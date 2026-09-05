/**
 * What a shopper is worth to this shop, computed from what they actually did.
 *
 * This exists for one reason: the recovery agent may, within limits the
 * merchant set, offer a discount to somebody who abandoned a basket because the
 * price was too high. That is a genuinely useful thing to do and a genuinely
 * dangerous one, and the danger is not the money. It is that **an agent which
 * gives money to whoever complains has taught the whole customer base to
 * complain.** Standing is the term that stops it.
 *
 * THREE RULES.
 *
 * 1. ONE ORDER IS NOT LOYALTY. A first-time shopper who abandons and says "too
 *    expensive" is describing the price, not negotiating, and the correct answer
 *    is to show them something cheaper. There is no tier below `returning` that
 *    can clear a discount floor, and that is enforced by the tier table rather
 *    than remembered by whoever writes the next policy.
 *
 * 2. MARGIN, NEVER REVENUE. A shopper who has spent ₹40,000 on a product we
 *    make ₹300 on is not the shopper who has spent ₹12,000 at 60%. Revenue is
 *    the number that feels like loyalty and margin is the number that is.
 *
 * 3. IT IS COMPUTED, NOT SCORED BY A MODEL, AND IT IS A TIER, NOT A NUMBER.
 *    A continuous score invites a threshold argument on every edge case and
 *    gives a model something to be persuaded about. Four tiers, explicit
 *    boundaries, and the reasons are returned alongside so a merchant reading
 *    "regular" can see the four orders behind it.
 *
 * Nothing here reaches a shopper. Telling somebody they are a `returning`
 * customer in tier language is both odd and an invitation to ask what the other
 * tiers get.
 */

import fs from "node:fs";
import path from "node:path";
import type { HistoryOrder, MerchantInputs } from "./detectors.server";

export type Tier =
  /** Nobody, or one order. Cannot clear a discount floor, by construction. */
  | "new"
  /** Two or three orders. Real, but not yet a relationship. */
  | "returning"
  /** Four or more, still active. */
  | "regular"
  /** Was a regular, and has not been seen in a long time. */
  | "lapsed";

export const TIER_ORDER: Tier[] = ["new", "returning", "regular", "lapsed"];

export type Standing = {
  customerId: string;
  tier: Tier;
  orders: number;
  /** Gross margin across every order they have placed. Merchant-only. */
  lifetimeMargin: number;
  averageOrderMargin: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  daysSinceLastOrder: number | null;
  /** Plain sentences a merchant can check the tier against. */
  because: string[];
};

/**
 * Where `regular` becomes `lapsed`.
 *
 * Four months. Long enough that a tea drinker who buys every six weeks is never
 * mislabelled by one slow quarter, short enough that "regular" still means
 * something about now rather than about last year.
 */
export const LAPSED_AFTER_DAYS = 120;

const REGULAR_AT = 4;
const RETURNING_AT = 2;

function readJsonl<T>(file: string): T[] {
  try {
    return fs
      .readFileSync(path.join(process.cwd(), "data", file), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

function readInputs(): MerchantInputs | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "merchant-inputs.json"), "utf8"),
    ) as MerchantInputs;
  } catch {
    return null;
  }
}

/**
 * Standing for one shopper.
 *
 * Reads the order history every call. That is fine here and would not be fine
 * on the shopper's path: this is asked once, when a recovery conversation
 * reaches the point of choosing a remedy, and correctness at that moment is
 * worth more than a cache that could hand out a discount based on a stale
 * order count.
 */
export function standing(opts: {
  customerId: string;
  asOf?: Date;
  orders?: HistoryOrder[];
  inputs?: MerchantInputs | null;
}): Standing {
  const asOf = opts.asOf ?? new Date();
  const inputs = opts.inputs ?? readInputs();
  const all = opts.orders ?? readJsonl<HistoryOrder>("orders.jsonl");

  const mine = all
    .filter((o) => o.status === "placed" && o.customer?.id === opts.customerId)
    .sort((a, b) => a.ts.localeCompare(b.ts));

  const marginOf = (o: HistoryOrder) =>
    o.lines.reduce((s, l) => {
      const cost = inputs?.unitCost[l.sku] ?? l.unitCost ?? 0;
      return s + Math.max(0, l.unitPrice - cost) * (l.qty || 1);
    }, 0);

  const lifetimeMargin = mine.reduce((s, o) => s + marginOf(o), 0);
  const firstOrderAt = mine[0]?.ts ?? null;
  const lastOrderAt = mine[mine.length - 1]?.ts ?? null;
  const daysSince = lastOrderAt ? (asOf.getTime() - Date.parse(lastOrderAt)) / 86_400_000 : null;

  let tier: Tier = "new";
  if (mine.length >= REGULAR_AT) tier = "regular";
  else if (mine.length >= RETURNING_AT) tier = "returning";

  // Lapsed is a state a REGULAR falls into, not a tier of its own to be earned.
  // Someone with two orders who has been quiet for a year is still `returning`;
  // calling them lapsed would imply a relationship that never existed.
  if (tier === "regular" && daysSince !== null && daysSince > LAPSED_AFTER_DAYS) tier = "lapsed";

  const because: string[] = [];
  because.push(
    mine.length === 0
      ? "no completed orders on record"
      : `${mine.length} completed order${mine.length === 1 ? "" : "s"}`,
  );
  if (mine.length) {
    because.push(`₹${Math.round(lifetimeMargin).toLocaleString("en-IN")} of gross margin, lifetime`);
    because.push(
      daysSince !== null && daysSince > LAPSED_AFTER_DAYS
        ? `last order ${Math.round(daysSince)} days ago — past the ${LAPSED_AFTER_DAYS}-day mark`
        : `last order ${Math.round(daysSince ?? 0)} days ago`,
    );
  }
  if (tier === "new" && mine.length === 1) {
    because.push("one order is not a relationship — this tier can never clear a discount floor");
  }

  return {
    customerId: opts.customerId,
    tier,
    orders: mine.length,
    lifetimeMargin,
    averageOrderMargin: mine.length ? lifetimeMargin / mine.length : 0,
    firstOrderAt,
    lastOrderAt,
    daysSinceLastOrder: daysSince === null ? null : Math.round(daysSince),
    because,
  };
}

/** Does this shopper meet or beat the tier a policy requires? */
export function meetsTier(actual: Tier, required: Tier): boolean {
  /**
   * `lapsed` is deliberately NOT below `regular` in this comparison — it is a
   * regular who has drifted, and winning one of those back is usually worth
   * more than the same money spent on someone who is already buying. So a
   * policy requiring `returning` or `regular` accepts them.
   *
   * Written as an explicit rank rather than an index into TIER_ORDER, because
   * TIER_ORDER is a display order and quietly reusing it as a comparison is how
   * `lapsed` would end up outranking `regular` for no reason anyone intended.
   */
  const rank: Record<Tier, number> = { new: 0, returning: 1, regular: 2, lapsed: 2 };
  return rank[actual] >= rank[required];
}
