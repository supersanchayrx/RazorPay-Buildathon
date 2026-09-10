/**
 * Assertions over the seeded history.
 *
 * A fixture that silently stops containing the signal it was built to contain
 * is worse than no fixture: the proposer starts failing and the seed script
 * looks innocent. This checks that every planted signal and every planted trap
 * is still there, and it is the thing to run after touching seed-history.mjs.
 *
 * It deliberately reports the traps as *present* rather than as failures. T1
 * and T2 are supposed to be in the data. The failure is a proposer that falls
 * for them, and that check belongs with the proposer.
 *
 * Run:  node scripts/check-history.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataPath } from "./data-dir.mjs";

const databaseFile = path.resolve(process.env.CHAPMAN_DATABASE_PATH || dataPath("chapman.sqlite"));
const db = new DatabaseSync(databaseFile, { readOnly: true });
const readDocument = (kind) => {
  const row = db.prepare(`
    SELECT payload FROM store_documents WHERE kind = ? ORDER BY updated_at DESC LIMIT 1
  `).get(kind);
  if (!row) throw new Error(`Missing ${kind} in ${databaseFile}; run npm run seed first.`);
  return JSON.parse(row.payload);
};

const orders = readDocument("seed.orders");
const carts = readDocument("seed.carts");
const inputs = readDocument("merchant.inputs");

let failed = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
}

/* ---- provenance ---------------------------------------------------- */
check(
  "every record is labelled synthetic",
  [...orders, ...carts].every((r) => r.synthetic === true && r.seed === inputs.seed),
  `${orders.length + carts.length} records, seed ${inputs.seed}`,
);

const testPhone = process.env.TWILIO_TEST_TO?.trim();
if (testPhone) {
  check(
    "every synthetic recovery contact uses TWILIO_TEST_TO",
    [...orders, ...carts].every((r) => r.customer?.phone === testPhone),
    `${orders.length} orders and ${carts.length} carts checked without printing the destination`,
  );
}

/* ---- S1  slow mover with margin room ------------------------------- */
const units = {};
for (const o of orders) for (const l of o.lines) units[l.handle] = (units[l.handle] ?? 0) + l.qty;
const cups = units["ceramic-cupping-set"] ?? 0;
const cupsMargin = 1 - inputs.unitCost["CCS-06"] / 1890;
check(
  "S1  ceramic-cupping-set is slow, has room, and clears the floor",
  cups >= inputs.floors.minSampleSize && cups < 120 && cupsMargin > 0.5,
  `${cups} units in 180d (floor ${inputs.floors.minSampleSize}), ${(cupsMargin * 100).toFixed(0)}% margin`,
);

/* ---- S2  co-purchase beats the tag graph --------------------------- */
const pairs = {};
for (const o of orders) {
  const hs = [...new Set(o.lines.map((l) => l.handle))].sort();
  for (let i = 0; i < hs.length; i++)
    for (let j = i + 1; j < hs.length; j++) pairs[`${hs[i]} + ${hs[j]}`] = (pairs[`${hs[i]} + ${hs[j]}`] ?? 0) + 1;
}
const top = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 4);
check(
  "S2  chai + assam is the strongest pair",
  top[0][0] === "masala-chai-blend + single-estate-assam-ctc",
  top.map(([k, v]) => `${k} (${v})`).join(", "),
);

/* ---- S3  replenishment cohort -------------------------------------- */
const byCustomer = {};
for (const o of orders) (byCustomer[o.customer.id] ??= []).push(o);
const cohort = Object.entries(byCustomer).filter(([, os]) => os.filter((o) => o.cohort === "replenish").length >= 4);
check("S3  a replenishment cohort exists", cohort.length >= 10, `${cohort.length} customers with 4+ cyclical reorders`);

/* ---- S4  bank failure cluster in the last 60 days ------------------ */
// This window must match the one the seed clusters over. It did not, and the
// check reported n=8 against a cluster that actually holds three times that —
// a measurement that disagrees with the thing it measures, which is the same
// class of mistake as testing a request your client never sends.
const cut = new Date("2026-07-07T00:00:00Z").toISOString();
const nb = orders.filter((o) => o.payment.method === "netbanking" && o.ts >= cut);
const rate = (bank) => {
  const rows = nb.filter((o) => o.payment.bank === bank);
  const bad = rows.filter((o) => o.payment.attempts.some((a) => a.status === "failed"));
  return rows.length ? { n: rows.length, pct: (bad.length / rows.length) * 100 } : { n: 0, pct: 0 };
};
const hdfc = rate("HDFC");
const others = ["ICIC", "SBIN", "AXIS", "KKBK"].map(rate);
const otherPct = others.reduce((s, r) => s + r.pct * r.n, 0) / Math.max(1, others.reduce((s, r) => s + r.n, 0));
check(
  "S4  one bank fails far more than the rest",
  hdfc.pct > otherPct * 2 && hdfc.n >= 12,
  `HDFC ${hdfc.pct.toFixed(0)}% of n=${hdfc.n} vs ${otherPct.toFixed(0)}% elsewhere`,
);

/* ---- S5  high-value carts abandon --------------------------------- */
const kettleCarts = carts.filter((c) => c.lines.some((l) => l.handle === "copper-chai-kettle")).length;
const kettleOrders = orders.filter((o) => o.lines.some((l) => l.handle === "copper-chai-kettle")).length;
check(
  "S5  the kettle is wanted and not bought",
  kettleCarts > kettleOrders * 10,
  `${kettleCarts} abandoned carts vs ${kettleOrders} orders`,
);

/* ---- T1  the sample-size trap -------------------------------------- */
const kettle = orders.filter((o) => o.lines.some((l) => l.handle === "copper-chai-kettle"));
const kettleCod = kettle.filter((o) => o.payment.method === "cod").length;
check(
  "T1  trap present: kettle looks COD-preferring at n=3",
  kettle.length < inputs.floors.minSampleSize && kettleCod / kettle.length >= 0.6,
  `${kettleCod}/${kettle.length} COD — floor is n>=${inputs.floors.minSampleSize}`,
);

/* ---- T2  the margin trap ------------------------------------------- */
const cbUnits = units["cold-brew-concentrate"] ?? 0;
const cbMargin = 1 - inputs.unitCost["CBC-500"] / 590;
check(
  "T2  trap present: cold brew sells fast on a thin margin",
  cbUnits > 40 && cbMargin < inputs.floors.minMarginPct / 100,
  `${cbUnits} units, ${(cbMargin * 100).toFixed(0)}% margin vs ${inputs.floors.minMarginPct}% floor`,
);

/* ---- S6 / T3  the festival window ---------------------------------- */
const GIFTS = ["ceramic-cupping-set", "nilgiri-frost-green-tea", "masala-chai-blend"];
const inWindow = (o) => o.ts >= "2026-08-14" && o.ts <= "2026-08-29T23:59:59Z";
const giftRevenue = (rows) =>
  rows.flatMap((o) => o.lines).filter((l) => GIFTS.includes(l.handle)).reduce((s, l) => s + l.lineTotal, 0);
const winDays = 16;
const restDays = 181 - winDays;
const inWin = giftRevenue(orders.filter(inWindow)) / winDays;
const outWin = giftRevenue(orders.filter((o) => !inWindow(o))) / restDays;
check(
  "S6  gifting demand rises inside the Raksha Bandhan window",
  inWin > outWin * 1.5 && inWin < outWin * 4,
  `INR ${inWin.toFixed(0)}/day inside vs ${outWin.toFixed(0)}/day outside (${(inWin / outWin).toFixed(1)}x)`,
);

/* ---- S7  deterministic loyal recovery shopper -------------------- */
const demoCustomerId = "cus_demo_regular_delivery";
const demoOrders = orders.filter(
  (order) => order.status === "placed" && order.customer?.id === demoCustomerId,
);
const demoCart = carts.find((cart) => cart.id === "crt_demo_regular_delivery");
const demoMarginAfterDiscount = demoCart
  ? Math.min(
      ...demoCart.lines.map((line) => {
        const price = line.unitPrice * 0.92;
        return ((price - inputs.unitCost[line.sku]) / price) * 100;
      }),
    )
  : 0;
check(
  "S7  the recovery demo shopper is visibly very loyal",
  demoOrders.length >= 10 && demoOrders.at(-1)?.ts >= "2026-08-01",
  `${demoOrders.length} completed orders; latest ${demoOrders.at(-1)?.ts.slice(0, 10) ?? "missing"}`,
);
check(
  "S7  their abandoned basket is charged delivery and safely clears 8% off",
  demoCart?.subtotal === 1140 &&
    demoCart.subtotal < 1200 &&
    demoMarginAfterDiscount >= inputs.floors.minMarginPct,
  `subtotal INR ${demoCart?.subtotal ?? 0}; ${demoMarginAfterDiscount.toFixed(1)}% minimum line margin after discount`,
);
const extraLoyalDemoIds = [
  ["cus_demo_loyal_chai", "crt_demo_loyal_chai"],
  ["cus_demo_loyal_green", "crt_demo_loyal_green"],
  ["cus_demo_loyal_coffee", "crt_demo_loyal_coffee"],
];
const safeExtraLoyalDemos = extraLoyalDemoIds.filter(([customerId, cartId]) => {
  const placed = orders.filter(
    (order) => order.status === "placed" && order.customer?.id === customerId,
  );
  const cart = carts.find((row) => row.id === cartId);
  if (placed.length < 4 || !cart || cart.subtotal >= 1200) return false;
  return cart.lines.every((line) => {
    const price = line.unitPrice * 0.92;
    return ((price - inputs.unitCost[line.sku]) / price) * 100 >= inputs.floors.minMarginPct;
  });
});
check(
  "S7  three extra loyal recovery shoppers safely clear the demo discount policy",
  safeExtraLoyalDemos.length === extraLoyalDemoIds.length,
  `${safeExtraLoyalDemos.length}/${extraLoyalDemoIds.length} ready`,
);

// The counterfactual for a festive discount is NOT the quiet-season baseline.
// Absent any discount, the festival demand still arrives — that is what a
// festival is. So every rupee of the uplift is a rupee a discount would have
// been paid on regardless, before it buys a single extra sale.
const windowGift = giftRevenue(orders.filter(inWindow));
check(
  "T3  trap present: a festive discount pays for demand the festival already brought",
  windowGift > 0,
  `INR ${windowGift.toFixed(0)} of gifting revenue arrived because of Rakhi; 10% off it costs INR ${(windowGift * 0.1).toFixed(0)} and buys nothing that was not already coming`,
);

/* ---- containment --------------------------------------------------- */
const publicFeed = fs.readFileSync(path.join(process.cwd(), "..", "demo-store", "catalog.json"), "utf8");
check(
  "cost never appears in the public catalogue feed",
  !/unitCost|"cost"/.test(publicFeed),
  "catalog.json is served to the open internet",
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
db.close();
process.exit(failed === 0 ? 0 : 1);
