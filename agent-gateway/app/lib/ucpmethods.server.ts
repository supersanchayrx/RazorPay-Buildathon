/**
 * The thirteen UCP Shopping methods.
 *
 * NOTHING HERE IS A SECOND IMPLEMENTATION OF ANYTHING.
 *
 * That is the constraint that shaped this file. Every method delegates to the
 * code the human storefront already uses — `buildQuote` prices, `claim` holds
 * stock, `createOrder` takes money, `settlePayment` records it, `orders`
 * answers "where is it". If an agent could get a different price, a different
 * stock answer, or a different order record than a person clicking buttons,
 * then one of the two surfaces is lying, and we would have no way to know which.
 *
 * The mapping, method by method:
 *
 *   search_catalog / lookup_catalog / get_product   catalog.server.ts
 *   create_cart / get_cart / update_cart            buildQuote  (prices, no hold)
 *   cancel_cart                                     drop the session
 *   create_checkout                                 buildQuote + claim + createOrder
 *   get_checkout / update_checkout                  pending + placed order stores
 *   complete_checkout                               settlePayment  (shared with the webhook)
 *   cancel_checkout                                 release
 *   get_order                                       orders.server.ts + orderstore
 *
 * A CART DOES NOT HOLD STOCK; A CHECKOUT DOES. The spec calls a cart
 * "lightweight pre-purchase exploration", and that is exactly right: an agent
 * comparing five shops should not be able to freeze inventory at all five.
 */

import type { CatalogSource } from "./catalog.server";
import type { Site } from "./sites.server";
import { buildQuote, type CartLineRequest, type Quote, type QuoteProblem } from "./quote.server";
import { claim, release } from "./reservations.server";
import { createOrder, toMinorUnits } from "./razorpay.server";
import { savePending, findPending, findByGatewayOrder, placedOrders, mergeSources } from "./orderstore.server";
import { settlePayment } from "./settle.server";
import { jsonFeedOrders, seededOrders } from "./orders.server";
import { record } from "./ledger.server";
import {
  UCP_VERSION,
  okEnvelope,
  checkoutEnvelope,
  errorResponse,
  errorMessage,
  toUcpProduct,
  toUcpPolicies,
  parseId,
  variantGid,
  price,
  toMinor,
  type AgentIdentity,
  type UcpMessage,
} from "./ucp.server";

export type MethodContext = {
  site: Site;
  catalog: CatalogSource;
  agent: AgentIdentity | null;
  /** Absolute base URL of this gateway, for building continue_url. */
  baseUrl: string;
};

type Json = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 * Cart sessions
 * ------------------------------------------------------------------ */

type CartSession = {
  id: string;
  shop: string;
  items: CartLineRequest[];
  createdAt: number;
  buyer?: Json;
  context?: Json;
};

const CART_TTL_MS = 60 * 60_000;
const carts = new Map<string, CartSession>();

/**
 * Carts are in memory and disposable ON PURPOSE.
 *
 * A cart holds no stock and moves no money, so losing one to a restart costs an
 * agent one round trip to rebuild it. A checkout is different in kind — it has
 * a Razorpay order behind it and possibly a payment in flight — so checkouts
 * are persisted through `savePending`, on disk, where the webhook can find them
 * minutes later from another process. Different durability for different
 * consequences, rather than one storage decision applied to both.
 */
function sweepCarts(): void {
  const cutoff = Date.now() - CART_TTL_MS;
  for (const [id, c] of carts) if (c.createdAt < cutoff) carts.delete(id);
}

const rand = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ *
 * Shared shaping
 * ------------------------------------------------------------------ */

/**
 * Our quote problems as UCP messages.
 *
 * Severity is chosen from what the agent can actually do about it: a stock
 * shortfall is `recoverable` because reducing the quantity fixes it, while an
 * unknown product is `unrecoverable` because no amount of retrying that request
 * will make it exist.
 */
function problemsToMessages(problems: QuoteProblem[]): UcpMessage[] {
  const CODE: Record<QuoteProblem["reason"], { code: string; severity: UcpMessage["severity"] }> = {
    unknown_product: { code: "not_found", severity: "unrecoverable" },
    unknown_variant: { code: "not_found", severity: "unrecoverable" },
    out_of_stock: { code: "out_of_stock", severity: "recoverable" },
    insufficient_stock: { code: "out_of_stock", severity: "recoverable" },
    bad_quantity: { code: "invalid_request", severity: "recoverable" },
  };
  return problems.map((p) => {
    const m = CODE[p.reason] ?? { code: "invalid_request", severity: "recoverable" as const };
    return errorMessage(m.code, p.message, m.severity!);
  });
}

/**
 * A priced quote as UCP `line_items` and `totals`.
 *
 * The `totals` array is schema-constrained to exactly one `subtotal` and exactly
 * one `total`, with discounts strictly negative. Emitting a breakdown that does
 * not add up is the fastest way to have an agent quote a wrong figure to a
 * buyer, so the total is taken from the quote rather than recomputed here —
 * there is one authority for what a basket costs and it is `buildQuote`.
 */
function quoteToWire(quote: Quote) {
  const cur = quote.currency;
  const lineItems = quote.lines.map((l, i) => ({
    id: `li_${i + 1}_${l.sku}`,
    item: {
      id: variantGid(l.sku),
      title: l.variantTitle ? `${l.title} — ${l.variantTitle}` : l.title,
      price: price(l.unitPrice, cur),
    },
    quantity: l.qty,
    totals: [{ type: "subtotal", amount: toMinor(l.lineTotal, cur) }],
  }));

  const totals: Array<Json> = [
    { type: "subtotal", display_text: "Subtotal", amount: toMinor(quote.subtotal, cur) },
  ];
  // Merchant-approved offers, itemised. The schema requires a discount amount to
  // be strictly NEGATIVE — it is a reduction, and an agent that read a positive
  // number here would add it to the total and quote the buyer a higher price
  // than they will be charged.
  for (const o of quote.offers ?? []) {
    totals.push({
      type: "items_discount",
      display_text: `${o.percent}% off ${o.title}`,
      amount: -toMinor(o.amount, cur),
    });
  }
  if (quote.shipping > 0) {
    totals.push({ type: "fulfillment", display_text: "Shipping", amount: toMinor(quote.shipping, cur) });
  }
  totals.push({ type: "total", display_text: "Total", amount: toMinor(quote.total, cur) });

  return { line_items: lineItems, totals, currency: cur };
}

/**
 * UCP line items back into a cart request.
 *
 * NOTE WHAT IS DROPPED: `item.price`. An agent may send it — the schema marks it
 * `ucp_request: "omit"` but the field exists on the type — and we read straight
 * past it. There is no code path from an inbound price to a charged amount,
 * which is the same guarantee `quote.server.ts` makes for the browser. The
 * protocol agrees with us here; that is pleasant, but it is not what we rely on.
 */
function wireToItems(lineItems: unknown): CartLineRequest[] {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.map((raw) => {
    const li = raw as { item?: { id?: string }; id?: string; quantity?: unknown };
    const id = String(li.item?.id ?? li.id ?? "");
    const parsed = parseId(id);
    // Whether it arrived as a GID, a SKU or a handle, resolution happens against
    // the catalogue in `buildQuote`. `handle` doubles as the free-text slot.
    return {
      handle: parsed.kind === "product" ? parsed.value : "",
      sku: parsed.kind === "variant" ? parsed.value : parsed.kind === "unknown" ? parsed.value : undefined,
      qty: Number(li.quantity),
    };
  });
}

/**
 * A cart line whose only identifier was a SKU still needs a handle, because the
 * quote resolves products by handle first. Fill it in from the catalogue.
 */
async function resolveHandles(catalog: CatalogSource, items: CartLineRequest[]): Promise<CartLineRequest[]> {
  const out: CartLineRequest[] = [];
  for (const it of items) {
    if (it.handle) {
      out.push(it);
      continue;
    }
    const needle = it.sku ?? "";
    // Try it as a handle first — an agent that sent a bare handle lands here.
    const direct = await catalog.get(needle).catch(() => null);
    if (direct) {
      out.push({ handle: direct.handle, qty: it.qty });
      continue;
    }
    const all = await catalog.search({ limit: 200 }).catch(() => []);
    const hit = all.find((p) => p.variants.some((v) => v.sku === needle));
    out.push(
      hit
        ? { handle: hit.handle, sku: needle, qty: it.qty }
        : // Unresolvable. Passed through unchanged so `buildQuote` reports it as
          // `unknown_product` with the identifier the agent actually sent, which
          // is far more debuggable than a blank line.
          { handle: needle, sku: undefined, qty: it.qty },
    );
  }
  return out;
}

const orderSourceFor = (site: Site) => {
  const merchant = !site.orders
    ? null
    : site.orders.useSeedFixture
      ? seededOrders()
      : site.orders.feedUrl
        ? jsonFeedOrders(site.orders.feedUrl, site.secret)
        : null;
  return merchant ? mergeSources([placedOrders(site.key), merchant]) : placedOrders(site.key);
};

/* ------------------------------------------------------------------ *
 * Catalogue
 * ------------------------------------------------------------------ */

export async function search_catalog(ctx: MethodContext, params: Json): Promise<Json> {
  const req = (params.catalog ?? {}) as {
    query?: string;
    filters?: { price?: { min?: number; max?: number }; available?: boolean };
    pagination?: { limit?: number; cursor?: string };
  };

  const limit = Math.min(Math.max(Number(req.pagination?.limit) || 10, 1), 50);
  const cursor = Number(req.pagination?.cursor ?? 0) || 0;

  // Filters are HARD exclusions in UCP, unlike `context`, which is a soft
  // ranking signal. Mapping them onto the same search arguments the human
  // assistant uses keeps one ranking implementation rather than two.
  const products = await ctx.catalog.search({
    query: req.query,
    // UCP prices are minor units; ours are major. A filter compared in the
    // wrong unit silently returns everything or nothing.
    priceMin: req.filters?.price?.min != null ? req.filters.price.min / 100 : undefined,
    priceMax: req.filters?.price?.max != null ? req.filters.price.max / 100 : undefined,
    inStockOnly: req.filters?.available === true,
    limit: 200,
  });

  const page = products.slice(cursor, cursor + limit);
  const hasNext = cursor + limit < products.length;
  const policies = await ctx.catalog.policies().catch(() => ({}));

  return {
    ucp: okEnvelope(),
    products: page.map((p) => toUcpProduct(p)),
    pagination: {
      has_next_page: hasNext,
      ...(hasNext ? { cursor: String(cursor + limit) } : {}),
      total_count: products.length,
    },
    policies: toUcpPolicies(policies),
  };
}

export async function lookup_catalog(ctx: MethodContext, params: Json): Promise<Json> {
  const req = (params.catalog ?? {}) as { ids?: unknown };
  const ids = Array.isArray(req.ids) ? req.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) {
    return errorResponse("invalid_request", "lookup_catalog requires at least one id.", "unrecoverable");
  }

  const all = await ctx.catalog.search({ limit: 500 }).catch(() => []);
  // Keyed by product handle so several ids resolving to the same product return
  // one product carrying several correlations, which is what the schema asks
  // for — not the same product repeated.
  const found = new Map<string, { product: (typeof all)[number]; inputs: Map<string, string> }>();

  for (const raw of ids) {
    const parsed = parseId(raw);
    const value = parsed.value;

    if (parsed.kind === "product") {
      const p = all.find((x) => x.handle === value);
      if (p) {
        const e = found.get(p.handle) ?? { product: p, inputs: new Map() };
        // A product id does not name a variant, so the featured one stands in.
        for (const v of p.variants) if (v.sku) e.inputs.set(v.sku, "featured");
        found.set(p.handle, e);
      }
      continue;
    }

    // A variant id, or something unlabelled we try every way we can.
    const bySku = all.find((x) => x.variants.some((v) => v.sku === value));
    if (bySku) {
      const e = found.get(bySku.handle) ?? { product: bySku, inputs: new Map() };
      e.inputs.set(value, "exact");
      found.set(bySku.handle, e);
      continue;
    }
    const byHandle = all.find((x) => x.handle === value);
    if (byHandle) {
      const e = found.get(byHandle.handle) ?? { product: byHandle, inputs: new Map() };
      for (const v of byHandle.variants) if (v.sku) e.inputs.set(v.sku, "featured");
      found.set(byHandle.handle, e);
    }
  }

  const products = [...found.values()].map(({ product, inputs }) => {
    const wire = toUcpProduct(product) as Json & { variants: Array<Json & { sku?: string }> };
    return {
      ...wire,
      // `inputs` is REQUIRED on every variant in a lookup response: it tells the
      // agent which of the identifiers it sent produced this row. Without it an
      // agent that looked up ten ids cannot tell which two failed.
      variants: wire.variants.map((v) => ({
        ...v,
        inputs: [{ id: String(v.sku), match: inputs.get(String(v.sku)) ?? "featured" }],
      })),
    };
  });

  const missing = ids.filter((raw) => {
    const v = parseId(raw).value;
    return ![...found.values()].some(
      (e) => e.product.handle === v || e.product.variants.some((x) => x.sku === v),
    );
  });

  const policies = await ctx.catalog.policies().catch(() => ({}));
  return {
    ucp: okEnvelope(),
    products,
    ...(missing.length
      ? {
          // Reported rather than silently dropped. A short array is otherwise
          // indistinguishable from a typo in the agent's own request.
          messages: missing.map((id) =>
            errorMessage("not_found", `No product or variant matches "${id}".`, "unrecoverable"),
          ),
        }
      : {}),
    policies: toUcpPolicies(policies),
  };
}

export async function get_product(ctx: MethodContext, params: Json): Promise<Json> {
  const req = (params.catalog ?? {}) as { id?: string };
  const raw = String(req.id ?? "");
  if (!raw) return errorResponse("invalid_request", "get_product requires an id.", "unrecoverable");

  const parsed = parseId(raw);
  let product = await ctx.catalog.get(parsed.value).catch(() => null);
  if (!product) {
    const all = await ctx.catalog.search({ limit: 500 }).catch(() => []);
    product =
      all.find((p) => p.variants.some((v) => v.sku === parsed.value)) ??
      all.find((p) => p.handle === parsed.value) ??
      null;
  }
  if (!product) {
    return errorResponse("not_found", `No product matches "${raw}".`, "unrecoverable");
  }

  const policies = await ctx.catalog.policies().catch(() => ({}));
  return {
    ucp: okEnvelope(),
    product: toUcpProduct(product),
    policies: toUcpPolicies(policies),
  };
}

/* ------------------------------------------------------------------ *
 * Cart — priced, but holding nothing
 * ------------------------------------------------------------------ */

async function cartResponse(ctx: MethodContext, session: CartSession): Promise<Json> {
  const policies = await ctx.catalog.policies().catch(() => ({}));
  const result = await buildQuote({
    catalog: ctx.catalog,
    items: session.items,
    policies,
    // No `shop`, deliberately: a cart prices against the raw catalogue and does
    // not subtract other shoppers' held stock. Carts are exploration.
  });

  const base: Json = {
    ucp: okEnvelope(),
    id: session.id,
    ...(session.context ? { context: session.context } : {}),
    ...(session.buyer ? { buyer: session.buyer } : {}),
    policies: toUcpPolicies(policies),
    expires_at: new Date(session.createdAt + CART_TTL_MS).toISOString(),
    continue_url: `${ctx.baseUrl}/ucp/${ctx.site.key}/cart/${session.id}`,
  };

  if (!result.ok) {
    return {
      ...base,
      line_items: [],
      currency: "INR",
      // A cart that prices to nothing still needs the two mandatory entries, or
      // the response fails its own schema and the agent cannot read the errors
      // explaining why.
      totals: [
        { type: "subtotal", display_text: "Subtotal", amount: 0 },
        { type: "total", display_text: "Total", amount: 0 },
      ],
      messages: problemsToMessages(result.problems),
    };
  }

  return { ...base, ...quoteToWire(result.quote) };
}

export async function create_cart(ctx: MethodContext, params: Json): Promise<Json> {
  sweepCarts();
  const req = (params.cart ?? {}) as { line_items?: unknown; buyer?: Json; context?: Json };
  const items = await resolveHandles(ctx.catalog, wireToItems(req.line_items));

  const session: CartSession = {
    id: `cart_${rand()}`,
    shop: ctx.site.key,
    items,
    createdAt: Date.now(),
    buyer: req.buyer,
    context: req.context,
  };
  carts.set(session.id, session);
  return cartResponse(ctx, session);
}

export async function get_cart(ctx: MethodContext, params: Json): Promise<Json> {
  const session = carts.get(String(params.id ?? ""));
  if (!session || session.shop !== ctx.site.key) {
    return errorResponse("not_found", "That cart does not exist or has expired.", "unrecoverable");
  }
  return cartResponse(ctx, session);
}

export async function update_cart(ctx: MethodContext, params: Json): Promise<Json> {
  const session = carts.get(String(params.id ?? ""));
  if (!session || session.shop !== ctx.site.key) {
    return errorResponse("not_found", "That cart does not exist or has expired.", "unrecoverable");
  }
  const req = (params.cart ?? {}) as { line_items?: unknown; buyer?: Json; context?: Json };
  // "Full replacement on update", per the cart schema. Merging would make the
  // result depend on what the agent believed the cart already held, and two
  // agents on one cart would each see their own idea of it.
  if (req.line_items !== undefined) {
    session.items = await resolveHandles(ctx.catalog, wireToItems(req.line_items));
  }
  if (req.buyer !== undefined) session.buyer = req.buyer;
  if (req.context !== undefined) session.context = req.context;
  return cartResponse(ctx, session);
}

export async function cancel_cart(ctx: MethodContext, params: Json): Promise<Json> {
  const id = String(params.id ?? "");
  const session = carts.get(id);
  if (!session || session.shop !== ctx.site.key) {
    return errorResponse("not_found", "That cart does not exist or has expired.", "unrecoverable");
  }
  carts.delete(id);
  return {
    ucp: okEnvelope(),
    id,
    line_items: [],
    currency: "INR",
    totals: [
      { type: "subtotal", display_text: "Subtotal", amount: 0 },
      { type: "total", display_text: "Total", amount: 0 },
    ],
    messages: [{ type: "info", content: "Cart cancelled." }],
  };
}

/* ------------------------------------------------------------------ *
 * Checkout — the money chokepoint
 * ------------------------------------------------------------------ */

const checkoutId = (gatewayOrderId: string) => `chk_${gatewayOrderId}`;
const gatewayOrderIdOf = (id: string) => id.replace(/^chk_/, "");

/**
 * Every checkout response, built from the persisted pending record and whatever
 * the order store knows.
 *
 * The status is DERIVED, never stored:
 *
 *   completed              a settled order exists for this gateway order
 *   canceled               the payment was recorded as failed
 *   requires_escalation    money is still owed, and a human must pay it
 *
 * Deriving it means the two report paths — the browser and Razorpay's webhook —
 * cannot leave a checkout claiming a state that contradicts the order book.
 */
function checkoutResponse(
  ctx: MethodContext,
  gatewayOrderId: string,
  quoteWire: ReturnType<typeof quoteToWire>,
  extra: { policies: Json[]; messages?: UcpMessage[] },
): Json {
  const placed = findByGatewayOrder(gatewayOrderId);
  const id = checkoutId(gatewayOrderId);
  const payUrl = `${ctx.baseUrl}/pay/${ctx.site.key}/${gatewayOrderId}`;

  let status = "requires_escalation";
  let order: Json | undefined;
  const messages: UcpMessage[] = [...(extra.messages ?? [])];

  if (placed && (placed.status === "paid" || placed.status === "authorized")) {
    status = "completed";
    order = {
      id: placed.id,
      label: placed.id,
      permalink_url: `${ctx.baseUrl}/pay/${ctx.site.key}/${gatewayOrderId}`,
    };
  } else if (placed && placed.status === "failed") {
    status = "canceled";
    messages.push(
      errorMessage("payment_failed", "That payment did not complete.", "recoverable"),
    );
  } else {
    // The honest statement of where Indian rails actually are. UPI is a redirect
    // into the payer's own banking app — there is no token an agent can hold
    // that completes it. Saying so plainly, with a link that works, is worth
    // more to an agent than a capability we would fail at.
    messages.push(
      errorMessage(
        "requires_buyer_presence",
        "Payment needs the buyer. UPI, cards and netbanking here settle through Razorpay, which authenticates the payer directly — open the link to pay, then call complete_checkout or get_checkout.",
        "requires_buyer_input",
      ),
    );
  }

  return {
    ucp: checkoutEnvelope(ctx.site),
    id,
    ...quoteWire,
    status,
    policies: extra.policies,
    // Mandatory on every checkout, for legal display by the calling platform.
    links: [
      { type: "terms_of_use", url: `${ctx.baseUrl}/legal/terms`, title: "Terms" },
      { type: "privacy_policy", url: `${ctx.baseUrl}/legal/privacy`, title: "Privacy" },
    ],
    // MUST be present when status is requires_escalation. We send it always,
    // because a buyer wanting to look at their own checkout is not an error
    // state.
    continue_url: payUrl,
    ...(order ? { order } : {}),
    ...(messages.length ? { messages } : {}),
  };
}

export async function create_checkout(ctx: MethodContext, params: Json): Promise<Json> {
  // A read may be anonymous. Holding stock and opening a payment may not: this
  // is the point where an unattributable caller starts costing the merchant
  // something real.
  if (!ctx.agent?.verified) {
    return errorResponse(
      "identity_required",
      `Checkout requires a reachable UCP agent profile. ${ctx.agent?.reason ?? "None was supplied."}`,
      "unrecoverable",
    );
  }
  if (!ctx.site.razorpay) {
    return errorResponse(
      "payment_unavailable",
      "This store has not enabled agent payments.",
      "unrecoverable",
      ctx.site.origins[0],
    );
  }

  const req = (params.checkout ?? {}) as { line_items?: unknown; cart_id?: string; buyer?: Json };
  const fromCart = req.cart_id ? carts.get(String(req.cart_id)) : null;
  if (req.cart_id && (!fromCart || fromCart.shop !== ctx.site.key)) {
    return errorResponse("not_found", "That cart does not exist or has expired.", "unrecoverable");
  }

  // "Business MUST use cart contents and MUST ignore overlapping fields in the
  // checkout payload." So when a cart is named, its line items win outright.
  const items = fromCart
    ? fromCart.items
    : await resolveHandles(ctx.catalog, wireToItems(req.line_items));

  const policies = await ctx.catalog.policies().catch(() => ({}));

  // Priced here, from the catalogue, against stock other shoppers already hold.
  // Nothing the agent sent about money is read.
  const result = await buildQuote({ catalog: ctx.catalog, items, policies, shop: ctx.site.key });
  if (!result.ok) {
    return {
      ...errorResponse("invalid_request", "That basket could not be priced.", "recoverable"),
      messages: problemsToMessages(result.problems),
    };
  }
  const quote = result.quote;

  const order = await createOrder(ctx.site.razorpay, {
    amount: toMinorUnits(quote.total),
    currency: quote.currency,
    receipt: `ucp_${quote.fingerprint}_${Date.now().toString(36)}`,
    notes: { site: ctx.site.key, fingerprint: quote.fingerprint, agent: ctx.agent.host },
  });
  if (!order.ok) {
    record({
      shop: ctx.site.key,
      kind: "payment_rejected",
      message: `ucp order creation failed: ${order.source}/${order.reason}`,
      detail: { total: quote.total, agent: ctx.agent.host },
    });
    return errorResponse("payment_failed", order.message, "recoverable");
  }

  // Hold the stock synchronously — the catalogue reads are already done, so
  // there is no await between checking availability and taking it. That gap is
  // exactly where a second buyer gets sold the same last unit.
  const onHand = new Map<string, number>();
  for (const l of quote.lines) {
    const p = await ctx.catalog.get(l.handle).catch(() => null);
    onHand.set(l.sku, p?.variants.find((x) => x.sku === l.sku)?.inventoryQuantity ?? 0);
  }
  const held = claim({
    shop: ctx.site.key,
    orderId: order.order.id,
    lines: quote.lines.map((l) => ({ sku: l.sku, qty: l.qty })),
    availableFromCatalogue: onHand,
  });
  if (!held.ok) {
    return {
      ...errorResponse(
        "out_of_stock",
        held.available === 0
          ? "Someone else is checking out with the last of that."
          : `Only ${held.available} of that is available right now.`,
        "recoverable",
      ),
    };
  }

  savePending({
    gatewayOrderId: order.order.id,
    shop: ctx.site.key,
    createdAt: new Date().toISOString(),
    amount: quote.total,
    currency: quote.currency,
    fingerprint: quote.fingerprint,
    // An agent checkout has no verified shopper of its own. Leaving this null
    // rather than inventing one from the agent's profile keeps the rule that
    // order access is only ever granted to a proven person.
    customer: null,
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
    shop: ctx.site.key,
    kind: "payment_started",
    message: `ucp checkout ${order.order.id} for ${quote.currency} ${quote.total}`,
    detail: {
      orderId: order.order.id,
      amount: quote.total,
      agent: ctx.agent.host,
      agentProfile: ctx.agent.profile,
      lines: quote.lines.map((l) => `${l.qty}x ${l.sku}`),
    },
  });

  return checkoutResponse(ctx, order.order.id, quoteToWire(quote), {
    policies: toUcpPolicies(policies),
  });
}

/** Rebuild the wire form of a checkout from its persisted basket. */
function pendingWire(gatewayOrderId: string): ReturnType<typeof quoteToWire> | null {
  const p = findPending(gatewayOrderId);
  if (!p) return null;
  const subtotal = p.lines.reduce((s, l) => s + l.lineTotal, 0);
  // What was actually charged, less what the lines came to. Reconstructed as
  // shipping rather than re-deriving offers: the persisted record is the
  // authority on the amount, and re-reading live offers here would produce a
  // breakdown that no longer matches the payment order already registered with
  // Razorpay.
  const shipping = Math.max(0, p.amount - subtotal);
  return quoteToWire({
    lines: p.lines.map((l) => ({ ...l, variantTitle: "" })),
    subtotal,
    offers: [],
    discount: 0,
    shipping,
    total: p.amount,
    currency: p.currency,
    expiresAt: "",
    fingerprint: p.fingerprint,
  } as Quote);
}

export async function get_checkout(ctx: MethodContext, params: Json): Promise<Json> {
  const gid = gatewayOrderIdOf(String(params.id ?? ""));
  const pending = findPending(gid);
  if (!pending || pending.shop !== ctx.site.key) {
    return errorResponse("not_found", "No such checkout.", "unrecoverable");
  }
  const policies = await ctx.catalog.policies().catch(() => ({}));
  return checkoutResponse(ctx, gid, pendingWire(gid)!, { policies: toUcpPolicies(policies) });
}

export async function update_checkout(ctx: MethodContext, params: Json): Promise<Json> {
  const gid = gatewayOrderIdOf(String(params.id ?? ""));
  const pending = findPending(gid);
  if (!pending || pending.shop !== ctx.site.key) {
    return errorResponse("not_found", "No such checkout.", "unrecoverable");
  }

  // Once a Razorpay order exists for an amount, that amount is what the gateway
  // will accept. Editing the basket underneath it would leave the two
  // disagreeing, and the mismatch check in `settlePayment` would then reject a
  // genuine payment. Cancel and start again is the honest answer, and the spec
  // has an error severity that says exactly that.
  const policies = await ctx.catalog.policies().catch(() => ({}));
  return checkoutResponse(ctx, gid, pendingWire(gid)!, {
    policies: toUcpPolicies(policies),
    messages: [
      errorMessage(
        "immutable_checkout",
        "This checkout is bound to a payment order and cannot be edited. Cancel it and create another to change the basket.",
        "recoverable",
      ),
    ],
  });
}

/**
 * Complete a checkout with a payment the agent has already obtained.
 *
 * The instrument we accept is a Razorpay payment id. Everything that then
 * happens — verify against Razorpay, compare the amount, write the order — is
 * `settlePayment`, the SAME function the browser and the webhook call. Three
 * report paths, one settlement, idempotent on the gateway order id. An agent
 * completing a checkout the buyer already paid for in a browser gets the
 * existing order back, not a second one.
 */
export async function complete_checkout(ctx: MethodContext, params: Json): Promise<Json> {
  if (!ctx.agent?.verified) {
    return errorResponse(
      "identity_required",
      `complete_checkout requires a reachable UCP agent profile. ${ctx.agent?.reason ?? "None was supplied."}`,
      "unrecoverable",
    );
  }
  const gid = gatewayOrderIdOf(String(params.id ?? ""));
  const pending = findPending(gid);
  if (!pending || pending.shop !== ctx.site.key) {
    return errorResponse("not_found", "No such checkout.", "unrecoverable");
  }
  const policies = toUcpPolicies(await ctx.catalog.policies().catch(() => ({})));

  // Already settled? Report it and change nothing.
  const already = findByGatewayOrder(gid);
  if (already) return checkoutResponse(ctx, gid, pendingWire(gid)!, { policies });

  const req = (params.checkout ?? {}) as {
    payment?: { instruments?: Array<{ handler_id?: string; credential?: { token?: string } }> };
  };
  const instrument = req.payment?.instruments?.[0];
  const token = instrument?.credential?.token;

  if (!token) {
    // No instrument: this is escalation, not failure. The buyer pays at the
    // link and the agent calls again — or just polls get_checkout.
    return checkoutResponse(ctx, gid, pendingWire(gid)!, { policies });
  }
  if (instrument?.handler_id && instrument.handler_id !== "razorpay") {
    return errorResponse(
      "payment_failed",
      `This store settles through Razorpay. Handler "${instrument.handler_id}" is not supported.`,
      "recoverable",
    );
  }

  const { fetchPayment } = await import("./razorpay.server");
  const p = await fetchPayment(ctx.site.razorpay!, token);
  if (!p.ok) {
    return errorResponse("payment_failed", p.message, "recoverable");
  }
  // The agent names a payment; we check it belongs to THIS checkout. Without
  // this, one real payment could be replayed against every open order.
  if (p.payment.order_id !== gid) {
    record({
      shop: ctx.site.key,
      kind: "payment_rejected",
      message: `ucp complete: payment ${token} belongs to ${p.payment.order_id}, not ${gid}`,
      detail: { agent: ctx.agent.host },
    });
    return errorResponse(
      "payment_failed",
      "That payment does not belong to this checkout.",
      "unrecoverable",
    );
  }

  const outcome = settlePayment({
    shop: ctx.site.key,
    gatewayOrderId: gid,
    gatewayPaymentId: token,
    gatewayStatus: p.payment.status,
    method: p.payment.method ?? null,
    amountMinor: p.payment.amount,
    currency: p.payment.currency,
    by: "browser",
  });
  if (outcome.mismatch) {
    return errorResponse(
      "payment_failed",
      "That payment did not match the order total.",
      "unrecoverable",
    );
  }
  return checkoutResponse(ctx, gid, pendingWire(gid)!, { policies });
}

export async function cancel_checkout(ctx: MethodContext, params: Json): Promise<Json> {
  const gid = gatewayOrderIdOf(String(params.id ?? ""));
  const pending = findPending(gid);
  if (!pending || pending.shop !== ctx.site.key) {
    return errorResponse("not_found", "No such checkout.", "unrecoverable");
  }
  const placed = findByGatewayOrder(gid);
  if (placed && placed.status !== "failed") {
    return errorResponse(
      "invalid_request",
      "That checkout is already paid and cannot be cancelled here.",
      "unrecoverable",
    );
  }

  // The point of cancelling: the held units go back on sale immediately rather
  // than after the fifteen-minute reservation timeout. An agent that abandons a
  // basket should not cost the merchant a quarter of an hour of stock.
  release(gid);
  record({
    shop: ctx.site.key,
    kind: "payment_rejected",
    message: `ucp checkout ${gid} cancelled by agent`,
    detail: { agent: ctx.agent?.host ?? "unknown" },
  });

  const policies = toUcpPolicies(await ctx.catalog.policies().catch(() => ({})));
  return {
    ...checkoutResponse(ctx, gid, pendingWire(gid)!, { policies }),
    status: "canceled",
  };
}

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

/**
 * Read one order back.
 *
 * An agent may read an order it can name the id of, and only an order this
 * gateway itself placed. It CANNOT reach the merchant's own order history —
 * `orders.server.ts` requires a verified shopper identity for that, and an
 * agent profile is a URL, not a person. An order number is printed on a receipt
 * and shared in screenshots; treating it as proof of identity is the same
 * mistake as trusting a typed email, only harder to spot.
 */
export async function get_order(ctx: MethodContext, params: Json): Promise<Json> {
  const id = String(params.id ?? "");
  if (!id) return errorResponse("invalid_request", "get_order requires an id.", "unrecoverable");

  const gid = id.startsWith("cho_") ? `order_${id.slice(4)}` : gatewayOrderIdOf(id);
  const placed = findByGatewayOrder(gid);
  if (!placed || placed.shop !== ctx.site.key) {
    return errorResponse(
      "not_found",
      "No order with that id was placed through this agent endpoint.",
      "unrecoverable",
    );
  }

  const cur = placed.currency;
  const subtotal = placed.lines.reduce((s, l) => s + l.lineTotal, 0);
  const totals: Json[] = [
    { type: "subtotal", display_text: "Subtotal", amount: toMinor(subtotal, cur) },
  ];
  if (placed.amount > subtotal) {
    totals.push({
      type: "fulfillment",
      display_text: "Shipping",
      amount: toMinor(placed.amount - subtotal, cur),
    });
  }
  totals.push({ type: "total", display_text: "Total", amount: toMinor(placed.amount, cur) });

  return {
    ucp: { version: UCP_VERSION, status: "success" },
    id: placed.id,
    label: placed.id,
    checkout_id: checkoutId(placed.gatewayOrderId),
    permalink_url: `${ctx.baseUrl}/pay/${ctx.site.key}/${placed.gatewayOrderId}`,
    line_items: placed.lines.map((l, i) => ({
      id: `li_${i + 1}_${l.sku}`,
      item: { id: variantGid(l.sku), title: l.title, price: price(l.unitPrice, cur) },
      quantity: { original: l.qty, total: l.qty, fulfilled: 0 },
      totals: [{ type: "subtotal", amount: toMinor(l.lineTotal, cur) }],
      status: "processing",
    })),
    fulfillment: {
      // Deliberately empty. We hold no carrier data, and an invented "arrives
      // Tuesday" is a promise made on the merchant's behalf that the merchant
      // never made. Same rule as `describeOrder`.
      expectations: [],
      events: [],
    },
    currency: cur,
    totals,
  };
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export type MethodFn = (ctx: MethodContext, params: Json) => Promise<Json>;

export const METHODS: Record<string, MethodFn> = {
  search_catalog,
  lookup_catalog,
  get_product,
  create_cart,
  get_cart,
  update_cart,
  cancel_cart,
  create_checkout,
  get_checkout,
  update_checkout,
  complete_checkout,
  cancel_checkout,
  get_order,
};

/** Test seam: drop every in-memory cart between check runs. */
export function _resetCarts(): void {
  carts.clear();
}
