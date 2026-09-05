/**
 * Razorpay client.
 *
 * Direct HTTP rather than the SDK — the surface we need is four calls, and a
 * dependency that wraps `fetch` in exchange for a supply-chain risk on the
 * money path is a poor trade.
 *
 * THE KEY ID IS PUBLIC. THE KEY SECRET IS NOT.
 *
 * `key_id` has to reach the browser: Razorpay Checkout is handed it to open the
 * payment sheet. `key_secret` authenticates order creation and signs the
 * receipt, and it must never leave this process. Everything in this file is
 * arranged so that distinction cannot blur — credentials arrive as env variable
 * NAMES, are resolved at the point of use, and are never returned, logged, or
 * placed in any object that crosses a response boundary.
 */
import crypto from "node:crypto";
import { secret } from "./env.server";

const API = "https://api.razorpay.com/v1";

/**
 * Credentials by variable name, never by value.
 *
 * The site registry holds one of these. It can safely be logged, serialised,
 * or rendered into a diagnostics page, because it contains no secret — only the
 * name of one.
 */
export type RazorpayRef = {
  keyIdEnv: string;
  keySecretEnv: string;
  /** For webhook verification, when we get there. */
  webhookSecretEnv?: string;
};

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
  created_at: number;
};

/**
 * Typed failures, not prose.
 *
 * The reason a call failed decides what happens next, and matching on error
 * strings is how retry logic rots. This mirrors Razorpay's own envelope, whose
 * shape is the right one: `source` says whose problem it is, `reason` says what
 * to do, and the pair forms a grid rather than a lookup.
 */
export type RazorpayFailure = {
  ok: false;
  /** ours: misconfiguration. theirs: gateway/bank. buyer: their input. */
  source: "ours" | "theirs" | "buyer";
  reason: string;
  /** Safe to show a shopper. Never contains gateway internals. */
  message: string;
  status?: number;
};

export type Result<T> = ({ ok: true } & T) | RazorpayFailure;

function auth(ref: RazorpayRef): { header: string; keyId: string } | null {
  const id = secret(ref.keyIdEnv);
  const key = secret(ref.keySecretEnv);
  if (!id || !key) return null;
  return {
    header: "Basic " + Buffer.from(`${id}:${key}`).toString("base64"),
    keyId: id,
  };
}

/** The public half, for the browser. Returns null when payments are not set up. */
export function publicKeyId(ref: RazorpayRef): string | null {
  return secret(ref.keyIdEnv);
}

export function isConfigured(ref: RazorpayRef): boolean {
  return Boolean(secret(ref.keyIdEnv) && secret(ref.keySecretEnv));
}

/**
 * Create an order.
 *
 * `amount` is in the smallest currency unit — paise for INR. Passing rupees
 * here undercharges by a factor of a hundred, and it is silent: the payment
 * succeeds, the shopper is delighted, and the merchant is short. Callers must
 * go through `toMinorUnits` rather than doing the multiplication inline.
 */
export async function createOrder(
  ref: RazorpayRef,
  o: {
    /** Minor units. Paise, not rupees. */
    amount: number;
    currency: string;
    /** Our own reference. Razorpay caps this at 40 characters. */
    receipt: string;
    notes?: Record<string, string>;
  },
): Promise<Result<{ order: RazorpayOrder }>> {
  const a = auth(ref);
  if (!a) {
    return {
      ok: false,
      source: "ours",
      reason: "not_configured",
      message: "Payments are not set up for this store yet.",
    };
  }
  if (!Number.isInteger(o.amount) || o.amount < 100) {
    // Razorpay's own floor is ₹1. A non-integer would be rejected anyway, but
    // failing here means the mistake is attributed to us rather than to them.
    return {
      ok: false,
      source: "ours",
      reason: "invalid_amount",
      message: "That total could not be prepared for payment.",
    };
  }

  let res: Response;
  try {
    res = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { authorization: a.header, "content-type": "application/json" },
      body: JSON.stringify({
        amount: o.amount,
        currency: o.currency,
        receipt: o.receipt.slice(0, 40),
        notes: o.notes ?? {},
      }),
    });
  } catch (e) {
    return {
      ok: false,
      source: "theirs",
      reason: "unreachable",
      message: "We could not reach the payment provider. Please try again.",
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: { code?: string; description?: string; source?: string; reason?: string };
  } & Partial<RazorpayOrder>;

  if (!res.ok || !body.id) {
    return {
      ok: false,
      // 5xx is theirs; 4xx on order creation is almost always our request.
      source: res.status >= 500 ? "theirs" : "ours",
      reason: body.error?.reason ?? body.error?.code ?? `http_${res.status}`,
      // Razorpay's description can name internal fields, so it is not shown to
      // a shopper — it goes to the ledger, where the merchant can read it.
      message: "We could not start the payment. Please try again.",
      status: res.status,
    };
  }

  return { ok: true, order: body as RazorpayOrder };
}

/**
 * Verify what Checkout hands back.
 *
 * This is the step that separates "the browser says it paid" from "it paid".
 * The browser is not a trustworthy narrator of its own payment: the success
 * handler is JavaScript on a page anyone can open a console on. Without this
 * check, a `POST` claiming success is a free order.
 */
export function verifyPaymentSignature(
  ref: RazorpayRef,
  p: { orderId: string; paymentId: string; signature: string },
): boolean {
  const key = secret(ref.keySecretEnv);
  if (!key || !p.orderId || !p.paymentId || !p.signature) return false;
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${p.orderId}|${p.paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(p.signature);
  // Length first: timingSafeEqual throws on a mismatch, which would be both a
  // crash and a timing signal.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Webhook bodies are signed over the RAW body — parse after verifying, never before. */
export function verifyWebhookSignature(
  ref: RazorpayRef,
  rawBody: string,
  signature: string,
): boolean {
  const key = ref.webhookSecretEnv ? secret(ref.webhookSecretEnv) : null;
  if (!key || !signature) return false;
  const expected = crypto.createHmac("sha256", key).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The authoritative state of a payment, from Razorpay rather than the browser.
 *
 * A valid signature proves the browser is relaying a genuine Razorpay result.
 * It does not prove the payment was captured, or that the amount matches what
 * we asked for — so anything that turns into a fulfilled order checks here too.
 */
export async function fetchPayment(
  ref: RazorpayRef,
  paymentId: string,
): Promise<Result<{ payment: { id: string; status: string; amount: number; currency: string; order_id: string; method?: string } }>> {
  const a = auth(ref);
  if (!a) {
    return { ok: false, source: "ours", reason: "not_configured", message: "Payments are not set up." };
  }
  try {
    const res = await fetch(`${API}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { authorization: a.header },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.id !== "string") {
      return {
        ok: false,
        source: res.status >= 500 ? "theirs" : "ours",
        reason: `http_${res.status}`,
        message: "We could not confirm the payment.",
        status: res.status,
      };
    }
    return { ok: true, payment: body as never };
  } catch {
    return { ok: false, source: "theirs", reason: "unreachable", message: "We could not confirm the payment." };
  }
}

/**
 * Rupees to paise.
 *
 * Rounded, not truncated, and asserted to be an integer. Floating point makes
 * `1.15 * 100` equal 114.99999999999999, and `Math.trunc` on that quietly
 * undercharges by a paisa on every order that hits it.
 */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export const fromMinorUnits = (minor: number): number => minor / 100;
