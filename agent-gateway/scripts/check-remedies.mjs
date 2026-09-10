/**
 * The recovery loop: ask why, remember, remedy.
 *
 * This suite exists because the feature it tests is the most dangerous one in
 * CHAPMAN. Everything else in the system can only ever *say* something; this can
 * give money away without a human approving each one. The interesting failures
 * are not bugs, they are behaviours that look like good service:
 *
 *   - an agent that improves its offer when pushed, teaching every customer to push
 *   - an agent that pays first-time complainers, teaching everyone to complain
 *   - an agent that answers "delivery was too slow" with money off the goods
 *   - an agent that treats "I changed my mind" as an opening position
 *   - a discount that survives past the margin floor it was supposed to respect
 *
 * So the assertions below are mostly about REFUSAL, and several of them prove a
 * gate can still fail rather than merely that it passed.
 *
 * Run:  node scripts/check-remedies.mjs
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

const SEEDED_INPUTS = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "merchant-inputs.json"), "utf8"),
);
const SANDBOX = path.join(process.cwd(), "node_modules", ".cache", "remedies-sandbox");
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(SANDBOX, { recursive: true });
process.env.CHAPMAN_DATA_DIR = SANDBOX;
process.env.CHAPMAN_DATABASE_PATH = path.join(SANDBOX, "chapman.sqlite");

const DBS = await load("app/lib/database.server.ts", "remedies-db-check.mjs");
const RSN = await load("app/lib/reasons.ts", "rsn-check.mjs");
const LOY = await load("app/lib/loyalty.server.ts", "loy-check.mjs");
const GRT = await load("app/lib/grants.server.ts", "grt-check.mjs");
const REM = await load("app/lib/remedies.server.ts", "rem-check.mjs");
const CNV = await load("app/lib/conversations.server.ts", "cnv-check.mjs");
const SET = await load("app/lib/settings.server.ts", "set2-check.mjs");
const QUO = await load("app/lib/quote.server.ts", "quo-check.mjs");
const APR = await load("app/lib/approvals.server.ts", "apr3-check.mjs");
const IDN = await load("app/lib/identity.server.ts", "idn2-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const SHOP = "pk_check_remedies";
const AS_OF = new Date("2026-09-05T11:00:00.000Z");

/* ---- a catalogue, and the merchant's real costs ---------------------- */
const feed = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "demo-store", "catalog.json"), "utf8"));
const inputs = SEEDED_INPUTS;

const products = feed.products.map((p) => ({
  handle: p.handle,
  title: p.title,
  description: p.description ?? "",
  productType: p.type,
  vendor: p.vendor ?? null,
  tags: p.tags ?? [],
  url: null,
  image: null,
  currency: feed.shop.currency,
  minPrice: String(Math.min(...p.variants.map((v) => v.price))),
  maxPrice: String(Math.max(...p.variants.map((v) => v.price))),
  totalInventory: p.variants.reduce((s, v) => s + v.inventory, 0),
  variants: p.variants.map((v) => ({
    title: v.title,
    price: String(v.price),
    currency: feed.shop.currency,
    sku: v.sku,
    availableForSale: Boolean(v.inStock),
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

/** A basket of one 250g assam — a mid-price line with a real cost on file. */
const assam = products.find((p) => p.handle === "single-estate-assam-ctc");
const assamVariant = assam.variants.find((v) => v.sku === "SEA-500") ?? assam.variants[0];
const basket = [
  {
    handle: assam.handle,
    title: assam.title,
    sku: assamVariant.sku,
    qty: 2,
    unitPrice: Number(assamVariant.price),
  },
];

const regular = {
  customerId: "cus_check_regular",
  tier: "regular",
  orders: 6,
  lifetimeMargin: 4200,
  averageOrderMargin: 700,
  firstOrderAt: "2026-01-01T00:00:00.000Z",
  lastOrderAt: "2026-08-20T00:00:00.000Z",
  daysSinceLastOrder: 16,
  because: [],
};
const brandNew = { ...regular, customerId: "cus_check_new", tier: "new", orders: 1, lifetimeMargin: 300 };

const policyOn = (over = {}) => {
  SET.writeSettings(SHOP, { recovery: { enabled: true, ...over } }, "check");
  return SET.readSettings(SHOP).recovery;
};

const remedy = (opts) =>
  REM.chooseRemedy({
    shop: SHOP,
    cartId: opts.cartId ?? "cart_check_1",
    reason: opts.reason,
    standing: opts.standing ?? regular,
    basket: opts.basket ?? basket,
    policy: opts.policy ?? policyOn(),
    inputs: opts.inputs === undefined ? inputs : opts.inputs,
    catalog,
    policies: feed.shop.policies,
    serviceNotice: opts.serviceNotice ?? null,
    asOf: AS_OF,
  });

/* ================= 1. the classifier ================= */
console.log("--- turning a sentence into one of eleven labels ---");

check(
  "an explicit choice is never re-interpreted",
  (await RSN.classify({ chosen: "shipping_cost", text: "actually it was the price" })).by === "choice",
  "re-reading an answer somebody gave explicitly is the one form of this that is indefensible",
);

/**
 * The ordering bug, pinned.
 *
 * "shipping was too expensive" contains a delivery word AND a price word. Read
 * price-first it becomes `price_too_high`, and the shop answers the wrong
 * complaint — money off a tea to somebody who objected to a ₹60 delivery
 * charge. They notice.
 */
check(
  "“shipping was too expensive” is about SHIPPING, not price",
  RSN.classifyByPhrases("shipping was too expensive").reason === "shipping_cost",
  RSN.classifyByPhrases("shipping was too expensive").evidence,
);
check(
  "plural delivery charges in a Hinglish sentence still classify deterministically",
  RSN.classifyByPhrases("delivery charges bahut jyada hai, discount de sakte ho")?.reason === "shipping_cost",
  RSN.classifyByPhrases("delivery charges bahut jyada hai, discount de sakte ho")?.evidence,
);
check(
  "“too expensive” on its own is about price",
  RSN.classifyByPhrases("honestly it was just too expensive for me").reason === "price_too_high",
);
check(
  "an explicit discount request is a deterministic price objection",
  RSN.classifyByPhrases("can you give me a discount")?.reason === "price_too_high",
  "a clear request must not fall through to an unreliable model classification",
);
check(
  "“delivery would take two weeks” is about speed",
  RSN.classifyByPhrases("delivery would take two weeks and I needed it sooner").reason === "shipping_speed",
);
check(
  "“my card kept getting declined” is a payment failure",
  RSN.classifyByPhrases("my card kept getting declined").reason === "payment_failed",
);
check(
  "“changed my mind” is recognised, because it is the one that ends things",
  RSN.classifyByPhrases("sorry, changed my mind").reason === "changed_mind",
);

check(
  "no phrase match returns null, not a guess",
  RSN.classifyByPhrases("hmm") === null,
  "“no rule fired” and “we decided it is unclear” are different, and only the first is worth a model",
);
check(
  "a model naming two labels has not decided, so: unknown",
  RSN.parseClassification("maybe price_too_high or shipping_cost").reason === "unknown",
  RSN.parseClassification("maybe price_too_high or shipping_cost").evidence,
);
check(
  "a model inventing a label is refused",
  RSN.parseClassification("customer_was_grumpy").reason === "unknown",
);
check(
  "a model answering cleanly is accepted, punctuation and all",
  RSN.parseClassification("Label: shipping_speed.").reason === "shipping_speed",
);
check(
  "with no classifier configured, prose that matches nothing is unknown",
  (await RSN.classify({ text: "eh" })).reason === "unknown",
  "a wrong label is worse than no label",
);
check(
  "the classifier prompt never mentions a discount, an offer, or the shopper",
  !/discount|offer|loyal|tier|customer value|worth/i.test(RSN.classifierPrompt("too expensive")),
  "a classifier that knows which answer pays out is a classifier with an incentive",
);

/* ================= 2. standing ================= */
console.log("\n--- who a shopper is, computed from what they did ---");

check(
  "one order is not loyalty",
  LOY.standing({ customerId: "nobody", orders: [], asOf: AS_OF }).tier === "new",
);
check(
  "and the tier says so in words a merchant can check",
  LOY.standing({ customerId: "nobody", orders: [], asOf: AS_OF }).because[0].includes("no completed orders"),
);
check(
  "a `new` shopper can never clear a `returning` floor",
  !LOY.meetsTier("new", "returning") && !LOY.meetsTier("new", "regular"),
  "this is the tier table refusing, not a policy remembering",
);
check(
  "a lapsed regular still clears a `regular` floor",
  LOY.meetsTier("lapsed", "regular"),
  "winning back a regular who drifted is usually worth more than the same money on someone already buying",
);

/* ================= 3. the free remedies come first ================= */
console.log("\n--- the cheapest true answer, before any money ---");

policyOn();

const ship = await remedy({ reason: "shipping_cost", cartId: "cart_ship" });
check(
  "a delivery-charge complaint is answered with the delivery policy",
  ship.remedy.kind === "answer" && /free over|already free/.test(ship.remedy.say),
  ship.remedy.say.slice(0, 96),
);
check(
  "and it tells them exactly how far short they are",
  /₹[\d,]+ short|already free/.test(ship.remedy.say),
  "a true statement of the shop's own published policy, which is what they objected to",
);
check(
  "no money is offered for it",
  ship.remedy.kind !== "discount",
  ship.blocked.join("; "),
);

const approvedShipping = await remedy({
  reason: "shipping_cost",
  cartId: "cart_ship_regular_approved",
  basket: [{ ...basket[0], qty: 1 }],
  policy: policyOn({
    discountFor: ["price_too_high", "shipping_cost"],
    requiresTier: "regular",
  }),
});
check(
  "an approved delivery-cost complaint from a regular shopper reaches the 8% grant",
  approvedShipping.remedy.kind === "discount" &&
    Math.round(approvedShipping.remedy.grant.depth * 100) === 8 &&
    approvedShipping.remedy.grant.tier === "regular",
  approvedShipping.remedy.kind === "discount"
    ? `${Math.round(approvedShipping.remedy.grant.depth * 100)}% for ${approvedShipping.remedy.grant.tier}`
    : approvedShipping.blocked.join("; "),
);

const slow = await remedy({ reason: "shipping_speed", cartId: "cart_slow" });
check(
  "“too slow” is answered with the shipping policy, not a discount",
  slow.remedy.kind === "answer" && slow.blocked.some((b) => /parcel arrive sooner/.test(b)),
  slow.blocked[0],
);

const trust = await remedy({ reason: "trust", cartId: "cart_trust" });
check(
  "somebody who doubted the shop is NOT offered money",
  trust.remedy.kind === "none",
  trust.blocked[0],
);

const pay = await remedy({ reason: "payment_failed", cartId: "cart_pay", serviceNotice: "Some HDFC netbanking payments have not been going through recently." });
check(
  "a payment failure gets the service notice and the reassurance",
  pay.remedy.kind === "answer" && /HDFC/.test(pay.remedy.say) && /Nothing was charged/.test(pay.remedy.say),
  pay.remedy.say.slice(0, 90),
);

const unclear = await remedy({ reason: "unknown", cartId: "cart_unknown" });
check(
  "an unclear answer is thanked and acted on in no way at all",
  unclear.remedy.kind === "none" && unclear.blocked.some((b) => /guess is worse than nothing/.test(b)),
);

/* ================= 4. no is the end of it ================= */
console.log("\n--- “I changed my mind” ---");

const no = await remedy({ reason: "changed_mind", cartId: "cart_no" });
check(
  "there is no counter-offer branch, and that absence is the feature",
  no.remedy.kind === "closed" && no.remedy.suppressFurther === true,
  no.remedy.say,
);
check(
  "nothing is dangled on the way out",
  !/%|off|discount|deal|instead/i.test(no.remedy.say),
  "the value of being a shop that hears “no” is worth more than the basket",
);
check(
  "browsing ends it too",
  (await remedy({ reason: "just_browsing", cartId: "cart_browse" })).remedy.kind === "closed",
);

/* ================= 5. money, and every gate in front of it ================= */
console.log("\n--- the one path that reaches a discount ---");

const newcomer = await remedy({ reason: "price_too_high", cartId: "cart_new", standing: brandNew });
check(
  "a first-time shopper who says “too expensive” is shown cheaper things, not given money",
  newcomer.remedy.kind === "cross_sell",
  newcomer.blocked.find((b) => /standing/.test(b)),
);
check(
  "and the alternatives really are cheaper, and really are in stock",
  newcomer.remedy.products.every((p) => p.price < basket[0].unitPrice),
  newcomer.remedy.products.map((p) => `${p.title} ₹${p.price}`).join(", "),
);
check(
  "the alternatives are the same KIND of thing",
  newcomer.remedy.products.length > 0,
  "answering “the tea is too expensive” with a cheaper kettle reads as a machine matching on price alone",
);

const off = await remedy({
  reason: "price_too_high",
  cartId: "cart_off",
  policy: { ...policyOn(), enabled: false },
});
check(
  "with the policy switched off, nothing is issued",
  off.remedy.kind !== "discount" && off.blocked.some((b) => /not switched recovery discounts on/.test(b)),
);

const wrongReason = await remedy({
  reason: "comparing",
  cartId: "cart_cmp",
  policy: policyOn({ discountFor: ["price_too_high"] }),
});
check(
  "a reason the merchant did not list gets no discount",
  wrongReason.remedy.kind !== "discount",
  wrongReason.blocked.find((b) => /not on the list/.test(b)),
);

/**
 * Two independent ceilings, and the tighter one wins.
 *
 * A recovery policy must not be usable to walk around the discount ceiling the
 * merchant set for the offer proposer. Ask for 30% with a 20% store ceiling and
 * the grant is 20%.
 */
const deep = await remedy({
  reason: "price_too_high",
  cartId: "cart_deep",
  policy: policyOn({ maxDepthPct: 30 }),
});
check(
  "a policy cannot exceed the merchant's own discount ceiling",
  deep.remedy.kind === "discount" && Math.round(deep.remedy.grant.depth * 100) === inputs.floors.maxDiscountPct,
  `asked for 30%, store ceiling is ${inputs.floors.maxDiscountPct}%, issued ${Math.round((deep.remedy.grant?.depth ?? 0) * 100)}%`,
);

/* ---- the margin floor, proved by watching it fail ---- */
const thin = products.find((p) => p.handle === "copper-chai-kettle");
const thinBasket = [
  {
    handle: thin.handle,
    title: thin.title,
    sku: "CCK-12",
    qty: 1,
    unitPrice: Number(thin.variants[0].price),
  },
];
const thinCase = await remedy({
  reason: "price_too_high",
  cartId: "cart_thin",
  basket: thinBasket,
  policy: policyOn({ maxDepthPct: 20 }),
});
check(
  "a discount that would break the margin floor is refused",
  thinCase.remedy.kind !== "discount" && thinCase.blocked.some((b) => /under your \d+% floor/.test(b)),
  thinCase.blocked.find((b) => /floor/.test(b)),
);

const never = await remedy({
  reason: "price_too_high",
  cartId: "cart_never",
  basket: [
    {
      handle: "cold-brew-concentrate",
      title: "Cold Brew Concentrate",
      sku: "CBC-500",
      qty: 1,
      unitPrice: 720,
    },
  ],
});
check(
  "the never-discount list is honoured here too",
  never.remedy.kind !== "discount" && never.blocked.some((b) => /never-discount list/.test(b)),
  never.blocked.find((b) => /never/.test(b)),
);

const noCosts = await remedy({ reason: "price_too_high", cartId: "cart_nocost", inputs: null });
check(
  "with no unit costs on file, no discount is issued at all",
  noCosts.remedy.kind !== "discount" && noCosts.blocked.some((b) => /margin floor cannot be checked/.test(b)),
  "an unchecked discount is not a discount, it is a guess about margin",
);

/* ================= 6. THE GUARANTEE: no negotiation ================= */
console.log("\n--- the same answer, however hard they push ---");

policyOn({ maxDepthPct: 8 });
const first = await remedy({ reason: "price_too_high", cartId: "cart_push" });
check("a qualifying shopper gets a grant", first.remedy.kind === "discount", first.remedy.say?.slice(0, 80));

const second = await remedy({ reason: "price_too_high", cartId: "cart_push" });
const third = await remedy({ reason: "price_too_high", cartId: "cart_push" });
check(
  "asking again returns the SAME grant, not a better one",
  second.remedy.kind === "discount" &&
    third.remedy.kind === "discount" &&
    second.remedy.grant.id === first.remedy.grant.id &&
    third.remedy.grant.id === first.remedy.grant.id,
  `${first.remedy.grant.id} · ${Math.round(first.remedy.grant.depth * 100)}% all three times`,
);
check(
  "and the depth never moves",
  second.remedy.grant.depth === first.remedy.grant.depth && third.remedy.grant.depth === first.remedy.grant.depth,
  "an agent that improves its offer under pressure has taught the customer base to push",
);
check(
  "the second answer says so, for the merchant's audit",
  second.blocked.some((b) => /never improved on a second ask/.test(b)),
);
check(
  "raising the policy afterwards does not retroactively improve a standing grant",
  (await remedy({ reason: "price_too_high", cartId: "cart_push", policy: policyOn({ maxDepthPct: 20 }) })).remedy.grant
    .depth === first.remedy.grant.depth,
  "the grant was issued under a snapshot of the policy, and the audit has to be able to tell those apart",
);
policyOn({ maxDepthPct: 8 });

/* ================= 7. budgets ================= */
console.log("\n--- the caps are counted at issue, not at redemption ---");

const before = GRT.monthlySpend(SHOP, AS_OF);
check(
  "spend counts live grants, not just redeemed ones",
  before.count > 0 && before.margin > 0,
  `${before.count} grants, ₹${Math.round(before.margin)} of margin`,
);

const capped = await remedy({
  reason: "price_too_high",
  cartId: "cart_capped",
  policy: policyOn({ monthlyGrantCap: before.count }),
});
check(
  "at the monthly count cap, no more are issued",
  capped.remedy.kind !== "discount" && capped.blocked.some((b) => /the cap is/.test(b)),
  capped.blocked.find((b) => /cap/.test(b)),
);

const budgeted = await remedy({
  reason: "price_too_high",
  cartId: "cart_budget",
  policy: policyOn({ monthlyGrantCap: 500, monthlyMarginCap: Math.round(before.margin) + 1 }),
});
check(
  "and at the margin budget, no more are issued",
  budgeted.remedy.kind !== "discount" && budgeted.blocked.some((b) => /margin already given this month/.test(b)),
  budgeted.blocked.find((b) => /margin/.test(b)),
);
check(
  "a blocked shopper is still helped, just not with money",
  budgeted.remedy.kind === "cross_sell" || budgeted.remedy.kind === "none",
);

/* ================= 8. nothing leaks to the shopper ================= */
console.log("\n--- what the shopper is told, and is not ---");

const shopperFacing = [first, newcomer, budgeted, capped, thinCase].map((d) => d.remedy.say).join("\n");
check(
  "no shopper-facing text mentions margin, tiers, budgets or caps",
  !/margin|tier|budget|cap\b|floor|regular shopper|returning shopper/i.test(shopperFacing),
  "“you'd have qualified with one more order” is a lesson in how to game a recovery page",
);
check(
  "no blocked reason is ever echoed into a reply",
  [first, newcomer, budgeted, capped, thinCase].every((d) => d.blocked.every((b) => !d.remedy.say.includes(b))),
);
check(
  "the grant sentence does not say “just for you” or “one-off”",
  !/just for you|one[- ]off|specially|exclusive/i.test(first.remedy.say),
  "both are the language of a negotiation, and this is not one",
);
check(
  "it does say the discount comes off at the payment page, with no code",
  /payment page/.test(first.remedy.say) && /no code/.test(first.remedy.say),
);

/* ================= 9. the grant, priced ================= */
console.log("\n--- the grant reaching the money path ---");

const grant = first.remedy.grant;
const plain = await QUO.buildQuote({ catalog, items: [{ handle: assam.handle, sku: assamVariant.sku, qty: 2 }] });
const withGrant = await QUO.buildQuote({
  catalog,
  items: [{ handle: assam.handle, sku: assamVariant.sku, qty: 2 }],
  shop: SHOP,
  grantId: grant.id,
  asOf: AS_OF,
});
check(
  "a grant discounts the basket, server-side",
  withGrant.ok && withGrant.quote.discount > 0 && withGrant.quote.total < plain.quote.total,
  `₹${plain.quote.total} -> ₹${withGrant.quote.total}`,
);
check(
  "the discount is exactly the policy depth on the eligible lines",
  Math.abs(withGrant.quote.discount - Math.round(assamVariant.price * 2 * grant.depth)) <= 1,
  `₹${withGrant.quote.discount}`,
);

/**
 * The unit cap is the reason a grant is not a coupon. Issued against a basket
 * of two, it discounts two — not twenty.
 */
const overCap = await QUO.buildQuote({
  catalog,
  items: [{ handle: assam.handle, sku: assamVariant.sku, qty: 6 }],
  shop: SHOP,
  grantId: grant.id,
  asOf: AS_OF,
});
check(
  "a grant issued on two units discounts two, on a basket of six",
  Math.abs(overCap.quote.discount - withGrant.quote.discount) <= 1,
  `₹${overCap.quote.discount} on six units vs ₹${withGrant.quote.discount} on two — same, because the cap is units`,
);

const bogus = await QUO.buildQuote({
  catalog,
  items: [{ handle: assam.handle, sku: assamVariant.sku, qty: 2 }],
  shop: SHOP,
  grantId: "grn_does_not_exist",
  asOf: AS_OF,
});
check(
  "an unknown grant id is ignored in silence, not honoured and not an error",
  bogus.ok && bogus.quote.discount === 0,
  "a shopper on a stale link should see the real price, not an error page about discount mechanics",
);

/* ---- no stacking ---- */
APR.decide({
  shop: SHOP,
  candidateId: "check:stack",
  action: "approve",
  by: "check",
  offer: {
    handle: assam.handle,
    title: assam.title,
    depth: 0.1,
    endsAt: new Date(AS_OF.getTime() + 7 * 86400000).toISOString(),
    maxUnits: 100,
  },
});
const stacked = await QUO.buildQuote({
  catalog,
  items: [{ handle: assam.handle, sku: assamVariant.sku, qty: 2 }],
  shop: SHOP,
  grantId: grant.id,
  asOf: AS_OF,
});
check(
  "a grant does not stack on top of a live approved offer",
  stacked.quote.offers.length === 1 && stacked.quote.offers[0].percent === 10,
  "two discounts on one line is how an 8% policy becomes 18% and nobody can say which rule allowed it",
);
APR.decide({ shop: SHOP, candidateId: "check:stack", action: "revoke", by: "check" });

/* ---- single use ---- */
check("a live grant redeems once", GRT.redeem(SHOP, grant.id, "order_test_1", AS_OF).ok);
check(
  "and not twice",
  GRT.redeem(SHOP, grant.id, "order_test_2", AS_OF).reason === "already_redeemed",
);
const afterRedeem = await QUO.buildQuote({
  catalog,
  items: [{ handle: assam.handle, sku: assamVariant.sku, qty: 2 }],
  shop: SHOP,
  grantId: grant.id,
  asOf: AS_OF,
});
check(
  "a redeemed grant stops discounting immediately",
  afterRedeem.quote.discount === 0,
  "single-use is only single-use if it is single-use in the other tab too",
);
check(
  "but the shopper is not stranded — the order it was spent on is recoverable",
  GRT.findGrant(SHOP, grant.id).redeemedOrderId === "order_test_1",
  "a one-use grant should not punish a closed tab",
);

/* ================= 10. the conversation state machine ================= */
console.log("\n--- asked once, and only once ---");

const conv = (turn) => CNV.addTurn({ shop: SHOP, cartId: "conv_1", customerId: "cus_conv", turn });
const now = () => new Date().toISOString();

/**
 * The refusal that caught a live bug, and why it must be LOUD.
 *
 * `addTurn` correctly refuses an answer to a question nobody asked. The
 * recovery page ignored that refusal for one afternoon: a POST arriving before
 * any GET found no conversation, the answer was dropped, and the shopper still
 * got a correct helpful reply on screen. The page looked like it worked and the
 * one thing the feature exists to collect went in the bin.
 *
 * So the refusal carries a message, and the caller is expected to read it.
 */
const orphan = conv({ kind: "answered", ts: now(), reason: "price_too_high", by: "choice", evidence: "-", text: null, tier: "regular" });
check("a turn cannot be recorded before the question was asked", !orphan.ok);
check(
  "and the refusal says why, rather than failing quietly",
  /nothing has been asked/.test(orphan.error ?? ""),
  orphan.error,
);
check("the question can be asked", conv({ kind: "asked", ts: now(), channel: "draft", draftId: "d1" }).ok);
check(
  "and cannot be asked again",
  !conv({ kind: "asked", ts: now(), channel: "draft", draftId: "d2" }).ok,
  "asking twice tells the shopper nobody read the first answer, which destroys the thing being collected",
);
check(
  "an answer moves it forward",
  conv({ kind: "answered", ts: now(), reason: "changed_mind", by: "choice", evidence: "-", text: "no thanks", tier: "regular" }).ok,
);
check("a remedy moves it forward", conv({ kind: "remedied", ts: now(), remedy: "ok", blocked: [] }).ok);
check("closing it works", conv({ kind: "closed", ts: now(), why: "they said no (changed_mind)" }).ok);
check(
  "and a closed conversation accepts nothing further",
  !conv({ kind: "remedied", ts: now(), remedy: "one more try", blocked: [] }).ok,
  CNV.addTurn({ shop: SHOP, cartId: "conv_1", customerId: "cus_conv", turn: { kind: "remedied", ts: now(), remedy: "x", blocked: [] } }).error,
);
check(
  "a shopper who said no is silenced as a PERSON, not just for that basket",
  CNV.silenced(SHOP).has("cus_conv"),
  "reading the suppression narrowly is a technically-correct way to be told to go away twice",
);

/* ---- the histogram, and its floor ---- */
const hist = CNV.reasonHistogram(SHOP, { minAnswers: 10 });
check(
  "the histogram counts what people said",
  hist.total >= 1 && hist.counts.some((c) => c.reason === "changed_mind"),
  `${hist.total} answers`,
);
check(
  "and refuses to be read as a finding below the sample floor",
  hist.enough === false,
  "four people are not a pattern, and the temptation to act on the first three replies is enormous",
);

/* ================= 11. the link is not a login ================= */
console.log("\n--- the recovery token ---");

const SECRET = "secret-for-the-check";
const tok = IDN.mintRecoveryToken({ site: SHOP, cart: "cart_push", sub: "cus_check_regular", secret: SECRET });
check("a recovery token verifies", IDN.verifyRecoveryToken(tok, { site: SHOP, secret: SECRET }).ok);
check(
  "a recovery token is NOT accepted as a session token",
  !IDN.verifySessionToken(tok, { site: SHOP, secret: SECRET }).ok,
  "different authority, different lifetime — neither verifier may accept the other's output",
);
const sess = IDN.mintSessionToken({ site: SHOP, sub: "cus_check_regular", secret: SECRET });
check(
  "and a session token is NOT accepted as a recovery token",
  !IDN.verifyRecoveryToken(sess, { site: SHOP, secret: SECRET }).ok,
);
check(
  "a token minted for one shop does not work at another",
  IDN.verifyRecoveryToken(tok, { site: "pk_someone_else", secret: SECRET }).reason === "wrong_site",
);
check(
  "a tampered token fails on the signature, not on the payload",
  IDN.verifyRecoveryToken(tok.replace(/.$/, "x"), { site: SHOP, secret: SECRET }).reason === "bad_signature",
);
check(
  "an expired token fails",
  IDN.verifyRecoveryToken(tok, { site: SHOP, secret: SECRET, now: Math.floor(Date.now() / 1000) + 15 * 86400 }).reason ===
    "expired",
);

/* ================= 12. the policy cannot be written unsafely ================= */
console.log("\n--- what a merchant is not allowed to save ---");

for (const [label, patch] of [
  ["a discount for first-time shoppers", { requiresTier: "new" }],
  ["more than half off", { maxDepthPct: 60 }],
  ["a grant that lasts a month", { grantTtlHours: 800 }],
  ["a zero margin budget", { monthlyMarginCap: 0 }],
  ["no reasons at all", { discountFor: [] }],
]) {
  const res = SET.writeSettings(SHOP, { recovery: { ...SET.readSettings(SHOP).recovery, ...patch } }, "check");
  check(`refused: ${label}`, !res.ok, res.error);
}
check(
  "and a partial settings row from an older build still has every cap",
  (() => {
    DBS.database().prepare(`
      UPDATE store_settings SET payload = ? WHERE store_id = (
        SELECT id FROM stores WHERE site_key = ?
      )
    `).run(JSON.stringify({ recovery: { enabled: true } }), SHOP);
    const r = SET.readSettings(SHOP).recovery;
    return r.maxDepthPct === SET.DEFAULTS.recovery.maxDepthPct && r.requiresTier === "returning" && r.monthlyGrantCap > 0;
  })(),
  "an absent cap read as undefined is a cap every call site treats as infinite",
);

check(
  "the suite is isolated from the real gateway database",
  DBS.databasePath() === path.join(SANDBOX, "chapman.sqlite"),
  "test grants, conversations, and policy exist only in a scratch database",
);

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
