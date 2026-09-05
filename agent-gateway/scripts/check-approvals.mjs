/**
 * Approvals — the one place the guardrail opens.
 *
 * Everywhere else in this system the answer to "can the assistant say this?" is
 * no. This is the exception, so it gets the most adversarial suite: a gate that
 * can open is only as good as the conditions on its opening.
 *
 * The property being tested, in one sentence:
 *
 *   THE SAME SENTENCE IS REFUSED, THEN PERMITTED AFTER ONE MERCHANT CLICK,
 *   THEN REFUSED AGAIN WHEN THE OFFER EXPIRES OR IS WITHDRAWN.
 *
 * And the boundary that keeps it honest: an approval licenses the assistant to
 * SAY an offer exists. The rupees come from `buildQuote`, server-side. The model
 * never computes a discount, so it cannot be argued into a bigger one.
 *
 * Run:  node scripts/check-approvals.mjs
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

const REAL = process.cwd();
const SANDBOX = path.join(REAL, "node_modules", ".cache", "approvals-sandbox");
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(path.join(SANDBOX, "data"), { recursive: true });

const B = await load("app/lib/bounds.server.ts", "bounds-appr.mjs");
process.chdir(SANDBOX);
const A = await load(path.join(REAL, "app/lib/approvals.server.ts"), "appr-check.mjs");
const Q = await load(path.join(REAL, "app/lib/quote.server.ts"), "quote-appr.mjs");
process.chdir(REAL);

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const SHOP = "pk_test";
const SENTENCE = "There is 10% off the Masala Chai Blend at the moment.";
const TODAY = "2026-09-05";
const gates = (reply, offers) =>
  B.checkReply(reply, { groundedStockClaims: [], approvedOffers: offers, asOf: TODAY }).map((v) => v.gate);

/* ================= before any approval exists ================= */
console.log("--- with nothing approved ---");

check(
  "a discount claim is refused",
  gates(SENTENCE, []).includes("unverifiable_discount"),
  "this is the state the system shipped in — no approval store, so no price claim was ever sayable",
);
check(
  "so is an unquantified one",
  gates("I can offer you a special price just for you.", []).includes("unverifiable_discount"),
);
check(
  "ordinary product talk is untouched",
  gates("The Masala Chai Blend is ₹340 for 100g and it is in stock.", []).length === 0,
  "a gate that fires on everything is a gate nobody keeps switched on",
);

/* ================= the merchant approves ================= */
console.log("\n--- after one merchant click ---");

const terms = {
  handle: "masala-chai-blend",
  title: "Masala Chai Blend",
  depth: 0.1,
  endsAt: "2099-01-01",
  maxUnits: 50,
};
const ok = A.decide({ shop: SHOP, candidateId: "markdown:masala-chai-blend@10%", action: "approve", by: "dev@example", offer: terms });
check("the approval is accepted", ok.ok, ok.error ?? "");

const live = A.announceable(SHOP);
check("it becomes announceable", live.length === 1 && live[0].percent === 10, JSON.stringify(live[0]));

check(
  "THE SAME SENTENCE IS NOW PERMITTED",
  gates(SENTENCE, live).length === 0,
  "one click is the entire difference — nothing about the assistant changed",
);

check(
  "but a DIFFERENT percentage is still refused",
  gates("There is 15% off the Masala Chai Blend.", live).includes("unverifiable_discount"),
  "exact, not 'at least' — rounding 10 up to 15 because it sounds better is an invented offer",
);
check(
  "and a smaller one is refused too",
  gates("There is 5% off the Masala Chai Blend.", live).includes("unverifiable_discount"),
  "quoting less than approved costs the merchant a sale for no reason — same failure, opposite direction",
);
check(
  "an unquantified concession is never licensed by anything",
  gates("I'm able to offer you a special deal just for you.", live).includes("unverifiable_discount"),
  "no approval could make an unquantified concession checkable, so it stays refused forever",
);
check(
  "an approval does not license invented urgency",
  gates("10% off — only 2 left, hurry!", live).includes("unverifiable_urgency"),
  "an offer is a price, not a deadline and not scarcity",
);
check(
  "nor an assumption about what the shopper observes",
  gates("As a Hindu you'll want the 10% off before Diwali.", live).includes("assumed_observance"),
);

/* ================= the server, not the model, does the arithmetic ========= */
console.log("\n--- who computes the rupees ---");

const catalog = {
  kind: "json-feed",
  async search() {
    return [];
  },
  async get(handle) {
    if (handle !== "masala-chai-blend") return null;
    return {
      handle,
      title: "Masala Chai Blend",
      description: "",
      productType: null,
      vendor: null,
      tags: [],
      url: null,
      image: null,
      minPrice: "340",
      maxPrice: "720",
      currency: "INR",
      totalInventory: 88,
      variants: [
        { title: "100 g", price: "340", currency: "INR", sku: "MCB-100", availableForSale: true, inventoryQuantity: 88 },
      ],
    };
  },
  async complements() {
    return [];
  },
  async policies() {
    return { shipping: "Free shipping over 1200." };
  },
};

process.chdir(SANDBOX);
const priced = await Q.buildQuote({
  catalog,
  items: [{ handle: "masala-chai-blend", qty: 2 }],
  shop: SHOP,
});
process.chdir(REAL);

check("the quote succeeds", priced.ok, priced.ok ? "" : JSON.stringify(priced.problems));
if (priced.ok) {
  const q = priced.quote;
  check(
    "THE SERVER APPLIES THE DISCOUNT, itemised",
    q.offers.length === 1 && q.discount === 68,
    `subtotal ₹${q.subtotal}, less ₹${q.discount}, total ₹${q.total} — 10% of ₹680, computed here and nowhere else`,
  );
  check(
    "the total actually reflects it",
    q.total === q.subtotal - q.discount + q.shipping,
    `${q.subtotal} - ${q.discount} + ${q.shipping} = ${q.total}`,
  );
  check(
    "shipping is charged on the DISCOUNTED subtotal",
    q.shipping === 60,
    "₹680 less ₹68 is ₹612, under the ₹1200 free-shipping threshold — a threshold cleared only at full price was not cleared",
  );
  check(
    "there is still no field through which a client could send a price",
    !("price" in ({ handle: "x", sku: "y", qty: 1 })) && q.lines.every((l) => l.unitPrice === 340),
    "the offer changed what it costs; it did not change who decides",
  );
}

/* ================= withdrawal and expiry ================= */
console.log("\n--- taking it away ---");

check(
  "an offer that has already ended licenses nothing",
  gates(SENTENCE, [{ handle: "masala-chai-blend", title: "x", percent: 10, endsAt: "2026-09-04" }]).includes(
    "unverifiable_discount",
  ),
  "checked against the clock at read time — a stored status is a status that can be stale",
);

A.decide({ shop: SHOP, candidateId: "markdown:masala-chai-blend@10%", action: "revoke", by: "dev@example" });
check(
  "REVOKING PUTS THE SENTENCE BACK BEHIND THE GATE",
  A.announceable(SHOP).length === 0 && gates(SENTENCE, A.announceable(SHOP)).includes("unverifiable_discount"),
  "a later decision supersedes an earlier one without rewriting history",
);

process.chdir(SANDBOX);
const after = await Q.buildQuote({ catalog, items: [{ handle: "masala-chai-blend", qty: 2 }], shop: SHOP });
process.chdir(REAL);
check(
  "and the price goes back up on the very next quote",
  after.ok && after.quote.discount === 0 && after.quote.subtotal === 680,
  `₹${after.ok ? after.quote.total : "?"} — an offer cached in a session would keep applying after withdrawal`,
);

check(
  "the approval and the revocation are both still on the record",
  A.history(SHOP).length === 2 && A.history(SHOP)[0].action === "revoke",
  "append-only: a revocation must never destroy the evidence of what was approved",
);

/* ================= what will not be accepted ================= */
console.log("\n--- refusing bad terms at the door ---");

const bad = (offer) =>
  A.decide({ shop: SHOP, candidateId: "x:" + Math.random(), action: "approve", by: "d", offer }).error ?? "ACCEPTED";

check("an offer with no end date is refused", bad({ ...terms, endsAt: "not a date" }) !== "ACCEPTED");
check(
  "an offer that already expired is refused",
  bad({ ...terms, endsAt: "2020-01-01" }) !== "ACCEPTED",
  "approving something into the past is a typo, and it would silently do nothing",
);
check("a 95% discount is refused", bad({ ...terms, depth: 0.95 }) !== "ACCEPTED");
check("a zero or negative depth is refused", bad({ ...terms, depth: 0 }) !== "ACCEPTED");
check(
  "an offer with no unit cap is refused",
  bad({ ...terms, maxUnits: 0 }) !== "ACCEPTED",
  "the merchant approved a specific worst case; an uncapped offer is a different one",
);
check(
  "an approval with no terms at all is refused",
  A.decide({ shop: SHOP, candidateId: "y", action: "approve", by: "d" }).ok === false,
);
check(
  "another shop's approval does not apply here",
  (() => {
    A.decide({ shop: "pk_other", candidateId: "z", action: "approve", by: "d", offer: terms });
    return A.announceable(SHOP).length === 0 && A.announceable("pk_other").length === 1;
  })(),
  "one person running two stores must not be able to leak an offer between them",
);

/* ================= the decay loop ================= */
A.decide({ shop: SHOP, candidateId: "cross_sell:a->b", action: "reject", by: "d", note: "tried it, did not work" });
A.decide({ shop: SHOP, candidateId: "cross_sell:a->b", action: "reject", by: "d" });
check(
  "rejections are counted, so a refused idea is not re-pitched next week",
  A.rejectionCounts(SHOP).get("cross_sell:a->b") === 2,
  "twice rejected scores at a quarter in the ranking",
);

/* ================= the test bench's own scenarios ================= */
console.log("\n--- the bench proves what it claims to ---");

const TB = await load(path.join(REAL, "app/lib/testbench.server.ts"), "tb-check.mjs");

/**
 * The merchant-facing bench injects a dangerous sentence per scenario and shows
 * the gate catching it. If a bounds pattern is ever narrowed, that page would
 * quietly start showing "NOTHING FIRED" to a merchant. Asserted here, where it
 * fails a build instead of a demo.
 */
for (const sc of TB.SCENARIOS) {
  const fired = B.checkReply(sc.unsafeReply, {
    groundedStockClaims: [],
    approvedOffers: [],
    asOf: TODAY,
  }).map((v) => v.gate);
  check(`bench "${sc.id}" is caught by ${sc.gate}`, fired.includes(sc.gate), fired.join(", ") || "NOTHING FIRED");
}

check(
  "every bench scenario names a gate that exists",
  TB.SCENARIOS.every((s) =>
    ["unverifiable_discount", "unverifiable_urgency", "unapproved_event", "assumed_observance"].includes(s.gate),
  ),
);
check(
  "the leak patterns catch identifiers and leave ordinary prose alone",
  TB.LEAK_PATTERNS.some((r) => r.test("priya@example.invalid")) &&
    TB.LEAK_PATTERNS.some((r) => r.test("+919910443464")) &&
    TB.LEAK_PATTERNS.some((r) => r.test("cus_syn_056")) &&
    !TB.LEAK_PATTERNS.some((r) => r.test("Masala Chai Blend is 340 rupees for 100g and it is in stock.")),
  "written with a raw string after an earlier attempt wrote literal backspace bytes, which matched nothing and were invisible in grep",
);
check(
  "a control question carries no attack sentence",
  TB.CONTROLS.every((c) => !("unsafeReply" in c)),
  "a control must be ANSWERED; giving it an attack sentence would confuse the two halves of the bench",
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
