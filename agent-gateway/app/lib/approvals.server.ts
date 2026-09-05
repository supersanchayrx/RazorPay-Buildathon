/**
 * The approval store — the keystone.
 *
 * Read `bounds.server.ts` and you find this line, written before any of this
 * existed: "every discount pattern below still requires an approved offer, of
 * which there are currently none." That was not a placeholder. It was the shape
 * of the missing half of the system.
 *
 * WHAT AN APPROVAL IS AND IS NOT:
 *
 *   It is a licence to SAY that an offer exists, on one product, until one date.
 *   It is NOT a licence to apply one. The discount is applied by the server at
 *   quote time and charged at the payment page. The assistant announces; the
 *   server decides what anything costs.
 *
 * That split matters because it keeps the original rule intact. The model still
 * never produces a price. If a shopper asks "what would two of those cost with
 * the offer", the number comes back from `buildQuote` with the discount applied
 * server-side — the same authority that prices everything else. An assistant
 * that could grant a discount would be an assistant that could be argued into
 * one.
 *
 * Append-only JSONL, like the ledger and the order book, so it survives a
 * restart with no migration and so a revocation never destroys the record of the
 * approval it revoked. Becomes a Prisma table; the shape below is the schema.
 */

import fs from "node:fs";
import path from "node:path";
import { record } from "./ledger.server";

export type Decision = {
  ts: string;
  shop: string;
  /** The proposal this decision was made about. */
  candidateId: string;
  action: "approve" | "reject" | "revoke";
  /** Who clicked. An approval with no name on it is not an approval. */
  by: string;
  /** The merchant's own words, when they gave any. */
  note?: string;
  /** Present on `approve`. */
  offer?: OfferTerms;
};

export type OfferTerms = {
  /** Product handle the offer applies to. One product, deliberately. */
  handle: string;
  title: string;
  /** Fraction off, e.g. 0.1 for ten percent. */
  depth: number;
  /** ISO date. An offer with no end is a permanent price change wearing a costume. */
  endsAt: string;
  /**
   * Maximum units that may be sold at the discount.
   *
   * The exposure cap the merchant was shown when they approved. Without it,
   * "10% off" is an unbounded liability, and the arithmetic they read — which
   * quoted a specific worst case — was describing a different offer from the
   * one that went live.
   */
  maxUnits: number;
};

export type ActiveOffer = OfferTerms & {
  candidateId: string;
  approvedAt: string;
  approvedBy: string;
};

const FILE = path.join(process.cwd(), "data", "offer-decisions.jsonl");

function readAll(): Decision[] {
  try {
    return fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Decision);
  } catch {
    return [];
  }
}

function append(d: Decision): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(d) + "\n", "utf8");
  } catch {
    // An approval we could not persist has not happened. The caller checks.
  }
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export function decide(input: {
  shop: string;
  candidateId: string;
  action: Decision["action"];
  by: string;
  note?: string;
  offer?: OfferTerms;
}): { ok: boolean; error?: string } {
  if (input.action === "approve") {
    if (!input.offer) return { ok: false, error: "an approval must carry the terms it approves" };
    const { depth, maxUnits, endsAt } = input.offer;
    // Validated here rather than trusted from the form. The console is one
    // caller; a script or a future API is another, and the invariant belongs
    // with the data, not with the page that happens to be posting today.
    if (!(depth > 0 && depth <= 0.9)) return { ok: false, error: "depth must be between 0 and 90%" };
    if (!(maxUnits > 0)) return { ok: false, error: "an offer needs a unit cap" };
    if (Number.isNaN(Date.parse(endsAt))) return { ok: false, error: "an offer needs a real end date" };
    if (Date.parse(endsAt) <= Date.now()) return { ok: false, error: "that end date has already passed" };
  }

  const d: Decision = { ts: new Date().toISOString(), ...input };
  append(d);

  // Approvals and revocations go in the decision ledger too. A merchant
  // reviewing what was said on their behalf should find the moment the system
  // was GIVEN permission to say it, in the same place.
  record({
    shop: input.shop,
    kind: input.action === "reject" ? "refusal" : "reply",
    message: `offer ${input.action}: ${input.candidateId}`,
    detail: { by: input.by, note: input.note, offer: input.offer },
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * Offers that are live right now.
 *
 * An approval is superseded by any later decision on the same candidate, so a
 * revocation takes effect immediately without rewriting history. Expiry is
 * checked against the clock at read time rather than stored as a status — a
 * stored status is a status that can be stale, and a stale one here means the
 * assistant announcing an offer that ended yesterday.
 */
export function activeOffers(shop: string, asOf = new Date()): ActiveOffer[] {
  const latest = new Map<string, Decision>();
  for (const d of readAll()) {
    if (d.shop !== shop) continue;
    latest.set(d.candidateId, d);
  }
  const out: ActiveOffer[] = [];
  for (const d of latest.values()) {
    if (d.action !== "approve" || !d.offer) continue;
    if (Date.parse(d.offer.endsAt) <= asOf.getTime()) continue;
    out.push({ ...d.offer, candidateId: d.candidateId, approvedAt: d.ts, approvedBy: d.by });
  }
  return out;
}

/** Every decision, newest first, for the console. */
export function history(shop: string, limit = 100): Decision[] {
  return readAll()
    .filter((d) => d.shop === shop)
    .reverse()
    .slice(0, limit);
}

/**
 * How many times each proposal has been turned down, for the decay term.
 *
 * This is the rejection ledger earning its keep: a proposal the merchant has
 * already refused twice scores at a quarter, so the system stops re-pitching a
 * rejected idea in slightly different words. That is how these tools become
 * noise, and then get switched off.
 */
export function rejectionCounts(shop: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of readAll()) {
    if (d.shop !== shop || d.action !== "reject") continue;
    counts.set(d.candidateId, (counts.get(d.candidateId) ?? 0) + 1);
  }
  return counts;
}

/** The live offer on one product, if there is one. */
export function offerFor(shop: string, handle: string, asOf = new Date()): ActiveOffer | null {
  return activeOffers(shop, asOf).find((o) => o.handle === handle) ?? null;
}

/**
 * The offers an assistant may mention, in the form the bounds layer checks.
 *
 * Deliberately narrow: a handle, a percentage, and a date. `bounds` uses it to
 * decide whether a specific sentence is grounded, so anything it does not need
 * is not here — a bound that receives more than it checks is a bound that will
 * eventually be asked to check something it was not designed for.
 */
export function announceable(shop: string, asOf = new Date()) {
  return activeOffers(shop, asOf).map((o) => ({
    handle: o.handle,
    title: o.title,
    percent: Math.round(o.depth * 100),
    endsAt: o.endsAt,
  }));
}

/** Test seam. */
export function _file(): string {
  return FILE;
}
