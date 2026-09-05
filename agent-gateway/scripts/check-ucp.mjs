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

const U = await load("app/lib/ucp.server.ts", "ucp-check.mjs");
const T = await load("app/lib/ucptools.server.ts", "ucptools-check.mjs");
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

const doc = U.discoveryDocument(SITE, "http://127.0.0.1:3000");
check(
  "discovery names the version, transport and endpoint",
  doc.ucp.version === "2026-08-25" &&
    doc.ucp.services["dev.ucp.shopping"][0].transport === "mcp" &&
    doc.ucp.services["dev.ucp.shopping"][0].endpoint === "http://127.0.0.1:3000/ucp/pk_test/mcp",
);
check(
  "we do NOT advertise the discount capability",
  !("dev.ucp.shopping.discount" in doc.ucp.capabilities),
  "no approved-offer store exists yet, so claiming it would be a lie told in JSON",
);
check(
  "a store with Razorpay keys advertises a payment handler",
  Object.keys(doc.ucp.payment_handlers).includes("in.razorpay.checkout"),
);
check(
  "a store WITHOUT keys advertises none",
  Object.keys(U.discoveryDocument({ ...SITE, razorpay: undefined }, "http://x").ucp.payment_handlers).length === 0,
  "so an agent expects escalation instead of discovering it by failing at the last step",
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
