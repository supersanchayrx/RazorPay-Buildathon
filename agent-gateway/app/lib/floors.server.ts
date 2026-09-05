/**
 * Stage 2 — floors, and the multiple-comparisons guard.
 *
 * FLOORS RUN BEFORE THE MODEL, NEVER AFTER.
 *
 * A gate downstream of a model is a model you have to argue with; a gate
 * upstream is one that cannot be talked into something it was never shown. Same
 * structure as `bounds.server.ts`, for the same reason — and it matters more
 * here, because the thing being gated is a merchant's margin rather than a
 * sentence.
 *
 * Three independent layers, and the fixture's planted traps need all three:
 *
 *   evidence   the Wilson lower bound already cripples a thin claim's rank
 *              before anything explicitly rejects it
 *   FDR        Benjamini–Hochberg removes findings that are artefacts of having
 *              run hundreds of implicit tests
 *   floors     the merchant's own hard limits: margin, depth, sample, and a
 *              list of things they will never discount
 *
 * The reason for three is that the traps are not equally easy. T1 — "kettle
 * buyers prefer cash on delivery", on three orders — PASSES Fisher's exact at
 * p = 0.028. A proposer that gated on significance alone would ship it.
 */

import { benjaminiHochberg } from "./stats.server";
import type { Candidate, MerchantInputs } from "./detectors.server";

export type Rejection = {
  gate: "sample_floor" | "margin_floor" | "depth_cap" | "never_discount" | "false_discovery" | "no_effect";
  why: string;
};

export type Screened = {
  candidate: Candidate;
  /** Present when the candidate was stopped. Kept, never deleted. */
  rejected?: Rejection;
};

/**
 * How many observations an incident needs before it is worth mentioning.
 *
 * Low on purpose, and separate from the merchant's own offer floor so that
 * raising one cannot silently suppress the other.
 */
const INCIDENT_SAMPLE_FLOOR = 10;

export type ScreenOptions = {
  inputs: MerchantInputs;
  /** Unit price and cost by SKU, so margin can be checked. */
  economicsBySku?: Map<string, { unitPrice: number; unitCost: number }>;
  /** Target false discovery rate. */
  q?: number;
};

/**
 * Screen every candidate, keeping the rejects.
 *
 * REJECTED CANDIDATES ARE RETURNED, NOT DROPPED. The merchant console shows
 * what was considered and stopped, and why. A proposer that silently discards
 * is indistinguishable from one that never looked, and the rejections are the
 * most persuasive evidence the floors are load-bearing — a merchant who sees
 * "this would have ranked first and it sells at a loss" trusts the rest of the
 * list more, not less.
 */
export function screen(candidates: Candidate[], opts: ScreenOptions): Screened[] {
  const q = opts.q ?? 0.1;
  const floors = opts.inputs.floors;

  // ---- Benjamini–Hochberg, across every candidate carrying a p-value -------
  //
  // Run over the whole batch at once, because that is what "multiple
  // comparisons" means: the correction depends on how many tests were run, and
  // running it per-detector would understate m and let artefacts through.
  const tested = candidates.filter((c) => typeof c.p === "number");
  const bh = benjaminiHochberg(tested, (c) => c.p as number, q);
  const survived = new Map<string, { rejected: boolean; threshold: number }>();
  for (const r of bh) {
    survived.set(r.item.id, { rejected: r.rejected, threshold: r.threshold });
  }

  return candidates.map((candidate): Screened => {
    const reject = (gate: Rejection["gate"], why: string): Screened => ({
      candidate,
      rejected: { gate, why },
    });

    /* ---- the sample floor ------------------------------------------------
     *
     * First, because it is the cheapest and the most common. A pattern seen
     * three times is not a pattern; it is three events.
     *
     * THE BAR IS LOWER FOR INCIDENTS, DELIBERATELY, because the cost of being
     * wrong is not the same in both directions. A false offer proposal costs
     * the merchant margin, so it should have to clear the sample size they set.
     * A false incident costs them ten minutes of checking a dashboard — and a
     * true one that we sat on because only 29 orders had gone through since it
     * started costs them every failed payment in the meantime.
     *
     * Incidents are still not evidence-free: the detector already required the
     * Wilson lower bound of the post-onset rate to clear the store baseline
     * before emitting one, which is a stronger test than a raw count.
     */
    const floorFor =
      candidate.lane === "incident"
        ? Math.min(INCIDENT_SAMPLE_FLOOR, floors.minSampleSize)
        : floors.minSampleSize;

    if (candidate.n < floorFor) {
      return reject(
        "sample_floor",
        `${candidate.n} observations, below the ${floorFor} ` +
          (candidate.lane === "incident" ? "needed to report a change" : "you set") +
          `. At this sample the confidence in the claim is ${candidate.confidence.toFixed(2)}, ` +
          `so the interval covers almost everything and the number means very little.`,
      );
    }

    // ---- false discovery -------------------------------------------------
    const bhResult = survived.get(candidate.id);
    if (bhResult && !bhResult.rejected) {
      return reject(
        "false_discovery",
        `p = ${(candidate.p as number).toExponential(2)}, above the Benjamini–Hochberg ` +
          `threshold of ${bhResult.threshold.toExponential(2)} for this batch. ` +
          `Across ${tested.length} tests run this week, keeping this one would mean more than ` +
          `${(q * 100).toFixed(0)}% of what you are shown could be noise.`,
      );
    }

    // ---- an effect that is not there -------------------------------------
    if (candidate.lane === "action" && candidate.impact <= 0) {
      return reject(
        "no_effect",
        "The conservative estimate of the effect is zero or negative, so there is nothing to act on.",
      );
    }

    // ---- price-experiment floors ----------------------------------------
    if (candidate.kind === "discount") {
      const handle = candidate.products[0];

      if (floors.neverDiscount.includes(handle)) {
        return reject(
          "never_discount",
          `${handle} is on your never-discount list.`,
        );
      }

      const depth = Number(/@(\d+(?:\.\d+)?)%/.exec(candidate.id)?.[1] ?? NaN) / 100;
      if (Number.isFinite(depth) && depth > floors.maxDiscountPct / 100) {
        return reject(
          "depth_cap",
          `${(depth * 100).toFixed(0)}% exceeds the ${floors.maxDiscountPct}% cap you set.`,
        );
      }

      // The margin floor, checked against what the margin becomes AFTER the
      // cut. Checking it before is the version of this test that passes
      // everything, because before the cut every product clears the floor.
      const marginAfterFact = candidate.facts.find((f) => f.label === "margin after the cut");
      const marginAfter = Number(String(marginAfterFact?.value ?? "").replace("%", ""));
      if (Number.isFinite(marginAfter) && marginAfter < floors.minMarginPct) {
        return reject(
          "margin_floor",
          `Margin after the cut would be ${marginAfter.toFixed(0)}%, below the ` +
            `${floors.minMarginPct}% floor you set` +
            (marginAfter < 0 ? " — every unit sold would lose money." : "."),
        );
      }
    }

    return { candidate };
  });
}

export const kept = (rows: Screened[]): Candidate[] =>
  rows.filter((r) => !r.rejected).map((r) => r.candidate);

export const stopped = (rows: Screened[]): Screened[] => rows.filter((r) => r.rejected);
