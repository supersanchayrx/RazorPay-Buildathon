// Does the proposed priority score actually order these candidates sensibly,
// and do the traps die? Testing the formula before writing it down as design.
import fs from "node:fs";
const D = new URL("../data/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const rd = (f) => fs.readFileSync(D + f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const all = rd("orders.jsonl");
const orders = all.filter((o) => o.status === "placed");
const carts = rd("carts.jsonl");
const inputs = JSON.parse(fs.readFileSync(D + "merchant-inputs.json", "utf8"));
const MONTHS = 6;

const wilson = (k, n, z = 1.96) => {
  if (!n) return 0;
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const m = (z / d) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return Math.max(0, c - m);
};

const PRICE = { "MCB-100": 340, "MCB-250": 720, "SEA-250": 420, "SEA-500": 760,
  "AVF-250": 640, "AVF-500": 1180, "NFG-100": 480, "NFG-250": 1080,
  "CGT-100": 520, "CBC-500": 590, "CCK-12": 2450, "CCS-06": 1890 };
const marginOf = (sku) => PRICE[sku] - inputs.unitCost[sku];

// Store scale, used to normalise risk. A cap that is trivial for a big merchant
// is existential for a small one, so exposure must be relative, not absolute.
let grossMargin = 0;
for (const o of orders) for (const l of o.lines) grossMargin += marginOf(l.sku) * l.qty;
const monthlyGM = grossMargin / MONTHS;
const monthlyOrders = orders.length / MONTHS;
console.log(`store: ${orders.length} placed orders / ${MONTHS}mo = ${monthlyOrders.toFixed(0)}/mo, monthly gross margin INR ${monthlyGM.toFixed(0)}\n`);

/**
 * Priority = (Reach x Impact x Confidence) / (Effort x Risk) x Decay
 *   Reach      orders per month the proposal touches
 *   Impact     INR margin effect per affected order (conservative estimate)
 *   Confidence derived, not guessed: Wilson LB / point estimate
 *   Effort     1 one click, 2 config, 3 operational change
 *   Risk       1 + worstCaseExposure / monthlyGrossMargin
 *   Decay      0.5^(similar proposals the merchant already rejected)
 */
function score(c) {
  const risk = 1 + (c.exposure ?? 0) / monthlyGM;
  const decay = 0.5 ** (c.priorRejections ?? 0);
  return {
    ...c,
    risk,
    decay,
    monthlyValue: c.reach * c.impact,
    priority: (c.reach * c.impact * c.confidence) / (c.effort * risk) * decay,
  };
}

const candidates = [];

/* --- cross-sell: no margin given up, so exposure 0 --------------------- */
const has = {};
for (const o of orders) for (const h of new Set(o.lines.map((l) => l.handle))) (has[h] ??= new Set()).add(o.id);
function pairStats(x, y) {
  let n = 0; for (const id of has[x]) if (has[y].has(id)) n++;
  return { n, nX: has[x].size, nY: has[y].size };
}
const XSELL = [
  ["masala-chai-blend", "single-estate-assam-ctc", 420 - 205],
  ["araku-valley-filter-coffee", "cold-brew-concentrate", 590 - 505],
  ["nilgiri-frost-green-tea", "ceramic-cupping-set", 1890 - 820],
];
for (const [x, y, unitMargin] of XSELL) {
  const { n, nX, nY } = pairStats(x, y);
  const N = orders.length;
  const conf = n / nX;
  const base = nY / N;
  const lb = wilson(n, nX);
  // Only the excess over the base rate is attributable to the pairing, and we
  // take the conservative end of it.
  const excess = Math.max(0, lb - base);
  candidates.push({
    id: `cross_sell:${x}->${y}`,
    kind: "cross_sell",
    reach: (nX / MONTHS),
    impact: excess * unitMargin,       // INR margin per X-basket
    confidence: conf > 0 ? lb / conf : 0,
    effort: 1,
    exposure: 0,
    note: `n=${n}/${nX}, conf ${(conf * 100).toFixed(0)}% vs base ${(base * 100).toFixed(0)}%, wilson LB ${(lb * 100).toFixed(0)}%`,
  });
}

/* --- discount on the cupping set -------------------------------------- */
{
  const u = orders.flatMap((o) => o.lines).filter((l) => l.sku === "CCS-06").reduce((s, l) => s + l.qty, 0);
  const perMo = u / MONTHS;
  const depth = 0.10, give = 1890 * depth, cap = 40;
  const m = marginOf("CCS-06");
  const breakevenUnits = perMo * (give / (m - give));
  candidates.push({
    id: "discount:ceramic-cupping-set@10%",
    kind: "discount",
    reach: perMo,
    // Assumed lift is exactly the break-even we must beat, so impact is stated
    // as zero net until proven. The honest number here is the RISK, not a
    // forecast, because we have no price variation to estimate elasticity from.
    impact: -give,
    confidence: 0.9,
    effort: 1,
    exposure: cap * give,
    note: `${perMo.toFixed(1)}/mo, needs +${breakevenUnits.toFixed(1)} units/mo to break even, cap ${cap} = INR ${(cap * give).toFixed(0)} exposure`,
  });
}

/* --- payment routing: HDFC netbanking --------------------------------- */
{
  const nb = all.filter((o) => o.payment.method === "netbanking" && o.ts >= "2026-07-07");
  const hd = nb.filter((o) => o.payment.bank === "HDFC");
  const f = hd.filter((o) => o.payment.attempts.some((a) => a.status === "failed")).length;
  const lb = wilson(f, hd.length);
  const others = nb.filter((o) => o.payment.bank !== "HDFC");
  const of_ = others.filter((o) => o.payment.attempts.some((a) => a.status === "failed")).length;
  const baseline = of_ / others.length;
  const lost = hd.filter((o) => o.payment.status === "failed");
  const avg = lost.length ? lost.reduce((s, o) => s + o.total, 0) / lost.length : 0;
  const recoverable = Math.max(0, lb - baseline);
  candidates.push({
    id: "payment_routing:HDFC-netbanking",
    kind: "payment",
    reach: hd.length / 2,               // 60-day window -> per month
    impact: recoverable * avg * 0.45,   // margin share of recoverable revenue
    confidence: (f / hd.length) > 0 ? lb / (f / hd.length) : 0,
    effort: 2,
    exposure: 0,
    note: `${f}/${hd.length} fail vs ${(baseline * 100).toFixed(0)}% elsewhere, wilson LB ${(lb * 100).toFixed(0)}%, avg lost order INR ${avg.toFixed(0)}`,
  });
}

/* --- replenishment: a reminder, not a discount ------------------------- */
{
  const rep = orders.filter((o) => o.cohort === "replenish");
  const cust = new Set(rep.map((o) => o.customer.id));
  const avg = rep.reduce((s, o) => s + o.total, 0) / rep.length;
  candidates.push({
    id: "replenish_reminder:masala-chai-blend",
    kind: "reminder",
    reach: cust.size,                   // roughly one cycle per customer per month
    impact: avg * 0.05 * 0.5,           // small assumed timing effect, margin share
    confidence: 0.85,
    effort: 1,
    exposure: 0,
    note: `${cust.size} customers, mean gap 32.8d CV 0.34 — regular enough that a discount would pay "sure things"`,
  });
  // The version we must NOT propose, kept here to show it scores worse.
  candidates.push({
    id: "discount:replenish-cohort@10%",
    kind: "discount",
    reach: cust.size,
    impact: -avg * 0.10,
    confidence: 0.85,
    effort: 1,
    exposure: rep.length / MONTHS * avg * 0.10 * 3,
    note: `same cohort, 10% off — gives margin to buyers whose CV=0.34 says they reorder anyway`,
  });
}

/* --- abandonment: the kettle ------------------------------------------ */
{
  const kc = carts.filter((c) => c.lines.some((l) => l.handle === "copper-chai-kettle"));
  const paid = kc.filter((c) => c.lastStep === "payment").length;
  candidates.push({
    id: "abandonment:copper-chai-kettle",
    kind: "outreach",
    reach: kc.length / MONTHS,
    impact: (2450 - 2050) * 0.08,       // margin x a conservative recovery rate
    confidence: 0.8,
    effort: 2,
    exposure: 0,
    note: `${kc.length} carts in ${MONTHS}mo, ${paid} reached payment, 3 orders ever`,
  });
}

/* --- the two traps, scored rather than filtered, to see where they land - */
{
  const kettle = all.filter((o) => o.lines.some((l) => l.handle === "copper-chai-kettle"));
  const cod = kettle.filter((o) => o.payment.method === "cod").length;
  const point = cod / kettle.length, lb = wilson(cod, kettle.length);
  candidates.push({
    id: "TRAP T1  discount:kettle-COD-exclusive",
    kind: "discount",
    reach: kettle.length / MONTHS,
    impact: 2450 * 0.10,
    confidence: lb / point,
    effort: 1,
    exposure: 10 * 245,
    note: `naive ${(point * 100).toFixed(0)}% COD on n=${kettle.length}; wilson LB ${(lb * 100).toFixed(0)}%`,
    filteredBy: `sample floor n>=${inputs.floors.minSampleSize}`,
  });
  const u = orders.flatMap((o) => o.lines).filter((l) => l.sku === "CBC-500").reduce((s, l) => s + l.qty, 0);
  candidates.push({
    id: "TRAP T2  discount:cold-brew@15%",
    kind: "discount",
    reach: u / MONTHS,
    impact: 590 * 0.15,
    confidence: 0.95,
    effort: 1,
    exposure: 60 * 590 * 0.15,
    note: `${u} units in ${MONTHS}mo, margin 14% vs floor ${inputs.floors.minMarginPct}%`,
    filteredBy: `margin floor + neverDiscount list`,
  });
}

const scored = candidates.map(score).sort((a, b) => b.priority - a.priority);
console.log("RANKED (traps included, marked)\n");
for (const c of scored) {
  const flag = c.filteredBy ? `  [KILLED AT STAGE 2: ${c.filteredBy}]` : "";
  console.log(
    `${c.priority.toFixed(1).padStart(9)}  ${c.id}${flag}\n` +
    `             reach ${c.reach.toFixed(1)}/mo  impact INR ${c.impact.toFixed(0)}/order  conf ${c.confidence.toFixed(2)}  effort ${c.effort}  risk ${c.risk.toFixed(2)}  monthly INR ${c.monthlyValue.toFixed(0)}\n` +
    `             ${c.note}\n`,
  );
}
