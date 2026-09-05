/**
 * Stage 3 — economics.
 *
 * Deterministic. THE MODEL NEVER PRODUCES A NUMBER THAT REACHES A MERCHANT.
 *
 * The hardest discipline in this file is what it refuses to compute.
 *
 * WE CANNOT ESTIMATE PRICE ELASTICITY, AND WILL NOT PRETEND TO.
 *
 * A log-log regression recovers elasticity as a coefficient, and on observational
 * retail data it is confounded: retailers raise prices when demand is strong and
 * cut them when shelves are slow, so price correlates with unobserved demand
 * shocks and OLS pulls the estimate toward zero. It needs an instrument or an
 * experiment.
 *
 * And this store has never changed a price. Zero price variation. Elasticity is
 * not biased here, it is UNIDENTIFIED — there is no estimator, good or bad.
 *
 * So nothing here ever says "10% off will lift units by X". It says: this needs
 * +21%, or 1.5 extra units a month, to pay for itself. The merchant knows their
 * category; we know the arithmetic. Putting the judgment where the knowledge is
 * beats a fabricated forecast, and it is the same discipline as refusing to
 * invent a deadline.
 */

export type Markdown = {
  sku: string;
  handle: string;
  unitPrice: number;
  unitCost: number;
  depth: number;
  unitsPerMonth: number;
  onHand: number;
};

export type MarkdownEconomics = {
  /** Rupees of margin surrendered on every unit sold. */
  givenUpPerUnit: number;
  marginNowPct: number;
  marginAfterPct: number;
  /**
   * The proportional volume increase needed just to stand still.
   *
   * `givenUp / marginAfter`. Infinite when the cut takes margin to zero or
   * below — at which point extra volume makes things worse, not better, and the
   * proposal is not a trade-off but a mistake.
   */
  breakEvenLift: number;
  /** The same figure in units, which merchants find easier to judge. */
  extraUnitsPerMonth: number;
  /** Worst case: every remaining unit sells at the discount. */
  maxExposure: number;
  /** Rupees tied up in the overstock for a year at the given rate. */
  carryingCost: number;
  monthsOfCover: number;
  /**
   * True when the carrying cost is small against the exposure — in which case
   * the "clear it early and shallow" argument does not apply and the proposal
   * must not borrow it.
   */
  carryingCostImmaterial: boolean;
};

/** Typical retail cost of capital plus storage and obsolescence. */
const CARRYING_RATE_PER_YEAR = 0.2;

export function markdownEconomics(m: Markdown): MarkdownEconomics {
  const givenUpPerUnit = m.unitPrice * m.depth;
  const marginNow = m.unitPrice - m.unitCost;
  const marginAfter = marginNow - givenUpPerUnit;

  const breakEvenLift = marginAfter > 0 ? givenUpPerUnit / marginAfter : Infinity;
  const monthsOfCover = m.unitsPerMonth > 0 ? m.onHand / m.unitsPerMonth : Infinity;

  // Capital tied up in the stock for as long as it takes to sell through.
  const inventoryValue = m.onHand * m.unitCost;
  const carryingCost =
    Number.isFinite(monthsOfCover) && monthsOfCover > 0
      ? inventoryValue * CARRYING_RATE_PER_YEAR * (monthsOfCover / 12)
      : 0;

  const maxExposure = m.onHand * givenUpPerUnit;

  return {
    givenUpPerUnit,
    marginNowPct: m.unitPrice > 0 ? marginNow / m.unitPrice : 0,
    marginAfterPct: m.unitPrice > 0 ? marginAfter / m.unitPrice : 0,
    breakEvenLift,
    extraUnitsPerMonth: Number.isFinite(breakEvenLift) ? m.unitsPerMonth * breakEvenLift : Infinity,
    maxExposure,
    carryingCost,
    monthsOfCover,
    /**
     * If holding the stock costs a small fraction of what the discount gives
     * away, then "clear it early to save the carrying cost" is simply false
     * here, and a proposal that says so is borrowing an argument from a
     * different shop with different numbers.
     *
     * A QUARTER is the line. Below it the carrying cost cannot carry the
     * decision on its own — the markdown has to be justified by something else
     * or not at all. Measured on the cupping set: ₹439 of carrying against
     * ₹2,835 given away, which is 15% and nowhere near enough.
     */
    carryingCostImmaterial: maxExposure > 0 && carryingCost < maxExposure * 0.25,
  };
}

/**
 * Store scale, used to make exposure relative.
 *
 * A ₹7,560 cap is trivial for one merchant and existential for another. RICE
 * has no downside term at all, which is its most serious omission for this
 * problem — so risk is expressed against the store's own monthly gross margin
 * rather than as an absolute.
 */
export function storeScale(
  orders: Array<{ status: string; total: number; lines: Array<{ sku: string; qty: number; unitPrice: number }> }>,
  unitCost: Record<string, number>,
  months: number,
): { monthlyGrossMargin: number; monthlyOrders: number } {
  const placed = orders.filter((o) => o.status === "placed");
  let grossMargin = 0;
  for (const o of placed) {
    for (const l of o.lines) {
      const cost = unitCost[l.sku];
      if (cost != null) grossMargin += (l.unitPrice - cost) * l.qty;
    }
  }
  return {
    monthlyGrossMargin: grossMargin / Math.max(1, months),
    monthlyOrders: placed.length / Math.max(1, months),
  };
}
