/**
 * Stage 4 — ranking and selection.
 *
 * Base is RICE — Reach × Impact × Confidence / Effort — with three changes,
 * each of which was earned rather than chosen:
 *
 *   Priority = (Reach × Impact × Confidence) / (Effort × Risk) × Decay
 *
 * CONFIDENCE IS DERIVED, NOT GUESSED. RICE's weakest link is a human picking
 * 50 / 80 / 100%, which in practice means picking the number that produces the
 * answer they already wanted. Here the data picks it: the Wilson lower bound
 * over the point estimate, 0.31 at n=3 and 0.88 at n=158.
 *
 * RISK IS NEW. RICE has no downside term at all. A ₹7,560 cap is trivial for
 * one merchant and existential for another, so exposure is expressed relative
 * to the store's own monthly gross margin rather than as an absolute.
 *
 * DECAY IS THE REJECTION LEDGER EARNING ITS KEEP. Halving the score for each
 * time a similar proposal was already turned down is what stops the system
 * re-pitching a rejected idea in new words every week, which is how these
 * things become noise and then get switched off.
 *
 * ONLY LANE A IS RANKED. Incidents are not scored against anything — a payment
 * outage does not compete with a cross-sell — and price experiments go through
 * a separate gate because they score negative by construction.
 */

import type { Candidate } from "./detectors.server";

export type Scored = Candidate & {
  risk: number;
  decay: number;
  monthlyValue: number;
  priority: number;
};

export type RankOptions = {
  /** From `storeScale`. Makes exposure relative to the shop's own size. */
  monthlyGrossMargin: number;
  /** How many similar proposals this merchant has already rejected, by id. */
  priorRejections?: Map<string, number>;
};

export function score(c: Candidate, opts: RankOptions): Scored {
  const risk = 1 + (c.exposure ?? 0) / Math.max(1, opts.monthlyGrossMargin);
  const decay = 0.5 ** (opts.priorRejections?.get(c.id) ?? 0);
  const monthlyValue = c.reach * c.impact;
  return {
    ...c,
    risk,
    decay,
    monthlyValue,
    priority: ((c.reach * c.impact * c.confidence) / (c.effort * risk)) * decay,
  };
}

export const rank = (cs: Candidate[], opts: RankOptions): Scored[] =>
  cs.map((c) => score(c, opts)).sort((a, b) => b.priority - a.priority);

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

/**
 * How alike two proposals are, for de-duplication.
 *
 * Three axes, because three different kinds of repetition annoy a merchant:
 * the same product twice, the same lever twice, the same audience twice.
 */
export function similarity(a: Candidate, b: Candidate): number {
  const shareProduct = a.products.some((p) => b.products.includes(p));
  const shareMechanism = a.mechanism === b.mechanism;
  const shareSegment = Boolean(a.segment) && a.segment === b.segment;
  return (
    (shareProduct ? 0.5 : 0) + (shareMechanism ? 0.3 : 0) + (shareSegment ? 0.2 : 0)
  );
}

/**
 * Maximal Marginal Relevance (Carbonell & Goldstein).
 *
 *   argmax [ λ·score(c) − (1−λ)·max_{s∈S} sim(c, s) ]
 *
 * Taking the top three by score can hand a merchant three proposals about the
 * same product, which reads as a system that has found one thing and is saying
 * it three ways. MMR trades a little score for coverage, and it is the standard
 * re-ranking layer for exactly this problem.
 *
 * λ = 0.7: relevance-leaning, because a merchant would rather see the two best
 * ideas plus a different one than three mediocre ideas about different things.
 */
export function selectDiverse(scored: Scored[], count: number, lambda = 0.7): Scored[] {
  if (scored.length <= count) return [...scored];

  // Normalised so the two terms are on the same scale. Without this, λ is
  // meaningless: a priority of 500 against a similarity of 0.8 means the
  // diversity term never affects the outcome and MMR silently becomes top-N.
  const top = Math.max(...scored.map((s) => s.priority), 1);
  const chosen: Scored[] = [];
  const pool = [...scored];

  while (chosen.length < count && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const maxSim = chosen.length
        ? Math.max(...chosen.map((s) => similarity(c, s)))
        : 0;
      const value = lambda * (c.priority / top) - (1 - lambda) * maxSim;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    chosen.push(pool.splice(bestIndex, 1)[0]);
  }
  return chosen;
}
