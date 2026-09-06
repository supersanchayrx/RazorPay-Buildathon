import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { findSite, allowedOrigin } from "../lib/sites.server";
import { buildQuote, type CartLineRequest } from "../lib/quote.server";
import { createOrder, publicKeyId, toMinorUnits, verifyPaymentSignature, fetchPayment } from "../lib/razorpay.server";
import { verifySessionToken } from "../lib/identity.server";
import { record } from "../lib/ledger.server";
import { claim, release } from "../lib/reservations.server";
import { savePending } from "../lib/orderstore.server";
import { settlePayment } from "../lib/settle.server";

/**
 * Money.
 *
 * The architecture divides everything into two kinds of thing: reads are tools
 * the reasoner may call freely, and speech and money are CHOKEPOINTS its output
 * merely passes through. This file is the money chokepoint. No reasoner reaches
 * it, no assistant can invoke it, and there is no argument a model could make
 * that would change what a basket costs.
 *
 * Three operations:
 *
 *   quote    price a basket from the catalogue. A read — moves nothing.
 *   start    create a Razorpay order for a freshly re-priced basket.
 *   confirm  verify what the browser claims happened, against Razorpay.
 *
 * The rule underneath all three: THE CLIENT SENDS WHAT, THE SERVER DECIDES HOW
 * MUCH. There is no field anywhere below through which a price can arrive.
 */

function cors(origin: string | null): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    ...(origin
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-max-age": "86400",
          vary: "Origin",
        }
      : {}),
  };
}

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: cors(origin) });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  return json({ error: "POST only" }, 405, origin);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get("Origin");

  let body: {
    site?: string;
    op?: "quote" | "start" | "confirm";
    items?: CartLineRequest[];
    session?: string;
    /** The storefront's handle for this basket, so settlement can close it. */
    ref?: string;
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "expected a JSON body" }, 400, origin);
  }

  const site = findSite(body.site ?? null);
  if (!site) return json({ error: "unknown site key" }, 404, origin);
  const ok = allowedOrigin(site, origin);
  if (!ok) return json({ error: "origin not allowed for this site" }, 403, origin);

  if (!site.razorpay) {
    return json({ error: "payments are not enabled for this store" }, 501, ok);
  }
  const ref = site.razorpay;

  // Identity is optional for checkout — a guest may buy. It is recorded when
  // present so an order can later be tied to an account, and its absence is
  // never inferred from anything the shopper typed.
  const verified = verifySessionToken(body.session, { site: site.key, secret: site.secret });
  const shopper = verified.ok ? verified.identity.sub : null;

  const catalog = jsonFeedCatalog(site.catalogFeedUrl);

  /* ---------------- quote ---------------- */
  if (body.op === "quote") {
    const result = await buildQuote({ catalog, items: body.items ?? [], shop: site.key });
    if (!result.ok) return json({ ok: false, problems: result.problems }, 200, ok);
    return json({ ok: true, quote: result.quote }, 200, ok);
  }

  /* ---------------- start ---------------- */
  if (body.op === "start") {
    // Re-priced here, from the catalogue, ignoring any quote the client is
    // holding. A quote handed back by the browser is a number the browser
    // chose, and the only safe response to that is to not look at it.
    const result = await buildQuote({ catalog, items: body.items ?? [], shop: site.key });
    if (!result.ok) {
      return json({ ok: false, problems: result.problems }, 200, ok);
    }
    const quote = result.quote;

    const order = await createOrder(ref, {
      amount: toMinorUnits(quote.total),
      currency: quote.currency,
      receipt: `np_${quote.fingerprint}_${Date.now().toString(36)}`,
      notes: {
        site: site.key,
        fingerprint: quote.fingerprint,
        ...(shopper ? { customer: shopper } : {}),
      },
    });

    if (!order.ok) {
      record({
        shop: site.key,
        kind: "payment_rejected",
        message: `order creation failed: ${order.source}/${order.reason}`,
        detail: { total: quote.total, fingerprint: quote.fingerprint },
      });
      return json({ ok: false, error: order.message, source: order.source }, 502, ok);
    }

    // Hold the stock, synchronously, before anyone else can be quoted it.
    // The catalogue read already happened above, so the numbers are in hand and
    // the claim needs no await — which is the whole point, because an await
    // between checking and taking is where a second shopper slips in.
    const onHand = new Map<string, number>();
    for (const l of quote.lines) {
      const p = await catalog.get(l.handle).catch(() => null);
      const v = p?.variants.find((x) => x.sku === l.sku);
      onHand.set(l.sku, v?.inventoryQuantity ?? 0);
    }
    const held = claim({
      shop: site.key,
      orderId: order.order.id,
      lines: quote.lines.map((l) => ({ sku: l.sku, qty: l.qty })),
      availableFromCatalogue: onHand,
    });
    if (!held.ok) {
      return json(
        {
          ok: false,
          problems: [
            {
              handle: "",
              sku: held.sku,
              reason: "insufficient_stock",
              available: held.available,
              message:
                held.available === 0
                  ? "Someone else is checking out with the last of that. Try again in a few minutes."
                  : `Only ${held.available} of that left right now.`,
            },
          ],
        },
        200,
        ok,
      );
    }

    // Persist the basket against the gateway order id. The webhook may need it
    // minutes later, from a different process, after the shopper has gone.
    savePending({
      gatewayOrderId: order.order.id,
      shop: site.key,
      createdAt: new Date().toISOString(),
      amount: quote.total,
      currency: quote.currency,
      fingerprint: quote.fingerprint,
      customer: shopper,
      // So settlement can mark exactly this basket bought, including when the
      // only report that arrives is the webhook.
      cartRef: typeof body.ref === "string" ? body.ref.slice(0, 120) : null,
      lines: quote.lines.map((l) => ({
        handle: l.handle,
        title: l.title,
        sku: l.sku,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    });

    record({
      shop: site.key,
      kind: "payment_started",
      message: `${order.order.id} for ${quote.currency} ${quote.total}`,
      detail: {
        orderId: order.order.id,
        amount: quote.total,
        fingerprint: quote.fingerprint,
        lines: quote.lines.map((l) => `${l.qty}x ${l.sku}`),
        identified: Boolean(shopper),
      },
    });

    return json(
      {
        ok: true,
        // key_id is public by design — Checkout needs it in the browser. The
        // secret is not in this response and has no path to one.
        keyId: publicKeyId(ref),
        orderId: order.order.id,
        amount: order.order.amount,
        currency: order.order.currency,
        quote,
      },
      200,
      ok,
    );
  }

  /* ---------------- confirm ---------------- */
  if (body.op === "confirm") {
    const orderId = String(body.razorpay_order_id ?? "");
    const paymentId = String(body.razorpay_payment_id ?? "");
    const signature = String(body.razorpay_signature ?? "");

    // The browser is not a trustworthy narrator of its own payment: the success
    // handler is JavaScript on a page anyone can open a console on.
    if (!verifyPaymentSignature(ref, { orderId, paymentId, signature })) {
      record({
        shop: site.key,
        kind: "payment_rejected",
        message: "signature did not verify",
        detail: { orderId, paymentId, identified: Boolean(shopper) },
      });
      return json({ ok: false, error: "That payment could not be verified." }, 400, ok);
    }

    // A valid signature proves the message is genuinely from Razorpay. It does
    // NOT prove the payment was captured, so the authoritative state is read
    // back rather than assumed.
    const p = await fetchPayment(ref, paymentId);
    if (!p.ok) {
      record({
        shop: site.key,
        kind: "payment_rejected",
        message: `could not read payment back: ${p.source}/${p.reason}`,
        detail: { orderId, paymentId },
      });
      return json({ ok: false, error: p.message }, 502, ok);
    }

    const captured = p.payment.status === "captured" || p.payment.status === "authorized";
    if (!captured || p.payment.order_id !== orderId) {
      record({
        shop: site.key,
        kind: "payment_rejected",
        message: `payment ${p.payment.status}, order ${p.payment.order_id === orderId ? "matches" : "MISMATCH"}`,
        detail: { orderId, paymentId, status: p.payment.status },
      });
      return json({ ok: false, error: "That payment has not completed." }, 400, ok);
    }

    // One settlement path, shared with the webhook. Whichever report arrives
    // first creates the order; this one may well be the second.
    const outcome = settlePayment({
      shop: site.key,
      gatewayOrderId: orderId,
      gatewayPaymentId: paymentId,
      gatewayStatus: p.payment.status,
      method: p.payment.method ?? null,
      amountMinor: p.payment.amount,
      currency: p.payment.currency,
      by: "browser",
    });

    if (outcome.mismatch) {
      return json({ ok: false, error: "That payment did not match the order total." }, 400, ok);
    }

    return json(
      {
        ok: true,
        paymentId,
        orderId,
        // Our order id, so the shopper has something to quote back — and so the
        // assistant can find it when they ask "where's my order?".
        orderRef: outcome.order?.id ?? null,
        status: p.payment.status,
        amount: p.payment.amount / 100,
        currency: p.payment.currency,
        // True when the webhook beat the browser here. Not an error: it means
        // the order was already safely recorded.
        alreadyRecorded: outcome.duplicate,
      },
      200,
      ok,
    );
  }

  return json({ error: "op must be quote, start or confirm" }, 400, ok);
};
