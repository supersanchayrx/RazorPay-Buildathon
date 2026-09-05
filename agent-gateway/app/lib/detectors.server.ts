/**
 * Stage 1 — detectors.
 *
 * Pure functions over the merchant's own history. No model, no network, no
 * clock beyond the `asOf` handed in. Each emits candidates with the statistics
 * that produced them still attached, because a proposal that cannot show its
 * arithmetic is an opinion.
 *
 * THE TRAPS ARE NOT HARDCODED.
 *
 * That is the point of writing detectors this way. The fixture contains three
 * planted false signals, and none of them is special-cased here — the detectors
 * are written to look for real patterns, they FIND the traps because the traps
 * look like real patterns, and the floors in `floors.server.ts` are what kill
 * them. A proposer that only avoids mistakes it was told about in advance has
 * not been tested; it has been rehearsed.
 *
 * Three lanes come out, and the split is load-bearing:
 *
 *   incident    something is broken and is costing money now. Not ranked, not
 *               weighed against anything — a payment outage is not an offer.
 *   action      margin-safe. Placement, reminders, outreach. Ranked weekly.
 *   experiment  gives up margin. At most one live at a time, separate gate.
 *
 * The first version of this ranked all three with one score, and the arithmetic
 * refused: discounts score negative against margin-safe actions by
 * construction. Chasing a weighting that fixed it would have been fitting the
 * formula to the answer.
 */

import {
  wilsonLower,
  evidenceRatio,
  ruleStats,
  bernoulliCusum,
  fisherUpperTail,
  coefficientOfVariation,
  mean,
  type RuleStats,
} from "./stats.server";

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export type HistoryOrder = {
  id: string;
  ts: string;
  status: string;
  total: number;
  currency: string;
  cohort?: string;
  customer: { id: string };
  lines: Array<{ handle: string; title: string; sku: string; qty: number; unitPrice: number; unitCost?: number; lineTotal: number }>;
  payment: { method: string; bank: string | null; status: string; attempts?: Array<{ status: string }> };
};

export type HistoryCart = {
  id: string;
  ts: string;
  lines: Array<{ handle: string; title: string; sku: string; qty: number; unitPrice: number; lineTotal: number }>;
  lastStep: string;
  recovered: boolean;
};

export type MerchantInputs = {
  unitCost: Record<string, number>;
  floors: {
    minMarginPct: number;
    maxDiscountPct: number;
    neverDiscount: string[];
    minSampleSize: number;
  };
};

export type DetectorInput = {
  orders: HistoryOrder[];
  carts: HistoryCart[];
  inputs: MerchantInputs;
  /** Stock on hand by SKU, from the live catalogue. */
  onHand?: Map<string, number>;
  asOf: Date;
};

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

export type Lane = "incident" | "action" | "experiment";

export type Fact = { label: string; value: string; n?: number };

export type Candidate = {
  id: string;
  lane: Lane;
  kind: string;
  title: string;
  /**
   * The case for this proposal, written from the numbers by template.
   *
   * Deliberately readable without a model. Stages 1–3 produce complete,
   * publishable proposals on their own; a model later improves the WRITING and
   * the selection, and is not load-bearing. That ordering means a bad proposal
   * is unambiguously the model's, because everything upstream was verified.
   */
  rationale: string;
  /**
   * Every number this proposal rests on, as text.
   *
   * When a model does write the prose, each figure in it must appear here or
   * the prose is rejected. "Nearly 60" against a finding of 44 is a fabrication
   * — the same rule that makes the assistant's cards safe.
   */
  facts: Fact[];
  /** Orders per month the proposal touches. */
  reach: number;
  /** Rupees of margin per affected order, at the conservative end. */
  impact: number;
  /** 1 one click · 2 configuration · 3 an operational change. */
  effort: 1 | 2 | 3;
  /** Worst-case rupees at risk. Zero for anything margin-safe. */
  exposure: number;
  /** Derived from the data, never guessed. */
  confidence: number;
  /** Sample size behind the central claim. */
  n: number;
  /** One-sided p-value, where a significance test applies. Fed to BH. */
  p?: number;
  /** For de-duplication in selection, and for the merchant's own reading. */
  products: string[];
  mechanism: string;
  segment?: string;
};

const MONTHS_IN_WINDOW = 6;
const round = (n: number, dp = 0) => Number(n.toFixed(dp));
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/* ------------------------------------------------------------------ *
 * 1. Cross-sell
 * ------------------------------------------------------------------ */

/**
 * Which pairs actually go together, and which of those has money left in it.
 *
 * Two different questions, answered by two different statistics, and conflating
 * them is the standard way this detector goes wrong:
 *
 *   DISCOVER with hyper-lift. Plain lift blows up on rare pairs that co-occur
 *   by chance — lift 3.49 on fourteen baskets is that shape, and it outranks a
 *   pair with more than twice the evidence.
 *
 *   SIZE with leverage x unit margin. Not leverage alone: the highest-leverage
 *   pair in the fixture is chai and assam, and it is the SMALLEST prize,
 *   because assam is already attached to 42% of chai baskets. There is no
 *   headroom left in the obvious pair.
 *
 * So the surprising pair is where the money is, and that falls out of the
 * arithmetic rather than being asserted.
 */
export function crossSell(input: DetectorInput): Candidate[] {
  const placed = input.orders.filter((o) => o.status === "placed");
  const N = placed.length;
  if (N < 30) return [];

  const baskets = new Map<string, Set<string>>();
  const titles = new Map<string, string>();
  const marginOf = new Map<string, number>();

  for (const o of placed) {
    for (const l of o.lines) {
      if (!baskets.has(l.handle)) baskets.set(l.handle, new Set());
      baskets.get(l.handle)!.add(o.id);
      titles.set(l.handle, l.title);
      const cost = l.unitCost ?? input.inputs.unitCost[l.sku];
      if (cost != null) marginOf.set(l.handle, l.unitPrice - cost);
    }
  }

  const handles = [...baskets.keys()];
  const rules: RuleStats[] = [];
  for (const x of handles) {
    for (const y of handles) {
      if (x === y) continue;
      rules.push(ruleStats(x, y, baskets.get(x)!, baskets.get(y)!, N));
    }
  }

  const out: Candidate[] = [];
  for (const r of rules.sort((a, b) => b.hyperLift - a.hyperLift).slice(0, 6)) {
    // A rule with no excess over the base rate is not a rule; it is two popular
    // products appearing together as often as chance predicts.
    const excess = Math.max(0, r.confidenceLower - r.baseRate);
    if (excess <= 0) continue;

    const margin = marginOf.get(r.y) ?? 0;
    if (margin <= 0) continue;

    // Imbalance: pitch in the direction the data actually supports. Without
    // this a symmetric-looking pair gets cross-sold backwards, to an audience
    // for whom the association does not hold.
    if (r.imbalanceRatio > 0.75 && r.confidence < r.nXY / r.nY) continue;

    const reach = r.nX / MONTHS_IN_WINDOW;
    const impact = excess * margin;

    out.push({
      id: `cross_sell:${r.x}->${r.y}`,
      lane: "action",
      kind: "cross_sell",
      title: `Show ${titles.get(r.y) ?? r.y} to ${titles.get(r.x) ?? r.x} buyers`,
      rationale:
        `${r.nXY} of ${r.nX} baskets with ${titles.get(r.x) ?? r.x} also held ` +
        `${titles.get(r.y) ?? r.y} — ${pct(r.confidence)} against a ${pct(r.baseRate)} base rate. ` +
        `Taking the conservative end of that interval (${pct(r.confidenceLower)}), the excess is worth ` +
        `${inr(impact)} of margin per basket, about ${inr(reach * impact)} a month. ` +
        `Costs nothing: it is placement, not a price.`,
      facts: [
        { label: "baskets with both", value: String(r.nXY), n: r.nXY },
        { label: "baskets with the first", value: String(r.nX), n: r.nX },
        { label: "attach rate", value: pct(r.confidence) },
        { label: "attach rate, lower bound", value: pct(r.confidenceLower) },
        { label: "base rate", value: pct(r.baseRate) },
        { label: "hyper-lift", value: r.hyperLift.toFixed(2) },
        { label: "lift", value: r.lift.toFixed(2) },
        { label: "monthly value", value: inr(reach * impact) },
      ],
      reach,
      impact,
      effort: 1,
      exposure: 0,
      confidence: evidenceRatio(r.nXY, r.nX),
      n: r.nXY,
      p: r.fisherP,
      products: [r.x, r.y],
      mechanism: "placement",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 2. Replenishment
 * ------------------------------------------------------------------ */

/**
 * Customers on a regular cycle.
 *
 * THIS DETECTOR EXISTS TO PROPOSE A REMINDER AND TO REFUSE TO PROPOSE A
 * DISCOUNT, and the distinction is the whole of it.
 *
 * A cohort that reorders every 33 days with a coefficient of variation of 0.34
 * is the textbook definition of "sure things" in uplift terms: they were going
 * to buy anyway. Discounting them is not marketing, it is a transfer of margin
 * to people already committed — the most attractive-looking signal in the data
 * and the worst possible discount target.
 *
 * Telling them their tea is probably running low costs nothing and is honest.
 * So the discount version is never generated here, and the rationale says why,
 * because the merchant will otherwise think of it themselves.
 */
export function replenishment(input: DetectorInput): Candidate[] {
  const placed = input.orders.filter((o) => o.status === "placed");

  // Gaps between consecutive orders, per customer, per product.
  const byCustomerProduct = new Map<string, string[]>();
  for (const o of placed) {
    for (const l of new Map(o.lines.map((l) => [l.handle, l])).values()) {
      const key = `${o.customer.id}::${l.handle}`;
      if (!byCustomerProduct.has(key)) byCustomerProduct.set(key, []);
      byCustomerProduct.get(key)!.push(o.ts);
    }
  }

  /**
   * REGULARITY IS MEASURED PER CUSTOMER, THEN POOLED — NEVER POOLED FIRST.
   *
   * This was wrong in the first version and the fixture caught it. Pooling every
   * gap for a product and taking one coefficient of variation measures the
   * spread BETWEEN customers, not whether any individual has a cycle. Someone
   * who buys every 30 days and someone who buys every 90 are each perfectly
   * regular, and pooled they look like noise: masala chai came out at CV 0.88
   * that way, and the detector found nothing at all.
   *
   * Measured per customer, the regular ones separate cleanly from the
   * occasional repeat buyers, which is the cohort a reminder is actually for.
   */
  const REGULAR_CV = 0.5;
  const MIN_GAPS_PER_CUSTOMER = 3;

  const gapsByProduct = new Map<
    string,
    { gaps: number[]; customers: Set<string>; cvs: number[] }
  >();

  for (const [key, stamps] of byCustomerProduct) {
    if (stamps.length <= MIN_GAPS_PER_CUSTOMER) continue;
    const [customer, handle] = key.split("::");
    const sorted = [...stamps].sort();
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const days = (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 86_400_000;
      if (days > 0) gaps.push(days);
    }
    const cv = coefficientOfVariation(gaps, MIN_GAPS_PER_CUSTOMER);
    // This customer has no cycle of their own, so they are not in the cohort.
    if (cv === null || cv > REGULAR_CV) continue;

    const entry = gapsByProduct.get(handle) ?? { gaps: [], customers: new Set<string>(), cvs: [] };
    entry.gaps.push(...gaps);
    entry.customers.add(customer);
    entry.cvs.push(cv);
    gapsByProduct.set(handle, entry);
  }

  const out: Candidate[] = [];
  for (const [handle, { gaps, customers, cvs }] of gapsByProduct) {
    if (gaps.length < input.inputs.floors.minSampleSize) continue;
    // The typical regularity within the cohort, not across it.
    const cv = mean(cvs);

    const avgGap = mean(gaps);
    const title =
      placed.flatMap((o) => o.lines).find((l) => l.handle === handle)?.title ?? handle;
    const cohortOrders = placed.filter((o) => o.lines.some((l) => l.handle === handle));
    const avgOrder = mean(cohortOrders.map((o) => o.total));

    out.push({
      id: `replenish_reminder:${handle}`,
      lane: "action",
      kind: "reminder",
      title: `Remind ${customers.size} regular ${title} buyers when they are due`,
      rationale:
        `${customers.size} customers have reordered ${title} at least twice, across ` +
        `${gaps.length} intervals averaging ${round(avgGap)} days with a coefficient of variation of ` +
        `${cv.toFixed(2)} — regular enough to time a reminder. ` +
        `A DISCOUNT TO THIS COHORT IS NOT PROPOSED AND SHOULD NOT BE: a group this predictable ` +
        `reorders anyway, so ten percent off would be ${inr(avgOrder * 0.1 * customers.size)} given ` +
        `to people already committed. The reminder costs nothing and does the same work.`,
      facts: [
        { label: "customers", value: String(customers.size), n: customers.size },
        { label: "intervals measured", value: String(gaps.length), n: gaps.length },
        { label: "mean gap", value: `${round(avgGap)} days` },
        { label: "coefficient of variation", value: cv.toFixed(2) },
        { label: "average order", value: inr(avgOrder) },
      ],
      reach: customers.size,
      // A reminder shifts timing, not desire. Claiming more would be inventing
      // a lift we have no way to measure without a holdout.
      impact: avgOrder * 0.05 * 0.5,
      effort: 1,
      exposure: 0,
      confidence: Math.min(1, 1 - cv),
      n: gaps.length,
      products: [handle],
      mechanism: "outreach",
      segment: "repeat buyers",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 3. Abandonment
 * ------------------------------------------------------------------ */

/** Baskets that got close to payment and did not arrive. */
export function abandonment(input: DetectorInput): Candidate[] {
  if (input.carts.length < 20) return [];

  const byProduct = new Map<string, { carts: HistoryCart[]; title: string; value: number }>();
  for (const c of input.carts) {
    if (c.recovered) continue;
    for (const l of c.lines) {
      const e = byProduct.get(l.handle) ?? { carts: [], title: l.title, value: l.unitPrice };
      e.carts.push(c);
      byProduct.set(l.handle, e);
    }
  }

  const placed = input.orders.filter((o) => o.status === "placed");
  const out: Candidate[] = [];

  for (const [handle, { carts, title, value }] of byProduct) {
    if (carts.length < input.inputs.floors.minSampleSize) continue;
    const reachedPayment = carts.filter((c) => c.lastStep === "payment").length;
    const everBought = placed.filter((o) => o.lines.some((l) => l.handle === handle)).length;
    const sku = carts[0].lines.find((l) => l.handle === handle)?.sku ?? "";
    const cost = input.inputs.unitCost[sku] ?? 0;
    const margin = value - cost;
    if (margin <= 0) continue;

    // A conservative recovery rate, stated as an assumption rather than
    // presented as a measurement. We have never run this outreach, so we have
    // no rate to cite — and dressing a guess as a finding is the failure this
    // whole pipeline is built to avoid.
    const ASSUMED_RECOVERY = 0.08;

    out.push({
      id: `abandonment:${handle}`,
      lane: "action",
      kind: "outreach",
      title: `Follow up on ${carts.length} abandoned ${title} baskets`,
      rationale:
        `${carts.length} baskets held ${title} and were never completed; ${reachedPayment} of them ` +
        `reached the payment step, and only ${everBought} ${title} orders exist in the whole window. ` +
        `That gap is the finding. At ${inr(margin)} of margin a unit and an ASSUMED ${pct(ASSUMED_RECOVERY)} ` +
        `recovery — assumed, because this outreach has never run here and we have no rate to cite — ` +
        `it is worth about ${inr((carts.length / MONTHS_IN_WINDOW) * margin * ASSUMED_RECOVERY)} a month.`,
      facts: [
        { label: "abandoned baskets", value: String(carts.length), n: carts.length },
        { label: "reached payment", value: String(reachedPayment), n: reachedPayment },
        { label: "orders ever placed", value: String(everBought), n: everBought },
        { label: "margin per unit", value: inr(margin) },
        { label: "assumed recovery", value: pct(ASSUMED_RECOVERY) },
      ],
      reach: carts.length / MONTHS_IN_WINDOW,
      impact: margin * ASSUMED_RECOVERY,
      effort: 2,
      exposure: 0,
      // Low on purpose. The recovery rate is an assumption, and confidence is
      // the term that carries how much we actually know.
      confidence: 0.6,
      n: carts.length,
      products: [handle],
      mechanism: "outreach",
      segment: "abandoners",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 4. Payment failures — an incident, not an offer
 * ------------------------------------------------------------------ */

/**
 * A step change in payment failures, found with CUSUM.
 *
 * The earlier version compared a 60-day window against the rest. That window
 * was chosen after looking at the data, which is a forking path: the analytical
 * freedom itself manufactures findings. CUSUM removes the choice and returns a
 * change POINT.
 *
 * IT REPORTS ITS OWN LATENESS. On the fixture the alarm fires 31 days after the
 * true onset, because the stream averages under one netbanking order a day.
 * A merchant reading "detected 7 August" as "started 7 August" would go looking
 * for a deploy on the wrong date, so both numbers are always shown.
 */
export function paymentFailures(input: DetectorInput): Candidate[] {
  const withPayment = input.orders
    .filter((o) => o.payment?.method)
    .sort((a, b) => a.ts.localeCompare(b.ts));
  if (withPayment.length < 60) return [];

  const out: Candidate[] = [];
  const groups = new Map<string, HistoryOrder[]>();
  for (const o of withPayment) {
    const key = `${o.payment.method}${o.payment.bank ? `/${o.payment.bank}` : ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  // The store-wide failure rate is the baseline a group is compared against.
  const failed = (o: HistoryOrder) =>
    o.payment.status === "failed" || (o.payment.attempts ?? []).some((a) => a.status === "failed");
  const baseline = withPayment.filter(failed).length / withPayment.length;

  for (const [key, rows] of groups) {
    if (rows.length < input.inputs.floors.minSampleSize) continue;

    /**
     * The sequential likelihood-ratio CUSUM, because these are rare binary
     * events rather than a continuous measurement.
     *
     * Two earlier attempts were wrong in opposite directions, which is worth
     * recording. Raw 0/1 with hand-picked constants never fired at all. The
     * standardised version fired on ANY two consecutive failures — at an 11%
     * base rate that is common, so it raised a false alarm on two ordinary
     * retries and dated a real outage four weeks early.
     *
     * `p1` is the rate worth catching: double the baseline, or ten points above
     * it, whichever is larger. That second term matters for a shop with very
     * few failures, where doubling a 1% rate is still 2% and not worth waking
     * anyone for.
     */
    const p1 = Math.min(0.95, Math.max(baseline * 2, baseline + 0.1));
    const alarm = bernoulliCusum(rows.map(failed), baseline, p1, 4);
    if (!alarm) continue;

    const since = rows.slice(alarm.onsetIndex);
    const failures = since.filter(failed).length;
    const lb = wilsonLower(failures, since.length);
    if (lb <= baseline) continue;

    const lost = since.filter((o) => o.payment.status === "failed");
    const avgLost = lost.length ? mean(lost.map((o) => o.total)) : 0;
    const detectedAt = rows[alarm.index].ts.slice(0, 10);
    const onsetAt = rows[alarm.onsetIndex].ts.slice(0, 10);
    const lagDays = Math.round(
      (Date.parse(rows[alarm.index].ts) - Date.parse(rows[alarm.onsetIndex].ts)) / 86_400_000,
    );

    // The first failure in the elevated run. The onset estimate is where the
    // evidence starts accumulating, which can sit slightly before the first
    // actual failure; showing both is what turns one confident date into an
    // honest window.
    const firstFailureAt = (since.find(failed) ?? since[0]).ts.slice(0, 10);

    out.push({
      id: `payment_incident:${key}`,
      lane: "incident",
      kind: "payment",
      title: `${key} payments are failing at ${pct(failures / since.length)}`,
      rationale:
        `${failures} of the last ${since.length} ${key} payments have failed, against ` +
        `${pct(baseline)} across all methods. The lower bound of that rate is ${pct(lb)}, so it is ` +
        `not a small-sample artefact. ` +
        `THE CHANGE BEGAN SOMEWHERE BETWEEN ${onsetAt} AND ${firstFailureAt} — that is a window, ` +
        `not a date, and it is the honest resolution at ${(since.length / Math.max(1, lagDays / 30)).toFixed(0)} ` +
        `${key} orders a month. ` +
        `It took until ${detectedAt} to be sure, ${lagDays} days later: at this volume the method ` +
        `needs that long, so do not read the detection date as the start. ` +
        `${lost.length} orders worth ${inr(lost.reduce((s, o) => s + o.total, 0))} were lost outright.`,
      facts: [
        { label: "failures since onset", value: `${failures} of ${since.length}`, n: since.length },
        { label: "rate, lower bound", value: pct(lb) },
        { label: "store baseline", value: pct(baseline) },
        { label: "change began between", value: `${onsetAt} and ${firstFailureAt}` },
        { label: "estimated onset", value: onsetAt },
        { label: "first failure", value: firstFailureAt },
        { label: "detected", value: detectedAt },
        { label: "detection lag", value: `${lagDays} days` },
        { label: "orders lost", value: String(lost.length), n: lost.length },
        { label: "revenue lost", value: inr(lost.reduce((s, o) => s + o.total, 0)) },
      ],
      reach: since.length / MONTHS_IN_WINDOW,
      impact: avgLost * 0.45,
      effort: 2,
      exposure: 0,
      confidence: evidenceRatio(failures, since.length),
      n: since.length,
      products: [],
      mechanism: "payments",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 5. Classification and stock — ABC/XYZ
 * ------------------------------------------------------------------ */

export type Classified = {
  handle: string;
  title: string;
  sku: string;
  revenue: number;
  revenueShare: number;
  unitsPerMonth: number;
  cv: number | null;
  abc: "A" | "B" | "C";
  xyz: "X" | "Y" | "Z" | "?";
  monthsOfCover: number | null;
  onHand: number | null;
};

/**
 * ABC by revenue Pareto, XYZ by the variability of monthly demand.
 *
 * CLASSIFY ON REVENUE, NOT VELOCITY. The fixture's own label called the cupping
 * set a slow mover, and it is — in units. In rupees it is 11.6% of the business.
 * "Slow mover" is a unit-centric framing, and acting on it would justify
 * discounting an A item. This detector exists partly to stop the others being
 * fooled the same way.
 *
 * XYZ returns "?" rather than a letter when there are too few periods to
 * describe. Three orders in three months reports CV 0.00, which reads as perfect
 * predictability and is really an absence of data.
 */
export function classify(input: DetectorInput): Classified[] {
  const placed = input.orders.filter((o) => o.status === "placed");
  const byHandle = new Map<
    string,
    { title: string; sku: string; skus: Set<string>; revenue: number; byMonth: Map<string, number> }
  >();

  for (const o of placed) {
    const month = o.ts.slice(0, 7);
    for (const l of o.lines) {
      const e = byHandle.get(l.handle) ?? {
        title: l.title,
        // The best-selling variant, used when one SKU has to stand for the
        // product — a unit cost, say. Stock is never taken from it.
        sku: l.sku,
        skus: new Set<string>(),
        revenue: 0,
        byMonth: new Map<string, number>(),
      };
      e.revenue += l.lineTotal;
      e.skus.add(l.sku);
      e.byMonth.set(month, (e.byMonth.get(month) ?? 0) + l.qty);
      byHandle.set(l.handle, e);
    }
  }

  const total = [...byHandle.values()].reduce((s, e) => s + e.revenue, 0);
  const rows = [...byHandle.entries()]
    .map(([handle, e]) => {
      const months = [...e.byMonth.values()];
      const unitsPerMonth = months.reduce((s, n) => s + n, 0) / Math.max(1, months.length);
      /**
       * Stock is summed ACROSS EVERY VARIANT of the product.
       *
       * Reading one SKU's inventory and calling it the product's cover was a
       * real bug: a tea with 88 units in the 100g tin and 54 in the 250g looked
       * like it had 54, and its months of cover came out roughly a third of the
       * truth. Cover drives the markdown detector, so the error pointed in the
       * dangerous direction — it hides overstock rather than inventing it.
       */
      const onHand = input.onHand
        ? [...e.skus].reduce((sum, sku) => sum + (input.onHand!.get(sku) ?? 0), 0)
        : null;
      const cv = coefficientOfVariation(months);
      return {
        handle,
        title: e.title,
        sku: e.sku,
        revenue: e.revenue,
        revenueShare: total ? e.revenue / total : 0,
        unitsPerMonth,
        cv,
        abc: "C" as Classified["abc"],
        xyz: (cv === null ? "?" : cv < 0.5 ? "X" : cv <= 1 ? "Y" : "Z") as Classified["xyz"],
        monthsOfCover: onHand != null && unitsPerMonth > 0 ? onHand / unitsPerMonth : null,
        onHand,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  let cumulative = 0;
  for (const r of rows) {
    cumulative += r.revenueShare;
    r.abc = cumulative <= 0.8 ? "A" : cumulative <= 0.95 ? "B" : "C";
  }
  return rows;
}

/**
 * Stock that has run out on something that sells, or piled up on something that
 * does not. Both are incidents: neither is an offer, and neither should wait a
 * week to be ranked against a cross-sell.
 */
export function stockIncidents(input: DetectorInput): Candidate[] {
  const rows = classify(input);
  const out: Candidate[] = [];

  for (const r of rows) {
    if (r.onHand === null) continue;

    if (r.onHand === 0 && (r.abc === "A" || r.abc === "B")) {
      out.push({
        id: `stockout:${r.handle}`,
        lane: "incident",
        kind: "stock",
        title: `${r.title} is out of stock`,
        rationale:
          `${r.title} is an ${r.abc}${r.xyz} item — ${pct(r.revenueShare)} of revenue, ` +
          `about ${r.unitsPerMonth.toFixed(1)} units a month — and there are none left. ` +
          `Every day it stays out costs roughly ${inr((r.revenue / MONTHS_IN_WINDOW / 30))} of sales.`,
        facts: [
          { label: "class", value: `${r.abc}${r.xyz}` },
          { label: "share of revenue", value: pct(r.revenueShare) },
          { label: "units per month", value: r.unitsPerMonth.toFixed(1) },
          { label: "on hand", value: "0" },
        ],
        reach: r.unitsPerMonth,
        impact: 0,
        effort: 3,
        exposure: 0,
        confidence: 1,
        n: Math.round(r.unitsPerMonth * MONTHS_IN_WINDOW),
        products: [r.handle],
        mechanism: "inventory",
      });
    }

    // Deep cover on a slow item is the honest opening for a markdown — and it
    // is opened here as an OBSERVATION, in the incident lane. The markdown
    // itself is a separate candidate that has to survive the floors.
    if (r.monthsOfCover !== null && r.monthsOfCover > 6 && r.abc === "C") {
      out.push({
        id: `overstock:${r.handle}`,
        lane: "incident",
        kind: "stock",
        title: `${r.title} has ${r.monthsOfCover.toFixed(1)} months of cover`,
        rationale:
          `${r.onHand} units of ${r.title} against ${r.unitsPerMonth.toFixed(1)} a month. ` +
          `It is a ${r.abc}${r.xyz} item at ${pct(r.revenueShare)} of revenue. ` +
          `This is the observation, not the recommendation — whether it is worth discounting ` +
          `depends on carrying cost against margin given up, which is computed separately.`,
        facts: [
          { label: "class", value: `${r.abc}${r.xyz}` },
          { label: "on hand", value: String(r.onHand) },
          { label: "months of cover", value: r.monthsOfCover.toFixed(1) },
          { label: "units per month", value: r.unitsPerMonth.toFixed(1) },
        ],
        reach: r.unitsPerMonth,
        impact: 0,
        effort: 1,
        exposure: 0,
        confidence: r.cv === null ? 0.3 : 1,
        n: Math.round(r.unitsPerMonth * MONTHS_IN_WINDOW),
        products: [r.handle],
        mechanism: "inventory",
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 6. Payment preference — the detector that finds trap T1
 * ------------------------------------------------------------------ */

/**
 * Does any product attract an unusual payment method?
 *
 * A perfectly reasonable thing to look for, and on this fixture it finds a
 * planted lie: two of three kettle orders were cash on delivery, which reads as
 * "kettle buyers overwhelmingly prefer COD" and passes Fisher's exact test at
 * p = 0.028.
 *
 * NOTHING HERE SPECIAL-CASES IT. The detector emits it with its statistics
 * attached — n=3, Wilson lower bound 20.8%, confidence 0.31 — and three
 * independent layers downstream each catch it: the evidence ratio cripples its
 * rank, Benjamini–Hochberg rejects it among tests where the genuine
 * associations sit at 1e-5 to 1e-10, and the sample floor removes it outright.
 *
 * That is the right number of layers for a trap that passes a naive
 * significance test.
 */
export function paymentPreference(input: DetectorInput): Candidate[] {
  const all = input.orders.filter((o) => o.payment?.method);
  if (all.length < 60) return [];

  const N = all.length;
  const methodTotals = new Map<string, number>();
  for (const o of all) methodTotals.set(o.payment.method, (methodTotals.get(o.payment.method) ?? 0) + 1);

  const byHandle = new Map<string, HistoryOrder[]>();
  for (const o of all) {
    for (const h of new Set(o.lines.map((l) => l.handle))) {
      if (!byHandle.has(h)) byHandle.set(h, []);
      byHandle.get(h)!.push(o);
    }
  }

  const out: Candidate[] = [];
  for (const [handle, rows] of byHandle) {
    const title = rows[0].lines.find((l) => l.handle === handle)?.title ?? handle;
    for (const [method, methodTotal] of methodTotals) {
      const k = rows.filter((o) => o.payment.method === method).length;
      if (k === 0) continue;
      const point = k / rows.length;
      const base = methodTotal / N;
      if (point <= base * 1.5) continue;

      const lb = wilsonLower(k, rows.length);
      const p = fisherUpperTail(k, N, methodTotal, rows.length);

      out.push({
        id: `payment_preference:${handle}:${method}`,
        lane: "action",
        kind: "payment_preference",
        title: `${title} buyers may prefer ${method}`,
        rationale:
          `${k} of ${rows.length} ${title} orders used ${method}, against ${pct(base)} store-wide. ` +
          `On ${rows.length} orders the lower bound of that rate is ${pct(lb)} — ` +
          `${lb <= base ? "which does not clear the store baseline at all" : `still above the ${pct(base)} baseline`}. ` +
          `Fisher's exact gives p = ${p.toExponential(2)}.`,
        facts: [
          { label: "orders with this method", value: `${k} of ${rows.length}`, n: rows.length },
          { label: "raw rate", value: pct(point) },
          { label: "rate, lower bound", value: pct(lb) },
          { label: "store-wide rate", value: pct(base) },
          { label: "Fisher p", value: p.toExponential(2) },
        ],
        reach: rows.length / MONTHS_IN_WINDOW,
        impact: mean(rows.map((o) => o.total)) * 0.02,
        effort: 2,
        exposure: 0,
        confidence: evidenceRatio(k, rows.length),
        n: rows.length,
        p,
        products: [handle],
        mechanism: "payments",
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 7. Markdown candidates — the detector that finds trap T2
 * ------------------------------------------------------------------ */

/**
 * Products with enough cover to justify considering a markdown.
 *
 * Emitted into the EXPERIMENT lane with no economics attached yet — sizing is
 * `economics.server.ts`'s job, and the margin and discount floors are
 * `floors.server.ts`'s. This detector's only judgment is "there is enough stock
 * here for the question to be worth asking".
 *
 * On the fixture it duly proposes a markdown on cold brew concentrate, which
 * carries 14% margin against a 25% floor and sits on the merchant's
 * never-discount list. It would rank FIRST of everything if it were not
 * stopped, and it sells at a loss on every unit. The floors are not a
 * formality; they are the only thing between this pipeline and a confident,
 * well-ranked, expensive mistake.
 */
export function markdownCandidates(input: DetectorInput): Candidate[] {
  const rows = classify(input);
  const out: Candidate[] = [];

  for (const r of rows) {
    if (r.onHand === null || r.onHand === 0) continue;
    if (r.monthsOfCover === null || r.monthsOfCover < 2) continue;

    const cost = input.inputs.unitCost[r.sku];
    if (cost == null) continue;
    const unitPrice = r.unitsPerMonth > 0 ? r.revenue / (r.unitsPerMonth * MONTHS_IN_WINDOW) : 0;
    if (unitPrice <= 0) continue;

    const depth = 0.1;
    const givenUp = unitPrice * depth;
    const marginNow = unitPrice - cost;
    const marginAfter = marginNow - givenUp;
    // How much more volume the cut has to buy just to stand still.
    const breakEvenLift = marginAfter > 0 ? givenUp / marginAfter : Infinity;

    out.push({
      id: `markdown:${r.handle}@${depth * 100}%`,
      lane: "experiment",
      kind: "discount",
      title: `Consider ${pct(depth)} off ${r.title}`,
      rationale:
        `${r.onHand} units, ${r.monthsOfCover.toFixed(1)} months of cover at ` +
        `${r.unitsPerMonth.toFixed(1)} a month. Current margin ${pct(marginNow / unitPrice)}. ` +
        `At ${pct(depth)} off, ${inr(givenUp)} a unit is given up and the cut must lift volume by ` +
        `${Number.isFinite(breakEvenLift) ? pct(breakEvenLift) : "an impossible amount"} just to break even. ` +
        `WE CANNOT TELL YOU WHETHER IT WILL: this store has never changed a price, so there is no ` +
        `variation to estimate elasticity from. The arithmetic is ours; the judgment is yours.`,
      facts: [
        { label: "on hand", value: String(r.onHand) },
        { label: "months of cover", value: r.monthsOfCover.toFixed(1) },
        { label: "current margin", value: pct(marginNow / unitPrice) },
        { label: "margin after the cut", value: pct(marginAfter / unitPrice) },
        { label: "given up per unit", value: inr(givenUp) },
        { label: "break-even lift", value: Number.isFinite(breakEvenLift) ? pct(breakEvenLift) : "unreachable" },
        { label: "class", value: `${r.abc}${r.xyz}` },
      ],
      reach: r.unitsPerMonth,
      // Negative by construction: a discount gives margin away, and whether it
      // buys anything back is exactly what we cannot measure.
      impact: -givenUp,
      effort: 1,
      exposure: Math.min(r.onHand, 60) * givenUp,
      confidence: r.cv === null ? 0.3 : 0.9,
      n: Math.round(r.unitsPerMonth * MONTHS_IN_WINDOW),
      products: [r.handle],
      mechanism: "price",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */

export function runDetectors(input: DetectorInput): Candidate[] {
  return [
    ...paymentFailures(input),
    ...stockIncidents(input),
    ...crossSell(input),
    ...replenishment(input),
    ...abandonment(input),
    ...paymentPreference(input),
    ...markdownCandidates(input),
  ];
}
