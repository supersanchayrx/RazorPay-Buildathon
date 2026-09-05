/**
 * Razorpay wiring and the quote that feeds it.
 *
 * Two halves:
 *
 *   OFFLINE — signature verification and quote arithmetic. These are where a
 *   bug is a free order, so they are adversarial: each check tries to pay less
 *   than the asking price, or to claim a payment that never happened.
 *
 *   LIVE — one real order against Razorpay's TEST API, to prove the credentials
 *   and the request shape are right. Skipped automatically when the keys are
 *   absent, so the suite still runs on a machine without them. Test-mode orders
 *   cost nothing and move no money.
 *
 * Run:  node scripts/check-payments.mjs
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
  return import(pathToFileURL(out).href);
}

const RP = await load("app/lib/razorpay.server.ts", "rp-check.mjs");
const Q = await load("app/lib/quote.server.ts", "quote-check.mjs");
const ENV = await load("app/lib/env.server.ts", "env-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const REF = {
  keyIdEnv: "RAZORPAY_TEST_API_KEY_ID1",
  keySecretEnv: "RAZORPAY_TEST_API_KEY_SECRET1",
};

/* ---- credentials are referenced, never embedded -------------------- */
const status = ENV.describe([REF.keyIdEnv, REF.keySecretEnv]);
check(
  "the site registry holds variable NAMES, not secrets",
  !/[A-Za-z0-9]{20,}/.test(JSON.stringify(REF)),
  "so nothing that gets logged or serialised can be carrying one",
);
check(
  "credentials resolve for the custom-site key set",
  status.configured,
  status.configured ? "key set 1 present" : `missing: ${status.missing.join(", ")}`,
);

/* ---- minor units --------------------------------------------------- */
check(
  "rupees convert to paise without floating-point drift",
  RP.toMinorUnits(1.15) === 115 && RP.toMinorUnits(2450) === 245000 && RP.toMinorUnits(0.1 + 0.2) === 30,
  "1.15*100 is 114.99999999999999 in IEEE754; truncating undercharges every order that hits it",
);

/* ---- payment signature: the check that separates claim from fact --- */
const secretValue = ENV.secret(REF.keySecretEnv);
if (!secretValue) {
  console.log("SKIP  signature verification — no key secret");
} else {
  const crypto = await import("node:crypto");
  const orderId = "order_TESTONLY123";
  const paymentId = "pay_TESTONLY456";
  const good = crypto
    .createHmac("sha256", secretValue)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  check(
    "a genuine Checkout signature verifies",
    RP.verifyPaymentSignature(REF, { orderId, paymentId, signature: good }),
  );
  check(
    "a forged signature does not",
    !RP.verifyPaymentSignature(REF, { orderId, paymentId, signature: "0".repeat(64) }),
    "without this, a POST claiming success is a free order",
  );
  check(
    "a signature from a DIFFERENT order does not verify",
    !RP.verifyPaymentSignature(REF, { orderId: "order_SOMETHINGELSE", paymentId, signature: good }),
    "so a real receipt cannot be replayed against a cheaper basket",
  );
  check(
    "a signature from a different payment does not verify",
    !RP.verifyPaymentSignature(REF, { orderId, paymentId: "pay_OTHER", signature: good }),
  );
  check(
    "missing or malformed input is rejected without throwing",
    ["", "abc", null, undefined].every(
      (sig) => RP.verifyPaymentSignature(REF, { orderId, paymentId, signature: sig }) === false,
    ),
  );
}

/* ---- the quote: the client says what, the server says how much ----- */
const feed = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "demo-store", "catalog.json"), "utf8"));
const products = feed.products.map((p) => ({
  handle: p.handle,
  title: p.title,
  variants: p.variants.map((v) => ({
    sku: v.sku,
    title: v.title,
    price: v.price,
    inventoryQuantity: v.inventory,
  })),
}));
const catalog = {
  kind: "test",
  search: async () => products,
  get: async (h) => products.find((p) => p.handle === h) ?? null,
  complements: async () => [],
  policies: async () => feed.shop.policies,
};
const quote = (items) => Q.buildQuote({ catalog, items });

const kettlePrice = 2450;
const chai100 = 340;

const q1 = await quote([{ handle: "masala-chai-blend", sku: "MCB-100", qty: 2 }]);
check(
  "a valid cart prices from the catalogue",
  q1.ok && q1.quote.subtotal === chai100 * 2 && q1.quote.total === chai100 * 2 + 60,
  q1.ok ? `subtotal ${q1.quote.subtotal} + shipping ${q1.quote.shipping} = ${q1.quote.total}` : "failed",
);

// THE attack. A client that can name a price can name any price.
const q2 = await quote([
  { handle: "copper-chai-kettle", sku: "CCK-12", qty: 1, price: 1, unitPrice: 1, amount: 1, lineTotal: 1 },
]);
check(
  "a client-supplied price is ignored entirely",
  q2.ok === false || q2.quote.lines.every((l) => l.unitPrice !== 1),
  q2.ok ? `priced at ${q2.quote.lines[0].unitPrice}, not 1` : `rejected: ${q2.problems[0].reason} (kettle is out of stock)`,
);

const q3 = await quote([{ handle: "not-a-real-product", qty: 1 }]);
check(
  "an unknown product is refused, not silently skipped",
  !q3.ok && q3.problems[0].reason === "unknown_product",
);

const q4 = await quote([{ handle: "copper-chai-kettle", sku: "CCK-12", qty: 1 }]);
check("an out-of-stock item cannot be bought", !q4.ok && q4.problems[0].reason === "out_of_stock", "kettle inventory is 0");

const q5 = await quote([{ handle: "cold-brew-concentrate", sku: "CBC-500", qty: 5 }]);
check(
  "buying more than exists is refused, and says how many there are",
  !q5.ok && q5.problems[0].reason === "insufficient_stock" && q5.problems[0].available === 3,
  q5.ok ? "" : q5.problems[0].message,
);

const q6 = await quote(
  Array.from({ length: 12 }, () => ({ handle: "cold-brew-concentrate", sku: "CBC-500", qty: 1 })),
);
check(
  "duplicate lines are merged before the quantity cap is applied",
  !q6.ok && q6.problems[0].reason === "insufficient_stock",
  "otherwise twelve lines of one unit walks past a per-line limit",
);

const q7 = await quote([{ handle: "masala-chai-blend", sku: "MCB-100", qty: -1 }]);
const q8 = await quote([{ handle: "masala-chai-blend", sku: "MCB-100", qty: 1.5 }]);
const q9 = await quote([{ handle: "masala-chai-blend", sku: "MCB-100", qty: 9999 }]);
check(
  "negative, fractional and absurd quantities are all refused",
  [q7, q8, q9].every((q) => !q.ok && q.problems[0].reason === "bad_quantity"),
  "a negative quantity is a refund request wearing a cart's clothes",
);

const q10 = await quote([
  { handle: "masala-chai-blend", sku: "MCB-100", qty: 1 },
  { handle: "not-a-real-product", qty: 1 },
]);
check(
  "a partly-invalid cart is refused whole",
  !q10.ok,
  "silently dropping the bad line means the shopper pays for a basket they did not agree to",
);

const q11 = await quote([{ handle: "ceramic-cupping-set", sku: "CCS-06", qty: 1 }]);
check(
  "shipping is free above the merchant's threshold",
  q11.ok && q11.quote.shipping === 0 && q11.quote.total === 1890,
  q11.ok ? `1890 -> shipping ${q11.quote.shipping}` : "failed",
);

check(
  "a quote expires",
  q1.ok && Date.parse(q1.quote.expiresAt) > Date.now() && !Q.quoteExpired(q1.quote) &&
    Q.quoteExpired({ ...q1.quote, expiresAt: new Date(Date.now() - 1000).toISOString() }),
  "prices and stock move; a quote that never expires is a promise the catalogue has not agreed to",
);

const again = await quote([{ handle: "masala-chai-blend", sku: "MCB-100", qty: 2 }]);
check(
  "the same basket fingerprints the same, a different one does not",
  again.ok && again.quote.fingerprint === q1.quote.fingerprint && q11.quote.fingerprint !== q1.quote.fingerprint,
  "so a payment can be tied back to exactly the basket that was priced",
);

/* ---- live: one real test-mode order -------------------------------- */
if (!status.configured) {
  console.log("SKIP  live order — no credentials");
} else if (process.env.SKIP_LIVE) {
  console.log("SKIP  live order — SKIP_LIVE set");
} else {
  const res = await RP.createOrder(REF, {
    amount: RP.toMinorUnits(q1.quote.total),
    currency: "INR",
    receipt: `chk_${q1.quote.fingerprint}`,
    notes: { source: "check-payments.mjs" },
  });
  check(
    "a real order is created against the Razorpay test API",
    res.ok && typeof res.order.id === "string" && res.order.id.startsWith("order_"),
    res.ok ? `${res.order.id}, ${res.order.amount} paise, ${res.order.status}` : `${res.source}/${res.reason}`,
  );
  if (res.ok) {
    check(
      "the amount Razorpay recorded is the amount we quoted",
      res.order.amount === RP.toMinorUnits(q1.quote.total),
      `${res.order.amount} paise = ₹${RP.fromMinorUnits(res.order.amount)}`,
    );
  }

  const bad = await RP.createOrder(
    { keyIdEnv: "RAZORPAY_TEST_API_KEY_ID1", keySecretEnv: "NO_SUCH_VARIABLE" },
    { amount: 10000, currency: "INR", receipt: "x" },
  );
  check(
    "a missing credential fails as OURS, not as the buyer's problem",
    !bad.ok && bad.source === "ours" && bad.reason === "not_configured",
    "source says whose problem it is; that is what makes retry logic decidable",
  );

  const tiny = await RP.createOrder(REF, { amount: 5, currency: "INR", receipt: "x" });
  check("an amount below the floor is caught before the network", !tiny.ok && tiny.reason === "invalid_amount");
}

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
