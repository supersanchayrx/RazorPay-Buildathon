// Probe the fixture with the methods from the research, to check they actually
// behave as claimed on our data before any of it gets written down as design.
import fs from "node:fs";
const D = new URL("../data/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const rd = (f) => fs.readFileSync(D + f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const orders = rd("orders.jsonl").filter((o) => o.status === "placed");
const all = rd("orders.jsonl");
const carts = rd("carts.jsonl");
const inputs = JSON.parse(fs.readFileSync(D + "merchant-inputs.json", "utf8"));

/* ---------- Wilson score lower bound ---------- */
function wilson(k, n, z = 1.96) {
  if (n === 0) return 0;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, c - m);
}

/* ---------- log-gamma, hypergeometric, Fisher ---------- */
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
const lchoose = (n, k) => (k < 0 || k > n ? -Infinity : lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1));
/** P(C = k) for C ~ Hypergeom(N, K, n) */
const hgPmf = (k, N, K, n) => Math.exp(lchoose(K, k) + lchoose(N - K, n - k) - lchoose(N, n));
/** Fisher one-sided: P(C >= k) */
function fisherUpper(k, N, K, n) {
  let s = 0;
  for (let i = k; i <= Math.min(K, n); i++) s += hgPmf(i, N, K, n);
  return Math.min(1, s);
}
/** delta-quantile of Hypergeom(N,K,n) */
function hgQuantile(delta, N, K, n) {
  let c = 0;
  for (let i = 0; i <= Math.min(K, n); i++) {
    c += hgPmf(i, N, K, n);
    if (c >= delta) return i;
  }
  return Math.min(K, n);
}

/* ---------- basket stats ---------- */
const N = orders.length;
const has = {};
for (const o of orders) {
  const hs = [...new Set(o.lines.map((l) => l.handle))];
  for (const h of hs) (has[h] ??= new Set()).add(o.id);
}
const handles = Object.keys(has);
function ruleStats(x, y) {
  const X = has[x], Y = has[y];
  let nXY = 0;
  for (const id of X) if (Y.has(id)) nXY++;
  const nX = X.size, nY = Y.size;
  const supp = nXY / N;
  const lift = supp / ((nX / N) * (nY / N));
  const leverage = supp - (nX / N) * (nY / N);
  const q99 = hgQuantile(0.99, N, nY, nX);
  const hyperlift = nXY / Math.max(1, q99);
  const p = fisherUpper(nXY, N, nY, nX);
  const cXY = nXY / nX, cYX = nXY / nY;
  const kulc = 0.5 * (cXY + cYX);
  const ir = Math.abs(cXY - cYX) / (cXY + cYX - cXY * cYX);
  return { x, y, nXY, nX, nY, lift, hyperlift, leverage, p, cXY, cYX, kulc, ir };
}
const rules = [];
for (let i = 0; i < handles.length; i++)
  for (let j = 0; j < handles.length; j++)
    if (i !== j) rules.push(ruleStats(handles[i], handles[j]));

console.log("=== association rules, top 6 by lift vs top 6 by hyper-lift ===");
const f = (r) =>
  `${r.x.slice(0, 22)} -> ${r.y.slice(0, 22)}  n=${r.nXY}  lift=${r.lift.toFixed(2)}  hlift=${r.hyperlift.toFixed(2)}  lev=${(r.leverage * 100).toFixed(2)}%  p=${r.p.toExponential(2)}  kulc=${r.kulc.toFixed(2)}  IR=${r.ir.toFixed(2)}`;
console.log("-- by lift --");
[...rules].sort((a, b) => b.lift - a.lift).slice(0, 6).forEach((r) => console.log("  " + f(r)));
console.log("-- by hyper-lift (delta=0.99) --");
[...rules].sort((a, b) => b.hyperlift - a.hyperlift).slice(0, 6).forEach((r) => console.log("  " + f(r)));
console.log("-- by leverage --");
[...rules].sort((a, b) => b.leverage - a.leverage).slice(0, 4).forEach((r) => console.log("  " + f(r)));

/* ---------- T1: the COD trap under Wilson ---------- */
console.log("\n=== T1  kettle COD claim ===");
const kettle = all.filter((o) => o.lines.some((l) => l.handle === "copper-chai-kettle"));
const kCod = kettle.filter((o) => o.payment.method === "cod").length;
const baseCod = all.filter((o) => o.payment.method === "cod").length / all.length;
console.log(`  naive        ${kCod}/${kettle.length} = ${((kCod / kettle.length) * 100).toFixed(0)}%`);
console.log(`  wilson LB    ${(wilson(kCod, kettle.length) * 100).toFixed(1)}%`);
console.log(`  store base   ${(baseCod * 100).toFixed(1)}%`);
console.log(`  naive effect ${(kCod / kettle.length / baseCod).toFixed(1)}x   wilson effect ${(wilson(kCod, kettle.length) / baseCod).toFixed(2)}x`);
console.log(`  fisher p     ${fisherUpper(kCod, all.length, all.filter((o) => o.payment.method === "cod").length, kettle.length).toExponential(2)}`);

/* ---------- ABC / XYZ ---------- */
console.log("\n=== ABC / XYZ ===");
const months = {};
for (const o of orders) {
  const m = o.ts.slice(0, 7);
  for (const l of o.lines) ((months[l.handle] ??= {})[m] = (months[l.handle][m] ?? 0) + l.qty);
}
const rev = {};
for (const o of orders) for (const l of o.lines) rev[l.handle] = (rev[l.handle] ?? 0) + l.lineTotal;
const totalRev = Object.values(rev).reduce((a, b) => a + b, 0);
const keys = Object.keys(months).sort((a, b) => rev[b] - rev[a]);
let cum = 0;
for (const h of keys) {
  const ms = Object.values(months[h]);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const sd = Math.sqrt(ms.reduce((s, v) => s + (v - mean) ** 2, 0) / ms.length);
  const cv = sd / mean;
  cum += rev[h] / totalRev;
  const abc = cum <= 0.8 ? "A" : cum <= 0.95 ? "B" : "C";
  const xyz = cv < 0.5 ? "X" : cv <= 1.0 ? "Y" : "Z";
  console.log(
    `  ${abc}${xyz}  ${h.padEnd(28)} rev ${String(rev[h]).padStart(7)}  ${(rev[h] / totalRev * 100).toFixed(1).padStart(5)}%  cum ${(cum * 100).toFixed(0).padStart(3)}%  CV ${cv.toFixed(2)}  ${mean.toFixed(1)}/mo`,
  );
}

/* ---------- CUSUM on netbanking failures ---------- */
console.log("\n=== S4  CUSUM change point, netbanking daily failure indicator ===");
const nb = all.filter((o) => o.payment.method === "netbanking").sort((a, b) => a.ts.localeCompare(b.ts));
const fail = nb.map((o) => (o.payment.attempts.some((a) => a.status === "failed") ? 1 : 0));
const mu0 = 0.09; // in-control rate the merchant baselines at
const k = 0.5 * (0.4 - mu0); // slack = half the shift we care about
let S = 0, best = null;
const h = 5 * Math.sqrt(mu0 * (1 - mu0)); // decision interval
for (let i = 0; i < nb.length; i++) {
  S = Math.max(0, S + (fail[i] - mu0 - k));
  if (S > h && !best) best = { i, ts: nb[i].ts.slice(0, 10), S };
}
console.log(`  n=${nb.length} netbanking orders, mu0=${mu0}, k=${k.toFixed(3)}, h=${h.toFixed(2)}`);
console.log(`  alarm at    ${best ? `${best.ts} (order ${best.i + 1} of ${nb.length}), S=${best.S.toFixed(2)}` : "no alarm"}`);
const cut = "2026-07-07";
const post = nb.filter((o) => o.ts >= cut);
const hd = post.filter((o) => o.payment.bank === "HDFC");
const hdF = hd.filter((o) => o.payment.attempts.some((a) => a.status === "failed")).length;
console.log(`  HDFC post-cut ${hdF}/${hd.length} = ${((hdF / hd.length) * 100).toFixed(0)}%, wilson LB ${(wilson(hdF, hd.length) * 100).toFixed(1)}%`);

/* ---------- S1 economics ---------- */
console.log("\n=== S1  cupping set economics ===");
const units = {};
for (const o of orders) for (const l of o.lines) units[l.handle] = (units[l.handle] ?? 0) + l.qty;
const u = units["ceramic-cupping-set"], price = 1890, cost = inputs.unitCost["CCS-06"], stock = 15;
const perMo = u / 6;
const marginUnit = price - cost;
for (const depth of [0.1, 0.15, 0.2]) {
  const give = price * depth;
  const newMargin = (marginUnit - give) / (price - give);
  const breakeven = give / (marginUnit - give); // extra units per existing unit
  console.log(
    `  ${(depth * 100).toFixed(0)}% off: give INR ${give.toFixed(0)}/unit, margin ${(newMargin * 100).toFixed(0)}% (floor ${inputs.floors.minMarginPct}%), break-even lift ${(breakeven * 100).toFixed(0)}%  (${(perMo * breakeven).toFixed(1)} extra units/mo)`,
  );
}
const carryYr = 0.2;
const monthsToClear = stock / perMo;
console.log(`  velocity ${perMo.toFixed(1)}/mo, stock ${stock} -> ${monthsToClear.toFixed(1)} months of cover`);
console.log(`  carrying cost of that cover: INR ${(stock * cost * carryYr * (monthsToClear / 12)).toFixed(0)}`);

/* ---------- S3: are the replenishers "sure things"? ---------- */
console.log("\n=== S3  replenishment cohort ===");
const rep = {};
for (const o of orders) if (o.cohort === "replenish") (rep[o.customer.id] ??= []).push(o.ts);
const gaps = [];
for (const ts of Object.values(rep)) {
  ts.sort();
  for (let i = 1; i < ts.length; i++)
    gaps.push((Date.parse(ts[i]) - Date.parse(ts[i - 1])) / 86400000);
}
const gm = gaps.reduce((a, b) => a + b, 0) / gaps.length;
const gsd = Math.sqrt(gaps.reduce((s, v) => s + (v - gm) ** 2, 0) / gaps.length);
console.log(`  ${Object.keys(rep).length} customers, ${gaps.length} intervals, mean ${gm.toFixed(1)}d, sd ${gsd.toFixed(1)}d, CV ${(gsd / gm).toFixed(2)}`);
const repRev = orders.filter((o) => o.cohort === "replenish").reduce((s, o) => s + o.total, 0);
console.log(`  cohort revenue INR ${repRev.toLocaleString("en-IN")} (${((repRev / totalRev) * 100).toFixed(1)}% of total)`);
console.log(`  10% discount to this cohort would give up INR ${(repRev * 0.1).toFixed(0)} against buyers whose CV says they reorder anyway`);
