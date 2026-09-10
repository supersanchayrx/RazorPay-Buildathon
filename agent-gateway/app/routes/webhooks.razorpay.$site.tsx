import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { findSite } from "../lib/sites.server";
import { verifyWebhookSignature } from "../lib/razorpay.server";
import { settlePayment } from "../lib/settle.server";
import { record } from "../lib/ledger.server";
import { release } from "../lib/reservations.server";
import { publicBodyFailure, readPublicText } from "../lib/http-security.server";

/**
 * Razorpay webhooks.
 *
 * The browser's success handler covers the happy path and nothing else. A
 * shopper who closes the tab, loses signal, or is redirected away by their bank
 * pays real money and we never hear about it — the order is missing, the stock
 * stays held, and the merchant finds out from a support email. That is the gap
 * this closes, and it is the difference between a checkout that demos and one
 * that can take money.
 *
 * THREE RULES, EACH OF WHICH IS A REAL VULNERABILITY IF BROKEN:
 *
 * 1. VERIFY BEFORE PARSING. The signature covers the RAW body, byte for byte.
 *    Parsing first and re-serialising to check changes whitespace and key
 *    order, so the signature never matches — and the usual "fix" is to stop
 *    checking. This endpoint is public and unauthenticated by design; the
 *    signature is the only thing standing between it and anyone who can POST.
 *
 * 2. NEVER TRUST THE BODY'S OWN AMOUNT AGAINST THE ORDER. Settlement compares
 *    what Razorpay says was paid with what we recorded asking for. A webhook
 *    that says "₹1 paid for order X" is exactly what a forged one would say.
 *
 * 3. ALWAYS RETURN 2xx ONCE VERIFIED. Razorpay retries non-2xx. If our own
 *    bookkeeping throws, retrying will not fix it, and the retries turn one
 *    broken order into a storm. Verified-but-unprocessable is logged loudly and
 *    acknowledged.
 */

export const loader = async (_: LoaderFunctionArgs) =>
  new Response(JSON.stringify({ error: "POST only" }), {
    status: 405,
    headers: { "content-type": "application/json" },
  });

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const site = findSite(params.site ?? null);
  if (!site?.razorpay) return ok({ error: "unknown site" }, 404);

  // Raw first. Nothing below may parse before the signature has been checked.
  let raw: string;
  try {
    raw = await readPublicText(request, "webhook");
  } catch (error) {
    const failure = publicBodyFailure(error);
    return ok({ error: failure.message, error_code: failure.code }, failure.status);
  }
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  if (!verifyWebhookSignature(site.razorpay, raw, signature)) {
    // Deliberately terse. An unauthenticated public endpoint should not narrate
    // why a signature failed — and a 401 here is correct: Razorpay does not
    // retry these, and there is nothing to retry.
    record({
      shop: site.key,
      kind: "payment_rejected",
      message: "webhook signature did not verify",
      detail: {
        configured: Boolean(site.razorpay.webhookSecretEnv),
        bytes: raw.length,
      },
    });
    return ok({ error: "invalid signature" }, 401);
  }

  let event: {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          order_id?: string;
          status?: string;
          amount?: number;
          currency?: string;
          method?: string;
        };
      };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return ok({ error: "unparseable body" }, 400);
  }

  const p = event.payload?.payment?.entity;
  const kind = event.event ?? "";

  // Everything from here returns 2xx: the message is genuine, so retrying it
  // gains nothing.
  if (!p?.order_id || !p.id) {
    record({
      shop: site.key,
      kind: "payment_rejected",
      message: `webhook ${kind} carried no payment entity`,
      detail: { event: kind },
    });
    return ok({ received: true, ignored: "no payment entity" });
  }

  if (kind === "payment.failed") {
    // Release immediately. Someone else should be able to buy what this
    // shopper's failed attempt was holding, without waiting out the TTL.
    release(p.order_id);
    record({
      shop: site.key,
      kind: "payment_rejected",
      message: `payment failed for ${p.order_id}`,
      detail: { paymentId: p.id, via: "webhook" },
    });
    return ok({ received: true });
  }

  if (kind !== "payment.captured" && kind !== "payment.authorized" && kind !== "order.paid") {
    return ok({ received: true, ignored: kind });
  }

  const outcome = settlePayment({
    shop: site.key,
    gatewayOrderId: p.order_id,
    gatewayPaymentId: p.id,
    gatewayStatus: p.status ?? "captured",
    method: p.method ?? null,
    amountMinor: Number(p.amount ?? 0),
    currency: p.currency ?? "INR",
    by: "webhook",
  });

  return ok({
    received: true,
    // Reported back for anyone reading delivery logs on Razorpay's side.
    duplicate: outcome.duplicate,
    mismatch: outcome.mismatch,
    orderRef: outcome.order?.id ?? null,
  });
};
