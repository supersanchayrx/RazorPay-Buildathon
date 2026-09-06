/**
 * The offer proposer, end to end.
 *
 *   detectors → floors → economics → rank → selection
 *
 * Every stage is deterministic. A model, when one is wired, gets three jobs at
 * the very end — choose which of the survivors to lead with, write the case,
 * and adjudicate near-repeats — and is handed candidate IDs and prose to return,
 * never numbers and never an offer object. The published offer is assembled from
 * the stage-3 record regardless of what it says.
 *
 * WHICH MEANS THIS SHIPS AND DEMOS WITH NO API AT ALL. Same logic as
 * `stubReasoner`: when a model does arrive, a bad proposal is unambiguously the
 * model's, because everything upstream was already verified.
 */

import fs from "node:fs";
import { dataPath } from "./paths.server";
import type { CatalogSource } from "./catalog.server";
import {
  runDetectors,
  classify,
  type Candidate,
  type HistoryCart,
  type HistoryOrder,
  type MerchantInputs,
  type Classified,
} from "./detectors.server";
import { screen, kept, stopped, type Screened } from "./floors.server";
import { rank, selectDiverse, type Scored } from "./rank.server";
import { storeScale } from "./economics.server";
import { rejectionCounts } from "./approvals.server";

const WINDOW_MONTHS = 6;

/* ------------------------------------------------------------------ *
 * Loading the merchant's history
 * ------------------------------------------------------------------ */

function readJsonl<T>(file: string): T[] {
  try {
    return fs
      .readFileSync(dataPath(file), "utf8")
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
      fs.readFileSync(dataPath("merchant-inputs.json"), "utf8"),
    ) as MerchantInputs;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

export type ProposalRun = {
  ranAt: string;
  shop: string;
  /** Broken, and costing money now. Not ranked against anything. */
  incidents: Candidate[];
  /** Margin-safe, ranked. */
  actions: Scored[];
  /** The three (or fewer) chosen for this week, after de-duplication. */
  digest: Scored[];
  /** Price experiments that survived the floors. At most one may go live. */
  experiments: Scored[];
  /** What was considered and stopped, with the reason. Never hidden. */
  rejected: Screened[];
  classification: Classified[];
  scale: { monthlyGrossMargin: number; monthlyOrders: number };
  /**
   * Why the run produced nothing, when it produced nothing. A blank page is
   * indistinguishable from a broken feature, and a merchant will assume the
   * latter.
   */
  emptyReason?: string;
};

export async function runProposals(opts: {
  shop: string;
  catalog?: CatalogSource;
  asOf?: Date;
  digestSize?: number;
}): Promise<ProposalRun> {
  const asOf = opts.asOf ?? new Date();
  const inputs = readInputs();
  const orders = readJsonl<HistoryOrder>("orders.jsonl").filter((o) => o.lines?.length);
  const carts = readJsonl<HistoryCart>("carts.jsonl");

  const base: ProposalRun = {
    ranAt: asOf.toISOString(),
    shop: opts.shop,
    incidents: [],
    actions: [],
    digest: [],
    experiments: [],
    rejected: [],
    classification: [],
    scale: { monthlyGrossMargin: 0, monthlyOrders: 0 },
  };

  if (!inputs) {
    return {
      ...base,
      emptyReason:
        "No merchant inputs. Unit costs and your floors are needed before anything can be " +
        "proposed — without a cost we cannot tell a good idea from one that sells at a loss.",
    };
  }
  if (orders.length < 30) {
    return {
      ...base,
      emptyReason: `Only ${orders.length} orders available. Nothing here would clear its own sample floor.`,
    };
  }

  // Stock on hand, from the LIVE catalogue rather than the history — the point
  // of a cover calculation is what is on the shelf now.
  const onHand = new Map<string, number>();
  if (opts.catalog) {
    try {
      for (const p of await opts.catalog.search({ limit: 200 })) {
        for (const v of p.variants) {
          if (v.sku) onHand.set(v.sku, v.inventoryQuantity ?? 0);
        }
      }
    } catch {
      // A catalogue that will not answer costs us the stock-based detectors and
      // nothing else. Everything derived from history still runs.
    }
  }

  const input = { orders, carts, inputs, onHand, asOf };
  const candidates = runDetectors(input);
  const screened = screen(candidates, { inputs });
  const survivors = kept(screened);
  const scale = storeScale(orders, inputs.unitCost, WINDOW_MONTHS);
  const priorRejections = rejectionCounts(opts.shop);

  const incidents = survivors.filter((c) => c.lane === "incident");
  const actions = rank(
    survivors.filter((c) => c.lane === "action"),
    { monthlyGrossMargin: scale.monthlyGrossMargin, priorRejections },
  );
  const experiments = rank(
    survivors.filter((c) => c.lane === "experiment"),
    { monthlyGrossMargin: scale.monthlyGrossMargin, priorRejections },
  );

  return {
    ...base,
    incidents,
    actions,
    digest: selectDiverse(actions, opts.digestSize ?? 3),
    experiments,
    rejected: stopped(screened),
    classification: classify(input),
    scale,
  };
}
