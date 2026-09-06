/**
 * The agent-readable front.
 *
 * An agent surface is more dangerous than a human one, and the reason is worth
 * stating before the assertions: a person notices when a price looks wrong, and
 * an agent does not. It reads a number, believes it, and tells the buyer. So
 * every check here is written from the position of a hostile or merely careless
 * caller, and asks what it could get away with.
 *
 * The four questions:
 *
 *   Can an agent make us charge the wrong amount?      (units, tampering, totals)
 *   Can an agent take something it should not?         (stock, other people's orders)
 *   Do we leak what a merchant would not publish?      (inventory counts, customers)
 *   Do we claim capabilities we do not have?           (discovery honesty)
 *
 * Run:  node scripts/check-ucp.mjs
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
const SANDBOX = path.join(REAL, "node_modules", ".cache", "ucp-sandbox");
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(path.join(SANDBOX, "data"), { recursive: true });
// Isolation used to rest on cwd alone. An inherited CHAPMAN_DATA_DIR would
// have walked straight past it and into the merchant's real data.
process.env.CHAPMAN_DATA_DIR = path.join(SANDBOX, "data");

const U = await load("app/lib/ucp.server.ts", "ucp-check.mjs");
const T = await load("app/lib/ucptools.ts", "ucptools-check.mjs");
const R = await load("app/lib/reservations.server.ts", "ucpresv-check.mjs");

process.chdir(SANDBOX);
const M = await load(path.join(REAL, "app/lib/ucpmethods.server.ts"), "ucpm-check.mjs");
process.chdir(REAL);

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/* ------------------------------------------------------------------ *
 * A stub catalogue, from the demo store's real feed
 * ------------------------------------------------------------------ */

const feed = JSON.parse(fs.readFileSync(path.join(REAL, "..", "demo-store", "catalog.json"), "utf8"));
const PRODUCTS = feed.products.map((p) => ({
  handle: p.handle,
  title: p.title,
  description: p.description,
  productType: p.type ?? null,
  vendor: p.vendor ?? null,
  tags: p.tags ?? [],
  url: `http://127.0.0.1:4000/product?h=${p.handle}`,
  image: p.image ?? null,
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

const catalog = {
  kind: "json-feed",
  async search(args = {}) {
    let out = [...PRODUCTS];
    if (args.query) {
      const q = args.query.toLowerCase();
      out = out.filter((p) => (p.title + " " + p.tags.join(" ")).toLowerCase().includes(q));
    }
    if (args.priceMin != null) out = out.filter((p) => Number(p.maxPrice) >= args.priceMin);
    if (args.priceMax != null) out = out.filter((p) => Number(p.minPrice) <= args.priceMax);
    if (args.inStockOnly) out = out.filter((p) => p.variants.some((v) => v.availableForSale));
    return out.slice(0, args.limit ?? 50);
  },
  async get(handle) {
    return PRODUCTS.find((p) => p.handle === handle) ?? null;
  },
  async complements() {
    return [];
  },
  async policies() {
    return { returns: "Unopened tins within 14 days.", shipping: "Free shipping over 1200." };
  },
};

const SITE = {
  key: "pk_test",
  name: "Nilgiri Post",
  origins: ["http://127.0.0.1:4000"],
  catalogFeedUrl: "http://127.0.0.1:4000/catalog.json",
  greeting: "",
  accent: "#1f4037",
  secret: "s",
  razorpay: { keyIdEnv: "K", keySecretEnv: "S", webhookSecretEnv: "W" },
};

const verified = { profile: "https://agent.example/.well-known/ucp", host: "agent.example", verified: true };
const ctx = (over = {}) => ({
  site: SITE,
  catalog,
  agent: verified,
  baseUrl: "http://127.0.0.1:3000",
  ...over,
});

/* ================= money ================= */

check("rupees convert to paise", U.toMinor(340, "INR") === 34000, "340 -> 34000");
check(
  "a zero-decimal currency is not multiplied by 100",
  U.toMinor(340, "JPY") === 340,
  "JPY has exponent 0 — assuming 2 would overcharge a hundredfold",
);
check(
  "an unknown currency is refused rather than assumed",
  (() => {
    try {
      U.toMinor(100, "XYZ");
      return false;
    } catch {
      return true;
    }
  })(),
  "guessing an exponent is a factor-of-100 error in a real charge",
);
check(
  "fractions round, never truncate",
  U.toMinor(340.005, "INR") === 34001 && U.toMinor(0.1 + 0.2, "INR") === 30,
  "truncating loses a paise per line and totals stop reconciling with Razorpay",
);

/* ================= identifiers ================= */

check(
  "our own gids parse",
  U.parseId("gid://chapman/Variant/MCB-100").kind === "variant" &&
    U.parseId("gid://chapman/Product/masala-chai-blend").kind === "product",
);
check(
  "a bare SKU is accepted, not rejected",
  U.parseId("MCB-100").kind === "unknown" && U.parseId("MCB-100").value === "MCB-100",
  "the spec permits secondary identifiers; refusing one costs a sale over pedantry",
);

/* ================= what we publish ================= */

const wire = U.toUcpProduct(PRODUCTS.find((p) => p.handle === "nilgiri-frost-green-tea"));
const wireText = JSON.stringify(wire);

check("a product maps to the UCP shape", wire.id && wire.title && wire.price_range && wire.variants.length > 0);
check(
  "prices are published in minor units",
  wire.variants[0].price.amount === 48000 && wire.variants[0].price.currency === "INR",
  "480 rupees -> 48000 paise",
);
check(
  "the exact inventory count is NOT published",
  !/\b"?inventor/i.test(wireText) && !wireText.includes("42"),
  "an on-hand count is merchant intelligence, and it is the raw material for \"only 3 left!\"",
);
check(
  "availability is published as a boolean and a status",
  wire.variants[0].availability.available === true && wire.variants[0].availability.status === "in_stock",
  "enough for an agent to decide; not enough to manufacture scarcity",
);
check(
  "a variant with no SKU is not published",
  (() => {
    const p = { ...PRODUCTS[0], variants: [{ ...PRODUCTS[0].variants[0], sku: null }] };
    return U.toUcpProduct(p).variants.length === 0;
  })(),
  "every downstream step is keyed on SKU, so it could be added to a cart and never bought",
);

/* ================= discovery honesty ================= */

// The profile is allowed to advertise checkout only when these names resolve.
// Set them for the discovery block, then remove them before the payment-method
// tests below so those can still exercise the unconfigured path.
process.env.K = "rzp_test_check";
process.env.S = "check-secret";
const doc = U.discoveryDocument(SITE, "http://127.0.0.1:3000");
check(
  "discovery names the version, transport and endpoint",
  doc.ucp.version === "2026-08-25" &&
    doc.ucp.services["dev.ucp.shopping"][0].transport === "mcp" &&
    doc.ucp.services["dev.ucp.shopping"][0].endpoint === "http://127.0.0.1:3000/ucp/pk_test/mcp",
);
check(
  "we DO advertise the discount capability, now that discounts exist",
  "dev.ucp.shopping.discount" in doc.ucp.capabilities,
  'this assertion used to be the opposite, noting "no approved-offer store exists yet" \u2014 the approval store shipped, so the lie would now be omitting it',
);
check(
  "...and declares itself an extension of the two things it extends",
  (() => {
    const e = doc.ucp.capabilities["dev.ucp.shopping.discount"]?.[0];
    return (
      Array.isArray(e?.extends) &&
      e.extends.includes("dev.ucp.shopping.cart") &&
      e.extends.includes("dev.ucp.shopping.checkout")
    );
  })(),
  "the profile schema: `extends` is present for extensions and absent for root capabilities",
);
check(
  "no spec or schema URL is invented for it",
  (() => {
    const e = doc.ucp.capabilities["dev.ucp.shopping.discount"]?.[0];
    return e && !("spec" in e) && !("schema" in e);
  })(),
  "both are optional and we host neither; a plausible URL that 404s is the same class of claim as a handler we cannot honour",
);
check(
  "a store with Razorpay keys advertises a payment handler",
  Object.keys(doc.ucp.payment_handlers).includes("in.razorpay.checkout"),
);
/* ---- the methods we advertise have to be ones the store can take ---- */
//
// This block exists because the opposite was shipped. `payment_methods` was
// hardcoded to ["upi", "card", "netbanking", "wallet"] for every store, and a
// probe on 2026-09-06 came back "UPI transactions are not enabled for the
// merchant" — UPI needs KYC. So the discovery document was promising a method
// the store could not take, to a caller whose only way to find out was to fail
// at the last step. Nothing in this file noticed, because nothing asked.

const handlerCfg = (site) =>
  U.discoveryDocument(site, "http://x").ucp.payment_handlers["in.razorpay.checkout"]?.[0]?.config ?? {};

check(
  "A STORE DOES NOT ADVERTISE UPI UNTIL IT SAYS IT HAS UPI",
  !handlerCfg(SITE).payment_methods.includes("upi"),
  "UPI needs KYC. Advertised falsely, an agent tells a buyer to pay by a method the checkout page will not offer",
);
check(
  "...and does advertise the methods that need no enablement",
  ["card", "netbanking", "wallet"].every((m) => handlerCfg(SITE).payment_methods.includes(m)),
  "the conservative default has to still be useful, or every store looks broken",
);
check(
  "a store that HAS cleared KYC advertises UPI",
  handlerCfg({ ...SITE, razorpay: { ...SITE.razorpay, methods: ["upi", "card"] } }).payment_methods.includes("upi"),
  "the fix must not be 'never say UPI' — that is the same error pointing the other way",
);
check(
  "buyer presence is required whatever the method",
  handlerCfg(SITE).requires_buyer_presence === true,
  "cards and netbanking go through Razorpay's hosted page too; no method here is completable by an agent holding a token",
);

check(
  "a store WITHOUT keys advertises none",
  Object.keys(U.discoveryDocument({ ...SITE, razorpay: undefined }, "http://x").ucp.payment_handlers).length === 0,
  "so an agent expects escalation instead of discovering it by failing at the last step",
);
delete process.env.K;
delete process.env.S;
check(
  "a store with variable names but missing values also advertises none",
  Object.keys(U.discoveryDocument(SITE, "http://x").ucp.payment_handlers).length === 0,
  "a reference in config is not a working credential",
);
check(
  "every advertised capability has a method behind it",
  Object.keys(U.capabilities()).every((cap) => {
    const need = {
      "dev.ucp.shopping.cart": ["create_cart", "get_cart", "update_cart", "cancel_cart"],
      "dev.ucp.shopping.checkout": ["create_checkout", "get_checkout", "complete_checkout", "cancel_checkout"],
      "dev.ucp.shopping.order": ["get_order"],
      "dev.ucp.shopping.catalog.search": ["search_catalog"],
      "dev.ucp.shopping.catalog.lookup": ["lookup_catalog", "get_product"],
      // An extension is honoured by FIELDS, not by a method: `discount_codes`
      // in, `items_discount` out. There is no method to point at, and asking
      // for one would be asking the wrong question of an extension.
      "dev.ucp.shopping.discount": [],
    }[cap];
    return need && need.every((m) => typeof M.METHODS[m] === "function");
  }),
);
check(
  "all thirteen Shopping methods are implemented",
  [
    "create_checkout", "get_checkout", "update_checkout", "complete_checkout", "cancel_checkout",
    "create_cart", "get_cart", "update_cart", "cancel_cart",
    "search_catalog", "lookup_catalog", "get_order", "get_product",
  ].every((m) => typeof M.METHODS[m] === "function"),
  `${Object.keys(M.METHODS).length} registered`,
);
check(
  "every method is described as a tool, and every tool has a method",
  T.TOOLS.length === Object.keys(M.METHODS).length &&
    T.TOOLS.every((t) => M.METHODS[t.name]) &&
    Object.keys(M.METHODS).every((m) => T.TOOLS.some((t) => t.name === m)),
  "a tool with no method fails mid-purchase; a method with no tool is unreachable",
);
check(
  "every priced tool restates the minor-units rule",
  T.TOOLS.filter((t) => /catalog|cart|checkout|order/.test(t.name))
    .filter((t) => !/cancel_c|update_checkout/.test(t.name))
    .every((t) => t.description.includes("minor units")),
  "a model may only ever see one description; a note elsewhere is a note it will not have",
);
check(
  "every tool requires an agent profile in its schema",
  T.TOOLS.every((t) => t.inputSchema.properties.meta.required.includes("ucp-agent")),
);

/* ================= catalogue methods ================= */

const search = await M.search_catalog(ctx(), { catalog: { query: "chai", pagination: { limit: 2 } } });
check("search returns products", Array.isArray(search.products) && search.products.length > 0);
check("search paginates", search.products.length <= 2 && typeof search.pagination.has_next_page === "boolean");
check(
  "a price filter is compared in the units it arrived in",
  (await M.search_catalog(ctx(), { catalog: { filters: { price: { max: 50000 } } } })).products.every(
    (p) => p.price_range.min.amount <= 50000,
  ),
  "500 rupees sent as 50000 paise; comparing raw would return everything",
);
check(
  "search works WITHOUT an agent profile",
  (await M.search_catalog(ctx({ agent: null }), { catalog: {} })).products.length > 0,
  "a catalogue is public; refusing to answer protects nothing and makes the store invisible",
);

const lookup = await M.lookup_catalog(ctx(), { catalog: { ids: ["MCB-100", "NOPE-999"] } });
check(
  "lookup correlates each id to the variant it resolved to",
  lookup.products[0].variants.some((v) => v.inputs?.[0]?.id === "MCB-100" && v.inputs[0].match === "exact"),
  "required by the schema — without it an agent cannot tell which of ten ids failed",
);
check(
  "an id that matched nothing is REPORTED, not silently dropped",
  lookup.messages?.some((m) => m.content.includes("NOPE-999")),
  "a short array is otherwise indistinguishable from a typo in the agent's own request",
);
check(
  "get_product resolves a bare SKU as well as a handle",
  (await M.get_product(ctx(), { catalog: { id: "MCB-100" } })).product?.handle === "masala-chai-blend" &&
    (await M.get_product(ctx(), { catalog: { id: "masala-chai-blend" } })).product?.handle === "masala-chai-blend",
);
check(
  "an unknown product is an unrecoverable error, not an empty result",
  (await M.get_product(ctx(), { catalog: { id: "ghost" } })).messages[0].severity === "unrecoverable",
  "recoverable would have the agent retry the same doomed request",
);

/* ================= carts ================= */

M._resetCarts();
R._reset();

const cart = await M.create_cart(ctx(), {
  cart: { line_items: [{ item: { id: "MCB-100" }, quantity: 2 }] },
});
check("a cart prices from the catalogue", cart.line_items.length === 1 && cart.totals.length >= 2);
check(
  "totals carry exactly one subtotal and exactly one total",
  cart.totals.filter((t) => t.type === "subtotal").length === 1 &&
    cart.totals.filter((t) => t.type === "total").length === 1,
  "schema-enforced; a breakdown that does not add up has an agent quoting a wrong figure",
);
check(
  "the total equals the sum of its parts",
  cart.totals.find((t) => t.type === "total").amount ===
    cart.totals.filter((t) => t.type !== "total").reduce((s, t) => s + t.amount, 0),
);

const tampered = await M.create_cart(ctx(), {
  cart: {
    line_items: [{ item: { id: "MCB-100", price: { amount: 1, currency: "INR" } }, quantity: 2 }],
  },
});
check(
  "A PRICE SENT BY THE AGENT IS IGNORED",
  tampered.totals.find((t) => t.type === "total").amount ===
    cart.totals.find((t) => t.type === "total").amount,
  "the agent said 1 paise; the catalogue said 340 rupees, twice — and the catalogue is the only authority",
);

check(
  "A CART HOLDS NO STOCK",
  R.committed("pk_test").size === 0,
  "an agent comparing five shops must not be able to freeze inventory at all five",
);

const updated = await M.update_cart(ctx(), {
  id: cart.id,
  cart: { line_items: [{ item: { id: "MCB-100" }, quantity: 1 }] },
});
check(
  "update REPLACES the basket rather than merging into it",
  updated.line_items.length === 1 && updated.line_items[0].quantity === 1,
  "merging would make the result depend on what the agent believed was already there",
);
check(
  "a cancelled cart is gone",
  (await M.cancel_cart(ctx(), { id: cart.id })).id === cart.id &&
    (await M.get_cart(ctx(), { id: cart.id })).messages[0].code === "not_found",
);
check(
  "another store cannot read this store's cart",
  (await M.get_cart(ctx({ site: { ...SITE, key: "pk_other" } }), { id: updated.id })).messages[0].code ===
    "not_found",
);
const ghost = await M.create_cart(ctx(), {
  cart: { line_items: [{ item: { id: "ghost" }, quantity: 1 }] },
});
check(
  "an unbuyable line comes back as a message",
  ghost.messages?.length > 0 && ghost.messages[0].code === "not_found",
);
check(
  "...and that cart still satisfies its own schema",
  ghost.totals.filter((t) => t.type === "subtotal").length === 1 &&
    ghost.totals.filter((t) => t.type === "total").length === 1,
  "a malformed error response is one the agent cannot read the errors out of",
);

const fractional = await M.create_cart(ctx(), {
  cart: { line_items: [{ item: { id: "MCB-100" }, quantity: 1.5 }] },
});
check(
  "a fractional quantity is refused, not rounded",
  fractional.messages?.length > 0 && fractional.line_items.length === 0,
  "rounding 1.5 to 1 silently reinterprets the request and hides a probe equally well",
);

/* ================= checkout guards ================= */

const anon = await M.create_checkout(ctx({ agent: null }), {
  checkout: { line_items: [{ item: { id: "MCB-100" }, quantity: 1 }] },
});
check(
  "CHECKOUT IS REFUSED WITHOUT A REACHABLE AGENT PROFILE",
  anon.messages[0].code === "identity_required",
  "reads may be anonymous; holding stock and opening a payment may not",
);

const unreachable = await M.create_checkout(
  ctx({ agent: { profile: "https://x.example/ucp", host: "x.example", verified: false, reason: "404" } }),
  { checkout: { line_items: [{ item: { id: "MCB-100" }, quantity: 1 }] } },
);
check(
  "a profile that does not resolve is not a profile",
  unreachable.messages[0].code === "identity_required",
  "claiming an identity and having one are different things",
);

const noPay = await M.create_checkout(ctx({ site: { ...SITE, razorpay: undefined } }), {
  checkout: { line_items: [{ item: { id: "MCB-100" }, quantity: 1 }] },
});
check(
  "a store without payment keys refuses rather than half-starting",
  noPay.messages[0].code === "payment_unavailable",
);
check(
  "no stock was held by any refused checkout",
  R.committed("pk_test").size === 0,
  "a refusal that still reserved units would let anyone empty the shelf for free",
);

check(
  "an unknown checkout is not found, in every method that takes one",
  (await M.get_checkout(ctx(), { id: "chk_nope" })).messages[0].code === "not_found" &&
    (await M.complete_checkout(ctx(), { id: "chk_nope", checkout: {} })).messages[0].code === "not_found" &&
    (await M.cancel_checkout(ctx(), { id: "chk_nope" })).messages[0].code === "not_found",
);
check(
  "completing requires a profile too, not just creating",
  (await M.complete_checkout(ctx({ agent: null }), { id: "chk_x", checkout: {} })).messages[0].code ===
    "identity_required",
  "otherwise the identity gate is one call wide",
);

/* ================= orders ================= */

check(
  "an order this endpoint never placed is not readable",
  (await M.get_order(ctx(), { id: "ord_syn_00002" })).messages[0].code === "not_found",
  "that is a real order in the merchant's own history — reaching it needs the BUYER's sign-in, not an agent's URL",
);
check(
  "get_order requires an id",
  (await M.get_order(ctx(), {})).messages[0].code === "invalid_request",
);

/* ================= offers, on the agent surface ================= *
 *
 * THIS SECTION EXISTS BECAUSE OF A BUG THE REST OF THIS FILE DID NOT CATCH.
 *
 * `cartResponse` called `buildQuote` without `shop`. The intent was right \u2014 a
 * cart holds no stock, so it should not subtract stock held for other shoppers
 * \u2014 but `shop` was also what switched approved offers on. So an agent's cart
 * quoted full price while `create_checkout`, on the same basket, charged the
 * discounted total.
 *
 * Every check above asks "can an agent make us charge the wrong amount?", and
 * every one of them passed, because none asked whether the two priced surfaces
 * agree WITH EACH OTHER. A number can be individually defensible on both sides
 * of a disagreement. That is the gap being closed here.
 */

process.chdir(SANDBOX);
const A = await load(path.join(REAL, "app/lib/approvals.server.ts"), "appr-ucp.mjs");
const G = await load(path.join(REAL, "app/lib/grants.server.ts"), "grants-ucp.mjs");
const Q = await load(path.join(REAL, "app/lib/quote.server.ts"), "quote-ucp.mjs");
process.chdir(REAL);

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const HANDLE = "masala-chai-blend";
const POLICIES = await catalog.policies();
const BASKET = [{ handle: HANDLE, qty: 2 }];

A.decide({
  shop: "pk_test",
  candidateId: "cand_ucp_offer",
  action: "approve",
  by: "merchant@nilgiripost.test",
  offer: { handle: HANDLE, title: "Masala Chai Blend", depth: 0.1, endsAt: iso(7), maxUnits: 50 },
});

const onOffer = await M.get_product(ctx(), { catalog: { id: HANDLE } });
const ext = onOffer.product["dev.ucp.shopping.discount"];

check(
  "a product on offer says so",
  ext?.promotions?.[0]?.value === 10 && ext.promotions[0].type === "percentage",
  "an agent that only reads the catalogue still learns the offer exists",
);
check(
  "...as TERMS, with no amount and no discounted price",
  !/amount|discounted_price|was_price/i.test(JSON.stringify(ext)),
  "a product carries no basket; handing an agent a figure here is how it quotes a total nobody computed",
);
check(
  "...and the merchant's exposure cap is NOT published",
  // Asserted STRUCTURALLY, not by substring. The first version of this check
  // looked for the string "50" and passed for a week by luck: the offer's end
  // date is an ISO timestamp, and a run at 14:50 puts "50" in the payload with
  // nothing wrong. A check that depends on the clock is a check that will one
  // day fail loudly for no reason, and — far worse — passed quietly for the
  // wrong one.
  Object.values(ext.promotions[0]).every((v) => v !== 50) &&
    !Object.keys(ext.promotions[0]).some((k) => /max|cap|units|budget/i.test(k)),
  'maxUnits is the merchant budget, and published it becomes "only 50 left at this price"',
);
check(
  "a product with no offer carries no promotions key at all",
  !("dev.ucp.shopping.discount" in (await M.get_product(ctx(), { catalog: { id: "copper-chai-kettle" } })).product),
  'an empty array reads as "we checked, there are none", which invites a model to say it out loud',
);

const promos = await M.get_promotions(ctx(), {});
check("get_promotions lists the live offer", promos.promotions.length === 1 && promos.promotions[0].value === 10);
check(
  "get_promotions says the offer needs no code",
  /automatic|no code/i.test(JSON.stringify(promos)) && promos.promotions[0].automatic === true,
  "otherwise a model invents a code field and tells a buyer to enter one",
);

/* ---- the regression: cart and checkout must agree ---- */

const offerCart = await M.create_cart(ctx(), { cart: { line_items: [{ item: { id: HANDLE }, quantity: 2 }] } });
const cartTotal = offerCart.totals.find((t) => t.type === "total").amount;
const cartDiscount = offerCart.totals.find((t) => t.type === "items_discount");

// Exactly what create_checkout prices with: same function, same arguments.
const authoritative = await Q.buildQuote({ catalog, items: BASKET, policies: POLICIES, shop: "pk_test" });

check(
  "AN AGENT'S CART SHOWS THE APPROVED OFFER",
  cartDiscount !== undefined && cartDiscount.amount < 0,
  "the bug: no discount line at all, because `shop` was omitted to skip reservations and took `activeOffers` with it",
);
check(
  "THE CART TOTAL EQUALS WHAT CHECKOUT WILL CHARGE",
  cartTotal === U.toMinor(authoritative.quote.total, "INR"),
  `cart ${cartTotal} vs checkout ${U.toMinor(authoritative.quote.total, "INR")} \u2014 the two surfaces disagreeing IS the failure`,
);
check(
  "the discounted total still adds up",
  cartTotal === offerCart.totals.filter((t) => t.type !== "total").reduce((s, t) => s + t.amount, 0),
  "a breakdown that does not reconcile has an agent quoting one number and a buyer paying another",
);
check(
  "a cart STILL holds no stock, offer or not",
  R.committed("pk_test").size === 0,
  "the fix passes `shop` for offers; it must not have quietly turned carts into reservations",
);

/* ---- recovery grants: redeemable by an agent, not discoverable ---- */

const { grant } = G.issue({
  shop: "pk_test",
  cartId: "cart_abandoned_1",
  customerId: "cus_1",
  handle: "single-estate-assam-ctc",
  title: "Single Estate Assam CTC",
  depth: 0.08,
  qtyCap: 2,
  marginCost: 40,
  reason: "price_too_high",
  tier: "returning",
  expiresAt: iso(2),
  under: { maxDepthPct: 10, requiresTier: "returning" },
});

check(
  "a grant is NOT listed by get_promotions",
  !JSON.stringify(await M.get_promotions(ctx(), {})).includes(grant.id),
  "a grant is bound to one basket and one customer; listing it turns a private remedy into a coupon feed",
);

const redeemed = await M.create_cart(ctx(), {
  cart: {
    line_items: [{ item: { id: "single-estate-assam-ctc" }, quantity: 2 }],
    discount_codes: [grant.id],
  },
});
check(
  "an agent can redeem a grant the buyer was given",
  redeemed.totals.some((t) => t.type === "items_discount" && t.amount < 0),
);

const bogus = await M.create_cart(ctx(), {
  cart: { line_items: [{ item: { id: HANDLE }, quantity: 2 }], discount_codes: ["grn_madeup"] },
});
check(
  "an unrecognised code is IGNORED, and the basket still prices",
  bogus.totals.find((t) => t.type === "total").amount > 0 &&
    bogus.messages?.some((m) => m.severity === "recoverable"),
  "refusing would have an agent abandon a good basket over a stale string from an old email",
);
check(
  "a made-up code buys nothing",
  bogus.totals.find((t) => t.type === "total").amount === cartTotal,
  "identical to the same basket with no code at all",
);

const stacked = await M.create_cart(ctx(), {
  cart: {
    line_items: [{ item: { id: "single-estate-assam-ctc" }, quantity: 2 }],
    discount_codes: [grant.id, grant.id, "grn_other"],
  },
});
check(
  "codes do not stack",
  stacked.totals.filter((t) => t.type === "items_discount").length === 1,
  "five codes that all landed would turn an 8% policy into 40% with no rule to point at",
);

check(
  "an agent cannot send terms, only an id",
  !/depth|percent_off|discount_amount|discount_value/i.test(
    JSON.stringify(T.TOOLS.find((x) => x.name === "create_cart")),
  ),
  "a caller that could pass a depth is a caller that could pass 90%",
);

/* ================= agent identity ================= */

U._resetAgentCache();
check(
  "a non-URL profile is refused",
  (await U.resolveAgent({ "ucp-agent": { profile: "not a url" } })).verified === false,
);
check(
  "a file:// profile is refused",
  (await U.resolveAgent({ "ucp-agent": { profile: "file:///etc/passwd" } })).verified === false,
  "otherwise we read our own disk on a stranger's instruction",
);
check("no profile at all resolves to null", (await U.resolveAgent({})) === null);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
