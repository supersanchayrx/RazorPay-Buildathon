import type { MiddlewareFunction } from "react-router";
import { currentRequestId, logWarn } from "./logging.server";

export const PUBLIC_BODY_LIMITS = {
  chat: 64 * 1024,
  agent: 128 * 1024,
  identity: 64 * 1024,
  recovery: 32 * 1024,
  voice: 64 * 1024,
  webhook: 256 * 1024,
} as const;

type GuardName = keyof typeof PUBLIC_BODY_LIMITS;
type Guard = {
  name: GuardName;
  capacity: number;
  refillPerSecond: number;
};

const GUARDS: Array<{ pattern: RegExp; guard: Guard }> = [
  { pattern: /^\/(?:embed\/chat|proxy\/chat)\/?$/, guard: { name: "chat", capacity: 12, refillPerSecond: 0.5 } },
  { pattern: /^\/ucp\/[^/]+\/(?:mcp|agentview|llms\.txt|profile)\/?$/, guard: { name: "agent", capacity: 30, refillPerSecond: 2 } },
  { pattern: /^\/(?:embed\/(?:cart|checkout|memory)|pay\/[^/]+\/[^/]+)\/?$/, guard: { name: "identity", capacity: 30, refillPerSecond: 1 } },
  { pattern: /^\/(?:recover|restore)\/[^/]+\/[^/]+\/?$/, guard: { name: "recovery", capacity: 12, refillPerSecond: 0.25 } },
  { pattern: /^\/voice\/(?:turn|reply|status|twiml)\/[^/]+\/[^/]+\/?$/, guard: { name: "voice", capacity: 40, refillPerSecond: 2 } },
  { pattern: /^\/webhooks\/(?:razorpay\/[^/]+|app\/(?:scopes[-_]update|uninstalled))\/?$/, guard: { name: "webhook", capacity: 120, refillPerSecond: 4 } },
];

type Bucket = { tokens: number; updatedAt: number; lastSeen: number };
const buckets = new Map<string, Bucket>();
let requestsSinceSweep = 0;

export class PublicBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: "HTTP_BODY_INVALID" | "HTTP_BODY_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "PublicBodyError";
  }
}

function guardFor(pathname: string): Guard | null {
  return GUARDS.find(({ pattern }) => pattern.test(pathname))?.guard ?? null;
}

function clientAddress(request: Request): string {
  // The production Express wrapper always overwrites this header from the
  // socket (or its explicitly trusted proxy). Never read X-Forwarded-For here.
  return request.headers.get("x-chapman-client-address")?.slice(0, 128) || "unresolved";
}

function consume(key: string, guard: Guard, now: number): number {
  const current = buckets.get(key) ?? { tokens: guard.capacity, updatedAt: now, lastSeen: now };
  current.tokens = Math.min(
    guard.capacity,
    current.tokens + Math.max(0, now - current.updatedAt) / 1000 * guard.refillPerSecond,
  );
  current.updatedAt = now;
  current.lastSeen = now;
  if (current.tokens >= 1) {
    current.tokens -= 1;
    buckets.set(key, current);
    return 0;
  }
  buckets.set(key, current);
  return Math.max(1, Math.ceil((1 - current.tokens) / guard.refillPerSecond));
}

function errorResponse(status: 400 | 413 | 429, code: string, message: string, request: Request, retryAfter?: number) {
  const origin = request.headers.get("origin");
  return Response.json(
    { error: message, error_code: code, ...(currentRequestId() ? { request_id: currentRequestId() } : {}) },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...(retryAfter ? { "retry-after": String(retryAfter) } : {}),
        ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
      },
    },
  );
}

export const publicRequestGuardMiddleware: MiddlewareFunction<Response> = async (
  { request },
  next,
) => {
  if (["HEAD", "OPTIONS"].includes(request.method)) return next();
  const url = new URL(request.url);
  const guard = guardFor(url.pathname);
  if (!guard) return next();

  const declared = request.headers.get("content-length");
  if (declared) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0) {
      return errorResponse(400, "HTTP_BODY_INVALID", "Invalid Content-Length header", request);
    }
    if (size > PUBLIC_BODY_LIMITS[guard.name]) {
      logWarn("http.request.body_rejected", { error_code: "HTTP_BODY_TOO_LARGE", surface: guard.name, declared_bytes: size });
      return errorResponse(413, "HTTP_BODY_TOO_LARGE", "Request body is too large", request);
    }
  }

  const now = Date.now();
  const retryAfter = consume(`${guard.name}:${clientAddress(request)}`, guard, now);
  if (retryAfter) {
    logWarn("http.request.rate_limited", { error_code: "HTTP_RATE_LIMITED", surface: guard.name, retry_after_seconds: retryAfter });
    return errorResponse(429, "HTTP_RATE_LIMITED", "Too many requests", request, retryAfter);
  }

  // Opportunistic cleanup keeps this process-local demo limiter bounded.
  if (++requestsSinceSweep % 1_000 === 0) {
    for (const [key, bucket] of buckets) if (now - bucket.lastSeen > 15 * 60_000) buckets.delete(key);
  }
  return next();
};

async function readBounded(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body limit exceeded").catch(() => undefined);
        throw new PublicBodyError(413, "HTTP_BODY_TOO_LARGE", "Request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readPublicJson<T>(request: Request, surface: GuardName): Promise<T> {
  const bytes = await readBounded(request, PUBLIC_BODY_LIMITS[surface]);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new PublicBodyError(400, "HTTP_BODY_INVALID", "Expected a JSON body");
  }
}

export async function readPublicText(request: Request, surface: GuardName): Promise<string> {
  return new TextDecoder().decode(await readBounded(request, PUBLIC_BODY_LIMITS[surface]));
}

export async function readPublicFormData(request: Request, surface: GuardName): Promise<FormData> {
  const bytes = await readBounded(request, PUBLIC_BODY_LIMITS[surface]);
  try {
    return await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "application/x-www-form-urlencoded" },
      body: bytes.buffer,
    }).formData();
  } catch {
    throw new PublicBodyError(400, "HTTP_BODY_INVALID", "Expected a valid form body");
  }
}

export function publicBodyFailure(error: unknown): { status: 400 | 413; code: string; message: string } {
  return error instanceof PublicBodyError
    ? { status: error.status, code: error.code, message: error.message }
    : { status: 400, code: "HTTP_BODY_INVALID", message: "Invalid request body" };
}

/** Test-only reset; exported so checks do not depend on wall-clock sleeps. */
export function resetPublicRateLimits(): void {
  buckets.clear();
  requestsSinceSweep = 0;
}
