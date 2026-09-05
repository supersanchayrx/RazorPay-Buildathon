/**
 * Reservations, settlement and the webhook.
 *
 * Three failures live here and each one costs real money:
 *
 *   overselling      two shoppers both buy the last unit
 *   double-settling  one payment becomes two orders, because the browser and
 *                    the webhook both reported it
 *   an unsigned webhook accepted, which is a public endpoint anyone can POST
 *                    a "payment captured" to
 *
 * So the checks are adversarial: each one tries to oversell, double-count, or
 * forge, and asserts that it could not.
 *
 * Run:  node scripts/check-settlement.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

// Settlement writes files. Point them at a scratch directory so a test run
// never appends to the real order book.
const REAL = process.cwd();
const SANDBOX = path.join(REAL, "node_modules", ".cache", "settle-sandbox");
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(path.join(SANDBOX, "data"), { recursive: true });

const R = await load("app/lib/reservations.server.ts", "resv-check.mjs");
const RP = await load("app/lib/razorpay.server.ts", "rp2-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/* ================= reservations ================= */
R._reset();
const stock = new Map([["CBC-500", 3]]);

const first = R.claim({ shop: "s1", orderId: "order_A", lines: [{ sku: "CBC-500", qty: 3 }], availableFromCatalogue: stock });
check("the first shopper can take all three", first.ok);

const second = R.claim({ shop: "s1", orderId: "order_B", lines: [{ sku: "CBC-500", qty: 1 }], availableFromCatalogue: stock });
check(
  "the second shopper cannot take a fourth",
  !second.ok && second.available === 0,
  "the catalogue still says 3 — without the hold, both would have succeeded",
);

check(
  "a shopper does not compete with their own hold",
  R.claim({ shop: "s1", orderId: "order_A", lines: [{ sku: "CBC-500", qty: 3 }], availableFromCatalogue: stock }).ok,
  "a retry of the same checkout is not a second shopper",
);

check(
  "another shop's holds do not block this one",
  R.claim({ shop: "s2", orderId: "order_C", lines: [{ sku: "CBC-500", qty: 3 }], availableFromCatalogue: stock }).ok,
);

R.release("order_A");
check(
  "releasing frees the stock again",
  R.claim({ shop: "s1", orderId: "order_D", lines: [{ sku: "CBC-500", qty: 3 }], availableFromCatalogue: stock }).ok,
);

R._reset();
R.claim({ shop: "s1", orderId: "order_E", lines: [{ sku: "CBC-500", qty: 2 }], availableFromCatalogue: stock });
check(
  "committed() reports what is held, so the quote can subtract it",
  R.committed("s1").get("CBC-500") === 2 && R.committed("s2").size === 0,
);

// A partial claim must take nothing at all.
R._reset();
const partial = R.claim({
  shop: "s1",
  orderId: "order_F",
  lines: [{ sku: "CBC-500", qty: 2 }, { sku: "MISSING-SKU", qty: 1 }],
  availableFromCatalogue: stock,
});
check(
  "a claim that cannot be met in full takes nothing",
  !partial.ok && R.committed("s1").size === 0,
  "half a reservation is stock held for an order that can never complete",
);

/* ================= settlement ================= */
process.chdir(SANDBOX);
const OS = await load(path.join(REAL, "app/lib/orderstore.server.ts"), "os-check.mjs");
const S = await load(path.join(REAL, "app/lib/settle.server.ts"), "settle-check.mjs");

const GW = "order_TESTSETTLE1";
OS.savePending({
  gatewayOrderId: GW,
  shop: "pk_test",
  createdAt: new Date().toISOString(),
  amount: 740,
  currency: "INR",
  fingerprint: "fp1",
  customer: "cus_syn_000",
  lines: [{ handle: "masala-chai-blend", title: "Masala Chai Blend", sku: "MCB-100", qty: 2, unitPrice: 340, lineTotal: 680 }],
});

const base = {
  shop: "pk_test",
  gatewayOrderId: GW,
  gatewayPaymentId: "pay_1",
  gatewayStatus: "captured",
  method: "upi",
  amountMinor: 74000,
  currency: "INR",
};

const a = S.settlePayment({ ...base, by: "browser" });
check("a payment becomes an order", !a.duplicate && a.order?.status === "paid", a.order?.id);
check("the order carries the basket, not just a total", a.order?.lines.length === 1 && a.order.lines[0].sku === "MCB-100");

const b = S.settlePayment({ ...base, by: "webhook" });
check(
  "the webhook reporting the same payment does not create a second order",
  b.duplicate && b.order?.id === a.order?.id,
  "the browser and the webhook race; both must converge on one order",
);

const c = S.settlePayment({ ...base, by: "browser" });
check("replaying the browser's report changes nothing either", c.duplicate && c.order?.id === a.order?.id);

const rows = fs
  .readFileSync(path.join(SANDBOX, "data", "placed-orders.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean);
check("exactly one order was written for three reports", rows.length === 1, `${rows.length} row(s)`);

/* ---- amount tampering, one layer deeper --------------------------- */
const GW2 = "order_TESTSETTLE2";
OS.savePending({
  gatewayOrderId: GW2,
  shop: "pk_test",
  createdAt: new Date().toISOString(),
  amount: 2450,
  currency: "INR",
  fingerprint: "fp2",
  customer: null,
  lines: [{ handle: "copper-chai-kettle", title: "Copper Chai Kettle", sku: "CCK-12", qty: 1, unitPrice: 2450, lineTotal: 2450 }],
});
const under = S.settlePayment({
  shop: "pk_test",
  gatewayOrderId: GW2,
  gatewayPaymentId: "pay_2",
  gatewayStatus: "captured",
  method: "card",
  amountMinor: 100,
  currency: "INR",
  by: "webhook",
});
check(
  "paying less than quoted is caught and the order is not marked paid",
  under.mismatch && under.order?.status === "failed",
  "we asked ₹2450, the report said ₹1",
);

const orphan = S.settlePayment({
  shop: "pk_test",
  gatewayOrderId: "order_NEVER_STARTED",
  gatewayPaymentId: "pay_3",
  gatewayStatus: "captured",
  method: "upi",
  amountMinor: 50000,
  currency: "INR",
  by: "webhook",
});
check(
  "a payment for a checkout we never started is refused loudly",
  orphan.order === null,
  "either a lost write or somebody else's order id — never silently accepted",
);

/* ---- the placed orders are readable, and only by their owner ------ */
const src = OS.placedOrders("pk_test");
const mine = await src.forShopper("cus_syn_000");
check("the buyer can see the order they just placed", mine.length === 1 && mine[0].total === 740);
check("nobody else can", (await src.forShopper("cus_syn_099")).length === 0);
check(
  "a guest checkout belongs to nobody",
  (await OS.placedOrders("pk_test").forShopper(null)).length === 0,
  "the kettle order above had no customer",
);

process.chdir(REAL);

/* ================= webhook signature ================= */
const WREF = { keyIdEnv: "X", keySecretEnv: "Y", webhookSecretEnv: "TEST_WEBHOOK_SECRET" };
process.env.TEST_WEBHOOK_SECRET = "whsec_test_value";
const bodyText = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x" } } } });
const goodSig = crypto.createHmac("sha256", "whsec_test_value").update(bodyText).digest("hex");

check("a genuine webhook signature verifies", RP.verifyWebhookSignature(WREF, bodyText, goodSig));
check(
  "a forged one does not",
  !RP.verifyWebhookSignature(WREF, bodyText, "0".repeat(64)),
  "this endpoint is public — the signature is the only thing guarding it",
);
check(
  "re-serialised JSON does NOT verify",
  !RP.verifyWebhookSignature(WREF, JSON.stringify(JSON.parse(bodyText), null, 2), goodSig),
  "the signature covers raw bytes; parse-then-check is why people end up disabling it",
);
check(
  "a body altered by one character does not verify",
  !RP.verifyWebhookSignature(WREF, bodyText.replace("pay_x", "pay_y"), goodSig),
);
check(
  "no webhook secret configured means nothing verifies",
  !RP.verifyWebhookSignature({ ...WREF, webhookSecretEnv: "NOT_SET_ANYWHERE" }, bodyText, goodSig),
  "fails closed, so an unconfigured deployment cannot be talked into accepting anything",
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
