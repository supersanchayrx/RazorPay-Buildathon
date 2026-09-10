/**
 * `npm run init`, and the one property it must have.
 *
 * A setup script that writes a file the server then refuses to start on is
 * worse than no setup script: the merchant now owns a broken file they did not
 * write and cannot read. So most of what follows feeds init's own output back
 * through `parseSitesConfig` — the same function the server calls — with
 * `production: true`, which is the strict reading.
 *
 * The rest guards the two rules that are easy to break later:
 *
 *   - init never writes a secret VALUE it was given by a human, only names.
 *   - init never rewrites a line already in `.env`.
 *
 * Run:  node scripts/check-init.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import {
  accentValid,
  configText,
  emailValid,
  embedTag,
  envAdditions,
  envEntriesFor,
  keyFromName,
  keyValid,
  originsValid,
  rawBlock,
  secretEnvFor,
  siteBlock,
  templateValid,
  urlValid,
} from "./init-lib.mjs";

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

const { parseSitesConfig, stripJsonComments } = await load("app/lib/config.server.ts", "init-config-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/** What init builds, as a builder, so each case says only what it changes. */
const site = (over = {}) => ({
  key: "pk_mystore",
  name: "My Store",
  origins: ["https://shop.example"],
  catalogFeedUrl: "https://shop.example/catalog.json",
  productUrlTemplate: "/products/{handle}",
  greeting: "Ask me anything about our products.",
  accent: "#1f2937",
  secretEnv: "SITE_SECRET_MYSTORE",
  orders: null,
  razorpay: null,
  ...over,
});

/** Emit exactly as init does, then validate exactly as the server does. */
const emitAndParse = (s, { carried = [], env = null, production = true } = {}) => {
  const text = configText([...carried.map(rawBlock), siteBlock(s)]);
  const known = env ?? { [s.secretEnv]: "x".repeat(64) };
  return {
    text,
    ...parseSitesConfig(text, "chapman.config.json", {
      resolveSecret: (n) => known[n] ?? null,
      production,
    }),
  };
};

/* ------------------------------------------------------------------ *
 * 1. What init emits, the server accepts
 * ------------------------------------------------------------------ */

console.log("\n-- the emitted config is one the server starts on --\n");

{
  const r = emitAndParse(site());
  check("minimal storefront validates in production", r.errors.length === 0, r.errors[0]);
  check("minimal storefront yields exactly one site", r.sites.length === 1);
}

{
  const s = site({
    orders: { feedUrl: "https://shop.example/api/orders" },
    razorpay: {
      keyIdEnv: "RAZORPAY_KEY_ID",
      keySecretEnv: "RAZORPAY_KEY_SECRET",
      webhookSecretEnv: "RAZORPAY_WEBHOOK_SECRET",
    },
  });
  const r = emitAndParse(s);
  check("orders + payments validates", r.errors.length === 0, r.errors[0]);
  const got = r.sites[0];
  check("orders.feedUrl survives the round trip", got?.orders?.feedUrl === "https://shop.example/api/orders");
  check(
    "razorpay names survive the round trip",
    got?.razorpay?.keyIdEnv === "RAZORPAY_KEY_ID" &&
      got?.razorpay?.keySecretEnv === "RAZORPAY_KEY_SECRET" &&
      got?.razorpay?.webhookSecretEnv === "RAZORPAY_WEBHOOK_SECRET",
  );
  check("razorpay.methods is left unset, so agents hear the conservative default", got?.razorpay?.methods === undefined);
}

{
  // An empty answer to "how do product URLs look?" must omit the field, not
  // write an empty string — an empty template fails validation.
  const r = emitAndParse(site({ productUrlTemplate: undefined }));
  check("no product URL template validates", r.errors.length === 0, r.errors[0]);
  check("no product URL template is omitted, not blank", !r.text.includes('"productUrlTemplate"'));
}

{
  const r = emitAndParse(site({ origins: ["https://shop.example", "https://www.shop.example", "http://localhost:4000"] }));
  check("several origins validate", r.errors.length === 0, r.errors[0]);
  check("all three origins are kept", r.sites[0]?.origins.length === 3);
}

{
  // Every field a merchant can type is user text, and every one of them goes
  // through JSON.stringify. A quote in a shop name used to be how these files
  // broke.
  const s = site({
    name: 'Bob\'s "Best" Tea',
    greeting: "Say hi — we ship worldwide. Read more: https://shop.example/faq",
  });
  const r = emitAndParse(s);
  check("quotes in the shop name do not break the file", r.errors.length === 0, r.errors[0]);
  check("the name survives verbatim", r.sites[0]?.name === 'Bob\'s "Best" Tea');
  // The `//` in that URL is the exact case stripJsonComments exists for: a
  // naive strip deletes the rest of the line and the parse error points
  // somewhere else entirely.
  check(
    "a URL inside a greeting survives comment stripping",
    r.sites[0]?.greeting === "Say hi — we ship worldwide. Read more: https://shop.example/faq",
  );
}

{
  const r = emitAndParse(site(), { env: {} });
  check(
    "a config whose secret is not in the environment is refused",
    r.errors.some((e) => e.includes("SITE_SECRET_MYSTORE")),
    r.errors[0],
  );
}

/* ------------------------------------------------------------------ *
 * 2. Adding a storefront loses nothing
 * ------------------------------------------------------------------ */

console.log("\n-- adding a second storefront keeps the first one whole --\n");

{
  // Deliberately carries fields init never asks about. Rebuilding a carried
  // site from init's own question list would silently drop every one of these.
  const existing = {
    key: "pk_first",
    name: "First Shop",
    origins: ["https://first.example"],
    catalogFeedUrl: "https://first.example/catalog.json",
    productUrlTemplate: "/p/{handle}",
    recoverPath: "/recover",
    restorePath: "/restore",
    greeting: "Hello",
    accent: "#123456",
    secretEnv: "SITE_SECRET_FIRST",
    orders: { feedUrl: "https://first.example/api/orders" },
    razorpay: {
      keyIdEnv: "RP_ID",
      keySecretEnv: "RP_SECRET",
      webhookSecretEnv: "RP_HOOK",
      methods: ["upi", "card"],
    },
  };
  const r = emitAndParse(site({ key: "pk_second", secretEnv: "SITE_SECRET_SECOND" }), {
    carried: [existing],
    env: { SITE_SECRET_FIRST: "a".repeat(64), SITE_SECRET_SECOND: "b".repeat(64) },
  });
  check("two storefronts validate together", r.errors.length === 0, r.errors[0]);
  check("both are present, in order", r.sites.map((s) => s.key).join(",") === "pk_first,pk_second");

  const first = r.sites[0];
  check("carried recoverPath survives", first?.recoverPath === "/recover");
  check("carried restorePath survives", first?.restorePath === "/restore");
  check("carried razorpay.methods survives", JSON.stringify(first?.razorpay?.methods) === '["upi","card"]');
  check("carried orders feed survives", first?.orders?.feedUrl === "https://first.example/api/orders");
  check("carried accent survives", first?.accent === "#123456");

  // The raw block is JSON.stringify of the parsed object, so a round trip
  // through it must be lossless for every key, not just the ones asserted above.
  const reparsed = JSON.parse(stripJsonComments(r.text)).sites[0];
  check(
    "no field is lost by the carry, whatever it is",
    JSON.stringify(reparsed) === JSON.stringify(existing),
    Object.keys(existing).filter((k) => JSON.stringify(reparsed[k]) !== JSON.stringify(existing[k])).join(", "),
  );
}

{
  // A hand-written devSecret is carried through as-is. It must still be
  // REFUSED in production — init must not become a way to launder one past
  // the guard by rewriting the file.
  const withDev = {
    key: "pk_demo",
    name: "Demo",
    origins: ["http://localhost:4000"],
    catalogFeedUrl: "http://localhost:4000/catalog.json",
    secretEnv: "SITE_SECRET_DEMO",
    devSecret: "dev-secret-do-not-ship",
  };
  const r = emitAndParse(site({ key: "pk_new", secretEnv: "SITE_SECRET_NEW" }), {
    carried: [withDev],
    env: { SITE_SECRET_NEW: "c".repeat(64) },
    production: true,
  });
  check(
    "a carried devSecret is still refused in production",
    r.errors.some((e) => e.includes("devSecret")),
    r.errors.join(" | ") || "no error raised",
  );
}

/* ------------------------------------------------------------------ *
 * 3. Names
 * ------------------------------------------------------------------ */

console.log("\n-- keys and variable names --\n");

for (const [name, expected] of [
  ["Nilgiri Post", "pk_nilgiripost"],
  ["Bob's Tea & Co.", "pk_bobsteaco"],
  ["  ", "pk_store"],
  ["", "pk_store"],
  ["日本茶", "pk_store"],
  ["A Very Long Shop Name That Goes On And On", "pk_averylongshopnamethatgoe"],
]) {
  const got = keyFromName(name);
  check(`keyFromName(${JSON.stringify(name)}) -> ${got}`, got === expected, `expected ${expected}`);
  check(`  and it is a legal key`, keyValid(got) === null);
}

for (const [key, expected] of [
  ["pk_nilgiripost", "SITE_SECRET_NILGIRIPOST"],
  ["pk_my-store", "SITE_SECRET_MY_STORE"],
  ["nilgiripost", "SITE_SECRET_NILGIRIPOST"],
  ["pk_a1", "SITE_SECRET_A1"],
]) {
  const got = secretEnvFor(key);
  check(`secretEnvFor(${key}) -> ${got}`, got === expected, `expected ${expected}`);
  check(`  and it is a legal shell variable name`, /^[A-Za-z_][A-Za-z0-9_]*$/.test(got));
}

/* ------------------------------------------------------------------ *
 * 4. Validators say no to what the server says no to
 *
 * The questions repeat the server's rules so the merchant hears them while
 * they are still typing. Two copies of a rule drift; these assert they have
 * not, on the cases people actually get wrong.
 * ------------------------------------------------------------------ */

console.log("\n-- the questions refuse what the server would refuse --\n");

for (const bad of [
  "https://shop.example/",
  "https://shop.example/path",
  "shop.example",
  "",
  "https://a.example, https://b.example/",
]) {
  const rejected = originsValid(bad) !== null;
  check(`origins reject ${JSON.stringify(bad)}`, rejected);
  if (!rejected) continue;
  // And the server agrees. The WHOLE answer goes in, not just its first entry:
  // "https://a.example, https://b.example/" is refused for the second origin,
  // and a test that only looked at the first would call that a pass.
  const list = bad.split(",").map((s) => s.trim()).filter(Boolean);
  const r = emitAndParse(site({ origins: list }));
  check(`  the server also refuses it`, r.errors.length > 0);
}

for (const good of ["https://shop.example", "http://localhost:4000", "https://a.b.c.example:8443"]) {
  check(`origins accept ${good}`, originsValid(good) === null);
  const r = emitAndParse(site({ origins: [good] }));
  check(`  and the server accepts it`, r.errors.length === 0, r.errors[0]);
}

check("catalogue URL rejects a bare host", urlValid("shop.example") !== null);
check("catalogue URL rejects a file path", urlValid("/var/catalog.json") !== null);
check("catalogue URL rejects ftp", urlValid("ftp://shop.example/c.json") !== null);
check("catalogue URL accepts https", urlValid("https://shop.example/catalog.json") === null);

check("product template rejects one without {handle}", templateValid("/products/") !== null);
check("product template accepts empty, meaning omit", templateValid("") === null);
check("product template accepts {handle}", templateValid("/p/{handle}") === null);

check("accent rejects a colour name", accentValid("teal") !== null);
check("accent rejects a hex without #", accentValid("1f2937") !== null);
check("accent accepts #1f4037", accentValid("#1f4037") === null);

check("email rejects a bare word", emailValid("sanchay") !== null);
check("email rejects a missing dot", emailValid("a@b") !== null);
check("email accepts an ordinary one", emailValid("you@shop.example") === null);

check("key rejects a space", keyValid("my store") !== null);
check("key rejects a slash", keyValid("my/store") !== null);
check("key accepts underscores and hyphens", keyValid("pk_my-store_2") === null);

/* ------------------------------------------------------------------ *
 * 5. .env is append-only
 * ------------------------------------------------------------------ */

console.log("\n-- .env is added to and never rewritten --\n");

const entries = (over = {}) =>
  envEntriesFor({
    site: site(over),
    siteSecret: "s".repeat(64),
    consoleSecret: "k".repeat(64),
    gatewayOrigin: "https://gateway.example",
  });

{
  const r = envAdditions("", entries(), "2026-01-01");
  check("a fresh .env gets all three variables", r.added.length === 3 && r.kept.length === 0, r.added.join(","));
  check("  SITE_SECRET is one of them", r.added.includes("SITE_SECRET_MYSTORE"));
  check("  CONSOLE_SESSION_SECRET is one of them", r.added.includes("CONSOLE_SESSION_SECRET"));
  check("  GATEWAY_ORIGIN is one of them", r.added.includes("GATEWAY_ORIGIN"));
  check("  every added line is key=value", r.append.split("\n").filter((l) => l && !l.startsWith("#")).every((l) => /^[A-Z_][A-Z0-9_]*=/.test(l.trim())));
}

{
  const existing = "SITE_SECRET_MYSTORE=already-live-do-not-touch\nOPENROUTER_API_KEY=xyz\n";
  const r = envAdditions(existing, entries(), "2026-01-01");
  check("an existing SITE_SECRET is kept, not rotated", r.kept.includes("SITE_SECRET_MYSTORE"));
  check("  and does not appear in what we append", !r.append.includes("SITE_SECRET_MYSTORE="));
  check("  the other two are still added", r.added.length === 2);
  check("  nothing already in the file is reproduced", !r.append.includes("OPENROUTER_API_KEY"));
}

{
  const all = "SITE_SECRET_MYSTORE=a\nCONSOLE_SESSION_SECRET=b\nGATEWAY_ORIGIN=c\n";
  const r = envAdditions(all, entries(), "2026-01-01");
  check("a second run appends nothing at all", r.append === "" && r.added.length === 0);
}

{
  // A commented-out variable is not a set variable. Writing it live is the
  // right move; skipping it would leave the merchant with a config naming a
  // variable that is only ever a comment.
  const r = envAdditions("# SITE_SECRET_MYSTORE=\n", entries(), "2026-01-01");
  check("a commented-out variable does not count as present", r.added.includes("SITE_SECRET_MYSTORE"));
}

{
  const crlf = "EXISTING=1\r\n";
  const r = envAdditions(crlf, entries(), "2026-01-01");
  check("a CRLF file keeps CRLF", r.append.includes("\r\n") && !/[^\r]\n/.test(r.append));
  const lf = "EXISTING=1\n";
  const r2 = envAdditions(lf, entries(), "2026-01-01");
  check("an LF file keeps LF", !r2.append.includes("\r"));
}

{
  const r = envAdditions("EXISTING=1", entries(), "2026-01-01");
  check("a file with no trailing newline is not joined onto", r.append.startsWith("\n"));
}

{
  const r = envAdditions("", entries({ razorpay: { keyIdEnv: "RP_ID", keySecretEnv: "RP_SECRET", webhookSecretEnv: "RP_HOOK" } }), "2026-01-01");
  check("payments add the three named variables", ["RP_ID", "RP_SECRET", "RP_HOOK"].every((k) => r.added.includes(k)));
  // THE RULE: init writes the name and an empty value. It never asks a human
  // for a key and never puts one in a file.
  check(
    "  and every one of them is written EMPTY",
    ["RP_ID", "RP_SECRET", "RP_HOOK"].every((k) => new RegExp(`^${k}=$`, "m").test(r.append)),
    r.append.split("\n").filter((l) => l.startsWith("RP_")).join(" | "),
  );
}

/* ------------------------------------------------------------------ *
 * 6. The bits a human copies out
 * ------------------------------------------------------------------ */

console.log("\n-- what init prints at the end --\n");

{
  const tag = embedTag("https://gateway.example", "pk_mystore");
  check("the embed tag names the gateway", tag.includes('src="https://gateway.example/embed.js"'));
  check("the embed tag names the site", tag.includes('data-site="pk_mystore"'));
  check("the embed tag is deferred", tag.includes("defer"));
  check("the embed tag is closed", tag.trim().endsWith("</script>"));
}

/* ------------------------------------------------------------------ *
 * 7. init writes where the app reads
 *
 * The class of bug that has no error message: a setup script that puts the
 * environment somewhere nothing loads it from. Asserted textually because the
 * default is a parameter default and cannot be observed at runtime.
 * ------------------------------------------------------------------ */

console.log("\n-- init writes where the app reads --\n");

{
  const initSrc = fs.readFileSync("scripts/init.mjs", "utf8");
  const envSrc = fs.readFileSync("app/lib/env.server.ts", "utf8");
  // Both of these are now two-headed: an override variable, and the same
  // default as before when it is unset. Both heads have to agree with the
  // server, and the override is the one a container depends on — a mismatch
  // there writes a configuration into a volume that nothing ever reads, and
  // reports success while doing it.
  check(
    "init's .env default is the repo root, as loadRootEnv() reads it",
    /path\.join\(process\.cwd\(\),\s*"\.\.",\s*"\.env"\)/.test(initSrc) &&
      /loadRootEnv\(root\s*=\s*path\.join\(process\.cwd\(\),\s*"\.\."\)\)/.test(envSrc),
  );
  check(
    "init and loadRootEnv honour the same CHAPMAN_ENV_FILE override",
    /ENV_FILE\s*=\s*process\.env\.CHAPMAN_ENV_FILE/.test(initSrc) &&
      /process\.env\.CHAPMAN_ENV_FILE/.test(envSrc),
  );
  check(
    "init writes the storefront through the SQLite repository",
    initSrc.includes("SITE_DB.saveSite(site)"),
  );
  check(
    "init does not write a legacy JSON registry",
    !initSrc.includes("writeFileSync(CONFIG_FILE"),
  );
  check("init refuses to run outside the gateway directory", initSrc.includes('app", "lib", "config.server.ts"'));
  check("init validates with production: true before writing", /production:\s*true/.test(initSrc));
  check(
    "init reports the authoritative database path",
    initSrc.includes("DATABASE.databasePath()"),
  );
  check("init appends to .env rather than writing it", initSrc.includes("appendFileSync(ENV_FILE") && !initSrc.includes("writeFileSync(ENV_FILE"));
}

{
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  check("npm run init exists", pkg.scripts.init === "node scripts/init.mjs");
  check("npm run merchant:grant exists", pkg.scripts["merchant:grant"] === "node scripts/merchant-grant.mjs");
  check("check-init is in the check chain", pkg.scripts.check.includes("check-init.mjs"));
}

/* ------------------------------------------------------------------ */

console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
