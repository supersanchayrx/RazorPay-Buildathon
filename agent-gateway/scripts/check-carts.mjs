/**
 * Live basket capture — the wire between a real storefront and the recovery loop.
 *
 * Until this existed, every abandoned basket came out of `npm run seed`. A
 * capture endpoint is a cheerful little feature and it has three ways to be a
 * security hole, all of which look fine in a demo:
 *
 *   1. Trusting a price from the page, so a basket can be inflated into a
 *      recovery target worth chasing by editing a JavaScript object.
 *   2. Trusting a phone number from the page, so anyone can aim the shop's
 *      outbound calls at a stranger's handset.
 *   3. Trusting an identity the page merely asserts.
 *
 * So the suite is mostly adversarial. It also pins the boring-but-fatal one:
 * live baskets must not live in `carts.jsonl`, because `npm run seed` rewrites
 * that file and the loss would be intermittent and only ever in the direction
 * that makes a demo look fine.
 *
 * Run:  node scripts/check-carts.mjs
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

const SANDBOX = path.join(process.cwd(), "node_modules", ".cache", "carts-sandbox");
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(SANDBOX, { recursive: true });
process.env.CHAPMAN_DATA_DIR = SANDBOX;
process.env.CHAPMAN_DATABASE_PATH = path.join(SANDBOX, "chapman.sqlite");

const DBS = await load("app/lib/database.server.ts", "carts-db-check.mjs");
const CRT = await load("app/lib/carts.server.ts", "crt-check.mjs");
const ORD = await load("app/lib/orders.server.ts", "orders-cart-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const SHOP = "pk_cartcheck_dev";
const OTHER = "pk_cartcheck_other";

DBS.writeStoreDocument(SHOP, "seed.orders", [{
  id: "ord_fixture_contact",
  shop: SHOP,
  synthetic: true,
  customer: { id: "cus_seeded_test", phone: "+919810000001", email: "seeded@example.invalid" },
}], "check");
check(
  "only a customer present in the synthetic merchant seed resolves to a contact",
  ORD.seededContact(SHOP, "cus_seeded_test").phone === "+919810000001" &&
    ORD.seededContact(SHOP, "cus_not_seeded").phone === null,
  "an arbitrary pseudonymous login has no channel and cannot be called",
);

/** A catalogue with two products and prices only IT knows. */
const catalog = {
  kind: "json-feed",
  search: async () => [],
  complements: async () => [],
  policies: async () => ({ returns: null, shipping: null, cod: null }),
  get: async (handle) => {
    const rows = {
      "masala-chai-blend": { title: "Masala Chai Blend", price: "340", sku: "MCB-100" },
      "copper-chai-kettle": { title: "Copper Chai Kettle", price: "2450", sku: "CCK-12" },
    };
    const r = rows[handle];
    if (!r) return null;
    return {
      handle,
      title: r.title,
      description: "",
      productType: null,
      vendor: null,
      tags: [],
      url: null,
      image: null,
      minPrice: r.price,
      maxPrice: r.price,
      currency: "INR",
      totalInventory: 10,
      variants: [
        { title: "Default", price: r.price, currency: "INR", sku: r.sku, availableForSale: true, inventoryQuantity: 10 },
      ],
    };
  },
};

/* ------------------------------------------------------------------ *
 * The client sends WHAT. The server decides everything else.
 * ------------------------------------------------------------------ */

console.log("\n— what the browser may not decide —");

const tampered = await CRT.captureCart({
  shop: SHOP,
  clientRef: "ref-a",
  // Everything a hostile page would try, in one payload.
  lines: [
    { handle: "copper-chai-kettle", sku: "CCK-12", qty: 1, unitPrice: 1, lineTotal: 1, title: "Free Kettle" },
  ],
  catalog,
  unitCosts: { "CCK-12": 2050 },
});

check("a basket is captured", tampered.ok);
check(
  "A PRICE SENT BY THE PAGE IS IGNORED",
  tampered.cart.lines[0].unitPrice === 2450 && tampered.cart.subtotal === 2450,
  "the page said 1; the catalogue said 2450, and the catalogue is the only authority",
);
check(
  "a title sent by the page is ignored too",
  tampered.cart.lines[0].title === "Copper Chai Kettle",
  "otherwise the recovery message names a product that does not exist",
);
check(
  "unit cost is attached from the merchant's own inputs, keyed by SKU",
  tampered.cart.lines[0].unitCost === 2050,
  "without it a basket has a value but no margin, and the merchant's floor cannot be applied",
);

const anon = await CRT.captureCart({ shop: SHOP, clientRef: "ref-anon", lines: [{ handle: "masala-chai-blend", qty: 1 }], catalog });
check(
  "an unauthenticated capture carries NO customer at all",
  !anon.cart.customer,
  "recovery will suppress it as no_channel and say so, which is the right outcome rather than a gap",
);

const spoofed = await CRT.captureCart({
  shop: SHOP,
  clientRef: "ref-spoof",
  lines: [{ handle: "masala-chai-blend", qty: 1 }],
  catalog,
  // No verified sub, but contact supplied anyway — as a compromised page would.
  contact: { phone: "+919999999999", email: "victim@example.invalid" },
});
check(
  "CONTACT WITHOUT A VERIFIED IDENTITY IS DISCARDED",
  !spoofed.cart.customer,
  "a page that could name a phone number could name anybody's, and the shop would ring them",
);

const identified = await CRT.captureCart({
  shop: SHOP,
  clientRef: "ref-known",
  lines: [{ handle: "masala-chai-blend", qty: 2 }],
  catalog,
  sub: "cus_cartcheck_1",
  contact: { phone: "+919810000001", email: "known@example.invalid" },
});
check(
  "a verified shopper's basket carries contact resolved server-side",
  identified.cart.customer?.id === "cus_cartcheck_1" && identified.cart.customer?.phone === "+919810000001",
);

/* ------------------------------------------------------------------ *
 * Quantities
 * ------------------------------------------------------------------ */

console.log("\n— quantities —");

const fractional = await CRT.captureCart({
  shop: SHOP,
  clientRef: "ref-frac",
  lines: [{ handle: "masala-chai-blend", qty: 1.5 }],
  catalog,
});
check(
  "a fractional quantity is refused, not floored",
  fractional.cart.lines.length === 0,
  "silently turning 1.5 into 1 reinterprets the request — the bug buildQuote already had once",
);

const absurd = await CRT.captureCart({ shop: SHOP, clientRef: "ref-big", lines: [{ handle: "masala-chai-blend", qty: 100000 }], catalog });
check("an absurd quantity is refused", absurd.cart.lines.length === 0);

const unknown = await CRT.captureCart({ shop: SHOP, clientRef: "ref-unknown", lines: [{ handle: "not-a-product", qty: 1 }], catalog });
check(
  "a line for a product that does not exist is dropped, not invented",
  unknown.cart.lines.length === 0,
);

/* ------------------------------------------------------------------ *
 * Folding
 * ------------------------------------------------------------------ */

console.log("\n— the append-only log, folded at read —");

await CRT.captureCart({ shop: SHOP, clientRef: "ref-a", lines: [{ handle: "masala-chai-blend", qty: 3 }], catalog });
const folded = CRT.liveCarts(SHOP).find((c) => c.id === CRT.cartId(SHOP, "ref-a"));
check(
  "the latest state of a basket wins",
  folded.lines.length === 1 && folded.lines[0].handle === "masala-chai-blend" && folded.lines[0].qty === 3,
  "a shopper who swapped a kettle for tea has one basket, not two",
);

await CRT.captureCart({ shop: SHOP, clientRef: "ref-a", lines: [], catalog });
check(
  "an emptied basket is not an abandoned one",
  !CRT.liveCarts(SHOP).some((c) => c.id === CRT.cartId(SHOP, "ref-a")),
  "clearing a cart is a decision; there is nothing to remind them of",
);

/* ------------------------------------------------------------------ *
 * Isolation
 * ------------------------------------------------------------------ */

console.log("\n— isolation —");

check(
  "the same browser handle at two shops is two different baskets",
  CRT.cartId(SHOP, "ref-x") !== CRT.cartId(OTHER, "ref-x"),
  "hashed with the site key, so shops cannot collide and the stored id is not a value the page can also read",
);

await CRT.captureCart({ shop: OTHER, clientRef: "ref-other", lines: [{ handle: "masala-chai-blend", qty: 1 }], catalog });
check(
  "one shop cannot read another's live baskets",
  !CRT.liveCarts(SHOP).some((c) => c.shop !== SHOP) && CRT.liveCarts(OTHER).length === 1,
);

/* ------------------------------------------------------------------ *
 * Bought
 * ------------------------------------------------------------------ */

console.log("\n— once it is bought —");

CRT.markRecovered(SHOP, "ref-known");
const done = CRT.liveCarts(SHOP).find((c) => c.id === CRT.cartId(SHOP, "ref-known"));
check(
  "a settled basket is marked recovered",
  done.recovered === true,
  "chasing somebody for something already in their hallway is the most embarrassing thing this system can do",
);
check(
  "...and the record that it WAS abandoned survives",
  CRT.cartHistory(SHOP, CRT.cartId(SHOP, "ref-known")).length > 1,
  "appended, not edited — a row that looks like it was never abandoned loses the fact worth keeping",
);
check("marking an unknown basket changes nothing", CRT.markRecovered(SHOP, "never-seen") === false);

/* ------------------------------------------------------------------ *
 * The boring, fatal one
 * ------------------------------------------------------------------ */

console.log("\n— survival —");

// Basenames, not a suffix test: "live-carts.jsonl".endsWith("carts.jsonl") is
// true, and the first version of this check passed for the wrong reason and
// then failed for the wrong reason. A control that can be satisfied by string
// coincidence is not a control.
check(
  "live baskets are NOT stored in the seeded fixture file",
  path.basename(CRT._file()) !== "carts.jsonl",
  "`npm run seed` rewrites carts.jsonl wholesale; a live basket written there vanishes at the next seed",
);
check(
  "every live row is flagged as real, not synthetic",
  CRT.liveCarts(OTHER).every((c) => c.synthetic === false && c.source === "storefront"),
  "so no demo can present a seeded basket as a real one, or the reverse",
);

/* ------------------------------------------------------------------ */

check(
  "the suite is isolated from the real gateway database",
  DBS.databasePath() === path.join(SANDBOX, "chapman.sqlite"),
  "test baskets exist only in a scratch database",
);

console.log(
  failed === 0
    ? "\nAll checks passed. A page can say what it wants; it cannot say what anything costs or who to ring."
    : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
