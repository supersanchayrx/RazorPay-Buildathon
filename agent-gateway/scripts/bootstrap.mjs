/**
 * `npm run bootstrap` — make an install runnable, without asking anything.
 *
 * This is the container's half of `npm run init`. Init is an interview: it
 * assumes a person, a terminal, and a shop that does not exist yet. A container
 * has none of those, and it starts again every time it is replaced. What it
 * needs is narrower, and it has to be idempotent:
 *
 *   1. Every site in the config can resolve a signing secret.
 *   2. Somebody can sign in to the console.
 *
 * WHY THIS EXISTS AT ALL. `react-router-serve` sets `NODE_ENV=production`, and
 * `config.server.ts` refuses to honour `devSecret` in production — deliberately,
 * so a throwaway secret committed to a public repository can never sign a real
 * shopper's session. A container that just runs `npm start` on the shipped demo
 * config therefore 500s on every route that resolves a site, with a correct and
 * unhelpful-looking error. Generating the secret at first boot is the fix, and
 * it has to happen where the data volume is, not where the image is.
 *
 * THE ONE RULE: it never overwrites a value that already exists. Every run after
 * the first should do nothing, and say so. That matters more here than in init,
 * because this runs unattended on every restart — a script that rotates a secret
 * on boot signs every shopper out on every boot, and the symptom (people being
 * logged out at random) never points back at the cause.
 *
 * Secrets are written by NAME and never printed. The console password is the one
 * exception, printed once, at creation, because there is no other way to learn
 * it.
 *
 *   npm run bootstrap
 *   npm run bootstrap -- --email me@shop.example
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { DATA_DIR } from "./data-dir.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : fallback;
};

/** The house pattern: bundle a `.server` module so bare Node can import it. */
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

const randomSecret = () => crypto.randomBytes(32).toString("hex");

/* ------------------------------------------------------------------ *
 * Where things live
 * ------------------------------------------------------------------ */

// Must agree with `loadRootEnv()` in app/lib/env.server.ts and with the same two
// lines in scripts/init.mjs. If they drift, this writes variables the server
// never loads and then reports success — the worst shape of failure, because
// everything it says is true and nothing works. check-docker.mjs asserts it.
const ENV_FILE = process.env.CHAPMAN_ENV_FILE?.trim()
  ? path.resolve(process.env.CHAPMAN_ENV_FILE.trim())
  : path.join(process.cwd(), "..", ".env");

const { findConfigFile, stripJsonComments } = await load(
  "app/lib/config.server.ts",
  "bootstrap-config.mjs",
);

const configFile = findConfigFile();
if (!configFile) {
  // A merchant account is deliberately independent of a storefront. The
  // owner signs in first, then registers the site they actually own.
  console.log(
    "bootstrap: no site registry found — starting in onboarding mode.",
  );
}

let sites = [];
if (configFile) {
  try {
    const parsed = JSON.parse(
      stripJsonComments(fs.readFileSync(configFile, "utf8")),
    );
    sites = Array.isArray(parsed?.sites) ? parsed.sites : [];
  } catch (e) {
    console.error(`bootstrap: ${configFile} is not valid JSON — ${e.message}`);
    console.error("           Fix it and start again. Nothing was written.");
    process.exit(1);
  }

  console.log(`bootstrap: config ${configFile}`);
}
console.log(`bootstrap: data   ${DATA_DIR}`);

/* ------------------------------------------------------------------ *
 * 1. Signing secrets
 * ------------------------------------------------------------------ */

let envText = "";
try {
  envText = fs.readFileSync(ENV_FILE, "utf8");
} catch {
  /* absent is fine — we are about to create it */
}

/**
 * Is this variable already set, in the environment or in the file we are about
 * to append to?
 *
 * Both halves matter. The environment half means an orchestrator that injects a
 * real secret wins and we stay out of the way. The file half means the second
 * boot does not append a second, different value under the same name — which
 * `loadRootEnv` would silently resolve to whichever line it read first.
 */
const alreadySet = (name) =>
  (process.env[name] ?? "").length > 0 ||
  new RegExp(`^\\s*${name}\\s*=\\s*\\S`, "m").test(envText);

const additions = [];
const added = [];
const kept = [];

const want = (name, value, comment) => {
  if (!name) return;
  if (alreadySet(name)) {
    kept.push(name);
    return;
  }
  additions.push(`\n# ${comment}\n${name}=${value}\n`);
  added.push(name);
  // So a later want() in this same run sees it, and so anything spawned after
  // this does too, without waiting for a re-read.
  process.env[name] = value;
  envText += `\n${name}=${value}\n`;
};

for (const site of sites) {
  const name = typeof site?.secretEnv === "string" ? site.secretEnv.trim() : "";
  if (!name) {
    console.log(
      `  secrets: ${site?.key ?? "(unnamed site)"} names no secretEnv — skipped.`,
    );
    continue;
  }
  want(
    name,
    randomSecret(),
    `Signs shopper session tokens for ${site.key}, and our requests to its order feed.\n` +
      "# Generated at first boot. Rotating it signs every shopper out.",
  );
}

want(
  "CONSOLE_SESSION_SECRET",
  randomSecret(),
  "Signs merchant console sessions. Generated at first boot so that two\n" +
    "# processes reading the same volume accept each other's sessions.",
);

if (additions.length > 0) {
  const isNew = !fs.existsSync(ENV_FILE);
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.appendFileSync(
    ENV_FILE,
    (isNew
      ? "# Written by npm run bootstrap. Values, not names — keep it off version control.\n"
      : "") + additions.join(""),
    "utf8",
  );
}

console.log(
  `  secrets: ${added.length ? `generated ${added.join(", ")}` : "nothing to generate"}`,
);
if (kept.length)
  console.log(`  secrets: already set, left alone — ${kept.join(", ")}`);
if (added.length) console.log(`  secrets: written to ${ENV_FILE}`);

/* ------------------------------------------------------------------ *
 * 2. A console account
 * ------------------------------------------------------------------ */

const { createMerchant, readMerchants } = await load(
  "app/lib/auth.server.ts",
  "bootstrap-auth.mjs",
);

const existing = readMerchants();
const keys = sites
  .map((s) => s?.key)
  .filter((k) => typeof k === "string" && k.length > 0);

if (existing.length > 0) {
  console.log(
    `  console: ${existing.length} account${existing.length === 1 ? "" : "s"} already — ${existing
      .map((m) => m.email)
      .join(", ")}`,
  );
} else {
  const email = arg(
    "email",
    process.env.CHAPMAN_CONSOLE_EMAIL?.trim() || "merchant@example.com",
  );
  // Generated rather than fixed. A container image whose console password is in
  // its Dockerfile is a container image with no console password. This is shown
  // once, here, and cannot be read back out afterwards.
  const password = arg(
    "password",
    process.env.CHAPMAN_CONSOLE_PASSWORD?.trim() ||
      crypto.randomBytes(9).toString("base64url"),
  );
  try {
    const m = createMerchant({
      email,
      name: sites[0]?.name ?? "Merchant",
      password,
      sites: keys,
    });
    console.log("");
    console.log("  +-- console sign-in ---------------------------------");
    console.log(`  |   email:    ${m.email}`);
    console.log(`  |   password: ${password}`);
    console.log(
      `  |   shops:    ${keys.join(", ") || "none yet — finish setup in the dashboard"}`,
    );
    console.log("  +-- stored scrypt-hashed. Shown once, and only here. -");
    console.log("");
  } catch (e) {
    console.log(
      `  console: could not create an account — ${String(e?.message ?? e)}`,
    );
  }
}
