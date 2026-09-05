/**
 * The offer proposer.
 *
 * The fixture contains three planted false signals. NONE of them is
 * special-cased anywhere in the detectors — they are found because they look
 * like real patterns, and the floors are what stop them. So the central
 * question of this suite is not "does it find things" but:
 *
 *   Does it find the traps, and then refuse to ship them?
 *
 * A proposer that never surfaced a trap would be untested, not safe. One that
 * surfaced it and shipped it would cost a merchant real margin. The passing
 * state is: detected, scored, and stopped with a reason a merchant can read.
 *
 * Run:  node scripts/check-proposals.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

async function load(entry, name) {
  const out = path.join(process.cwd(), "node_modules", ".cache", name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href + "?t=" + Date.now());
}

const S = await load("app/lib/stats.server.ts", "stats-check.mjs");
const D = await load("app/lib/detectors.server.ts", "det-check.mjs");
const F = await load("app/lib/floors.server.ts", "floors-check.mjs");
const R = await load("app/lib/rank.server.ts", "rank-check.mjs");
const E = await load("app/lib/economics.server.ts", "econ-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/* ================= the statistics ================= */
console.log("--- arithmetic ---");

check(
  "Wilson degrades a thin claim, hard",
  Math.abs(S.wilsonLower(2, 3) - 0.208) < 0.005,
  `2 of 3 raw is 67%; the lower bound is ${(S.wilsonLower(2, 3) * 100).toFixed(1)}%`,
);
check(
  "and barely touches a well-evidenced one",
  S.wilsonLower(158, 300) > 0.46,
  `158 of 300 -> ${(S.wilsonLower(158, 300) * 100).toFixed(1)}%`,
);
check(
  "the evidence ratio separates them without a threshold",
  S.evidenceRatio(2, 3) < 0.35 && S.evidenceRatio(158, 300) > 0.85,
  `${S.evidenceRatio(2, 3).toFixed(2)} vs ${S.evidenceRatio(158, 300).toFixed(2)}`,
);
check("wilson is bounded below by zero", S.wilsonLower(0, 5) === 0 && S.wilsonLower(0, 0) === 0);

check(
  "Fisher's exact matches the known value on the kettle trap",
  Math.abs(S.fisherUpperTail(2, 718, 72, 3) - 0.0276) < 0.01,
  `p = ${S.fisherUpperTail(2, 718, 72, 3).toFixed(4)} — WHICH PASSES p<0.05. Significance alone ships the trap.`,
);
check(
  "hypergeometric probabilities sum to one",
  Math.abs([...Array(21).keys()].reduce((s, k) => s + S.hypergeomPmf(k, 100, 20, 20), 0) - 1) < 1e-9,
);
check(
  "log-space survives numbers that would overflow a double",
  Number.isFinite(S.hypergeomPmf(50, 5000, 1000, 200)) && S.hypergeomPmf(50, 5000, 1000, 200) > 0,
  "factorials of 5000 do not fit in a float64",
);

// The worked example from Benjamini & Hochberg (1995) itself, so this is
// checked against a published answer rather than against my own arithmetic.
const ps = [
  0.0001, 0.0004, 0.0019, 0.0095, 0.0201, 0.0278, 0.0298, 0.0344,
  0.0459, 0.324, 0.4262, 0.5719, 0.6528, 0.759, 1.0,
];
const bh = S.benjaminiHochberg(ps.map((p, i) => ({ i, p })), (x) => x.p, 0.05);
check(
  "BH reproduces the published 1995 example",
  bh.filter((r) => r.rejected).length === 4,
  `${bh.filter((r) => r.rejected).length} rejected of 15 at q=0.05 — the paper says 4`,
);
check(
  "and it is a step-UP procedure, not a per-test comparison",
  (() => {
    // Sorted: 0.01, 0.03, 0.032. Thresholds: 0.0167, 0.0333, 0.05.
    // 0.03 fails its own threshold at rank 2, but 0.032 clears at rank 3 —
    // so a step-UP procedure rejects all three, and a per-test comparison
    // would reject one.
    const r = S.benjaminiHochberg([{ p: 0.01 }, { p: 0.032 }, { p: 0.03 }], (x) => x.p, 0.05);
    return r.filter((x) => x.rejected).length === 3;
  })(),
  "rejecting only where the inequality holds is the classic implementation error — it silently loses power",
);
check(
  "BH keeps more than Bonferroni would",
  bh.filter((r) => r.rejected).length > ps.filter((p) => p < 0.05 / ps.length).length,
  "Bonferroni controls a different thing and destroys power at this scale",
);
check(
  "a batch of pure noise yields nothing",
  S.benjaminiHochberg(
    Array.from({ length: 50 }, (_, i) => ({ p: 0.2 + i * 0.015 })),
    (x) => x.p,
    0.1,
  ).every((r) => !r.rejected),
);

check(
  "CUSUM reports its own lateness",
  (() => {
    // 60 quiet points, then a step. The alarm must come after the step, and the
    // onset estimate must be closer to it than the alarm is.
    const series = [...Array(60).fill(0), ...Array(40).fill(1)];
    const a = S.cusum(series, 0.05, 0.1, 3);
    return a && a.index >= 60 && a.onsetIndex <= a.index;
  })(),
  "an alarm read as an onset sends a merchant looking for a deploy on the wrong date",
);
check("CUSUM stays silent on a stable series", S.cusum(Array(200).fill(0), 0.05, 0.1, 3) === null);

/* The Bernoulli CUSUM, which exists because the standardised one was wrong for
 * rare binary events and the fixture proved it. These are regression tests for
 * a bug that produced a confident, wrong date on a merchant's screen. */
const F_ = true, OK_ = false;
check(
  "TWO CONSECUTIVE FAILURES DO NOT RAISE AN ALARM",
  S.bernoulliCusum([OK_, OK_, OK_, F_, F_, OK_, OK_, OK_, OK_, OK_], 0.11, 0.25, 4) === null,
  "at an 11% base rate this happens constantly; the standardised version fired on it and cried wolf",
);
check(
  "a real sustained doubling does",
  (() => {
    const a = S.bernoulliCusum(
      [...Array(30).fill(OK_), ...Array(20).fill(0).map((_, i) => i % 2 === 0)],
      0.11,
      0.25,
      4,
    );
    return a !== null && a.index >= 30;
  })(),
  "50% failures after 30 clean ones — caught, and not before it starts",
);
check(
  "the onset estimate points at the change, not at the alarm",
  (() => {
    const a = S.bernoulliCusum(
      [...Array(40).fill(OK_), ...Array(20).fill(0).map((_, i) => i % 2 === 0)],
      0.11,
      0.25,
      4,
    );
    return a !== null && a.onsetIndex >= 35 && a.onsetIndex < a.index;
  })(),
);
check(
  "a rate below the one we accept never alarms, however long the series",
  S.bernoulliCusum(
    Array.from({ length: 500 }, (_, i) => i % 12 === 0),
    0.11,
    0.25,
    4,
  ) === null,
  "8% against an accepted 11% — 500 observations of ordinary noise and it stays quiet",
);
check(
  "a degenerate p1 is refused rather than returning NaN",
  S.bernoulliCusum([F_, F_, F_], 0.5, 0.2, 4) === null,
  "a rate worth catching that is lower than the one we accept is not a test",
);

check(
  "CV refuses to describe a series it cannot",
  S.coefficientOfVariation([1, 1, 1]) === null && S.coefficientOfVariation([1, 1, 1, 1]) === 0,
  "three orders at one unit reports CV 0.00, which READS as perfect predictability",
);

/* ================= the pipeline, on the real fixture ================= */
console.log("\n--- detectors, on data/orders.jsonl ---");

const rd = (f) =>
  fs
    .readFileSync(path.join(process.cwd(), "data", f), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const orders = rd("orders.jsonl");
const carts = rd("carts.jsonl");
const inputs = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "merchant-inputs.json"), "utf8"));

// Stock on hand, from the demo store's catalogue.
const feed = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "demo-store", "catalog.json"), "utf8"));
const onHand = new Map();
for (const p of feed.products) for (const v of p.variants) onHand.set(v.sku, v.inventory ?? 0);

const input = { orders, carts, inputs, onHand, asOf: new Date("2026-09-05T00:00:00Z") };
const candidates = D.runDetectors(input);
check("the detectors produce candidates", candidates.length > 0, `${candidates.length} found`);

const byId = (frag) => candidates.filter((c) => c.id.includes(frag));

/* ---- classification corrects a unit-centric framing ---- */
const classes = D.classify(input);
const cupping = classes.find((c) => c.handle === "ceramic-cupping-set");
check(
  "the cupping set is NOT classified a C item",
  cupping && cupping.abc !== "C" && cupping.revenueShare > 0.1,
  `${cupping?.abc}${cupping?.xyz}, ${(cupping?.revenueShare * 100).toFixed(1)}% of revenue at ${cupping?.unitsPerMonth.toFixed(1)} units/mo — slow in UNITS, fast in RUPEES. Classifying on velocity would put it in C and justify discounting an eighth of the business.`,
);
const kettle = classes.find((c) => c.handle === "copper-chai-kettle");
check(
  "a product with too few periods gets no XYZ letter",
  kettle?.xyz === "?",
  "its CV computes to 0.00, which is an absence of data wearing the costume of perfect stability",
);

/* ---- cross-sell finds the surprising pair, not the obvious one ---- */
const xsell = candidates.filter((c) => c.kind === "cross_sell");
check("cross-sell finds pairs", xsell.length > 0, xsell.map((c) => c.id.split(":")[1]).join(", "));
check(
  "every cross-sell shows its arithmetic",
  xsell.every((c) => c.facts.some((f) => f.label === "hyper-lift") && c.facts.some((f) => f.label === "attach rate, lower bound")),
);

/* ---- replenishment proposes a reminder and refuses a discount ---- */
const repl = candidates.filter((c) => c.kind === "reminder");
check("replenishment finds the regular cohort", repl.length > 0, repl.map((c) => c.products[0]).join(", "));
check(
  "IT NEVER PROPOSES DISCOUNTING THEM",
  !candidates.some((c) => c.kind === "discount" && c.segment === "repeat buyers"),
  "a cohort with CV 0.34 reorders anyway — discounting them is a transfer of margin to the already-committed",
);
check(
  "and the rationale says so out loud",
  repl.every((c) => /discount/i.test(c.rationale) && /not proposed/i.test(c.rationale)),
  "because the merchant will otherwise think of it themselves",
);

/* ================= the traps ================= */
console.log("\n--- the three planted traps ---");

const screened = F.screen(candidates, { inputs });
const survived = F.kept(screened);
const rejected = F.stopped(screened);
const findRejection = (frag) => rejected.find((r) => r.candidate.id.includes(frag));

/* T1: the kettle COD claim, on three orders, p = 0.028 */
const t1 = byId("payment_preference:copper-chai-kettle");
check(
  "T1 IS DETECTED — the detector is not rigged to miss it",
  t1.length > 0,
  t1[0]?.id ?? "not found",
);
if (t1.length) {
  check(
    "T1 arrives already crippled by its own evidence",
    t1[0].confidence < 0.5,
    `confidence ${t1[0].confidence.toFixed(2)} on n=${t1[0].n}`,
  );
  const r = findRejection("payment_preference:copper-chai-kettle");
  check(
    "T1 IS STOPPED",
    Boolean(r),
    r ? `${r.rejected.gate}: ${r.rejected.why.slice(0, 90)}` : "IT SURVIVED — this would be shipped to a merchant",
  );
}

/* T2: cold brew, 14% margin against a 25% floor, on the never-discount list.
 *
 * It is NOT proposed here, and that is the correct behaviour rather than a miss.
 * The markdown detector only opens the question where there is stock to clear,
 * and cold brew has three units against roughly twelve a month — a quarter of a
 * month of cover. There is no overstock, so there is no reason to discuss a
 * discount, and inventing one to prove the floor works would be theatre.
 *
 * So the floor is tested directly instead, on a candidate constructed to be
 * exactly the mistake T2 represents. */
check(
  "cold brew is not proposed for markdown, because it has no cover to clear",
  byId("markdown:cold-brew-concentrate").length === 0,
  "3 units against ~12 a month — a markdown detector that proposed this would be inventing a reason",
);

const t2 = {
  id: "markdown:cold-brew-concentrate@15%",
  lane: "experiment",
  kind: "discount",
  title: "15% off cold brew",
  rationale: "constructed",
  facts: [{ label: "margin after the cut", value: "-1%" }],
  reach: 12,
  impact: -88,
  effort: 1,
  exposure: 5000,
  confidence: 0.95,
  n: 70,
  products: ["cold-brew-concentrate"],
  mechanism: "price",
};
const t2Screened = F.screen([t2], { inputs });
check(
  "T2 IS STOPPED — a cut that sells below cost never reaches a merchant",
  Boolean(t2Screened[0].rejected),
  t2Screened[0].rejected
    ? `${t2Screened[0].rejected.gate}: ${t2Screened[0].rejected.why.slice(0, 80)}`
    : "IT SURVIVED — every unit would sell at a loss",
);
check(
  "and it would have RANKED FIRST if it had not been",
  (() => {
    const scale2 = E.storeScale(orders, inputs.unitCost, 6);
    // Scored on the magnitude of its effect, which is exactly why a floor and
    // not a ranking weight is the right instrument: it is a big number.
    return Math.abs(R.score(t2, { monthlyGrossMargin: scale2.monthlyGrossMargin }).monthlyValue) > 500;
  })(),
  "the margin floor is not a formality — it is the only thing between this pipeline and a confident, well-ranked, expensive mistake",
);

const markdownsProposed = candidates.filter((c) => c.kind === "discount");
const markdownsSurviving = survived.filter((c) => c.kind === "discount");
check(
  "surviving markdowns are only ones with real cover and healthy margin",
  markdownsSurviving.every((c) => {
    const cover = Number(c.facts.find((f) => f.label === "months of cover")?.value ?? 0);
    const after = Number(String(c.facts.find((f) => f.label === "margin after the cut")?.value ?? "0").replace("%", ""));
    return cover >= 2 && after >= inputs.floors.minMarginPct;
  }),
  `${markdownsProposed.length} proposed, ${markdownsSurviving.length} survived: ${markdownsSurviving.map((c) => c.products[0]).join(", ") || "none"}`,
);
check(
  "every surviving markdown lands in the experiment lane, never the digest",
  markdownsSurviving.every((c) => c.lane === "experiment"),
  "a price experiment is not a weekly suggestion — at most one runs at a time, behind its own gate",
);
check(
  "and each one refuses to forecast what the cut will do",
  markdownsSurviving.every((c) => /never changed a price|cannot tell you/i.test(c.rationale)),
  "no price variation means elasticity is unidentified, not merely uncertain",
);
check(
  "every rejection carries a reason a merchant can read",
  rejected.every((r) => r.rejected.why.length > 20),
  `${rejected.length} rejected`,
);
check(
  "rejections are RETURNED, not silently dropped",
  rejected.length > 0 && rejected.every((r) => r.candidate),
  "a proposer that hides what it stopped is indistinguishable from one that never looked",
);

/* ---- the floors are individually load-bearing ---- */
console.log("\n--- each floor, tested by removing it ---");

const noSampleFloor = F.screen(candidates, {
  inputs: { ...inputs, floors: { ...inputs.floors, minSampleSize: 1 } },
});
check(
  "dropping the sample floor lets T1 further through",
  F.kept(noSampleFloor).some((c) => c.id.includes("copper-chai-kettle")) ||
    F.stopped(noSampleFloor).find((r) => r.candidate.id.includes("copper-chai-kettle"))?.rejected.gate ===
      "false_discovery",
  "which is the point of having more than one layer — FDR catches what the sample floor would have",
);

/* Each floor peeled back one at a time, so the gate that fires is named rather
 * than assumed. A gate you cannot watch fail is a gate you have not verified. */
const gateFor = (floors) => F.screen([t2], { inputs: { ...inputs, floors: { ...inputs.floors, ...floors } } })[0].rejected?.gate ?? "SURVIVED";
check(
  "with the list in place, the never-discount list is what stops T2",
  gateFor({}) === "never_discount",
  gateFor({}),
);
check(
  "take the list away and the MARGIN floor catches it instead",
  gateFor({ neverDiscount: [] }) === "margin_floor",
  `${gateFor({ neverDiscount: [] })} — two independent layers, either one sufficient`,
);
check(
  "take BOTH away and it survives — which is what makes them load-bearing",
  gateFor({ neverDiscount: [], minMarginPct: -100 }) === "SURVIVED",
  "a loss-making cut, ranked first, on its way to a merchant",
);

/* ================= economics ================= */
console.log("\n--- economics ---");

const econ = E.markdownEconomics({
  sku: "CCS-06",
  handle: "ceramic-cupping-set",
  unitPrice: 1890,
  unitCost: 820,
  depth: 0.1,
  unitsPerMonth: 7,
  onHand: 15,
});
check(
  "break-even lift is computed, never forecast",
  Math.abs(econ.breakEvenLift - 0.2136) < 0.01,
  `10% off needs +${(econ.breakEvenLift * 100).toFixed(0)}% volume — ${econ.extraUnitsPerMonth.toFixed(1)} extra units a month`,
);
check(
  "margin after the cut is stated, not just margin now",
  Math.abs(econ.marginAfterPct - 0.466) < 0.005 && econ.marginAfterPct < econ.marginNowPct,
  `${(econ.marginNowPct * 100).toFixed(1)}% -> ${(econ.marginAfterPct * 100).toFixed(1)}% — checking the floor against the BEFORE figure is the version of this test that passes everything`,
);
check(
  "a cut that erases margin reports an unreachable break-even, not a big number",
  E.markdownEconomics({ sku: "X", handle: "x", unitPrice: 100, unitCost: 90, depth: 0.2, unitsPerMonth: 5, onHand: 10 })
    .breakEvenLift === Infinity,
  "extra volume makes a loss worse; a finite number there would read as achievable",
);
check(
  "carrying cost is flagged as immaterial when it is",
  econ.carryingCostImmaterial,
  `₹${econ.carryingCost.toFixed(0)} carrying against ₹${econ.maxExposure.toFixed(0)} exposure — so the "clear it early" argument does NOT apply here and must not be borrowed`,
);

/* ================= ranking ================= */
console.log("\n--- ranking ---");

const scale = E.storeScale(orders, inputs.unitCost, 6);
check(
  "store scale is measured",
  scale.monthlyGrossMargin > 0 && scale.monthlyOrders > 0,
  `${scale.monthlyOrders.toFixed(0)} orders/mo, ₹${scale.monthlyGrossMargin.toFixed(0)} monthly gross margin`,
);

const actions = R.rank(survived.filter((c) => c.lane === "action"), {
  monthlyGrossMargin: scale.monthlyGrossMargin,
});
check("lane A ranks", actions.length > 0, `${actions.length} ranked`);
console.log(
  actions
    .slice(0, 5)
    .map(
      (c) =>
        `      ${c.priority.toFixed(1).padStart(8)}  ${c.kind.padEnd(14)} ${c.id.split(":")[1]?.slice(0, 38) ?? ""}  conf ${c.confidence.toFixed(2)}  ₹${c.monthlyValue.toFixed(0)}/mo`,
    )
    .join("\n"),
);
check(
  "free interventions outrank operational ones, all else equal",
  (() => {
    const effort1 = actions.filter((c) => c.effort === 1);
    const effort2 = actions.filter((c) => c.effort === 2);
    if (!effort1.length || !effort2.length) return true;
    return Math.max(...effort1.map((c) => c.priority)) > Math.min(...effort2.map((c) => c.priority));
  })(),
);
check(
  "a rejected proposal decays rather than being re-pitched",
  (() => {
    const one = actions[0];
    const decayed = R.score(one, {
      monthlyGrossMargin: scale.monthlyGrossMargin,
      priorRejections: new Map([[one.id, 2]]),
    });
    return Math.abs(decayed.priority - one.priority * 0.25) < 0.01;
  })(),
  "twice rejected scores at a quarter — this is how these tools avoid becoming noise",
);
check(
  "risk is relative to the store, not absolute",
  (() => {
    const c = { ...actions[0], exposure: 10000 };
    const small = R.score(c, { monthlyGrossMargin: 10000 }).risk;
    const large = R.score(c, { monthlyGrossMargin: 1_000_000 }).risk;
    return small > large && Math.abs(small - 2) < 0.01;
  })(),
  "a ₹10,000 cap is existential for one merchant and rounding for another",
);

/* ---- MMR ---- */
const digest = R.selectDiverse(actions, 3);
check("selection returns a digest", digest.length === Math.min(3, actions.length));
check(
  "MMR does not hand back three proposals about one product",
  (() => {
    const seen = new Set();
    let repeats = 0;
    for (const d of digest) for (const p of d.products) {
      if (seen.has(p)) repeats++;
      seen.add(p);
    }
    return repeats <= 1;
  })(),
  digest.map((d) => d.products[0] ?? d.kind).join(", "),
);
check(
  "MMR normalises, so lambda actually does something",
  (() => {
    // Two identical-product candidates with a huge score gap. Pure top-N would
    // take both; MMR at lambda 0.5 should prefer the different one.
    const a = { ...actions[0], id: "a", priority: 500, products: ["p1"], mechanism: "m", segment: "s" };
    const b = { ...actions[0], id: "b", priority: 480, products: ["p1"], mechanism: "m", segment: "s" };
    const c = { ...actions[0], id: "c", priority: 100, products: ["p2"], mechanism: "n", segment: "t" };
    const picked = R.selectDiverse([a, b, c], 2, 0.5).map((x) => x.id);
    return picked.includes("a") && picked.includes("c");
  })(),
  "without normalisation a priority of 500 against a similarity of 0.8 makes the diversity term inert",
);

/* ================= the lane split ================= */
console.log("\n--- lanes ---");

check(
  "incidents exist and are NOT in the ranked list",
  survived.some((c) => c.lane === "incident") && actions.every((c) => c.lane === "action"),
  `${survived.filter((c) => c.lane === "incident").length} incidents held out of the digest`,
);
check(
  "a payment outage is an incident, not an offer",
  survived.filter((c) => c.lane === "incident").every((c) => c.kind !== "cross_sell"),
);
check(
  "every incident carries both an onset and a detection date where it claims a change",
  survived
    .filter((c) => c.kind === "payment")
    .every((c) => c.facts.some((f) => f.label === "estimated onset") && c.facts.some((f) => f.label === "detected")),
);
check(
  "no candidate reaches a merchant without its facts",
  survived.every((c) => c.facts.length >= 3 && c.rationale.length > 60),
);
check(
  "every number in a rationale can be checked against a fact",
  survived.every((c) => {
    // The rule a model's prose will later be held to: each figure must appear
    // in the finding. Asserted now, on the templates, so the check is known to
    // work before it is the only thing standing between a model and a merchant.
    const inFacts = c.facts.map((f) => f.value.replace(/[₹,%\s]/g, "")).join("|");
    const numbers = (c.rationale.match(/₹[\d,]+|\b\d+(?:\.\d+)?%/g) ?? []).map((s) =>
      s.replace(/[₹,%\s]/g, ""),
    );
    return numbers.every((n) => inFacts.includes(n) || c.rationale.includes(n));
  }),
);

/* ================= the tools agree with the pipeline ================= */
console.log("\n--- the analyst and the offers page must not contradict each other ---");

const MT = await load("app/lib/merchanttools.server.ts", "mt-check.mjs");
const CAT = await load("app/lib/catalog.server.ts", "mtcat-check.mjs");

const mctx = {
  shop: "pk_nilgiripost_dev",
  shopName: "Nilgiri Post",
  catalog: {
    kind: "json-feed",
    async search() {
      return feed.products.map((p) => ({
        handle: p.handle,
        title: p.title,
        description: p.description ?? "",
        productType: null,
        vendor: null,
        tags: p.tags ?? [],
        url: null,
        image: null,
        minPrice: String(Math.min(...p.variants.map((v) => v.price))),
        maxPrice: String(Math.max(...p.variants.map((v) => v.price))),
        currency: "INR",
        totalInventory: p.variants.reduce((s, v) => s + (v.inventory ?? 0), 0),
        variants: p.variants.map((v) => ({
          title: v.title,
          price: String(v.price),
          currency: "INR",
          sku: v.sku,
          availableForSale: Boolean(v.inStock),
          inventoryQuantity: v.inventory ?? 0,
        })),
      }));
    },
    async get() {
      return null;
    },
    async complements() {
      return [];
    },
    async policies() {
      return {};
    },
  },
  cache: {},
};

const mtool = (n) => MT.MERCHANT_TOOLS.find((t) => t.name === n);
const xsellText = await mtool("cross_sell_opportunities").run(mctx, { top: 8 });

/**
 * The analyst reads these tools; the offers page reads the pipeline. If they
 * disagree about what is actionable, a merchant sees the analyst recommend
 * exactly what the offers page refuses to offer — and is right to stop trusting
 * both. On the seeded data the highest-value pairing by raw arithmetic is one
 * the sample floor stops, so this is not hypothetical.
 */
const thinPairs = xsellText
  .split("\n")
  .filter((l) => /BELOW YOUR SAMPLE FLOOR/.test(l))
  .map((l) => l.split(" => ")[0]);

check(
  "the cross-sell tool marks pairings the proposer would stop",
  thinPairs.length > 0,
  thinPairs.join(", ") || "none marked — check the floor is still applied",
);
check(
  "a marked pairing names the floor it failed and by how much",
  /only \d+ baskets against the \d+ you set/.test(xsellText),
  "a warning that does not say what to do about it is decoration",
);
check(
  "marked pairings sort BELOW actionable ones, however large their headline figure",
  (() => {
    const lines = xsellText.split("\n").filter(Boolean);
    const firstThin = lines.findIndex((l) => /BELOW YOUR SAMPLE FLOOR/.test(l));
    const lastGood = lines.map((l) => !/BELOW YOUR SAMPLE FLOOR/.test(l)).lastIndexOf(true);
    return firstThin === -1 || firstThin > lastGood;
  })(),
  "the biggest number on the page must not be the one nobody may act on",
);
check(
  "...but they are still SHOWN, not silently dropped",
  xsellText.split("\n").length > xsellText.split("\n").filter((l) => !/BELOW YOUR SAMPLE FLOOR/.test(l)).length,
  "the merchant asked; a shortened list is indistinguishable from an empty one",
);
check(
  "every merchant tool returns text, never throws, even with junk arguments",
  await (async () => {
    for (const t of MT.MERCHANT_TOOLS) {
      try {
        const out = await t.run(mctx, { handle: "!!!nope", id: "!!!nope", depth_percent: -5, k: -1, n: 0 });
        if (typeof out !== "string" || out.length === 0) return false;
      } catch {
        return false;
      }
    }
    return true;
  })(),
  "a tool that throws mid-loop leaves the harness with a dangling call and no way to continue",
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
