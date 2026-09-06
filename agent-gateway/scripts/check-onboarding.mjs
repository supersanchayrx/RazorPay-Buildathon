/**
 * The empty-account -> first-store transition.
 *
 * This is the boundary the Docker demo depends on: signing in must not create
 * a site, and submitting the authenticated setup form must create exactly one
 * valid site without ever sending a generated secret through the browser.
 *
 * Run: node scripts/check-onboarding.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const cache = path.join(process.cwd(), "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(cache, "onboarding-check-"));

process.env.CHAPMAN_DATA_DIR = sandbox;
process.env.CHAPMAN_CONFIG = path.join(sandbox, "chapman.config.json");
process.env.CHAPMAN_ENV_FILE = path.join(sandbox, ".env");
process.env.NODE_ENV = "production";

async function load(entry, name) {
  const out = path.join(sandbox, name);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href + `?t=${Date.now()}`);
}

const [Auth, Onboarding, Install] = await Promise.all([
  load("app/lib/auth.server.ts", "auth.mjs"),
  load("app/lib/onboarding.server.ts", "onboarding.mjs"),
  load("app/lib/installstatus.server.ts", "install.mjs"),
]);

let failed = 0;
const check = (label, ok, detail) => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  - ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

const input = (overrides = {}) => ({
  name: "Monsoon Market",
  key: "pk_monsoon_market",
  origin: "http://localhost:4000",
  catalogFeedUrl: "http://store:4000/catalog.json",
  productUrlTemplate: "/product.html?handle={handle}",
  ordersFeedUrl: "",
  greeting: "Ask me about our teas and coffees.",
  payments: false,
  ...overrides,
});

try {
  const merchant = Auth.createMerchant({
    email: "merchant@example.com",
    name: "Merchant",
    password: "correct horse battery staple",
    sites: [],
  });

  check(
    "a new merchant account has no storefront grant",
    merchant.sites.length === 0,
  );
  check(
    "signing up did not create a site registry",
    !fs.existsSync(process.env.CHAPMAN_CONFIG),
  );

  const invalid = Onboarding.createFirstStore(
    merchant,
    input({ origin: "http://localhost:4000/" }),
  );
  check("an origin with a trailing slash is rejected", !invalid.ok);
  check(
    "invalid setup writes no config",
    !fs.existsSync(process.env.CHAPMAN_CONFIG),
  );
  check(
    "invalid setup generates no site secret",
    !fs.existsSync(process.env.CHAPMAN_ENV_FILE),
  );

  const created = Onboarding.createFirstStore(merchant, input());
  check("valid first-store setup succeeds", created.ok, created.error);

  const configText = fs.readFileSync(process.env.CHAPMAN_CONFIG, "utf8");
  const config = JSON.parse(configText);
  const envText = fs.readFileSync(process.env.CHAPMAN_ENV_FILE, "utf8");
  const stored = Auth.findMerchantByEmail("merchant@example.com");
  const secret = envText.match(/^SITE_SECRET_MONSOON_MARKET=(.+)$/m)?.[1] ?? "";

  check("exactly one storefront is registered", config.sites?.length === 1);
  check(
    "the registered storefront has the merchant's site key",
    config.sites?.[0]?.key === input().key,
  );
  check("the signing secret is generated server-side", secret.length >= 64);
  check(
    "the config contains only the secret variable name",
    config.sites?.[0]?.secretEnv === "SITE_SECRET_MONSOON_MARKET",
  );
  check(
    "the secret value is absent from the site registry",
    !configText.includes(secret),
  );
  check(
    "the authenticated merchant receives the new site grant",
    stored?.sites.includes(input().key),
  );

  const duplicate = Onboarding.createFirstStore(
    merchant,
    input({ key: "pk_second" }),
  );
  check(
    "first-store onboarding cannot overwrite an existing registry",
    !duplicate.ok,
  );
  check(
    "the rejected second submission leaves one storefront",
    JSON.parse(fs.readFileSync(process.env.CHAPMAN_CONFIG, "utf8")).sites
      .length === 1,
  );

  const cleanFetch = async (url) =>
    url.endsWith("/.well-known/ucp")
      ? new Response("not found", { status: 404 })
      : new Response("<html><body>plain storefront</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
  const site = {
    key: input().key,
    name: input().name,
    origins: [input().origin],
    catalogFeedUrl: input().catalogFeedUrl,
  };
  const clean = await Install.inspectStorefrontInstall(site, cleanFetch);
  check(
    "a registered but untouched storefront is not called installed",
    !clean.assistant.installed && !clean.agentFront.installed,
  );

  const installedFetch = async (url) =>
    url.endsWith("/.well-known/ucp")
      ? Response.json({ ucp: { version: "2026-01-11" } })
      : new Response(
          `<script src="http://localhost:3000/embed.js" data-site="${site.key}"></script>`,
          {
            status: 200,
            headers: { "content-type": "text/html" },
          },
        );
  const installed = await Install.inspectStorefrontInstall(
    site,
    installedFetch,
  );
  check(
    "the assistant is installed only when the matching embed exists",
    installed.assistant.installed,
  );
  check(
    "agent discovery is installed only when a UCP document answers",
    installed.agentFront.installed,
  );

  const wrongKey = await Install.inspectStorefrontInstall(
    { ...site, key: "pk_someone_else" },
    installedFetch,
  );
  check(
    "another storefront's embed does not count",
    !wrongKey.assistant.installed,
  );
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(
  failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`,
);
process.exit(failed ? 1 : 0);
