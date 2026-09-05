/**
 * Binding quotes.
 *
 * THE ONE RULE:
 *
 *   The client sends WHAT it wants. The server decides WHAT IT COSTS.
 *
 * A checkout that accepts an `amount` from the browser is a shop that sells a
 * ₹2,450 kettle for ₹1 to anyone who opens the console. It is the oldest bug in
 * e-commerce and it is still the most common, because the insecure version is
 * the one that is easier to write and looks identical when you test it
 * honestly.
 *
 * So a cart line here is `{handle, sku, qty}` and nothing else. There is no
 * field for a price, which means there is no code path that could trust one.
 * Every number below is looked up from the catalogue at quote time.
 *
 * A quote is also the thing an agent gets asked for — "what would this cost,
 * delivered here" — so it is a read tool, not a chokepoint. Producing one moves
 * no money. Only `handoff` does that.
 */
import type { CatalogSource, ShopPolicies } from "./catalog.server";
import { committed } from "./reservations.server";
import { activeOffers } from "./approvals.server";
import { findGrant, priceable } from "./grants.server";

/** What a client may ask for. Note the absence of any price field. */
export type CartLineRequest = {
  handle: string;
  /** Optional: without it, the cheapest in-stock variant is used. */
  sku?: string;
  qty: number;
};

export type QuoteLine = {
  handle: string;
  title: string;
  sku: string;
  variantTitle: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type AppliedOffer = {
  handle: string;
  title: string;
  percent: number;
  /** Rupees taken off, computed here and nowhere else. */
  amount: number;
  endsAt: string;
};

export type Quote = {
  lines: QuoteLine[];
  subtotal: number;
  /**
   * Merchant-approved offers applied to this basket, and what each was worth.
   *
   * THIS IS THE ONLY PLACE A DISCOUNT BECOMES A NUMBER. The assistant may
   * announce that an offer exists; it cannot compute one, and there is no field
   * through which it could send one. Same rule as the unit price: the client
   * says what it wants and the server says what it costs.
   */
  offers: AppliedOffer[];
  /** Total taken off, always positive. Zero when no offer applies. */
  discount: number;
  shipping: number;
  total: number;
  currency: string;
  /**
   * Prices and stock move. A quote that never expires is a promise the
   * catalogue has not agreed to keep.
   */
  expiresAt: string;
  /** Stable hash of the priced contents, so a later payment can be tied to it. */
  fingerprint: string;
};

export type QuoteProblem = {
  handle: string;
  sku?: string;
  reason: "unknown_product" | "unknown_variant" | "out_of_stock" | "insufficient_stock" | "bad_quantity";
  /** Plain enough to show a shopper. */
  message: string;
  available?: number;
};

export type QuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; problems: QuoteProblem[] };

const MAX_QTY_PER_LINE = 20;
const MAX_LINES = 20;
const QUOTE_TTL_MINUTES = 15;

/**
 * Free shipping threshold, read from the merchant's own policy text where we
 * can, and otherwise from a conservative default.
 *
 * Parsing a number out of prose is fragile, so this is deliberately narrow: it
 * matches the one shape the demo store writes and falls back rather than
 * guessing. A shipping rule invented from a misread sentence is a promise the
 * merchant never made.
 */
/**
 * The threshold above which delivery is free, read from the merchant's own
 * policy text.
 *
 * Exported because the recovery agent needs it for a genuinely useful, entirely
 * true sentence: a shopper who abandoned over a ₹60 delivery charge, ₹140 short
 * of free delivery, should be told that. It is a fact about the shop's own
 * published policy, not a concession — which is exactly the kind of remedy this
 * system should reach for before it reaches for money.
 */
export function freeShippingThreshold(policies: ShopPolicies): number {
  const free = policies.shipping?.match(/free (?:shipping|delivery)[^\d]{0,20}(\d[\d,]*)/i);
  return free ? Number(free[1].replace(/,/g, "")) : 1200;
}

function shippingFor(subtotal: number, policies: ShopPolicies): number {
  return subtotal >= freeShippingThreshold(policies) ? 0 : 60;
}


function fingerprint(lines: QuoteLine[], total: number, currency: string): string {
  const body = lines
    .map((l) => `${l.sku}x${l.qty}@${l.unitPrice}`)
    .sort()
    .join("|");
  // Not a secret and not a signature — an identity, so a payment can be matched
  // back to exactly the basket that was priced.
  let h = 5381;
  const s = `${body}#${total}#${currency}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export async function buildQuote(opts: {
  catalog: CatalogSource;
  items: CartLineRequest[];
  policies?: ShopPolicies;
  /**
   * When given, stock already held for other shoppers is subtracted before
   * anything is priced. Omitting it prices against the raw catalogue, which is
   * right for a browsing "what would this cost" and wrong for a checkout.
   */
  shop?: string;
  /** A re-quote for an attempt that already holds stock does not compete with itself. */
  excludeOrderId?: string;
  /**
   * A recovery grant to price against, BY ID.
   *
   * An id, never terms. The caller says which grant; this function reads what
   * it is worth, from disk, at quote time — exactly the rule that makes the
   * rest of this file safe. A caller that could pass a depth is a caller that
   * could pass 90%, and the browser is a caller.
   *
   * Unknown, expired or already-redeemed grants are ignored in silence rather
   * than refused: a shopper opening a stale link should see the real price of
   * their basket, not an error page about a discount they never knew the
   * mechanics of.
   */
  grantId?: string | null;
}): Promise<QuoteResult> {
  const reserved = opts.shop ? committed(opts.shop, opts.excludeOrderId) : new Map<string, number>();
  const problems: QuoteProblem[] = [];
  const lines: QuoteLine[] = [];

  if (!Array.isArray(opts.items) || opts.items.length === 0) {
    return { ok: false, problems: [{ handle: "", reason: "bad_quantity", message: "The cart is empty." }] };
  }
  if (opts.items.length > MAX_LINES) {
    return {
      ok: false,
      problems: [{ handle: "", reason: "bad_quantity", message: `A cart can hold at most ${MAX_LINES} different items.` }],
    };
  }

  // Merge duplicate lines first, so ten separate lines of one unit cannot walk
  // past a per-line quantity cap.
  const merged = new Map<string, CartLineRequest>();
  for (const raw of opts.items) {
    const handle = String(raw.handle ?? "").trim();
    const sku = raw.sku ? String(raw.sku).trim() : undefined;
    // Deliberately NOT floored. Rounding 1.5 down to 1 silently reinterprets
    // the request, which hides a client bug and hides someone probing equally
    // well. The validation below refuses it instead, and says so.
    const qty = Number(raw.qty);
    const key = `${handle}::${sku ?? ""}`;
    const prev = merged.get(key);
    merged.set(key, { handle, sku, qty: (prev?.qty ?? 0) + (Number.isFinite(qty) ? qty : NaN) });
  }

  for (const item of merged.values()) {
    if (!item.handle) {
      problems.push({ handle: "", reason: "unknown_product", message: "A cart line was missing a product." });
      continue;
    }
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY_PER_LINE) {
      problems.push({
        handle: item.handle,
        reason: "bad_quantity",
        message: `Quantity must be between 1 and ${MAX_QTY_PER_LINE}.`,
      });
      continue;
    }

    const product = await opts.catalog.get(item.handle).catch(() => null);
    if (!product) {
      problems.push({
        handle: item.handle,
        reason: "unknown_product",
        message: "That product is not in the catalogue.",
      });
      continue;
    }

    // Without a sku, take the cheapest variant that is actually in stock —
    // never merely the first, which can be a sold-out size.
    const inStock = product.variants.filter((v) => (v.inventoryQuantity ?? 0) > 0);
    const variant = item.sku
      ? product.variants.find((v) => v.sku === item.sku)
      : [...inStock].sort((a, b) => Number(a.price) - Number(b.price))[0];

    if (!variant) {
      problems.push({
        handle: item.handle,
        sku: item.sku,
        reason: item.sku ? "unknown_variant" : "out_of_stock",
        message: item.sku ? "That option is not available." : `${product.title} is out of stock.`,
      });
      continue;
    }

    // What the merchant says, minus what we are already holding for someone
    // mid-payment. Two shoppers racing for the last unit is not a rare case —
    // it is the normal one at the moment stock is worth reserving.
    const onHand = variant.inventoryQuantity ?? 0;
    const available = Math.max(0, onHand - (reserved.get(variant.sku ?? "") ?? 0));
    if (available <= 0) {
      problems.push({
        handle: item.handle,
        sku: variant.sku ?? undefined,
        reason: "out_of_stock",
        message: `${product.title} is out of stock.`,
      });
      continue;
    }
    if (available < item.qty) {
      // The real number, because it is true. This is the same rule that lets
      // the assistant say "only 3 left" — grounded scarcity is not urgency.
      problems.push({
        handle: item.handle,
        sku: variant.sku ?? undefined,
        reason: "insufficient_stock",
        available,
        message: `Only ${available} of ${product.title} left.`,
      });
      continue;
    }

    const unitPrice = Number(variant.price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      problems.push({
        handle: item.handle,
        sku: variant.sku ?? undefined,
        reason: "unknown_variant",
        message: "That item cannot be priced right now.",
      });
      continue;
    }

    lines.push({
      handle: product.handle,
      title: product.title,
      sku: variant.sku ?? product.handle,
      variantTitle: variant.title ?? "",
      qty: item.qty,
      unitPrice,
      lineTotal: unitPrice * item.qty,
    });
  }

  // All or nothing. A partial quote that silently drops the out-of-stock line
  // is a shopper paying for a basket they did not agree to.
  if (problems.length > 0) return { ok: false, problems };

  const policies = opts.policies ?? (await opts.catalog.policies().catch(() => ({})));
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

  /**
   * Approved offers, applied server-side.
   *
   * Read at quote time rather than passed in, so a revoked or expired offer
   * stops applying immediately. An offer held in a session, a cart, or a
   * client-supplied token would keep applying after the merchant withdrew it —
   * which is the discount equivalent of trusting a price from the browser.
   *
   * Shipping is charged on the DISCOUNTED subtotal, because a free-shipping
   * threshold the shopper only clears at full price is a threshold they did not
   * really clear, and reconciling that later is worse than being strict now.
   */
  const live = opts.shop ? activeOffers(opts.shop) : [];
  const offers: AppliedOffer[] = [];
  for (const o of live) {
    const eligible = lines.filter((l) => l.handle === o.handle);
    if (eligible.length === 0) continue;
    const base = eligible.reduce((s, l) => s + l.lineTotal, 0);
    const amount = Math.round(base * o.depth);
    if (amount <= 0) continue;
    offers.push({ handle: o.handle, title: o.title, percent: Math.round(o.depth * 100), amount, endsAt: o.endsAt });
  }

  /**
   * A recovery grant, if one was named and is still live.
   *
   * Two differences from a broadcast offer, both of which exist to bound what
   * one conversation can cost:
   *
   *   - it is capped at UNITS, not just at a percentage, so a grant issued
   *     against a basket of two cannot be spent on a basket of twenty;
   *   - it stacks with nothing. If an approved offer already covers this
   *     product, the grant is skipped rather than added on top — two discounts
   *     on one line is how a 10% policy becomes 18% and nobody can say which
   *     rule allowed it.
   */
  if (opts.shop && opts.grantId) {
    const g = findGrant(opts.shop, opts.grantId);
    const p = g ? priceable(g) : null;
    if (p && !offers.some((o) => o.handle === p.handle)) {
      let remaining = p.qtyCap;
      let base = 0;
      for (const l of lines) {
        if (l.handle !== p.handle || remaining <= 0) continue;
        const units = Math.min(l.qty, remaining);
        base += l.unitPrice * units;
        remaining -= units;
      }
      const amount = Math.round(base * p.depth);
      if (amount > 0) {
        offers.push({
          handle: p.handle,
          title: p.title,
          percent: Math.round(p.depth * 100),
          amount,
          endsAt: p.endsAt,
        });
      }
    }
  }

  const discount = offers.reduce((s, o) => s + o.amount, 0);

  const shipping = shippingFor(subtotal - discount, policies);
  const total = subtotal - discount + shipping;
  const currency = "INR";

  return {
    ok: true,
    quote: {
      lines,
      subtotal,
      offers,
      discount,
      shipping,
      total,
      currency,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000).toISOString(),
      fingerprint: fingerprint(lines, total, currency),
    },
  };
}

export const quoteExpired = (q: Quote, now = new Date()): boolean =>
  Date.parse(q.expiresAt) <= now.getTime();
