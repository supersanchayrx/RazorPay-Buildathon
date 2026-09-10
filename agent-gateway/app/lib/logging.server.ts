import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { MiddlewareFunction } from "react-router";

const REQUEST_ID_HEADER = "X-Request-ID";
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SENSITIVE_KEY =
  /authorization|cookie|credential|password|secret|signature|token|api[-_]?key|email|phone|contact|otp|session/i;

type LogLevel = "info" | "warn" | "error";
type LogFields = Record<string, unknown>;
type RequestLogContext = { requestId: string };

const requestLogContext = new AsyncLocalStorage<RequestLogContext>();

function redactText(input: string): string {
  return input
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\b(?:sk|pk|rzp)_(?:test|live)_[A-Za-z0-9_-]+\b/gi, "[redacted-key]")
    .replace(/\+\d[\d\s().-]{8,}\d/g, "[redacted-phone]")
    .replace(/\b\d{10,15}\b/g, "[redacted-phone]")
    .replace(
      /([?&](?:token|secret|signature|key|password|email|phone)=)[^&#\s]*/gi,
      "$1[redacted]",
    );
}

/** Convert arbitrary diagnostic values into bounded, JSON-safe, redacted data. */
export function redactLogValue(
  value: unknown,
  key = "",
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactText(value).slice(0, 2_000);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (depth >= 5) return "[truncated]";

  if (value instanceof Error) {
    return {
      name: redactText(value.name),
      message: redactText(value.message).slice(0, 2_000),
    };
  }

  if (typeof value !== "object") return redactText(String(value));
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactLogValue(item, "", depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 50)) {
    output[childKey] = redactLogValue(childValue, childKey, depth + 1, seen);
  }
  return output;
}

export function requestIdFor(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
}

export function currentRequestId(): string | undefined {
  return requestLogContext.getStore()?.requestId;
}

export function writeLog(level: LogLevel, event: string, fields: LogFields = {}): void {
  const safeFields = redactLogValue(fields) as LogFields;
  const entry = {
    ...safeFields,
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(currentRequestId() ? { request_id: currentRequestId() } : {}),
  };
  // One JSON object per line is directly consumable by Docker and log collectors.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

export const logInfo = (event: string, fields?: LogFields) => writeLog("info", event, fields);
export const logWarn = (event: string, fields?: LogFields) => writeLog("warn", event, fields);
export const logError = (event: string, fields: LogFields = {}) => writeLog("error", event, {
  error_code: event.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""),
  ...fields,
});

function responseWithRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const exposed = headers.get("Access-Control-Expose-Headers")
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean) ?? [];
  if (!exposed.some((name) => name.toLowerCase() === REQUEST_ID_HEADER.toLowerCase())) {
    headers.set("Access-Control-Expose-Headers", [...exposed, REQUEST_ID_HEADER].join(", "));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const requestLoggingMiddleware: MiddlewareFunction<Response> = async (
  { request },
  next,
) => {
  const requestId = requestIdFor(request);
  const started = performance.now();
  const url = new URL(request.url);

  return requestLogContext.run({ requestId }, async () => {
    try {
      const response = await next();
      const fields = {
        method: request.method,
        path: url.pathname,
        status: response.status,
        duration_ms: Math.round(performance.now() - started),
      };
      if (response.status >= 400) {
        logError("http.request.error_response", {
          ...fields,
          error_code: `HTTP_${response.status}`,
          message: `Request returned HTTP ${response.status}`,
        });
      } else {
        logInfo("http.request.completed", fields);
      }
      return responseWithRequestId(response, requestId);
    } catch (error) {
      const status = error instanceof Response ? error.status : 500;
      logError("http.request.failed", {
        error_code: error instanceof Response ? `HTTP_${status}` : "HTTP_UNHANDLED_ERROR",
        message: error instanceof Response
          ? `Request threw HTTP ${status}`
          : "Unhandled error while processing request",
        method: request.method,
        path: url.pathname,
        status,
        duration_ms: Math.round(performance.now() - started),
        ...(error instanceof Response ? {} : { error }),
      });
      if (error instanceof Response) throw responseWithRequestId(error, requestId);
      throw error;
    }
  });
};
