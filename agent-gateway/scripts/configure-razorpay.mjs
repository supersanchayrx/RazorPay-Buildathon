/**
 * Link a registered site to the canonical Razorpay variables.
 *
 * Docker usage from the repository root:
 *
 *   docker compose run --rm gateway npm run site:enable-razorpay -- --site pk_monsoon_market
 *   docker compose up -d --force-recreate gateway
 *
 * The first command changes only the durable config volume. The second is
 * required because the running server intentionally caches site config and a
 * container's environment cannot change after that container is created.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import {
  DEFAULT_RAZORPAY_REF,
  linkRazorpay,
} from "./configure-razorpay-lib.mjs";

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const stop = (message) => {
  console.error(`\nstopped: ${message}\n`);
  process.exit(1);
};
const present = (name) => Boolean(process.env[name]?.trim());

if (!present(DEFAULT_RAZORPAY_REF.keyIdEnv)) {
  stop("RAZORPAY_KEY_ID is empty. Add the test Key ID to the root .env first.");
}
if (!present(DEFAULT_RAZORPAY_REF.keySecretEnv)) {
  stop(
    "RAZORPAY_KEY_SECRET is empty. Add the test Key Secret to the root .env first.",
  );
}

let siteKey = valueAfter("site")?.trim() || process.env.CHAPMAN_SITE_KEY?.trim();

/**
 * Docker's current self-hosted mode keeps registered storefronts in SQLite.
 * Use the same validated linker as the Features page rather than manufacturing
 * a second legacy JSON registry beside the authoritative database.
 */
if (process.env.CHAPMAN_DATABASE_PATH?.trim()) {
  if (!siteKey) stop("pass --site <public-site-key>; it cannot be inferred safely");
  const out = path.join(
    process.cwd(),
    "node_modules",
    ".cache",
    "configure-razorpay-database.mjs",
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await esbuild.build({
    entryPoints: ["app/lib/sitepayments.server.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    logLevel: "silent",
  });
  const { linkAgentRazorpay } = await import(
    `${pathToFileURL(out).href}?at=${Date.now()}`
  );
  let result;
  try {
    result = linkAgentRazorpay(siteKey, {
      resolveSecret: (name) => process.env[name]?.trim() || null,
    });
  } catch (error) {
    stop(error instanceof Error ? error.message : String(error));
  }
  console.log(
    result.changed
      ? `\nRazorpay linked for ${siteKey} in ${result.file}.`
      : `\nRazorpay is already linked for ${siteKey}. No database row was changed.`,
  );
  console.log("  Key ID: RAZORPAY_KEY_ID (set)");
  console.log("  Key Secret: RAZORPAY_KEY_SECRET (set)");
  console.log(
    `  Webhook Secret: RAZORPAY_WEBHOOK_SECRET (${present("RAZORPAY_WEBHOOK_SECRET") ? "set" : "optional, not set"})`,
  );
  console.log(
    "\nNow recreate the gateway: docker compose up -d --force-recreate gateway\n",
  );
  process.exit(0);
}

const configFile = path.resolve(
  process.env.CHAPMAN_CONFIG?.trim() ||
    path.join(process.cwd(), "chapman.config.json"),
);
if (!fs.existsSync(configFile)) {
  stop(`no Chapman config exists at ${configFile}; register the storefront first`);
}

async function loadConfigModule() {
  const out = path.join(
    process.cwd(),
    "node_modules",
    ".cache",
    "configure-razorpay-config.mjs",
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await esbuild.build({
    entryPoints: ["app/lib/config.server.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    logLevel: "silent",
  });
  // A query prevents an earlier invocation in this Node process from reusing
  // a stale module. It costs nothing in the normal one-command process.
  return import(`${pathToFileURL(out).href}?at=${Date.now()}`);
}

const raw = fs.readFileSync(configFile, "utf8");
const { parseSitesConfig, stripJsonComments } = await loadConfigModule();
let parsed;
try {
  parsed = JSON.parse(stripJsonComments(raw));
} catch (error) {
  stop(`the existing config is not valid JSON: ${error.message}`);
}

if (!siteKey && Array.isArray(parsed.sites) && parsed.sites.length === 1) {
  siteKey = parsed.sites[0]?.key;
}
if (!siteKey) {
  stop("pass --site <public-site-key>; it cannot be inferred safely");
}

let result;
try {
  result = linkRazorpay(parsed, siteKey);
} catch (error) {
  stop(error.message);
}

if (!result.changed) {
  console.log(`\nRazorpay is already linked for ${siteKey}. No config was changed.`);
} else {
  const nextText = `${JSON.stringify(result.config, null, 2)}\n`;
  const report = parseSitesConfig(nextText, configFile, {
    production: true,
    resolveSecret: (name) => process.env[name]?.trim() || null,
  });
  if (report.errors.length > 0) {
    stop(`the updated config did not validate:\n  - ${report.errors.join("\n  - ")}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${configFile}.before-razorpay-${stamp}`;
  const temporary = `${configFile}.tmp-${process.pid}`;
  fs.copyFileSync(configFile, backup, fs.constants.COPYFILE_EXCL);
  try {
    fs.writeFileSync(temporary, nextText, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, configFile);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The original config is still intact; failure to remove a temp file does
      // not justify hiding the write error that matters.
    }
    stop(`could not replace ${configFile}: ${error.message}`);
  }

  console.log(`\nRazorpay linked for ${siteKey}.`);
  console.log(`  config: ${configFile}`);
  console.log(`  backup: ${backup}`);
  console.log("  Key ID: RAZORPAY_KEY_ID (set)");
  console.log("  Key Secret: RAZORPAY_KEY_SECRET (set)");
  console.log(
    `  Webhook Secret: RAZORPAY_WEBHOOK_SECRET (${present("RAZORPAY_WEBHOOK_SECRET") ? "set" : "optional, not set"})`,
  );
}

console.log(
  "\nNow recreate the gateway: docker compose up -d --force-recreate gateway\n",
);
