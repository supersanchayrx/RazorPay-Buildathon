/**
 * Tier C — what the store says about itself to a model that cannot transact.
 *
 * WHY THIS SUITE IS DIFFERENT FROM THE OTHERS. Everywhere else in this codebase
 * the danger is that something breaks. Here the danger is that something WORKS
 * and is wrong: a JSON-LD block is injected into the merchant's own page, on the
 * merchant's own domain, and a model reads it as the store's word. Nothing 500s
 * when we publish a discounted price nobody will honour, or a brand the merchant
 * never claimed, or an "only 40 left" invented out of an internal budget. The
 * page renders and the lie travels.
 *
 * So most of what follows asserts about ABSENCE — that a number is not there,
 * that a key is omitted rather than nulled, that an internal field never
 * escapes. Those are the assertions that decay silently, which is exactly why
 * they are written down.
 *
 * The Go half of this tier — injection, content negotiation, passthrough — is
 * tested where it lives, in `demo-store/agentfront_test.go`, against a real
 * httptest server. Two languages, two suites, no mock of either.
 *
 * Run:  node scripts/check-tierc.mjs
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

const AV = await load("app/lib/agentview.server.ts", "agentview-check.mjs");
const AP = await load("app/lib/approvals.server.ts", "approvals-tierc.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const SITE = {
  key: "pk_tierc_test",
  name: "Test Teas",
  origins: ["https://shop.example", "https://www.shop.example"],
  catalogFeedUrl: "https://shop.example/catalog.json",
  productUrlTemplate: "/product.html?handle={handle}",
  greeting: "",
  accent: "#000",
  secret: "x",
};

/**
 * A product with a hostile description and a variant with no SKU.
 *
 * Both are things a real merchant feed can contain and both have bitten
 * somebody: a description that closes a script tag, and a variant that looks
 * buyable in markup and cannot be bought anywhere else in the system.
 */
const GREEN = {
  handle: "green-tea",
  title: "Green Tea",
  description: 'Bright and clean. </script><img src=x onerror="alert(1)">',
  productType: "Green Tea",
  vendor: "Test Estate",
  tags: ["tea", "green"],
  url: "/product.html?handle=green-tea",
  image: "/img/green.png",
  minPrice: "480",
  maxPrice: "1080",
  currency: "INR",
  totalInventory: 60,
  variants: [
    { title: "100 g", price: "480", currency: "INR", sku: "GT-100", availableForSale: true, inventoryQuantity: 42 },
    { title: "250 g", price: "1080", currency: "INR", sku: "GT-250", availableForSale: false, inventoryQuantity: 0 },
    { title: "sample", price: "0", currency: "INR", sku: null, availableForSale: true, inventoryQuantity: 5 },
  ],
};

/** Everything optional is missing. The "omit, never guess" rule lives or dies here. */
const BARE = {
  handle: "bare",
  title: "Bare Product",
  description: "",
  productType: null,
  vendor: null,
  tags: [],
  url: null,
  image: null,
  minPrice: "100",
  maxPrice: "100",
  currency: "INR",
  totalInventory: 3,
  variants: [
    { title: "one", price: "100", currency: "INR", sku: "BARE-1", availableForSale: true, inventoryQuantity: 3 },
  ],
};

const POLICIES = {
  returns: "Seven days, unopened.",
  shipping: "Dispatched in 2 working days.",
  cod: "Under 3000 INR.",
};

const CATALOG = {
  kind: "json-feed",
  async search() {
    return [GREEN, BARE];
  },
  async get(handle) {
    return [GREEN, BARE].find((p) => p.handle === handle) ?? null;
  },
  async complements() {
    return [];
  },
  async policies() {
    return POLICIES;
  },
};

// A live 10% offer on the green tea, written to the real ledger under a test
// shop key so `announceable` reads it the way production does. Testing against
// a stubbed offer source would test the stub.
const LEDGER = AP._file();
fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
const before = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8") : null;
const ENDS = new Date(Date.now() + 30 * 864e5).toISOString();
fs.appendFileSync(
  LEDGER,
  JSON.stringify({
    id: "d-tierc",
    shop: SITE.key,
    candidateId: "c-tierc",
    action: "approve",
    at: new Date().toISOString(),
    by: "check-tierc",
    offer: { handle: "green-tea", title: "Frost pick", depth: 0.1, endsAt: ENDS, maxUnits: 40 },
  }) + "\n",
);

const restore = () => {
  if (before === null) fs.rmSync(LEDGER, { force: true });
  else fs.writeFileSync(LEDGER, before, "utf8");
};

const view = (p, askedOrigin = "https://shop.example") =>
  AV.agentView({
    site: SITE,
    catalog: CATALOG,
    path: p,
    askedOrigin,
    gatewayBaseUrl: "https://gw.example",
  });

const ld = (v) => JSON.parse(v.jsonld.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));

try {
  /* ---------------------------------------------------------------- *
   * 1. Which page is this? — productUrlTemplate, run backwards
   * ---------------------------------------------------------------- */
  console.log("\nproductUrlTemplate, run backwards\n");

  const H = AV.handleFromPath;
  check("query-param template resolves", H("/product.html?handle={handle}", "/product.html?handle=green-tea") === "green-tea");
  check(
    "campaign tags do not break it",
    H("/product.html?handle={handle}", "/product.html?utm_source=x&handle=green-tea&utm_medium=y") === "green-tea",
    "the failure a prefix match would have had, and nobody would report it",
  );
  check(
    "path-segment template resolves",
    H("/products/{handle}", "/products/green-tea") === "green-tea",
    "the Shopify-shaped template, and the one that was silently resolving nothing",
  );
  check("wrapped values resolve", H("/p?id=sku-{handle}", "/p?id=sku-green-tea") === "green-tea");
  check("a different path is not a product page", H("/products/{handle}", "/about") === null);
  check("the bare template path is not a product page", H("/product.html?handle={handle}", "/product.html") === null);
  check(
    "a handle is one segment",
    H("/products/{handle}", "/products/a/b/c") === null,
    "otherwise the handle becomes 'a/b/c' and we look for a product that cannot exist",
  );
  check("percent-encoding is decoded", H("/products/{handle}", "/products/green%20tea") === "green tea");
  check("no template means no product pages", H(undefined, "/products/green-tea") === null);

  /* ---------------------------------------------------------------- *
   * 2. What we publish about a product
   * ---------------------------------------------------------------- */
  console.log("\nthe product page\n");

  const pv = await view("/product.html?handle=green-tea");
  const node = ld(pv);

  check("it is a Product node", pv.page === "product" && node["@type"] === "Product");
  check("URLs are absolute on the merchant's origin", node.url === "https://shop.example/product.html?handle=green-tea");
  check("the image is absolutised too", node.image === "https://shop.example/img/green.png");

  const offers = node.offers;
  check("one Offer per sellable variant", Array.isArray(offers) && offers.length === 2, `got ${offers?.length}`);
  check(
    "a variant with no SKU is not published",
    JSON.stringify(offers).includes("GT-100") && !JSON.stringify(offers).includes('"name":"sample"'),
    "every step that could act on one is keyed on the SKU",
  );
  check(
    "out of stock is stated, not hidden",
    offers[1].availability === "https://schema.org/OutOfStock",
  );

  /* -- the assertions that matter: what is NOT there -- */
  const flat = JSON.stringify(node);
  check(
    "the LIST price is published",
    offers[0].price === "480.00",
    "480 is a true fact about the variant",
  );
  check(
    "the DISCOUNTED price is not",
    !flat.includes("432"),
    "432 is what 10% off 480 would be — only buildQuote may say that, on the request that charges it",
  );
  check(
    "maxUnits never escapes",
    !Object.values(offers[0]).some((v) => v === 40) && !flat.includes('"maxUnits"') && !/\b40\b/.test(flat),
    "the merchant's exposure budget, not a fact about the product",
  );
  check(
    "the offer is present as terms",
    /10% off until \d{4}-\d{2}-\d{2}/.test(offers[0].description ?? ""),
    offers[0].description,
  );
  check(
    "the offer says there is no code",
    (offers[0].description ?? "").includes("automatically"),
    "silence here is what makes a model invent a coupon code",
  );

  /* -- absent means omitted -- */
  const bare = ld(await view("/product.html?handle=bare"));
  const keys = Object.keys(bare);
  check(
    "no vendor means no brand key",
    !keys.includes("brand"),
    "a null brand is a claim that the product has none",
  );
  check("no image means no image key", !keys.includes("image"));
  check("no tags means no keywords key", !keys.includes("keywords"));
  check("no description means no description key", !keys.includes("description"));
  check("a single variant is one Offer, not an array of one", bare.offers["@type"] === "Offer");

  /* -- injection safety -- */
  check(
    "a description cannot close the script tag",
    !pv.jsonld.slice(0, -9).includes("</script>") && pv.jsonld.includes("\\u003c/script"),
    "product copy comes from the merchant's feed and lands next to their session cookie",
  );
  check(
    "the escaped block still parses as the original text",
    node.description.includes("</script>"),
    "escaped for HTML, unchanged as data",
  );

  /* ---------------------------------------------------------------- *
   * 3. The other pages
   * ---------------------------------------------------------------- */
  console.log("\nthe rest of the store\n");

  const home = await view("/");
  const homeNodes = ld(home);
  check("the home page is Organization + ItemList", home.page === "home" && homeNodes.length === 2);
  check("the list carries every product", homeNodes[1].numberOfItems === 2);
  check("index.html is the home page too", (await view("/index.html")).page === "home");

  const other = await view("/about");
  check("an unknown page claims only the store", other.page === "other" && ld(other)["@type"] === "Organization");
  check(
    "a product path with no product does not publish an empty Product",
    (await view("/product.html?handle=does-not-exist")).page === "other",
  );

  check(
    "every page carries the ucp link",
    [pv, home, other].every((v) => v.head.includes('rel="ucp"') && v.link.includes('rel="ucp"')),
  );
  check(
    "the machine view names the endpoint that can actually transact",
    pv.json.ucp.endpoint === "https://gw.example/ucp/pk_tierc_test/mcp" &&
      pv.json.ucp.profile === "https://shop.example/.well-known/ucp",
  );
  check(
    "the machine view says where the real total comes from",
    /create_cart/.test(pv.json.notice) && /list prices/i.test(pv.json.notice),
    "a model that totals a catalogue page will be wrong the moment anything applies",
  );

  /* ---------------------------------------------------------------- *
   * 4. Whose origin?
   * ---------------------------------------------------------------- */
  console.log("\nthe origin is not taken on trust\n");

  const O = AV.storefrontOriginOf;
  check("a registered origin is honoured", O(SITE, "https://www.shop.example") === "https://www.shop.example");
  check(
    "an unregistered one is not",
    O(SITE, "https://evil.example") === "https://shop.example",
    "this mints markup that gets injected into the merchant's page",
  );
  check("garbage falls back", O(SITE, "not a url") === "https://shop.example");
  check("absent falls back", O(SITE, null) === "https://shop.example");

  const spoofed = await view("/product.html?handle=green-tea", "https://evil.example");
  check(
    "and a spoofed origin never reaches the document",
    !JSON.stringify(spoofed).includes("evil.example") &&
      JSON.stringify(spoofed).includes("shop.example"),
    "the guard is inside agentView, not in the caller — a caller-side guard is one the second caller forgets",
  );
  const spoofedTxt = await AV.llmsTxt({
    site: SITE,
    catalog: CATALOG,
    askedOrigin: "https://evil.example",
    gatewayBaseUrl: "https://gw.example",
  });
  check("nor into llms.txt", !spoofedTxt.includes("evil.example"));

  /* ---------------------------------------------------------------- *
   * 5. /llms.txt
   * ---------------------------------------------------------------- */
  console.log("\n/llms.txt\n");

  const txt = await AV.llmsTxt({
    site: SITE,
    catalog: CATALOG,
    askedOrigin: "https://shop.example",
    gatewayBaseUrl: "https://gw.example",
    tagline: "Tea, tested.",
  });

  check("it leads with the store", txt.startsWith("# Test Teas"));
  check("the tagline is quoted, not invented", txt.includes("> Tea, tested."));
  check("it says the store can be transacted with", /transactable by agents/i.test(txt));
  check("products are listed with list prices", txt.includes("INR 480") && txt.includes("[Green Tea]"));
  check("out of stock is said out loud", txt.includes("(out of stock)"));
  check("the offer is listed as terms", /10% off, until \d{4}-\d{2}-\d{2}/.test(txt));
  check(
    "and the model is told not to do the arithmetic",
    /Do not compute a discounted total/.test(txt),
    "the one instruction that stops a browsing model quoting a number nobody will honour",
  );
  check("no discounted number appears", !txt.includes("432"));
  check("maxUnits does not appear", !/\b40\b/.test(txt));
  check(
    "policies are the merchant's own words",
    txt.includes(POLICIES.returns) && txt.includes(POLICIES.shipping),
    "a returns policy summarised by a model is a promise the merchant never made",
  );
  check("the profile and endpoint are both given", txt.includes("/.well-known/ucp") && txt.includes("/ucp/pk_tierc_test/mcp"));
  check(
    "it tells the reader how to get JSON without setting a header",
    txt.includes("?format=json"),
    "a browsing model calls a fetch tool with a URL; it cannot send Accept",
  );
  check(
    "it says reads are open and money is not",
    /Reads are open/.test(txt) && /create_checkout/.test(txt),
  );

  /* ---------------------------------------------------------------- *
   * 6. An offer withdrawn stops being published
   * ---------------------------------------------------------------- */
  console.log("\nwithdrawal\n");

  fs.appendFileSync(
    LEDGER,
    JSON.stringify({
      id: "d-tierc-2",
      shop: SITE.key,
      candidateId: "c-tierc",
      action: "reject",
      at: new Date().toISOString(),
      by: "check-tierc",
    }) + "\n",
  );

  const after = await view("/product.html?handle=green-tea");
  const afterNode = ld(after);
  const afterOffers = Array.isArray(afterNode.offers) ? afterNode.offers : [afterNode.offers];
  check(
    "a rejected offer disappears from the product page",
    !afterOffers.some((o) => (o.description ?? "").includes("% off")),
    "read at render time, not cached at approval time",
  );
  const afterTxt = await AV.llmsTxt({
    site: SITE,
    catalog: CATALOG,
    askedOrigin: "https://shop.example",
    gatewayBaseUrl: "https://gw.example",
  });
  check("and from llms.txt", !afterTxt.includes("## Current offers"));
} finally {
  restore();
}

console.log(failed === 0 ? "\nAll Tier C checks passed.\n" : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
