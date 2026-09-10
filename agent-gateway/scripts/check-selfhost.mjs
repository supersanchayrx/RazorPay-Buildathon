/**
 * The two things that decide whether somebody other than us can run this.
 *
 * A merchant clones the repo, sets nothing, and starts the server. Two
 * assumptions used to be baked in so deeply they were invisible: that the data
 * directory is the checkout, and that Shopify exists. Both are configurable
 * now, and both are the kind of change that looks fine until the moment it
 * matters — a data directory that silently resolves back into the repo, or a
 * Shopify import that throws during boot again after somebody moves a line.
 * Neither failure announces itself. Hence these.
 *
 * Run:  node scripts/check-selfhost.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

async function load(entry, name, external = false) {
  const out = path.join(process.cwd(), "node_modules", ".cache", name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    logLevel: "silent",
    ...(external ? { packages: "external" } : {}),
  });
  return import(pathToFileURL(out).href);
}

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const REAL = process.cwd();
const SANDBOX = path.join(REAL, "node_modules", ".cache", "selfhost-sandbox");
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(SANDBOX, { recursive: true });

/* ================================================================== *
 * Where CHAPMAN writes
 * ================================================================== */
console.log("\n-- where CHAPMAN writes ------------------------------------\n");

{
  delete process.env.CHAPMAN_DATA_DIR;
  const P = await load("app/lib/paths.server.ts", "paths-default.mjs");
  check(
    "unset, it is ./data exactly as before",
    P.dataDir() === path.join(process.cwd(), "data"),
    "the default is the entire reason nothing changed for anyone already running this",
  );
  check(
    "dataPath joins under it",
    P.dataPath("orders.jsonl") === path.join(process.cwd(), "data", "orders.jsonl"),
  );
  check(
    "and it takes more than one part",
    P.dataPath("voice", "a.wav").endsWith(path.join("data", "voice", "a.wav")),
  );
}

{
  const target = path.join(SANDBOX, "moved");
  process.env.CHAPMAN_DATA_DIR = target;
  const P = await load("app/lib/paths.server.ts", "paths-moved.mjs");
  check("CHAPMAN_DATA_DIR moves it", P.dataDir() === target);
  check(
    "and the directory is created rather than assumed",
    fs.existsSync(target) && fs.statSync(target).isDirectory(),
    "a merchant pointing at a fresh volume should not have to mkdir it first",
  );
}

{
  process.env.CHAPMAN_DATA_DIR = "./relative-data";
  const P = await load("app/lib/paths.server.ts", "paths-rel.mjs");
  check(
    "a relative value is resolved to an absolute path",
    path.isAbsolute(P.dataDir()),
    "otherwise it follows the process around the moment anything calls chdir",
  );
  fs.rmSync(path.resolve("./relative-data"), { recursive: true, force: true });
}

{
  process.env.CHAPMAN_DATA_DIR = "   ";
  const P = await load("app/lib/paths.server.ts", "paths-blank.mjs");
  check(
    "a blank value falls back rather than writing to the filesystem root",
    P.dataDir() === path.join(process.cwd(), "data"),
    "CHAPMAN_DATA_DIR= with nothing after it is an easy line to leave in a compose file",
  );
}

{
  /* The claim in the header of scripts/data-dir.mjs. If the two resolvers ever
     disagree, `npm run seed` writes where the server does not read, and the
     symptom is an empty dashboard with no error anywhere. */
  process.env.CHAPMAN_DATA_DIR = path.join(SANDBOX, "agree");
  const P = await load("app/lib/paths.server.ts", "paths-agree.mjs");
  const script = await import(`./data-dir.mjs?v=${Date.now()}`);
  check(
    "the app resolver and the script resolver agree",
    P.dataDir() === script.DATA_DIR &&
      P.dataPath("orders.jsonl") === script.dataPath("orders.jsonl"),
    "seed writes through one of these and the server reads through the other",
  );
}

{
  delete process.env.CHAPMAN_DATA_DIR;
  const P = await load("app/lib/paths.server.ts", "paths-reset.mjs");
  const first = P.dataDir();
  process.env.CHAPMAN_DATA_DIR = path.join(SANDBOX, "after-reset");
  check(
    "the resolved directory is cached",
    P.dataDir() === first,
    "a merchant does not move their data half way through a process",
  );
  P.resetDataDir();
  check("resetDataDir picks up the new one", P.dataDir() === path.join(SANDBOX, "after-reset"));
  delete process.env.CHAPMAN_DATA_DIR;
}

/* The regression guard. The whole point of the helper is that it is the ONLY
   way this codebase names a data file; one reintroduced longhand join is a
   module that quietly ignores CHAPMAN_DATA_DIR. */
{
  const longhand = [];
  const users = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(e.name)) continue;
      const s = fs.readFileSync(p, "utf8");
      if (!p.endsWith("paths.server.ts") && /process\.cwd\(\),\s*"data"/.test(s)) longhand.push(p);
      if (s.includes("dataPath(")) users.push(p);
    }
  };
  walk(path.join(REAL, "app"));

  check(
    "no module addresses the data directory longhand",
    longhand.length === 0,
    longhand.length ? longhand.join(", ") : "dataPath() is the only way in",
  );
  check("and the helper remains available for non-database assets", users.length >= 5, `${users.length} modules`);

  const databaseUsers = [];
  const collectDatabaseUsers = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        collectDatabaseUsers(p);
        continue;
      }
      if (!/\.tsx?$/.test(e.name) || p.endsWith("database.server.ts")) continue;
      const s = fs.readFileSync(p, "utf8");
      if (s.includes('from "./database.server"')) databaseUsers.push(p);
    }
  };
  collectDatabaseUsers(path.join(REAL, "app", "lib"));
  check(
    "stateful modules use the shared SQLite repository",
    databaseUsers.length >= 15,
    `${databaseUsers.length} modules`,
  );
}

/* ================================================================== *
 * Existing demo files are deliberately not migrated
 * ================================================================== */
console.log("\n-- no implicit legacy-data migration -----------------------\n");

{
  const home = path.join(SANDBOX, "legacy-data");
  fs.mkdirSync(home, { recursive: true });
  const legacy = path.join(home, "decision-ledger.jsonl");
  const original = JSON.stringify({ ts: "t", kind: "legacy" }) + "\n";
  fs.writeFileSync(legacy, original);
  process.env.CHAPMAN_DATA_DIR = path.join(home, "data");
  process.env.CHAPMAN_DATABASE_PATH = path.join(home, "data", "chapman.sqlite");
  process.chdir(home);
  const L = await load(path.join(REAL, "app/lib/ledger.server.ts"), "ledger-sqlite.mjs");
  process.chdir(REAL);

  const initial = L.readLedger(10);
  check(
    "legacy JSONL is not silently imported",
    initial.length === 0,
    "fresh installations start with a clean authoritative database",
  );
  L.record({ shop: "pk_test", kind: "reply", message: "stored in SQLite" });
  const rows = L.readLedger(10);
  check(
    "new ledger entries round-trip through SQLite",
    rows.length === 1 && rows[0].shop === "pk_test" && rows[0].message === "stored in SQLite",
  );
  check(
    "the legacy file is left untouched",
    fs.readFileSync(legacy, "utf8") === original,
  );
  L.closeDatabase?.();
  delete process.env.CHAPMAN_DATA_DIR;
  delete process.env.CHAPMAN_DATABASE_PATH;
}

/* ================================================================== *
 * Shopify is an integration, not a requirement
 * ================================================================== */
console.log("\n-- Shopify is an integration, not a requirement ------------\n");

const SHOP_VARS = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES"];
const stash = {};
const restore = () => {
  for (const k of SHOP_VARS) {
    if (stash[k] === undefined) delete process.env[k];
    else process.env[k] = stash[k];
  }
};
for (const k of SHOP_VARS) {
  stash[k] = process.env[k];
  delete process.env[k];
}

{
  let mod = null;
  let threw = null;
  try {
    mod = await load("app/shopify.server.ts", "shopify-off.mjs", true);
  } catch (e) {
    threw = e;
  }
  check(
    "importing it with no Shopify configuration does not throw",
    threw === null,
    threw
      ? String(threw.message).split("\n")[0]
      : "this IS the boot — entry.server.tsx imports this on every document response",
  );

  if (mod) {
    check("shopifyConfigured() reports false", mod.shopifyConfigured() === false);

    const headers = new Headers();
    let hThrew = null;
    try {
      mod.addDocumentResponseHeaders(new Request("http://localhost/dashboard"), headers);
    } catch (e) {
      hThrew = e;
    }
    check(
      "addDocumentResponseHeaders is a silent no-op",
      hThrew === null && [...headers.keys()].length === 0,
      "it emitted nothing for a non-Shopify request before this change either",
    );

    let msg = "";
    try {
      await mod.authenticate.admin(new Request("http://localhost/app"));
    } catch (e) {
      msg = String(e.message);
    }
    check(
      "a Shopify route fails with a sentence, not a stack trace",
      msg.includes("Shopify is not configured"),
    );
    check(
      "and the sentence names all three variables",
      ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL"].every((v) => msg.includes(v)),
    );
    check(
      "...and says the rest of CHAPMAN does not need them",
      /widget|custom site/.test(msg),
      "otherwise a merchant reads it as: you must set up Shopify",
    );

    let nested = "";
    try {
      await mod.authenticate.public.appProxy(new Request("http://localhost/proxy"));
    } catch (e) {
      nested = String(e.message);
    }
    check(
      "a nested accessor reaches the same message",
      nested.includes("Shopify is not configured"),
      "authenticate.public.appProxy is two property reads deep — the usual way a lazy shim breaks",
    );

    check(
      "apiVersion is still a plain value",
      typeof mod.apiVersion === "string" && mod.apiVersion.length > 0,
    );
  }
}

restore();

{
  /* The other direction, which is the one that must NOT have changed. */
  process.env.SHOPIFY_API_KEY = "test_key";
  process.env.SHOPIFY_API_SECRET = "test_secret";
  process.env.SHOPIFY_APP_URL = "https://gateway.example";
  process.env.SCOPES = "read_products";
  const mod = await load("app/shopify.server.ts", "shopify-on.mjs", true);

  check("shopifyConfigured() reports true", mod.shopifyConfigured() === true);

  const embedded = new Headers();
  mod.addDocumentResponseHeaders(
    new Request("https://gateway.example/app?embedded=1&shop=x.myshopify.com"),
    embedded,
  );
  const csp = embedded.get("content-security-policy") || "";
  check(
    "an embedded Shopify request still gets its frame-ancestors CSP",
    csp.includes("frame-ancestors") && csp.includes("x.myshopify.com"),
    csp ? "unchanged from the eager version" : "MISSING — the Shopify path regressed",
  );

  const plain = new Headers();
  mod.addDocumentResponseHeaders(new Request("https://gateway.example/dashboard"), plain);
  check(
    "a non-Shopify request gets nothing, configured or not",
    [...plain.keys()].length === 0,
    "which is why the no-op above preserves behaviour rather than cutting a corner",
  );

  check("authenticate resolves to the real object", typeof mod.authenticate.admin === "function");
  restore();
}

{
  /* The placeholder credentials this change exists to delete. */
  const embed = fs.existsSync(".env.embed") ? fs.readFileSync(".env.embed", "utf8") : "";
  check(
    ".env.embed no longer carries invented Shopify credentials",
    !/^\s*SHOPIFY_[A-Z_]+\s*=\s*\S/m.test(embed),
    "they existed only to get past a module-scope throw, and they made dev pass while npm start failed",
  );

  const entry = fs.readFileSync("app/entry.server.tsx", "utf8");
  check(
    "entry.server.tsx still adds Shopify's document headers",
    entry.includes("addDocumentResponseHeaders(request, responseHeaders)"),
    "making it optional must not mean quietly dropping it for the merchants who do use Shopify",
  );
}

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
