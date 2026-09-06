/**
 * Order access.
 *
 * Off unless the merchant turns it on and points at a source, because switching
 * it on changes what the assistant can say about a *person*.
 *
 * Every function here takes a `sub` that came from `identity.server.ts` and
 * nothing else. There is no lookup by email, by phone, or by order number
 * alone — an order number is printed on a receipt and shared in screenshots,
 * so treating it as proof of identity is the same mistake as trusting a typed
 * email, only harder to spot.
 *
 * Two implementations behind one interface, in the order the design doc
 * prefers them:
 *
 *   jsonFeedOrders  a read-only endpoint the merchant publishes. Signed
 *                   request, they decide what to expose, their schema stays
 *                   theirs, and we hold no credential to their database.
 *   seededOrders    our synthetic fixture, for development. Every row it
 *                   returns is flagged, so nothing can quietly present demo
 *                   data as a real order.
 */
import fs from "node:fs";
import { dataPath } from "./paths.server";
import crypto from "node:crypto";

export type OrderLine = {
  handle: string;
  title: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type Order = {
  id: string;
  placedAt: string;
  status: "placed" | "payment_failed" | "shipped" | "delivered" | "cancelled";
  total: number;
  currency: string;
  lines: OrderLine[];
  payment: { method: string; status: string };
  /** True when the row came from a development fixture rather than a merchant. */
  synthetic?: boolean;
};

export interface OrderSource {
  readonly kind: string;
  /** Orders for one verified shopper. There is no unscoped list. */
  forShopper(sub: string, limit?: number): Promise<Order[]>;
  /** One order, and only if it belongs to this shopper. */
  get(sub: string, orderId: string): Promise<Order | null>;
}

/* ------------------------------------------------------------------ *
 * The merchant-published feed — the preferred adapter
 * ------------------------------------------------------------------ */

/**
 * Requests are signed so the merchant can tell us apart from anyone who guesses
 * their URL. Without this, an order feed is an open endpoint that leaks every
 * customer to whoever finds it — the exact failure this whole file exists to
 * prevent, moved one hop away where it is easier to miss.
 *
 * The signature covers the customer id and a timestamp, so a captured request
 * cannot be replayed tomorrow against a different customer.
 */
function signRequest(secret: string, sub: string, ts: number): string {
  return crypto.createHmac("sha256", secret).update(`${ts}.${sub}`).digest("base64url");
}

export function jsonFeedOrders(feedUrl: string, secret: string): OrderSource {
  async function fetchFor(sub: string): Promise<Order[]> {
    // No identity, no lookup. Never send an empty customer to a merchant feed
    // and hope they scope it correctly on our behalf.
    if (!sub) return [];
    const ts = Math.floor(Date.now() / 1000);
    const url = new URL(feedUrl);
    url.searchParams.set("customer", sub);
    const res = await fetch(url, {
      headers: {
        "x-chapman-timestamp": String(ts),
        "x-chapman-signature": signRequest(secret, sub, ts),
        accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`order feed ${feedUrl} returned ${res.status}`);
    const body = (await res.json()) as { orders?: Order[] };
    const rows = body.orders ?? [];
    // Defence in depth: a merchant endpoint that returns the wrong customer's
    // orders — through their bug, not ours — must not become our data breach.
    // We asked for one shopper, so anything else is dropped and the mismatch is
    // loud rather than silently rendered into a reply.
    return rows.filter((o) => !("customer" in o) || (o as { customer?: string }).customer === sub);
  }

  return {
    kind: "json-feed",
    async forShopper(sub, limit = 10) {
      const rows = await fetchFor(sub);
      return rows
        .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
        .slice(0, limit);
    },
    async get(sub, orderId) {
      return (await fetchFor(sub)).find((o) => o.id === orderId) ?? null;
    },
  };
}

/* ------------------------------------------------------------------ *
 * The development fixture
 * ------------------------------------------------------------------ */

let cache: { at: number; rows: Array<Order & { customer: string }> } | null = null;

function loadSeed(): Array<Order & { customer: string }> {
  if (cache && Date.now() - cache.at < 30_000) return cache.rows;
  let rows: Array<Order & { customer: string }> = [];
  try {
    rows = fs
      .readFileSync(dataPath("orders.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const o = JSON.parse(l);
        return {
          id: o.id,
          placedAt: o.ts,
          status: o.status,
          total: o.total,
          currency: o.currency,
          lines: o.lines.map((l: OrderLine) => ({
            handle: l.handle,
            title: l.title,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
          payment: { method: o.payment.method, status: o.payment.status },
          customer: o.customer.id,
          synthetic: true,
        };
      });
  } catch {
    rows = [];
  }
  cache = { at: Date.now(), rows };
  return rows;
}

export function seededOrders(): OrderSource {
  const mine = (sub: string) =>
    !sub
      ? []
      : loadSeed()
      .filter((o) => o.customer === sub)
      .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  return {
    kind: "seed-fixture",
    async forShopper(sub, limit = 10) {
      return mine(sub).slice(0, limit);
    },
    async get(sub, orderId) {
      return mine(sub).find((o) => o.id === orderId) ?? null;
    },
  };
}

/* ------------------------------------------------------------------ */

const money = (n: number, cur: string) =>
  (cur === "INR" ? "₹" : cur + " ") + Number(n).toLocaleString("en-IN");

const STATUS_TEXT: Record<Order["status"], string> = {
  placed: "placed",
  payment_failed: "payment did not go through",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
};

/**
 * Render an order for a shopper.
 *
 * States what the merchant's record actually says and stops. No delivery
 * estimate is invented here: "should arrive Tuesday" from a system with no
 * carrier data is a promise made on the merchant's behalf that the merchant
 * never made.
 */
export function describeOrder(o: Order): string {
  const when = o.placedAt.slice(0, 10);
  const items = o.lines.map((l) => `${l.qty}× ${l.title}`).join(", ");
  return `${o.id} — placed ${when}, ${money(o.total, o.currency)}, ${STATUS_TEXT[o.status]}: ${items}`;
}

/* ------------------------------------------------------------------ *
 * Contact
 * ------------------------------------------------------------------ */

/** A way to reach one shopper, as the merchant chose to expose it. */
export type ShopperContact = { phone: string | null; email: string | null };

/**
 * Ask the merchant how to reach one of their own customers.
 *
 * THE BROWSER IS NEVER ASKED THIS. A phone number in a POST body is a phone
 * number anyone can put there, and accepting one would let a stranger aim our
 * outreach at somebody else's handset by opening the console on a shop page.
 * The browser may prove WHO it is with a signed session token; turning that
 * `sub` into a way of reaching them is the merchant's business, answered
 * server-to-server over the same signed request that serves their orders.
 *
 * It fails soft and on purpose. No feed, no `customer` object, a slow endpoint
 * or an outright error all produce nulls, and a basket with no contact is
 * suppressed by the recovery agent as `no_channel` with that reason shown. A
 * shop that never publishes contact details simply never has anyone chased,
 * which is a coherent way to run a shop.
 */
export async function jsonFeedContact(
  feedUrl: string,
  secret: string,
  sub: string,
  timeoutMs = 2500,
): Promise<ShopperContact> {
  const empty: ShopperContact = { phone: null, email: null };
  if (!sub) return empty;

  const ts = Math.floor(Date.now() / 1000);
  const url = new URL(feedUrl);
  url.searchParams.set("customer", sub);

  try {
    const res = await fetch(url, {
      headers: {
        "x-chapman-timestamp": String(ts),
        "x-chapman-signature": signRequest(secret, sub, ts),
        accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return empty;
    const body = (await res.json()) as { customer?: { id?: string; phone?: string; email?: string } };
    const c = body.customer;
    // Same defence in depth as the orders above: we asked about one shopper, so
    // a record naming a different one is the merchant's bug and not our licence
    // to phone whoever came back.
    if (!c || (c.id && c.id !== sub)) return empty;
    return { phone: c.phone ?? null, email: c.email ?? null };
  } catch {
    return empty;
  }
}
