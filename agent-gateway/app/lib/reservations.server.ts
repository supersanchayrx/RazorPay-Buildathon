/**
 * Stock held against payments in flight.
 *
 * Without this, two shoppers both quote the last Cold Brew, both pay, and both
 * succeed — the catalogue said 3 to each of them because neither had bought yet.
 * Overselling is not a rare race: it is the normal outcome at the exact moment
 * a product is worth reserving, which is when it is nearly gone.
 *
 * We cannot decrement the merchant's own inventory — their catalogue feed is
 * read-only and theirs. So we keep our own ledger of what we have COMMITTED,
 * and the quote subtracts it. Available = what the merchant says, minus what we
 * are already holding for someone else.
 *
 * CLAIMING IS SYNCHRONOUS AND DOES ITS OWN AVAILABILITY CHECK. Node runs one
 * turn at a time, so a synchronous check-then-write cannot interleave; an async
 * one absolutely can, and "check availability, await something, then write" is
 * how a reservation system oversells anyway. This is correct for one process
 * and NOT for several — the honest fix is a database with a real transaction,
 * and that is what this becomes.
 */

export type Held = { sku: string; qty: number };

type Reservation = {
  shop: string;
  /** The Razorpay order id — one per checkout attempt, so it is the natural key. */
  orderId: string;
  lines: Held[];
  expiresAt: number;
};

const held = new Map<string, Reservation>();

/**
 * Short. A reservation is a promise to hold something for someone who has said
 * they intend to pay; it is not a parking space. Long TTLs turn a busy shop
 * into a shop that appears out of stock.
 */
export const RESERVATION_TTL_MS = 15 * 60_000;

function sweep(now: number) {
  for (const [k, r] of held) if (r.expiresAt <= now) held.delete(k);
}

/** How much of each sku is currently spoken for at this shop. */
export function committed(shop: string, excludeOrderId?: string): Map<string, number> {
  const now = Date.now();
  sweep(now);
  const out = new Map<string, number>();
  for (const r of held.values()) {
    if (r.shop !== shop) continue;
    if (excludeOrderId && r.orderId === excludeOrderId) continue;
    for (const l of r.lines) out.set(l.sku, (out.get(l.sku) ?? 0) + l.qty);
  }
  return out;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; sku: string; wanted: number; available: number };

/**
 * Take the stock, or say why not — in one uninterrupted step.
 *
 * `availableFromCatalogue` is passed in rather than fetched here, because
 * fetching would mean awaiting, and awaiting is what lets a second claim slip
 * between this one's check and its write.
 */
export function claim(opts: {
  shop: string;
  orderId: string;
  lines: Held[];
  availableFromCatalogue: Map<string, number>;
}): ClaimResult {
  const now = Date.now();
  sweep(now);

  // Re-claiming the same order id is a retry, not a second shopper, so its own
  // existing hold does not count against it.
  const other = committed(opts.shop, opts.orderId);

  for (const l of opts.lines) {
    const stock = opts.availableFromCatalogue.get(l.sku) ?? 0;
    const free = stock - (other.get(l.sku) ?? 0);
    if (l.qty > free) {
      return { ok: false, sku: l.sku, wanted: l.qty, available: Math.max(0, free) };
    }
  }

  held.set(opts.orderId, {
    shop: opts.shop,
    orderId: opts.orderId,
    lines: opts.lines,
    expiresAt: now + RESERVATION_TTL_MS,
  });
  return { ok: true };
}

/**
 * Give the stock back.
 *
 * Called when a payment settles (the units are gone for real now, and the
 * merchant's own inventory will reflect it), and when one fails or is
 * abandoned. Both paths release, because a hold that outlives its reason is
 * indistinguishable from stock that has been stolen.
 */
export function release(orderId: string): void {
  held.delete(orderId);
}

/** Diagnostics only. */
export function active(shop?: string): Reservation[] {
  sweep(Date.now());
  return [...held.values()].filter((r) => !shop || r.shop === shop);
}

/** Tests need a clean slate; nothing in the app calls this. */
export function _reset(): void {
  held.clear();
}
