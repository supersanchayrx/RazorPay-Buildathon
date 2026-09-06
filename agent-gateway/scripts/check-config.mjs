/**
 * The site registry, now that it is a file a merchant edits.
 *
 * Two jobs here. The first is the ordinary one: a validator is only worth
 * having if it rejects the things people actually type, so most of these
 * checks are malformed configs rather than well-formed ones.
 *
 * The second is a regression guard. This registry used to be a TypeScript
 * array, and the shipped demo config has to resolve to byte-identical values —
 * a restructure that quietly changes a shop's origins or its Razorpay key
 * names would be indistinguishable from a working system right up until a
 * shopper tried to pay. The last block asserts field by field against what the
 * hardcoded array held.
 *
 * Run:  node scripts/check-config.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundled rather than imported directly: `config.server.ts` reaches for
// `env.server`, and bare Node will not resolve an extensionless import that
// Vite resolves happily. Same shape as check-payments.mjs.
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

const { stripJsonComments, parseSitesConfig, CONFIG_FILENAMES } = await load(
  "app/lib/config.server.ts",
  "config-check.mjs",
);

let failed = 0;
const check = (label, ok, detail) => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

/** Parse with an injected environment, so no test depends on the real .env. */
const parse = (text, env = {}, production = false) =>
  parseSitesConfig(text, "test.json", {
    resolveSecret: (n) => env[n] ?? null,
    production,
  });

/** The smallest config that should be accepted, as a builder. */
const site = (over = {}) =>
  JSON.stringify({
    sites: [
      {
        key: "pk_test",
        name: "Test Shop",
        origins: ["https://shop.example"],
        catalogFeedUrl: "https://shop.example/catalog.json",
        secretEnv: "SITE_SECRET_TEST",
        ...over,
      },
    ],
  });

const ENV = { SITE_SECRET_TEST: "s3cr3t" };

/* ---- comment stripping --------------------------------------------- */
// The whole reason this is hand-written rather than a regex: every origin a
// merchant writes contains `//`, and a naive stripper eats their domain.

check(
  "a URL inside a string survives comment stripping",
  JSON.parse(stripJsonComments('{"a": "https://shop.example/x"}')).a ===
    "https://shop.example/x",
  "the failure mode that makes naive comment stripping unusable here",
);

check(
  "a line comment is removed",
  JSON.parse(stripJsonComments('{\n  // gone\n  "a": 1\n}')).a === 1,
);

check(
  "a block comment is removed",
  JSON.parse(stripJsonComments('{ /* gone\n still gone */ "a": 1 }')).a === 1,
);

check(
  "a comment marker inside a string is kept",
  JSON.parse(stripJsonComments('{"a": "not // a comment"}')).a ===
    "not // a comment",
);

check(
  "an escaped quote does not end the string early",
  JSON.parse(stripJsonComments('{"a": "say \\"hi\\" // still text"}')).a ===
    'say "hi" // still text',
);

check(
  "stripping preserves line numbers",
  stripJsonComments("{\n/* a\nb\nc */\n}").split("\n").length === 5,
  "so a JSON.parse error points at the line the merchant is looking at",
);

/* ---- the happy path ------------------------------------------------- */
{
  const r = parse(site(), ENV);
  check(
    "a minimal valid site is accepted",
    r.errors.length === 0 && r.sites.length === 1,
    r.errors[0],
  );
  check(
    "the named secret is resolved from the environment",
    r.sites[0]?.secret === "s3cr3t",
  );
  check(
    "an absent greeting and accent get defaults rather than errors",
    Boolean(r.sites[0]?.greeting) &&
      /^#[0-9a-f]{3,8}$/i.test(r.sites[0]?.accent ?? ""),
    "cosmetic fields must never block a boot",
  );
}

/* ---- what people actually get wrong --------------------------------- */
const rejects = (label, text, env = ENV, detail) => {
  const r = parse(text, env);
  check(
    label,
    r.errors.length > 0 && r.sites.length === 0,
    detail ?? r.errors[0],
  );
};

rejects("a missing key is rejected", site({ key: undefined }));
rejects(
  "a key with a space is rejected",
  site({ key: "pk test" }),
  ENV,
  "it goes into URLs",
);
rejects("a missing name is rejected", site({ name: undefined }));
rejects("an empty origins list is rejected", site({ origins: [] }));
rejects(
  "an origin with a trailing slash is rejected",
  site({ origins: ["https://shop.example/"] }),
  ENV,
  "allowedOrigin compares exact strings, so this silently blocks the merchant's own site",
);
rejects(
  "an origin with a path is rejected",
  site({ origins: ["https://shop.example/store"] }),
);
rejects(
  "a bare hostname is rejected as an origin",
  site({ origins: ["shop.example"] }),
);
rejects(
  "a relative catalogue URL is rejected",
  site({ catalogFeedUrl: "/catalog.json" }),
);
rejects(
  "a product template without {handle} is rejected",
  site({ productUrlTemplate: "/products/" }),
  ENV,
  "present-and-wrong is worse than absent: every recovery link would point nowhere",
);
rejects(
  "a recoverPath that is not a path is rejected",
  site({ recoverPath: "https://shop.example/recover" }),
);
rejects("a non-hex accent is rejected", site({ accent: "forestgreen" }));
rejects(
  "an unknown payment method is rejected",
  site({ razorpay: { keyIdEnv: "A", keySecretEnv: "B", methods: ["cash"] } }),
);
rejects(
  "a razorpay block without keySecretEnv is rejected",
  site({ razorpay: { keyIdEnv: "A" } }),
);
rejects("a top level that is not an object is rejected", "[]");
rejects("a missing sites list is rejected", '{"shops": []}');

{
  const r = parse('{"sites": [{,}]}', ENV);
  check(
    "malformed JSON is reported as a config error, not a crash",
    r.errors.length === 1,
  );
  check(
    "the JSON error names the trailing-comma cause",
    /trailing comma/i.test(r.errors[0] ?? ""),
    "the merchant is holding a text editor, not a debugger",
  );
}

{
  const two = JSON.stringify({
    sites: [JSON.parse(site()).sites[0], JSON.parse(site()).sites[0]],
  });
  const r = parse(two, ENV);
  check(
    "a duplicate site key is rejected",
    r.errors.some((e) => /more than once/.test(e)),
  );
}

{
  const r = parse('{"sites": []}', ENV);
  check(
    "zero sites is a warning, not an error",
    r.errors.length === 0 && r.warnings.length > 0,
    "a Shopify-only install legitimately has none",
  );
}

/* ---- the secret, which is the part worth being strict about ---------- */
{
  const withDev = site({ devSecret: "dev-fallback" });

  const noEnv = parse(withDev, {});
  check(
    "devSecret works for an explicitly selected development fixture",
    noEnv.sites[0]?.secret === "dev-fallback",
    "the runtime never selects that fixture for a new merchant",
  );

  const bothSet = parse(withDev, ENV);
  check(
    "the environment wins over devSecret",
    bothSet.sites[0]?.secret === "s3cr3t",
    "same order the hardcoded registry used",
  );

  const prod = parse(withDev, {}, true);
  check(
    "devSecret is refused in production",
    prod.errors.some((e) => /devSecret/.test(e)) && prod.sites.length === 0,
    "the old hardcoded fallback would have shipped silently; this one cannot",
  );

  const prodOk = parse(withDev, ENV, true);
  check(
    "production is fine once the variable is set",
    prodOk.errors.length === 0,
  );

  const nothing = parse(site(), {});
  check(
    "an unset secretEnv with no fallback is rejected",
    nothing.errors.some((e) => /SITE_SECRET_TEST is not set/.test(e)),
  );

  const literal = parse(site({ secretEnv: "" }), ENV);
  check("an empty secretEnv is rejected", literal.errors.length > 0);
}

/* ---- named but unset keys warn, and do not block a boot -------------- */
{
  const r = parse(
    site({
      razorpay: {
        keyIdEnv: "RP_ID",
        keySecretEnv: "RP_SECRET",
        webhookSecretEnv: "RP_HOOK",
      },
    }),
    ENV,
  );
  check(
    "a shop whose Razorpay keys are not set yet still boots",
    r.errors.length === 0 && r.sites.length === 1,
    "shape is validated here; reachability is doctor's job",
  );
  check(
    "...but each unset key is named in a warning",
    ["RP_ID", "RP_SECRET", "RP_HOOK"].every((n) =>
      r.warnings.some((w) => w.includes(n)),
    ),
  );
}

/* ---- every error names the field and offers a fix -------------------- */
{
  const r = parse(
    site({ origins: ["https://shop.example/"], accent: "green" }),
    ENV,
  );
  check(
    "errors are reported together rather than one per run",
    r.errors.length === 2,
    "a merchant fixing a config one boot at a time is a bad afternoon",
  );
  check(
    "every error names the offending field path",
    r.errors.every((e) => /^sites\[\d+\]\./.test(e)),
  );
}

/* ---- the shipped files ----------------------------------------------- */
// Both are committed, so a typo in either is a broken clone for everyone.

for (const name of [
  "chapman.config.demo.json",
  "chapman.config.example.json",
]) {
  const p = path.join(process.cwd(), name);
  const exists = fs.existsSync(p);
  check(`${name} is present`, exists);
  if (!exists) continue;
  const r = parse(fs.readFileSync(p, "utf8"), {
    // Pretend every named variable is set, so these assert shape rather than
    // the state of whoever's machine is running the suite.
    SITE_SECRET_NILGIRIPOST: "x",
    SITE_SECRET_MYSTORE: "x",
    RAZORPAY_TEST_API_KEY_ID1: "x",
    RAZORPAY_TEST_API_KEY_SECRET1: "x",
    RAZORPAY_WEBHOOK_SECRET1: "x",
    RAZORPAY_KEY_ID: "x",
    RAZORPAY_KEY_SECRET: "x",
    RAZORPAY_WEBHOOK_SECRET: "x",
  });
  check(`${name} is valid`, r.errors.length === 0, r.errors.join(" | "));
}

check(
  "the runtime discovers only the merchant-owned config",
  CONFIG_FILENAMES.length === 1 &&
    CONFIG_FILENAMES[0] === "chapman.config.json",
  "the demo fixture must be selected explicitly so a new merchant starts empty",
);

/* ---- regression: the demo config equals the registry it replaced ----- */
// Field for field against the array that used to live in sites.server.ts. If
// this block ever fails, the restructure changed a running shop's behaviour.
{
  const text = fs.readFileSync(
    path.join(process.cwd(), "chapman.config.demo.json"),
    "utf8",
  );
  const r = parse(text, {});
  const s = r.sites[0];
  const eq = (field, expected) =>
    check(
      `demo config preserves ${field}`,
      JSON.stringify(s?.[field]) === JSON.stringify(expected),
      `got ${JSON.stringify(s?.[field])}`,
    );

  check(
    "the demo config parses with no environment at all",
    r.errors.length === 0,
    r.errors[0],
  );
  eq("key", "pk_monsoon_market");
  eq("name", "Monsoon Market");
  eq("origins", [
    "http://127.0.0.1:4000",
    "http://localhost:4000",
    "http://127.0.0.1:4100",
  ]);
  eq("catalogFeedUrl", "http://127.0.0.1:4000/catalog.json");
  eq("productUrlTemplate", "/product.html?handle={handle}");
  eq("recoverPath", "/recover");
  eq("restorePath", "/restore");
  eq("greeting", "Ask me about our teas and coffees.");
  eq("accent", "#1f4037");
  eq("orders", { feedUrl: "http://127.0.0.1:4000/api/orders" });
  eq("razorpay", {
    keyIdEnv: "RAZORPAY_TEST_API_KEY_ID1",
    keySecretEnv: "RAZORPAY_TEST_API_KEY_SECRET1",
    webhookSecretEnv: "RAZORPAY_WEBHOOK_SECRET1",
  });
  check(
    "demo config preserves the dev secret the old array fell back to",
    s?.secret === "dev-secret-monsoonmarket-do-not-ship",
    "SITE_SECRET_MONSOON_MARKET is unset on this machine, exactly as before",
  );
  check(
    "demo config still leaves UPI unadvertised",
    s?.razorpay?.methods === undefined,
    "this account cannot take UPI until KYC clears; saying otherwise lies to agents",
  );
}

console.log(
  failed === 0 ? "\nAll config checks passed." : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
