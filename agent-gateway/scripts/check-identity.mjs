/**
 * Identity and order scoping.
 *
 * This is the file where a bug is a data breach rather than a wrong answer, so
 * the checks are adversarial: each one tries to read somebody else's orders and
 * asserts that it could not.
 *
 * Run:  node scripts/check-identity.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

/**
 * These two used to be imported straight from source, which worked only for as
 * long as neither reached for another module in `app/lib`. Node resolves the
 * types away but not the extensionless specifiers the rest of the codebase is
 * written in, so the first ordinary intra-lib import turned a security suite
 * into ERR_MODULE_NOT_FOUND. Bundled the way every other check script does it.
 */
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

const { mintSessionToken, verifySessionToken } = await load(
  "app/lib/identity.server.ts",
  "identity-check.mjs",
);
const { seededOrders } = await load("app/lib/orders.server.ts", "orders-identity.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const SITE = "pk_test";
const SECRET = "test-secret";
const good = mintSessionToken({ site: SITE, sub: "cus_syn_000", secret: SECRET });
const v = (t, o = {}) => verifySessionToken(t, { site: SITE, secret: SECRET, ...o });

/* ---- the token itself ---------------------------------------------- */
check("a valid token verifies", v(good).ok && v(good).identity.sub === "cus_syn_000");

check("no token is not an identity", !v(null).ok && v(null).reason === "missing");

check(
  "a token signed with another secret is rejected",
  !v(mintSessionToken({ site: SITE, sub: "cus_syn_001", secret: "not-the-secret" })).ok,
  "the whole point: only the merchant can assert who someone is",
);

// Swap the payload for another customer, keep the original signature.
const forged = (() => {
  const [, , sig] = good.split(".");
  const body = Buffer.from(
    JSON.stringify({ site: SITE, sub: "cus_syn_099", exp: Math.floor(Date.now() / 1000) + 900 }),
  ).toString("base64url");
  return `v1.${body}.${sig}`;
})();
check(
  "swapping the payload for another customer is rejected",
  !v(forged).ok && v(forged).reason === "bad_signature",
  "the signature covers the payload, so the subject cannot be edited",
);

check(
  "an expired token is rejected",
  !v(mintSessionToken({ site: SITE, sub: "cus_syn_000", secret: SECRET, ttlSeconds: -1 })).ok,
);

check(
  "a token minted for another shop is rejected",
  !verifySessionToken(good, { site: "pk_other_shop", secret: SECRET }).ok,
  "a leaked secret at one merchant must not read customers at every other",
);

check(
  "garbage is rejected without throwing",
  ["", "v1", "v1.a.b", "v2." + good.slice(3), "....", "v1..", good.slice(0, -3)].every(
    (t) => v(t).ok === false,
  ),
  "6 malformed inputs",
);

/* ---- order scoping -------------------------------------------------- */
const seedPath = dataPath("orders.jsonl");
if (!fs.existsSync(seedPath)) {
  console.log("SKIP  order scoping — run `npm run seed` first");
} else {
  const src = seededOrders();
  const a = "cus_syn_000";
  const rowsA = await src.forShopper(a, 50);
  check("a shopper sees their own orders", rowsA.length > 0, `${rowsA.length} for ${a}`);
  check(
    "every row returned belongs to the shopper asked for",
    rowsA.every((o) => o.customer === a),
    "scoped at the source, not filtered afterwards by a caller who might forget",
  );
  check(
    "every row is flagged as fixture data",
    rowsA.every((o) => o.synthetic === true),
    "so demo data can never be quietly presented as a real order",
  );

  // Find another customer's order and try to read it as the first one.
  const all = fs
    .readFileSync(seedPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const other = all.find((o) => o.customer.id !== a);
  check(
    "one shopper cannot fetch another's order by id",
    (await src.get(a, other.id)) === null,
    `${a} asking for ${other.id} (belongs to ${other.customer.id})`,
  );
  check(
    "the rightful owner still can",
    (await src.get(other.customer.id, other.id))?.id === other.id,
    "scoping denies the stranger without breaking the owner",
  );
  check(
    "an unknown shopper gets nothing, not everything",
    (await src.forShopper("cus_does_not_exist", 50)).length === 0,
    "an empty filter must never fall through to the full list",
  );
}

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
