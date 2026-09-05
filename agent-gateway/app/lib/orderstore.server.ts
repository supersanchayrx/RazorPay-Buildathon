/**
 * Orders CHAPMAN placed.
 *
 * Distinct from `orders.server.ts`, which READS the merchant's own history.
 * This is the small set of orders that came through our checkout, and it exists
 * because a verified payment that is only a log line is not an order — nobody
 * can look it up, and the shopper who just paid gets told we have no record.
 *
 * SETTLEMENT IS IDEMPOTENT, KEYED ON THE RAZORPAY ORDER ID.
 *
 * That matters because two things race to report the same payment: the
 * browser's success handler and Razorpay's webhook. Either may arrive first,
 * either may arrive twice, and one may never arrive at all. So `settle` is
 * written to be called any number of times from any number of sources, and the
 * order it produces is the same each time. Whichever gets there first wins; the
 * rest are recorded as duplicates and change nothing.
 *
 * Append-only JSONL, like the ledger, so it survives a restart with no
 * migration. It becomes a Prisma table alongside everything else — the shape
 * below is the schema.
 */
import fs from "node:fs";
import path from "node:path";
import type { Order, OrderSource } from "./orders.server";

export type PlacedOrder = {
  /** Our id, derived from theirs so it is stable across replays. */
  id: string;
  shop: string;
  createdAt: string;
  settledAt: string;
  status: "paid" | "authorized" | "failed";
  /** Razorpay's order id — the idempotency key. */
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  method: string | null;
  amount: number;
  currency: string;
  lines: Array<{ handle: string; title: string; sku: string; qty: number; unitPrice: number; lineTotal: number }>;
  /** The verified shopper, when there was one. Guests are null. */
  customer: string | null;
  fingerprint: string;
  /** Which report arrived first. Useful when reconciling. */
  settledBy: "browser" | "webhook";
};

const FILE = path.join(process.cwd(), "data", "placed-orders.jsonl");
const PENDING = path.join(process.cwd(), "data", "pending-checkouts.jsonl");

/**
 * What we were asked to sell, recorded when the Razorpay order is created.
 *
 * Persisted rather than held in memory because the webhook may arrive minutes
 * later, from a different process, after a restart, or long after the shopper
 * closed the tab. An in-memory basket would be gone in every one of those
 * cases — which are exactly the cases the webhook exists to cover.
 *
 * Pending is INTENT. Placed is FACT. They are separate files so that neither
 * can be mistaken for the other.
 */
export type PendingCheckout = {
  gatewayOrderId: string;
  shop: string;
  createdAt: string;
  amount: number;
  currency: string;
  fingerprint: string;
  customer: string | null;
  lines: PlacedOrder["lines"];
};

export function savePending(p: PendingCheckout): void {
  try {
    fs.mkdirSync(path.dirname(PENDING), { recursive: true });
    fs.appendFileSync(PENDING, JSON.stringify(p) + "\n", "utf8");
  } catch {
    // A lost pending record costs us the line items on a webhook-settled
    // order, not the payment itself. Never fail a checkout over it.
  }
}

export function findPending(gatewayOrderId: string): PendingCheckout | null {
  try {
    const rows = fs
      .readFileSync(PENDING, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as PendingCheckout);
    // Last write wins, same as placed orders.
    return [...rows].reverse().find((r) => r.gatewayOrderId === gatewayOrderId) ?? null;
  } catch {
    return null;
  }
}

function readAll(): PlacedOrder[] {
  try {
    return fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as PlacedOrder);
  } catch {
    return [];
  }
}

/**
 * Last write wins on replay, so the file stays append-only while reads still
 * see one row per order. An append-only log that you compact on read is much
 * easier to reason about than one you rewrite in place.
 */
function index(): Map<string, PlacedOrder> {
  const m = new Map<string, PlacedOrder>();
  for (const o of readAll()) m.set(o.gatewayOrderId, o);
  return m;
}

export function findByGatewayOrder(gatewayOrderId: string): PlacedOrder | null {
  return index().get(gatewayOrderId) ?? null;
}

export type SettleResult = {
  order: PlacedOrder;
  /** False when this call created it, true when an earlier one already had. */
  duplicate: boolean;
};

export function settle(input: {
  shop: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  status: PlacedOrder["status"];
  method: string | null;
  amount: number;
  currency: string;
  lines: PlacedOrder["lines"];
  customer: string | null;
  fingerprint: string;
  settledBy: PlacedOrder["settledBy"];
}): SettleResult {
  const existing = findByGatewayOrder(input.gatewayOrderId);
  if (existing) {
    // A later report never downgrades a paid order. The webhook is the more
    // authoritative source, but "captured" arriving after "authorized" is a
    // progression, and anything arriving after "paid" is noise.
    return { order: existing, duplicate: true };
  }

  const order: PlacedOrder = {
    // Derived, not random: a replay that somehow got past the check above would
    // still produce the same id rather than a second order.
    id: "cho_" + input.gatewayOrderId.replace(/^order_/, ""),
    shop: input.shop,
    createdAt: new Date().toISOString(),
    settledAt: new Date().toISOString(),
    status: input.status,
    gatewayOrderId: input.gatewayOrderId,
    gatewayPaymentId: input.gatewayPaymentId,
    method: input.method,
    amount: input.amount,
    currency: input.currency,
    lines: input.lines,
    customer: input.customer,
    fingerprint: input.fingerprint,
    settledBy: input.settledBy,
  };

  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(order) + "\n", "utf8");
  } catch {
    // Never let a write failure lose a payment that already happened — the
    // caller still gets the order, and the ledger records the attempt.
  }
  return { order, duplicate: false };
}

/* ------------------------------------------------------------------ *
 * Reading them back
 * ------------------------------------------------------------------ */

const toOrder = (p: PlacedOrder): Order => ({
  id: p.id,
  placedAt: p.createdAt,
  status: p.status === "failed" ? "payment_failed" : "placed",
  total: p.amount,
  currency: p.currency,
  lines: p.lines.map((l) => ({
    handle: l.handle,
    title: l.title,
    qty: l.qty,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
  })),
  payment: { method: p.method ?? "unknown", status: p.status === "failed" ? "failed" : "captured" },
});

/**
 * Placed orders as an `OrderSource`, so "where's my order?" finds something
 * bought two minutes ago — not just what the merchant's own system knows.
 * Scoped on `customer` exactly like every other source: a guest checkout has no
 * customer, so it is reachable by nobody, which is the correct answer.
 */
export function placedOrders(shop: string): OrderSource {
  // A guest order has customer === null. Without this guard a lookup with no
  // identity matches null to null and hands back every unowned order — the one
  // case where "no identity" must mean "nothing", not "everything ownerless".
  const mine = (sub: string) =>
    !sub
      ? []
      : readAll()
      .filter((o) => o.shop === shop && o.customer === sub)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toOrder);
  return {
    kind: "placed",
    async forShopper(sub, limit = 10) {
      return mine(sub).slice(0, limit);
    },
    async get(sub, orderId) {
      return mine(sub).find((o) => o.id === orderId) ?? null;
    },
  };
}

/**
 * Read several sources as one.
 *
 * Each is scoped to the same verified `sub` before it gets here, so merging
 * cannot widen access — the composite is exactly as narrow as its narrowest
 * part. A failing source is skipped rather than failing the whole lookup: a
 * merchant's feed being down should not hide the order we placed ourselves.
 */
export function mergeSources(sources: OrderSource[]): OrderSource {
  return {
    kind: sources.map((s) => s.kind).join("+"),
    async forShopper(sub, limit = 10) {
      const all = await Promise.all(
        sources.map((s) => s.forShopper(sub, limit).catch(() => [] as Order[])),
      );
      return all
        .flat()
        .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
        .slice(0, limit);
    },
    async get(sub, orderId) {
      for (const s of sources) {
        const hit = await s.get(sub, orderId).catch(() => null);
        if (hit) return hit;
      }
      return null;
    },
  };
}
