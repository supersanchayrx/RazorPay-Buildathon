/**
 * The arithmetic behind every proposal.
 *
 * ANYTHING COUNTABLE IS COUNTED HERE, NEVER BY A MODEL.
 *
 * A model asked to compute an attach rate over 771 orders returns a plausible
 * number that is wrong, and you cannot tell which one it is. Arithmetic is not
 * a judgment task. So this file is pure: no I/O, no network, no clock, no
 * randomness. Same inputs, same outputs, forever — which is the only reason the
 * numbers in a merchant-facing proposal can be trusted.
 *
 * Every function here was probed against `data/orders.jsonl` (seed 20260905)
 * before it was written down as design. See the offer-proposer architecture doc.
 */

/* ------------------------------------------------------------------ *
 * Proportions
 * ------------------------------------------------------------------ */

/**
 * Wilson score interval, lower bound.
 *
 * NEVER REPORT A RAW PROPORTION. 2 out of 3 is not "67%", it is "three orders".
 * The Wald interval assumes asymptotic normality and falls apart near 0, near 1,
 * and at small n — exactly where a proposer is most tempted to find a pattern.
 * Wilson inverts a score test instead, so it behaves at the edges.
 *
 * Using the LOWER bound as the ranking value is the point: it rewards a claim
 * for having both a good rate and enough evidence, and it degrades a thin claim
 * automatically rather than needing a rule to catch it.
 *
 *   2/3     raw 66.7%   wilson LB 20.8%
 *   158/300 raw 52.7%   wilson LB 47.1%
 */
export function wilsonLower(k: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const margin = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, centre - margin);
}

/** Upper bound of the same interval, so a range can be stated honestly. */
export function wilsonUpper(k: number, n: number, z = 1.96): number {
  if (n <= 0) return 1;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const margin = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.min(1, centre + margin);
}

/**
 * How much of the point estimate survives the interval.
 *
 * This is the CONFIDENCE term in the ranking score, and deriving it rather than
 * asking a human for "50 / 80 / 100%" is the single biggest fix to RICE. The
 * data picks the number: 0.31 at n=3, 0.88 at n=158.
 */
export function evidenceRatio(k: number, n: number): number {
  if (n <= 0 || k <= 0) return 0;
  return wilsonLower(k, n) / (k / n);
}

/**
 * Empirical Bayes shrinkage toward a prior mean.
 *
 * The smooth version of a sample floor: a product with 2 orders is pulled most
 * of the way back to the catalogue average, one with 200 barely moves. Beta is
 * conjugate to the binomial, so the posterior mean is closed-form and fast.
 *
 * `strength` is the prior's weight in pseudo-observations. Shrinkage is the
 * soft first line; the hard floor in `floors.server.ts` stays as the second,
 * because a soft prior can still be overwhelmed by a lucky run.
 */
export function shrink(k: number, n: number, priorMean: number, strength = 20): number {
  return (k + priorMean * strength) / (n + strength);
}

/* ------------------------------------------------------------------ *
 * Log-gamma and the hypergeometric family
 * ------------------------------------------------------------------ */

/**
 * Lanczos approximation to log Gamma.
 *
 * Factorials of 771 overflow a double long before you need them, so every
 * combinatorial quantity below is computed in log space and exponentiated
 * exactly once, at the end.
 */
function lgamma(x: number): number {
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

const lchoose = (n: number, k: number): number =>
  k < 0 || k > n ? -Infinity : lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

/** P(C = k) where C ~ Hypergeometric(N population, K successes, n draws). */
export function hypergeomPmf(k: number, N: number, K: number, n: number): number {
  return Math.exp(lchoose(K, k) + lchoose(N - K, n - k) - lchoose(N, n));
}

/**
 * Fisher's exact test, one-sided: P(C >= k).
 *
 * Chi-squared stops being trustworthy at low expected cell counts, which is
 * precisely where a rare-pair "discovery" lives. Fisher is exact under the
 * hypergeometric, so it stays valid there.
 */
export function fisherUpperTail(k: number, N: number, K: number, n: number): number {
  let s = 0;
  const top = Math.min(K, n);
  for (let i = k; i <= top; i++) s += hypergeomPmf(i, N, K, n);
  return Math.min(1, Math.max(0, s));
}

/** The delta-quantile of Hypergeometric(N, K, n) — the denominator of hyper-lift. */
export function hypergeomQuantile(delta: number, N: number, K: number, n: number): number {
  let c = 0;
  const top = Math.min(K, n);
  for (let i = 0; i <= top; i++) {
    c += hypergeomPmf(i, N, K, n);
    if (c >= delta) return i;
  }
  return top;
}

/* ------------------------------------------------------------------ *
 * Association rules
 * ------------------------------------------------------------------ */

export type RuleStats = {
  x: string;
  y: string;
  /** Baskets containing both. */
  nXY: number;
  nX: number;
  nY: number;
  N: number;
  support: number;
  /** P(Y|X) — the attach rate. */
  confidence: number;
  confidenceLower: number;
  /** Base rate of Y across all baskets, for comparison. */
  baseRate: number;
  lift: number;
  hyperLift: number;
  leverage: number;
  fisherP: number;
  kulczynski: number;
  imbalanceRatio: number;
};

/**
 * Every interest measure for one directed rule X => Y, in one pass.
 *
 * Three metrics, three different winners on the same data. That is not a defect
 * — they answer different questions, and picking one without knowing which is
 * how a proposer ends up confidently wrong:
 *
 *   lift        surprise. Blows up on rare itemsets that co-occur by chance.
 *   hyperLift   surprise, robust at low counts (Hahsler & Hornik). Divides by
 *               the 0.99-quantile of the hypergeometric rather than by the
 *               independence expectation.
 *   leverage    absolute excess co-occurrence. Converts to units, then rupees.
 *   kulczynski  null-invariant — unmoved by the vast number of baskets holding
 *               neither item.
 *   IR          flags one-directional rules. Without it you cross-sell in the
 *               wrong direction: pitching A to B's buyers when only B=>A holds.
 *
 * DISCOVER WITH HYPER-LIFT, SIZE WITH LEVERAGE x UNIT MARGIN. Not leverage
 * alone: the highest-leverage pair in the fixture is also the one already
 * attached 42% of the time, so there is no headroom left in it.
 */
export function ruleStats(
  x: string,
  y: string,
  basketsWithX: ReadonlySet<string>,
  basketsWithY: ReadonlySet<string>,
  N: number,
  delta = 0.99,
): RuleStats {
  let nXY = 0;
  for (const id of basketsWithX) if (basketsWithY.has(id)) nXY++;
  const nX = basketsWithX.size;
  const nY = basketsWithY.size;
  const support = N ? nXY / N : 0;
  const pX = N ? nX / N : 0;
  const pY = N ? nY / N : 0;
  const cXY = nX ? nXY / nX : 0;
  const cYX = nY ? nXY / nY : 0;
  const denom = cXY + cYX - cXY * cYX;
  return {
    x,
    y,
    nXY,
    nX,
    nY,
    N,
    support,
    confidence: cXY,
    confidenceLower: wilsonLower(nXY, nX),
    baseRate: pY,
    lift: pX * pY > 0 ? support / (pX * pY) : 0,
    hyperLift: nXY / Math.max(1, hypergeomQuantile(delta, N, nY, nX)),
    leverage: support - pX * pY,
    fisherP: fisherUpperTail(nXY, N, nY, nX),
    kulczynski: 0.5 * (cXY + cYX),
    imbalanceRatio: denom > 0 ? Math.abs(cXY - cYX) / denom : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Multiple comparisons
 * ------------------------------------------------------------------ */

export type BHResult<T> = {
  item: T;
  p: number;
  rank: number;
  /** The (i/m)·q line this p-value was compared against. */
  threshold: number;
  rejected: boolean;
};

/**
 * Benjamini–Hochberg step-up procedure.
 *
 * Five detectors x eight products x several windows is dozens to hundreds of
 * implicit hypothesis tests per run. At p < 0.05 you EXPECT false positives —
 * that is what the threshold means. Without this layer the proposer manufactures
 * a finding every week and calls it evidence.
 *
 * BH controls the expected PROPORTION of false positives among rejections.
 * Bonferroni controls the probability of any false positive at all, and destroys
 * power at this scale.
 *
 * The payoff is a statable, checkable claim: at q = 0.10, at most one proposal
 * in ten shown to a merchant is a statistical artefact.
 */
export function benjaminiHochberg<T>(
  items: readonly T[],
  pOf: (t: T) => number,
  q = 0.1,
): BHResult<T>[] {
  const m = items.length;
  const sorted = items
    .map((item) => ({ item, p: pOf(item) }))
    .sort((a, b) => a.p - b.p);

  // Step UP: find the LARGEST i where p(i) <= (i/m)q, then reject everything at
  // or below it. Rejecting only where the inequality holds is the classic
  // implementation error — it silently loses power and is not the published
  // procedure, so the FDR claim above would no longer describe what runs.
  let cutoff = 0;
  for (let i = 0; i < m; i++) {
    if (sorted[i].p <= ((i + 1) / m) * q) cutoff = i + 1;
  }

  return sorted.map((row, i) => ({
    item: row.item,
    p: row.p,
    rank: i + 1,
    threshold: ((i + 1) / m) * q,
    rejected: i < cutoff,
  }));
}

/* ------------------------------------------------------------------ *
 * Change detection
 * ------------------------------------------------------------------ */

export type CusumAlarm = {
  /** Index into the series where the alarm was raised. */
  index: number;
  /** The accumulated statistic at the alarm. */
  statistic: number;
  /**
   * Best estimate of where the shift actually began: the last point at which
   * the statistic was zero. ALWAYS REPORT THIS ALONGSIDE THE ALARM — the two
   * differ by weeks on sparse data, and "detected Aug 7" read as "started
   * Aug 7" is a wrong fact delivered with confidence.
   */
  onsetIndex: number;
};

/**
 * One-sided upward CUSUM.
 *
 *   S_i = max(0, S_{i-1} + x_i - mu0 - k),  alarm when S > h
 *
 * Replaces the hand-picked comparison window. Choosing a window AFTER looking at
 * the data is a forking path: the analytical freedom itself manufactures
 * findings. CUSUM removes the choice, and yields a change POINT rather than a
 * window verdict — "failures stepped up around this date" is actionable in a way
 * that "the last 60 days look bad" is not.
 *
 * CUSUM for abrupt steps of roughly known size; EWMA for gradual drift. A
 * gateway outage is a step, so CUSUM.
 *
 * Measured honestly on the fixture: detected 31 days late on a stream averaging
 * 0.7 events/day. It works, and it needs volume.
 *
 * @param k slack, conventionally half the shift worth caring about
 * @param h decision interval, in the same units
 */
export function cusum(
  series: readonly number[],
  mu0: number,
  k: number,
  h: number,
): CusumAlarm | null {
  let s = 0;
  let lastZero = 0;
  for (let i = 0; i < series.length; i++) {
    s = Math.max(0, s + series[i] - mu0 - k);
    if (s === 0) lastZero = i;
    if (s > h) return { index: i, statistic: s, onsetIndex: lastZero };
  }
  return null;
}

/**
 * CUSUM for rare binary events — the one to use for failure rates.
 *
 * THE NORMAL-THEORY VERSION ABOVE IS WRONG FOR THIS DATA, and the fixture
 * caught it. Standardising a 0/1 outcome at an 11% base rate makes every single
 * failure a 2.9-sigma jump, so two consecutive failures — which happen by
 * chance constantly — clear a decision interval of 4. Run against the seeded
 * payment history it raised a false alarm on two ordinary retries and dated a
 * real outage four weeks too early. An alarm that fires on noise is worse than
 * no alarm: it teaches the merchant to ignore the next one.
 *
 * The correct instrument is the sequential probability ratio test in CUSUM
 * form. Each observation contributes its log-likelihood ratio between the rate
 * we accept and the rate we want to catch:
 *
 *   failure   ln(p1 / p0)
 *   success   ln((1 - p1) / (1 - p0))
 *
 * A failure pushes up, a success pulls down, and both are weighted by how much
 * evidence they actually carry. `h` is then in log-likelihood units — h = 4 is
 * roughly "the elevated rate is e^4 ≈ 55 times more likely than the accepted
 * one", which no short run of bad luck reaches.
 *
 * `onsetIndex` is the last point at which the statistic was zero, which under
 * this formulation is the maximum-likelihood estimate of the change point
 * rather than a heuristic — the accumulated evidence begins exactly there.
 *
 * @param p0 the rate to accept
 * @param p1 the rate worth catching; must exceed p0
 */
export function bernoulliCusum(
  events: readonly boolean[],
  p0: number,
  p1: number,
  h = 4,
): CusumAlarm | null {
  // Guard the logarithms rather than returning NaN into a merchant-facing
  // number. A degenerate rate means there is nothing to test, not an alarm.
  const a = Math.min(Math.max(p0, 1e-6), 1 - 1e-6);
  const b = Math.min(Math.max(p1, 1e-6), 1 - 1e-6);
  if (b <= a) return null;

  const wFail = Math.log(b / a);
  const wOk = Math.log((1 - b) / (1 - a));

  let s = 0;
  let lastZero = 0;
  for (let i = 0; i < events.length; i++) {
    s = Math.max(0, s + (events[i] ? wFail : wOk));
    if (s === 0) lastZero = i;
    if (s > h) return { index: i, statistic: s, onsetIndex: lastZero };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Dispersion
 * ------------------------------------------------------------------ */

export const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Coefficient of variation, with a minimum-periods guard.
 *
 * Returns null rather than a number when there is not enough of a series to
 * describe. The fixture contains the reason: three orders in three months at one
 * unit each reports CV 0.00, which READS AS PERFECT PREDICTABILITY and is really
 * an absence of data. A metric that cannot say "I don't know" will eventually
 * say something false instead.
 */
export function coefficientOfVariation(
  xs: readonly number[],
  minPeriods = 4,
): number | null {
  if (xs.length < minPeriods) return null;
  const m = mean(xs);
  if (m <= 0) return null;
  return stdev(xs) / m;
}
