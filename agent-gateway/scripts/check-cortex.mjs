/**
 * The cortex boundary.
 *
 * A shared memory every tool borrows from is only safe if the outward
 * projection is airtight. This asserts the two properties the whole design
 * rests on:
 *
 *   1. `shopperView` carries no merchant-confidential value — not costs, not
 *      margin floors, not order volumes, not what was refused. Checked by
 *      serialising the projection and searching it for values we know are
 *      secret, rather than by inspecting the type, because a type says what
 *      was intended and JSON says what actually crosses the wire.
 *
 *   2. No shopper can appear in it at all. The cortex is shop knowledge; a
 *      person belongs in a per-(merchant, shopper) store that this module has
 *      no access to.
 *
 * Run:  node scripts/check-cortex.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Unlike calendar and bounds, this module imports a sibling, and it does so
// without a file extension because that is what Vite expects. Node's resolver
// does not. Bundling with esbuild (already present via Vite) sidesteps the
// difference rather than contorting the source to suit a test. Using esbuild's
// JS API rather than its CLI, because spawning a .cmd shim is a Windows-only
// failure that would only show up on someone else's machine.
const out = path.join(process.cwd(), "node_modules", ".cache", "cortex-check.mjs");
fs.mkdirSync(path.dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: ["app/lib/cortex.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "silent",
});
const { buildCortex, shopperView, isStale } = await import(pathToFileURL(out).href);

const D = path.join(process.cwd(), "data");
const inputs = JSON.parse(fs.readFileSync(path.join(D, "merchant-inputs.json"), "utf8"));
const feed = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "..", "demo-store", "catalog.json"), "utf8"),
);

// A stand-in catalogue so this test needs no running demo store.
const products = feed.products.map((p) => ({
  handle: p.handle,
  title: p.title,
  productType: p.type,
  currency: feed.shop.currency,
  minPrice: Math.min(...p.variants.map((v) => v.price)),
  maxPrice: Math.max(...p.variants.map((v) => v.price)),
  totalInventory: p.variants.reduce((s, v) => s + v.inventory, 0),
  variants: p.variants.map((v) => ({ inventoryQuantity: v.inventory })),
}));
const catalog = {
  kind: "test",
  search: async () => products,
  get: async (h) => products.find((p) => p.handle === h) ?? null,
  complements: async () => [],
  policies: async () => feed.shop.policies,
};

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const cortex = await buildCortex({ site: { key: "pk_test", name: "Nilgiri Post" }, catalog });
const view = shopperView(cortex);
const wire = JSON.stringify(view);

/* ---- 1. nothing confidential crosses the projection ----------------- */
const secrets = Object.entries(inputs.unitCost).map(([sku, c]) => [`unit cost ${sku}`, String(c)]);
const leaked = secrets.filter(([, v]) => new RegExp(`\\b${v}\\b`).test(wire));
check("no unit cost appears in the shopper projection", leaked.length === 0, leaked.map(([k]) => k).join(", ") || `${secrets.length} costs checked`);

check(
  "no margin floor, discount ceiling or sample floor crosses",
  !/minMargin|maxDiscount|neverDiscount|minSampleSize/i.test(wire) &&
    !new RegExp(`\\b${inputs.floors.minMarginPct}\\b`).test(wire),
  "checked by key name and by value",
);

check(
  "no trade volume or refusal count crosses",
  !/ordersPerMonth|avgOrderValue|bestsellers|refusals|byGate/i.test(wire),
  cortex.commerce ? `merchant view has ${cortex.commerce.value.ordersPerMonth} orders/mo` : "no order data",
);

check(
  "the merchant view still has them",
  Boolean(cortex.constraints) && Boolean(cortex.commerce) && cortex.decisions.value.replies >= 0,
  "the boundary hides them from shoppers, it does not delete them",
);

/* ---- 2. no person, anywhere ----------------------------------------- */
// Scan for things that IDENTIFY a person, not for words that mention one.
// The first version of this check looked for "customer" and failed on the
// merchant's own returns policy — "return shipping is paid by the customer".
// A privacy test that fires on English prose gets switched off within a week.
const whole = JSON.stringify(cortex);
const IDENTIFIERS = [
  ["email address", /[\w.+-]+@[\w-]+\.[\w.]+/],
  ["phone number", /\+?\d{2}[- ]?\d{8,12}/],
  ["customer id", /\bcus_[a-z0-9_]+/i],
  ["contact field", /"(?:email|phone|contact|customer)"\s*:/i],
];
const found = IDENTIFIERS.filter(([, re]) => re.test(whole)).map(([n]) => n);
check(
  "the cortex carries nothing that identifies a person",
  found.length === 0,
  found.join(", ") || "no address, number, id or contact field — a person belongs in a per-shopper store this module cannot reach",
);

/* ---- 3. freshness is declared, not assumed -------------------------- */
check(
  "a catalogue snapshot is marked perishable, a policy is not",
  cortex.catalogue.staleAfterDays === 1 && cortex.policies.staleAfterDays !== null &&
    cortex.constraints?.staleAfterDays === null,
  `catalogue ${cortex.catalogue.staleAfterDays}d, policies ${cortex.policies.staleAfterDays}d, limits never`,
);
check(
  "a fresh fact is not reported stale",
  !isStale(cortex.catalogue),
  `built ${cortex.catalogue.at.slice(11, 19)}`,
);
check(
  "an old catalogue snapshot IS reported stale",
  isStale({ ...cortex.catalogue, at: new Date(Date.now() - 3 * 86400000).toISOString() }),
  "three days old",
);

/* ---- 4. it knows what it is missing --------------------------------- */
check(
  "gaps name who has to close them",
  cortex.gaps.length > 0 && cortex.gaps.every((g) => g.who === "merchant" || g.who === "us"),
  cortex.gaps.map((g) => `${g.who}: ${g.what.slice(0, 34)}`).join(" | "),
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
