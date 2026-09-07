/** Create the same discounted Razorpay checkout from web or voice recovery. */
import { jsonFeedCatalog } from "./catalog.server";
import type { RecoveryGrant, GrantState } from "./grants.server";
import { redeem } from "./grants.server";
import { record } from "./ledger.server";
import { savePending } from "./orderstore.server";
import { buildQuote } from "./quote.server";
import { createOrder, isConfigured, toMinorUnits } from "./razorpay.server";
import type { RecoveryCart } from "./recovery-context.server";
import { claim } from "./reservations.server";
import type { Site } from "./sites.server";

export type RecoveryCheckoutResult =
  | { ok: true; gatewayOrderId: string; total: number; path: string }
  | { ok: false; error: string };

export async function createRecoveryCheckout(input: {
  site: Site;
  cart: RecoveryCart;
  customerId: string;
  grant: RecoveryGrant & {
    state: GrantState;
    redeemedOrderId?: string;
  };
}): Promise<RecoveryCheckoutResult> {
  const { site, cart, customerId, grant } = input;
  if (
    grant.shop !== site.key ||
    grant.cartId !== cart.id ||
    grant.customerId !== customerId
  ) {
    return {
      ok: false,
      error: "The recovery grant does not match this basket.",
    };
  }
  if (grant.state === "redeemed" && grant.redeemedOrderId) {
    return {
      ok: true,
      gatewayOrderId: grant.redeemedOrderId,
      total: 0,
      path: `/pay/${site.key}/${grant.redeemedOrderId}`,
    };
  }
  if (grant.state !== "live")
    return { ok: false, error: "That discount has expired." };
  if (!site.razorpay || !isConfigured(site.razorpay)) {
    return {
      ok: false,
      error: "This shop cannot create Razorpay orders right now.",
    };
  }

  const catalog = jsonFeedCatalog(site.catalogFeedUrl);
  const quoted = await buildQuote({
    catalog,
    items: cart.lines.map((line) => ({
      handle: line.handle,
      sku: line.sku,
      qty: line.qty,
    })),
    shop: site.key,
    grantId: grant.id,
  });
  if (!quoted.ok) {
    return {
      ok: false,
      error:
        quoted.problems[0]?.message ??
        "That basket cannot be priced right now.",
    };
  }
  const quote = quoted.quote;
  const order = await createOrder(site.razorpay, {
    amount: toMinorUnits(quote.total),
    currency: quote.currency,
    receipt: `rc_${quote.fingerprint}_${Date.now().toString(36)}`,
    notes: {
      site: site.key,
      fingerprint: quote.fingerprint,
      customer: customerId,
      grant: grant.id,
    },
  });
  if (!order.ok) return { ok: false, error: order.message };

  const onHand = new Map<string, number>();
  for (const line of quote.lines) {
    const product = await catalog.get(line.handle).catch(() => null);
    onHand.set(
      line.sku,
      product?.variants.find((variant) => variant.sku === line.sku)
        ?.inventoryQuantity ?? 0,
    );
  }
  const held = claim({
    shop: site.key,
    orderId: order.order.id,
    lines: quote.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
    availableFromCatalogue: onHand,
  });
  if (!held.ok) {
    return {
      ok: false,
      error:
        "Someone else is checking out with the last item. Try again shortly.",
    };
  }

  const spent = redeem(site.key, grant.id, order.order.id);
  if (!spent.ok)
    return { ok: false, error: "That discount has already been used." };

  savePending({
    gatewayOrderId: order.order.id,
    shop: site.key,
    createdAt: new Date().toISOString(),
    amount: quote.total,
    currency: quote.currency,
    fingerprint: quote.fingerprint,
    customer: customerId,
    cartRef: cart.id,
    recoveryGrantId: grant.id,
    lines: quote.lines.map((line) => ({
      handle: line.handle,
      title: line.title,
      sku: line.sku,
      qty: line.qty,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
  });
  record({
    shop: site.key,
    kind: "payment_started",
    message: `recovery checkout ${order.order.id} for ${quote.total} ${quote.currency}`,
    detail: { grant: grant.id, discount: quote.discount, cartId: cart.id },
  });

  return {
    ok: true,
    gatewayOrderId: order.order.id,
    total: quote.total,
    path: `/pay/${site.key}/${order.order.id}`,
  };
}
