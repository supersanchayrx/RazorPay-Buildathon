/**
 * The merchant registry.
 *
 * TWO SETS, AND THE SPLIT IS THE INTERESTING PART.
 *
 * `MERCHANT_TOOLS` is what a merchant gets. Every entry answers a question they
 * would ask out loud: what should I promote, is anything broken, what would 15%
 * off actually cost me, what has the assistant been stopped from saying.
 *
 * `DIAGNOSTIC_TOOLS` is the statistical machinery — Wilson intervals, Fisher's
 * exact, association rules. Nobody asks for those in those words, and a model
 * reaching for one is a signal that the deterministic pipeline should have done
 * the work and put the answer on a page. They are kept for debugging a finding
 * and for the bench, and left out of the default set.
 *
 * What both sets share:
 *
 * 1. THE ARITHMETIC STAYS OUT OF THE MODEL. A model asked "what is the attach
 *    rate between chai and assam" answers fluently and wrongly, and you cannot
 *    tell which time. Asked to CALL a tool, it gets 158 of 258 with a Wilson
 *    bound because a real function counted them. The model chooses the
 *    question; the code answers it.
 *
 * 2. EVERY ANSWER CARRIES ITS OWN CAVEAT. A rate comes back with its sample
 *    size and, when the sample is thin, a sentence saying so — in the same
 *    string. A model cannot forget a caveat that is part of the value.
 *
 * 3. THIS IS A DIFFERENT REGISTRY FROM THE SHOPPER'S, and nothing bridges them.
 *    These tools return unit costs, margins, rejected proposals and the
 *    decision ledger. A storefront surface that could reach any of it would be
 *    leaking the merchant's negotiating position to their own customers.
 *
 * Still all reads. There is no `approve_offer` here either: approval is a human
 * clicking a button with an exposure cap in front of them, and an analyst that
 * could approve its own proposal would make the floors layer decorative.
 */

import fs from "node:fs";
import path from "node:path";
import type { ToolSpec } from "./tools.server";
import type { CatalogSource } from "./catalog.server";
import {
  wilsonLower,
  wilsonUpper,
  evidenceRatio,
  ruleStats,
  fisherUpperTail,
  bernoulliCusum,
  coefficientOfVariation,
  mean,
} from "./stats.server";
import { classify, type HistoryOrder, type HistoryCart, type MerchantInputs } from "./detectors.server";
import { markdownEconomics, storeScale } from "./economics.server";
import { runProposals, type ProposalRun } from "./proposals.server";
import { activeOffers, history as decisionHistory } from "./approvals.server";
import { readLedger } from "./ledger.server";
import { runRecovery } from "./recovery.server";
import { answerRate, reasonHistogram } from "./conversations.server";
import { REASON_LABEL } from "./reasons";
import { allGrants, monthlySpend } from "./grants.server";
import { readSettings } from "./settings.server";
import { findSite } from "./sites.server";

export type MerchantToolContext = {
  shop: string;
  shopName: string;
  catalog: CatalogSource;
  /** Computed once per session and reused, because the pipeline is not cheap. */
  cache: { run?: ProposalRun };
};

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/* ------------------------------------------------------------------ *
 * Loading, once
 * ------------------------------------------------------------------ */

let cached: { at: number; orders: HistoryOrder[]; carts: HistoryCart[]; inputs: MerchantInputs | null } | null = null;

function history() {
  if (cached && Date.now() - cached.at < 60_000) return cached;
  const read = <T,>(f: string): T[] => {
    try {
      return fs
        .readFileSync(path.join(process.cwd(), "data", f), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as T);
    } catch {
      return [];
    }
  };
  let inputs: MerchantInputs | null = null;
  try {
    inputs = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "merchant-inputs.json"), "utf8"));
  } catch {
    inputs = null;
  }
  cached = { at: Date.now(), orders: read<HistoryOrder>("orders.jsonl"), carts: read<HistoryCart>("carts.jsonl"), inputs };
  return cached;
}

const placed = () => history().orders.filter((o) => o.status === "placed");

async function onHandBySku(catalog: CatalogSource): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  try {
    for (const p of await catalog.search({ limit: 200 })) {
      for (const v of p.variants) if (v.sku) m.set(v.sku, v.inventoryQuantity ?? 0);
    }
  } catch {
    // Stock-dependent tools will say so rather than reporting zero, which would
    // read as "everything is out of stock".
  }
  return m;
}

const detectorInput = async (ctx: MerchantToolContext) => {
  const h = history();
  return {
    orders: h.orders,
    carts: h.carts,
    inputs: h.inputs!,
    onHand: await onHandBySku(ctx.catalog),
    asOf: new Date(),
  };
};

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

/**
 * Statistical primitives — NOT shipped to a merchant by default.
 *
 * A tool earns a place in the product if a merchant would ask for it in those
 * words. Nobody says "give me the Wilson lower bound of 12 out of 29"; they say
 * "is that real?". These exist so a MODEL can do arithmetic — and a model
 * reaching for them is a signal that the deterministic pipeline should have
 * done that work already and put the answer on a page.
 *
 * `association_rules` is the clearest case. The proposer runs it over every
 * pair on every run, ranks the output and renders it on the offers page.
 * Offering it as a chat tool re-asks a question that was already answered
 * better, and costs prompt tokens and a wrong-tool-choice risk to do it.
 *
 * They stay in the codebase because they are genuinely useful for debugging a
 * finding and for the test bench, and because deleting a correct
 * implementation to make a registry shorter is a bad trade. They are simply
 * not in the default set.
 */
export const DIAGNOSTIC_TOOLS: ToolSpec<MerchantToolContext>[] = [
  {
    name: "rate_with_confidence",
    description:
      "Turn a count into a rate you can defend. Give it k successes out of n and it returns the Wilson score interval, not a bare percentage. ALWAYS use this instead of dividing two numbers yourself: 2 out of 3 is not '67%', it is 'three orders', and this is the tool that says so.",
    parameters: obj(
      {
        k: { type: "integer", description: "How many times it happened." },
        n: { type: "integer", description: "Out of how many." },
        label: { type: "string", description: "What is being measured, for the answer text." },
      },
      ["k", "n"],
    ),
    async run(_ctx, a) {
      const k = Number(a.k);
      const n = Number(a.n);
      if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0 || k < 0 || k > n) {
        return "Needs 0 <= k <= n and n > 0.";
      }
      const lo = wilsonLower(k, n);
      const hi = wilsonUpper(k, n);
      const conf = evidenceRatio(k, n);
      const thin = n < 30;
      return (
        `${a.label ?? "rate"}: ${k} of ${n}. Point estimate ${pct(k / n)}, ` +
        `95% interval ${pct(lo)} to ${pct(hi)}. Confidence ${conf.toFixed(2)}.` +
        (thin
          ? ` ONLY ${n} OBSERVATIONS — the interval covers most of the range, so state the lower bound and the sample size, never the point estimate on its own.`
          : "")
      );
    },
  },
  {
    name: "association_rules",
    description:
      "How strongly two products are bought together, with every interest measure at once: attach rate and its lower bound, lift, hyper-lift, leverage and Fisher's exact p. Use hyper-lift to judge whether a pairing is surprising and leverage to judge whether it is worth money — plain lift blows up on rare pairs that co-occurred by chance.",
    parameters: obj(
      {
        product: { type: "string", description: "Handle of the product bought first. Omit to get the top pairs." },
        top: { type: "integer", description: "How many pairs to return when no product is named. Default 5." },
      },
      [],
    ),
    async run(_ctx, a) {
      const orders = placed();
      const N = orders.length;
      if (N < 30) return `Only ${N} orders. Not enough for association rules.`;

      const baskets = new Map<string, Set<string>>();
      const titles = new Map<string, string>();
      for (const o of orders) {
        for (const l of o.lines) {
          if (!baskets.has(l.handle)) baskets.set(l.handle, new Set());
          baskets.get(l.handle)!.add(o.id);
          titles.set(l.handle, l.title);
        }
      }
      const handles = [...baskets.keys()];
      const want = a.product ? String(a.product) : null;
      if (want && !baskets.has(want)) return `No product with handle "${want}". Known: ${handles.join(", ")}.`;

      const rules = [];
      for (const x of want ? [want] : handles) {
        for (const y of handles) {
          if (x === y) continue;
          rules.push(ruleStats(x, y, baskets.get(x)!, baskets.get(y)!, N));
        }
      }
      const top = rules.sort((p, q) => q.hyperLift - p.hyperLift).slice(0, Math.min(Number(a.top) || 5, 10));
      return top
        .map(
          (r) =>
            `${titles.get(r.x)} => ${titles.get(r.y)}: ${r.nXY} of ${r.nX} baskets ` +
            `(attach ${pct(r.confidence)}, lower bound ${pct(r.confidenceLower)}, base rate ${pct(r.baseRate)}), ` +
            `hyper-lift ${r.hyperLift.toFixed(2)}, lift ${r.lift.toFixed(2)}, leverage ${pct(r.leverage)}, ` +
            `Fisher p ${r.fisherP.toExponential(2)}, imbalance ${r.imbalanceRatio.toFixed(2)}`,
        )
        .join("\n");
    },
  },
  {
    name: "significance",
    description:
      "Fisher's exact test, one-sided. Use for any 'is this pattern real' question at small counts, where chi-squared stops being trustworthy. Remember that a single p-value is not enough on its own — running many tests produces small p-values by chance, which is what the proposer's false-discovery guard exists to correct.",
    parameters: obj(
      {
        k: { type: "integer", description: "Observed count in the group." },
        group_size: { type: "integer", description: "Size of the group." },
        population_hits: { type: "integer", description: "Total hits across the whole population." },
        population_size: { type: "integer", description: "Size of the whole population." },
      },
      ["k", "group_size", "population_hits", "population_size"],
    ),
    async run(_ctx, a) {
      const k = Number(a.k);
      const n = Number(a.group_size);
      const K = Number(a.population_hits);
      const N = Number(a.population_size);
      if (![k, n, K, N].every(Number.isFinite) || N <= 0 || n > N || K > N) return "Check the four counts.";
      const p = fisherUpperTail(k, N, K, n);
      return (
        `p = ${p.toExponential(3)} (one-sided). Group rate ${pct(k / n)} on ${n}, population rate ${pct(K / N)}.` +
        (n < 30
          ? ` The group has only ${n} members — a small p-value here is exactly the shape a false positive takes, so do not treat this as settled.`
          : "")
      );
    },
  },

];

/**
 * What a merchant actually gets.
 *
 * Every one of these answers a question a merchant would ask out loud. The
 * statistics are still underneath — `list_proposals` runs the whole pipeline,
 * Wilson bounds and false-discovery guard included — but the merchant asks for
 * the conclusion, not the estimator.
 */
export const MERCHANT_TOOLS: ToolSpec<MerchantToolContext>[] = [
  {
    name: "list_proposals",
    description:
      "START HERE for any question about what the merchant should do, what is worth money, or what needs attention. Runs the whole pipeline and returns three things: what is broken right now, margin-safe ideas ranked by rupees a month, and price experiments. It also returns what was STOPPED and why, which matters as much as what was kept — it is the evidence the floors are doing work.",
    parameters: obj({}),
    async run(ctx) {
      ctx.cache.run ??= await runProposals({ shop: ctx.shop, catalog: ctx.catalog });
      const r = ctx.cache.run;
      if (r.emptyReason) return r.emptyReason;
      const line = (c: { title: string; kind: string; n: number; confidence: number }) =>
        `  [${c.kind}] ${c.title} (n=${c.n}, confidence ${c.confidence.toFixed(2)})`;
      return [
        `NEEDS ATTENTION (${r.incidents.length}):`,
        ...r.incidents.map(line),
        `\nRANKED IDEAS, none costing margin (${r.actions.length}):`,
        ...r.actions.map((c) => `  ${c.priority.toFixed(0).padStart(6)} ${c.title} — ${inr(c.monthlyValue)}/mo` ),
        `\nPRICE EXPERIMENTS, these give up margin (${r.experiments.length}):`,
        ...r.experiments.map(line),
        `\nSTOPPED (${r.rejected.length}):`,
        ...r.rejected.map((x) => `  [${x.rejected!.gate}] ${x.candidate.title} — ${x.rejected!.why}`),
      ].join("\n");
    },
  },
  {
    name: "cross_sell_opportunities",
    description:
      "Which products are worth showing together, ranked by rupees of margin a month. Answers 'what should I cross-sell' directly: each row names the pair, how many baskets held both, the attach rate against the base rate, and what the untapped excess is worth monthly. Rows below the merchant's sample floor are shown but marked, and sorted last: they are not actionable yet. Prefer this over reasoning about pairings yourself — the obvious pair is usually the smallest prize, because it is already attached most of the time.",
    parameters: obj({ top: { type: "integer", description: "How many pairs. Default 5." } }, []),
    async run(ctx, a) {
      const h = history();
      if (!h.inputs) return "No merchant inputs file, so margins are unknown and pairings cannot be valued.";
      const orders = placed();
      const N = orders.length;
      if (N < 30) return `Only ${N} orders. Not enough to measure pairings.`;

      const baskets = new Map<string, Set<string>>();
      const titles = new Map<string, string>();
      const marginOf = new Map<string, number>();
      for (const o of orders) {
        for (const l of o.lines) {
          if (!baskets.has(l.handle)) baskets.set(l.handle, new Set());
          baskets.get(l.handle)!.add(o.id);
          titles.set(l.handle, l.title);
          const cost = l.unitCost ?? h.inputs.unitCost[l.sku];
          if (cost != null) marginOf.set(l.handle, l.unitPrice - cost);
        }
      }

      const handles = [...baskets.keys()];
      const rows: Array<{ text: string; value: number }> = [];
      for (const x of handles) {
        for (const y of handles) {
          if (x === y) continue;
          const r = ruleStats(x, y, baskets.get(x)!, baskets.get(y)!, N);
          const margin = marginOf.get(y) ?? 0;
          if (margin <= 0) continue;
          // Only the excess over the base rate is attributable to the pairing,
          // and only the conservative end of it. The rest would have happened
          // anyway and counting it inflates every estimate.
          const excess = Math.max(0, r.confidenceLower - r.baseRate);
          if (excess <= 0) continue;
          const monthly = (r.nX / 6) * excess * margin;

          /**
           * THE MERCHANT'S OWN SAMPLE FLOOR APPLIES HERE TOO.
           *
           * Without this the tool and the proposer disagree in public: on the
           * seeded data the highest-value pairing by raw arithmetic is one the
           * proposer STOPS at the sample floor, so an analyst answering "which
           * pairing is worth most?" would recommend the very thing the offers
           * page refuses to offer. A merchant who notices that stops trusting
           * both surfaces, and they would be right to.
           *
           * Flagged rather than hidden. They asked, and a silently shortened
           * list is indistinguishable from there being nothing there — but the
           * row now carries the reason it will not be proposed.
           */
          const thin = r.nXY < h.inputs.floors.minSampleSize;
          rows.push({
            value: thin ? monthly / 1000 : monthly,
            text:
              `${titles.get(x)} => ${titles.get(y)}: ${inr(monthly)}/month. ` +
              `${r.nXY} of ${r.nX} baskets already hold both (attach ${pct(r.confidence)}, ` +
              `lower bound ${pct(r.confidenceLower)}, base rate ${pct(r.baseRate)}); ` +
              `${inr(margin)} margin per unit; hyper-lift ${r.hyperLift.toFixed(2)}; ` +
              `Fisher p ${r.fisherP.toExponential(2)}.` +
              (thin
                ? ` BELOW YOUR SAMPLE FLOOR — only ${r.nXY} baskets against the ${h.inputs.floors.minSampleSize} you set, so the proposer will not offer this and neither should you yet.`
                : ` Costs no margin — it is placement.`),
          });
        }
      }
      if (rows.length === 0) return "No pairing clears its own base rate. There is nothing here worth acting on.";
      return rows
        .sort((m, n) => n.value - m.value)
        .slice(0, Math.min(Number(a.top) || 5, 10))
        .map((r) => r.text)
        .join("\n");
    },
  },
  {
    name: "explain_proposal",
    description:
      "Every number behind one proposal, as label/value pairs. Use this before writing about a proposal: any figure you state must appear here, or it is something you made up and it will be rejected.",
    parameters: obj({ id: { type: "string", description: "Proposal id from list_proposals." } }, ["id"]),
    async run(ctx, a) {
      ctx.cache.run ??= await runProposals({ shop: ctx.shop, catalog: ctx.catalog });
      const r = ctx.cache.run;
      const all = [...r.incidents, ...r.actions, ...r.experiments, ...r.rejected.map((x) => x.candidate)];
      const c = all.find((x) => x.id === String(a.id)) ?? all.find((x) => x.id.includes(String(a.id)));
      if (!c) return `No proposal with id "${a.id}". Call list_proposals first.`;
      return (
        `${c.title}\nlane: ${c.lane}, kind: ${c.kind}, effort ${c.effort}, exposure ${inr(c.exposure)}\n` +
        `reach ${c.reach.toFixed(1)}/mo, impact ${inr(c.impact)}/order, confidence ${c.confidence.toFixed(2)}, n=${c.n}\n` +
        `FACTS (every number you may state):\n` +
        c.facts.map((f) => `  ${f.label}: ${f.value}`).join("\n") +
        `\nTEMPLATED RATIONALE:\n  ${c.rationale}`
      );
    },
  },

  {
    name: "classify_catalogue",
    description:
      "ABC by share of revenue and XYZ by how steady monthly demand is, plus months of stock cover. Use this before suggesting anything about a product: A means it earns its place whatever its unit velocity, and an 'X' or 'Y' is only meaningful when there are enough months to measure — too few and it returns '?' rather than a misleading letter.",
    parameters: obj({}),
    async run(ctx) {
      if (!history().inputs) return "No merchant inputs file, so unit costs are unknown.";
      const rows = classify(await detectorInput(ctx));
      return rows
        .map(
          (r) =>
            `${r.abc}${r.xyz} ${r.title}: ${pct(r.revenueShare)} of revenue, ${r.unitsPerMonth.toFixed(1)} units/mo, ` +
            `CV ${r.cv === null ? "unmeasurable (too few months)" : r.cv.toFixed(2)}, ` +
            `${r.onHand === null ? "stock unknown" : `${r.onHand} on hand`}` +
            `${r.monthsOfCover === null ? "" : `, ${r.monthsOfCover.toFixed(1)} months cover`}`,
        )
        .join("\n");
    },
  },
  {
    name: "break_even",
    description:
      "What a discount costs and how much extra volume it would need just to pay for itself. Returns margin before and after, rupees given up per unit, break-even lift, worst-case exposure and carrying cost. It does NOT predict whether the cut will work — this shop has never changed a price, so there is no data to estimate that from, and any forecast would be invented.",
    parameters: obj(
      {
        handle: { type: "string", description: "Product handle." },
        depth_percent: { type: "number", description: "Discount depth, e.g. 10 for ten percent." },
      },
      ["handle", "depth_percent"],
    ),
    async run(ctx, a) {
      const h = history();
      if (!h.inputs) return "No merchant inputs file, so unit cost is unknown and no break-even can be computed.";
      const rows = classify(await detectorInput(ctx));
      const row = rows.find((r) => r.handle === String(a.handle));
      if (!row) return `No product with handle "${a.handle}".`;
      const cost = h.inputs.unitCost[row.sku];
      if (cost == null) return `No unit cost recorded for ${row.sku}.`;

      const unitPrice = row.unitsPerMonth > 0 ? row.revenue / (row.unitsPerMonth * 6) : 0;
      const depth = Number(a.depth_percent) / 100;
      if (!(depth > 0 && depth < 1)) return "depth_percent must be between 0 and 100.";

      const e = markdownEconomics({
        sku: row.sku,
        handle: row.handle,
        unitPrice,
        unitCost: cost,
        depth,
        unitsPerMonth: row.unitsPerMonth,
        onHand: row.onHand ?? 0,
      });
      return (
        `${row.title} at ${(depth * 100).toFixed(0)}% off:\n` +
        `  margin ${pct(e.marginNowPct)} -> ${pct(e.marginAfterPct)}\n` +
        `  given up ${inr(e.givenUpPerUnit)} per unit\n` +
        `  break-even lift ${Number.isFinite(e.breakEvenLift) ? pct(e.breakEvenLift) : "UNREACHABLE — the cut erases the margin, so extra volume makes it worse"}` +
        `${Number.isFinite(e.extraUnitsPerMonth) ? ` (${e.extraUnitsPerMonth.toFixed(1)} extra units a month)` : ""}\n` +
        `  worst-case exposure ${inr(e.maxExposure)}, carrying cost ${inr(e.carryingCost)}` +
        `${e.carryingCostImmaterial ? " — carrying cost is small against the exposure, so 'clear it early to save holding costs' does NOT apply here" : ""}\n` +
        `  floors: minimum margin ${h.inputs.floors.minMarginPct}%, maximum depth ${h.inputs.floors.maxDiscountPct}%` +
        `${h.inputs.floors.neverDiscount.includes(row.handle) ? ", AND THIS PRODUCT IS ON THE NEVER-DISCOUNT LIST" : ""}`
      );
    },
  },
  {
    name: "detect_change",
    description:
      "Whether a payment method's failure rate has stepped up, using a sequential likelihood-ratio test. Returns the estimated onset as a WINDOW, not a date, and its own detection lag — at low volume a change takes weeks to confirm, and reading the detection date as the start date sends someone looking for a deploy on the wrong day.",
    parameters: obj(
      { method: { type: "string", description: "e.g. 'netbanking/HDFC' or 'upi'. Omit to scan every method." } },
      [],
    ),
    async run(_ctx, a) {
      const rows = history().orders.filter((o) => o.payment?.method).sort((x, y) => x.ts.localeCompare(y.ts));
      if (rows.length < 60) return `Only ${rows.length} orders with payment data. Not enough to detect a change.`;
      const failed = (o: HistoryOrder) =>
        o.payment.status === "failed" || (o.payment.attempts ?? []).some((t) => t.status === "failed");
      const baseline = rows.filter(failed).length / rows.length;

      const groups = new Map<string, HistoryOrder[]>();
      for (const o of rows) {
        const key = `${o.payment.method}${o.payment.bank ? `/${o.payment.bank}` : ""}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(o);
      }

      const want = a.method ? String(a.method) : null;
      const out: string[] = [`store-wide failure rate ${pct(baseline)} over ${rows.length} payments`];
      for (const [key, g] of groups) {
        if (want && key !== want) continue;
        if (g.length < 10) {
          out.push(`${key}: only ${g.length} payments, too few to test`);
          continue;
        }
        const p1 = Math.min(0.95, Math.max(baseline * 2, baseline + 0.1));
        const alarm = bernoulliCusum(g.map(failed), baseline, p1, 4);
        if (!alarm) {
          out.push(`${key}: ${g.filter(failed).length} of ${g.length} failed, no step change detected`);
          continue;
        }
        const since = g.slice(alarm.onsetIndex);
        const k = since.filter(failed).length;
        const firstFail = (since.find(failed) ?? since[0]).ts.slice(0, 10);
        out.push(
          `${key}: CHANGE DETECTED. ${k} of ${since.length} failing since the shift ` +
            `(lower bound ${pct(wilsonLower(k, since.length))} vs ${pct(baseline)} baseline). ` +
            `It began between ${g[alarm.onsetIndex].ts.slice(0, 10)} and ${firstFail}; ` +
            `confirmed only on ${g[alarm.index].ts.slice(0, 10)}.`,
        );
      }
      return out.join("\n");
    },
  },
  {
    name: "repeat_purchase_rhythm",
    description:
      "Whether customers reorder a product on a regular cycle, measured PER CUSTOMER and then pooled. Pooling every gap together first measures the spread between different people rather than whether anyone has a rhythm, and makes a regular cohort look like noise.",
    parameters: obj({ handle: { type: "string" } }, ["handle"]),
    async run(_ctx, a) {
      const handle = String(a.handle);
      const byCustomer = new Map<string, string[]>();
      for (const o of placed()) {
        if (!o.lines.some((l) => l.handle === handle)) continue;
        if (!byCustomer.has(o.customer.id)) byCustomer.set(o.customer.id, []);
        byCustomer.get(o.customer.id)!.push(o.ts);
      }
      const cvs: number[] = [];
      const gaps: number[] = [];
      let regular = 0;
      for (const stamps of byCustomer.values()) {
        if (stamps.length < 4) continue;
        const s = [...stamps].sort();
        const g: number[] = [];
        for (let i = 1; i < s.length; i++) g.push((Date.parse(s[i]) - Date.parse(s[i - 1])) / 86_400_000);
        const cv = coefficientOfVariation(g, 3);
        if (cv === null) continue;
        cvs.push(cv);
        gaps.push(...g);
        if (cv <= 0.5) regular++;
      }
      if (cvs.length === 0) return `Not enough repeat buyers of ${handle} to measure a rhythm.`;
      return (
        `${handle}: ${byCustomer.size} buyers, ${cvs.length} with enough repeats to measure, ` +
        `${regular} of those on a regular cycle (CV <= 0.5). ` +
        `Mean gap ${mean(gaps).toFixed(0)} days, typical CV ${mean(cvs).toFixed(2)}. ` +
        `NOTE: a cohort this predictable reorders anyway — a reminder is free, a discount to them is margin given to people already committed.`
      );
    },
  },
  {
    name: "store_scale",
    description:
      "Orders a month and monthly gross margin. Needed to judge whether an exposure is trivial or existential — the same rupee cap means completely different things at different scales, which is why risk is always expressed relative to this.",
    parameters: obj({}),
    async run() {
      const h = history();
      if (!h.inputs) return "No merchant inputs file, so gross margin cannot be computed.";
      const s = storeScale(h.orders, h.inputs.unitCost, 6);
      return `${s.monthlyOrders.toFixed(0)} orders a month, ${inr(s.monthlyGrossMargin)} monthly gross margin, over ${h.orders.length} orders in 6 months.`;
    },
  },
  /* ---------------- what has been decided and said ---------------- */
  {
    name: "list_live_offers",
    description: "Offers this merchant has approved that are still running, with their end date and unit cap.",
    parameters: obj({}),
    async run(ctx) {
      const live = activeOffers(ctx.shop);
      return live.length
        ? live
            .map(
              (o) =>
                `${(o.depth * 100).toFixed(0)}% off ${o.title} until ${o.endsAt}, capped at ${o.maxUnits} units, approved by ${o.approvedBy}`,
            )
            .join("\n")
        : "No offers are live.";
    },
  },
  {
    name: "recovery_queue",
    description:
      "Abandoned baskets that are worth writing to right now, and — the more useful half — the ones that are not, with the reason each was left alone. Answers 'who should we chase about their cart', 'why aren't we messaging more people', and 'what is that costing us'.",
    parameters: obj({ show: { type: "string", enum: ["send", "skip", "both"] } }, []),
    async run(ctx, a) {
      const site = findSite(ctx.shop);
      const run = runRecovery({
        shop: ctx.shop,
        shopName: ctx.shopName,
        storefrontOrigin: site?.origins[0],
        productUrlTemplate: site?.productUrlTemplate,
        gatewayOrigin: process.env.GATEWAY_ORIGIN,
        siteSecret: site?.secret,
      });
      if (run.emptyReason && !run.targets.length && !run.suppressed.length) return run.emptyReason;

      const show = String(a.show ?? "both");
      const out: string[] = [];

      if (show !== "skip") {
        out.push(
          run.targets.length
            ? `WOULD WRITE TO ${run.targets.length} people, ${inr(run.totals.marginAtStake)} of margin at stake, ` +
                `about ${inr(run.totals.expectedValue)} of it recoverable at an ASSUMED ${pct(run.totals.assumedRecovery)} ` +
                `— assumed, because this outreach has never run here and there is no rate to cite:\n` +
                run.targets
                  .map(
                    (t) =>
                      `  ${t.treatment.padEnd(9)} ${inr(t.marginAtStake).padStart(7)}  ${t.items
                        .map((i) => i.title)
                        .join(" + ")}  (${Math.round(t.ageHours / 24)}d old, stopped at ${t.lastStep})`,
                  )
                  .join("\n")
            : "NOTHING would be written today.",
        );
      }

      if (show !== "send") {
        /**
         * The suppressed side is where a merchant's actual question lives. "Why
         * are we only messaging twelve people" is answered by this table and by
         * nothing else, and a tool that returned only the queue would send them
         * to a settings page to guess.
         */
        out.push(
          `LEFT ALONE — ${run.suppressed.length} baskets, ${inr(
            run.suppressedBy.reduce((s2, x) => s2 + x.margin, 0),
          )} of margin not chased:\n` +
            run.suppressedBy
              .map((x) => `  ${String(x.count).padStart(4)}  ${x.label}  (${inr(x.margin)})`)
              .join("\n"),
        );
      }

      if (!run.settings.outreach.enabled)
        out.push("Outreach is switched OFF, so this is a dry run: everything above is drafted and nothing is delivered.");

      return out.join("\n\n");
    },
  },
  {
    name: "why_they_did_not_buy",
    description:
      "What shoppers said when asked why they abandoned a basket, counted by reason. The only thing in this shop's data that answers WHY rather than WHAT — nothing else can, because the reason never touched the server. Use it for 'why are people not buying', 'what is putting people off', 'is it the price or the delivery'.",
    parameters: obj({ since_days: { type: "integer" } }, []),
    async run(ctx, a) {
      const days = Number(a.since_days) || 0;
      const h = reasonHistogram(ctx.shop, days > 0 ? { sinceDays: days } : {});
      const rate = answerRate(ctx.shop);

      if (h.total === 0) {
        return (
          `Nobody has answered yet. ${rate.asked} basket${rate.asked === 1 ? " has" : "s have"} been asked about. ` +
          `This is the one number in the shop that cannot be derived from order data, so it is worth waiting for.`
        );
      }
      if (!h.enough) {
        /**
         * A histogram over four answers is a histogram that will be read as a
         * finding, and four people are not a finding. Same reasoning as the
         * proposer's sample floor, and it matters more here because the
         * temptation to act on the first three replies is enormous.
         */
        return (
          `Only ${h.total} answers so far — too few to read as a pattern, so here they are as raw counts and nothing more:\n` +
          h.counts.map((c) => `  ${String(c.count).padStart(3)}  ${REASON_LABEL[c.reason]}`).join("\n") +
          `\nBELOW THE SAMPLE FLOOR. Do not change anything on the strength of this yet.`
        );
      }
      return (
        `${h.total} shoppers answered, out of ${rate.asked} asked (${pct(rate.rate)} replied):\n` +
        h.counts
          .map((c) => `  ${pct(c.share).padStart(6)}  ${String(c.count).padStart(3)}  ${REASON_LABEL[c.reason]}`)
          .join("\n")
      );
    },
  },
  {
    name: "recovery_grants",
    description:
      "Discounts the recovery agent has issued under the merchant's own policy: who, why, how deep, what it cost in margin, and how much of the monthly budget is left. Use it for 'what discounts have gone out', 'what is this costing me', 'how much budget is left'.",
    parameters: obj({}),
    async run(ctx) {
      const settings = readSettings(ctx.shop);
      const grants = allGrants(ctx.shop);
      const spent = monthlySpend(ctx.shop);
      if (!settings.recovery.enabled)
        return "Recovery discounts are switched OFF, so none can be issued. Nothing has gone out.";
      if (!grants.length)
        return `Recovery discounts are on — up to ${settings.recovery.maxDepthPct}% for ${settings.recovery.requiresTier} shoppers — and none has been issued yet.`;
      return (
        `${spent.count} of ${settings.recovery.monthlyGrantCap} grants used this month, ` +
        `${inr(spent.margin)} of ${inr(settings.recovery.monthlyMarginCap)} margin budget:\n` +
        grants
          .slice(-15)
          .reverse()
          .map(
            (g) =>
              `  ${g.state.padEnd(9)} ${String(Math.round(g.depth * 100)).padStart(3)}% off ${g.title} ` +
              `(${g.tier}, said ${g.reason}, costs ${inr(g.marginCost)})`,
          )
          .join("\n")
      );
    },
  },
  {
    name: "list_decisions",
    description:
      "What this merchant has approved, rejected and revoked. A proposal rejected twice already is one to stop raising — that is what the ranking's decay term is for.",
    parameters: obj({ limit: { type: "integer" } }, []),
    async run(ctx, a) {
      const rows = decisionHistory(ctx.shop, Math.min(Number(a.limit) || 20, 50));
      return rows.length
        ? rows.map((d) => `${d.ts.slice(0, 16).replace("T", " ")} ${d.action} ${d.candidateId}${d.note ? ` — "${d.note}"` : ""}`).join("\n")
        : "No decisions recorded yet.";
    },
  },
  {
    name: "read_ledger",
    description:
      "Recent entries from the decision ledger: replies, refusals and which gate fired on each. Use it to answer what the assistant has been saying and what it has been stopped from saying.",
    parameters: obj({ limit: { type: "integer" }, gates_only: { type: "boolean" } }, []),
    async run(ctx, a) {
      const rows = readLedger(200)
        .filter((e) => e.shop === ctx.shop || e.shop === "-")
        .filter((e) => (a.gates_only === true ? Boolean(e.gate) : true))
        .slice(-Math.min(Number(a.limit) || 20, 50));
      return rows.length
        ? rows.map((e) => `${e.ts.slice(0, 16).replace("T", " ")} ${e.kind}${e.gate ? ` [${e.gate}]` : ""} ${e.message}`).join("\n")
        : "Nothing in the ledger yet.";
    },
  },
];

/**
 * Everything, for the bench and for local debugging.
 *
 * Never handed to the analyst by default: a longer registry is more prompt
 * tokens and more chances to pick the wrong tool, paid on every question, to
 * serve the rare case where a primitive is genuinely what someone wanted.
 */
export const ALL_MERCHANT_TOOLS = [...MERCHANT_TOOLS, ...DIAGNOSTIC_TOOLS];
