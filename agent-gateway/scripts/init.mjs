/**
 * `npm run init` — set CHAPMAN up on your own infrastructure.
 *
 * An interview, not a wizard with a progress bar. Every question says what the
 * answer is for and offers a default, because the field people get wrong here
 * — `origins`, by a distance — is wrong for want of one sentence of context,
 * not for want of a form.
 *
 * WHAT IT WRITES, and nothing else:
 *
 *   agent-gateway/chapman.config.json   the site registry, gitignored
 *   ../.env                             the generated secrets, APPEND ONLY
 *   <data dir>/merchants.json           your console account
 *
 * THREE RULES IT KEEPS.
 *
 * 1. It never overwrites a value you already have. An existing
 *    `chapman.config.json` is backed up before it is touched, and only after
 *    you say so; an existing variable in `.env` is left exactly as it is and
 *    reported as kept. Re-running this has to be safe, because the second run
 *    is always the one where you have real data to lose.
 *
 * 2. It never asks you to type a secret. Razorpay keys are NAMED in the config
 *    and their values live in `.env`, so init writes the empty lines and tells
 *    you which to fill. A prompt that echoes a live key into a terminal — and
 *    into whatever is recording that terminal — is a bad prompt to have written.
 *
 * 3. It validates before it writes. The answers go through the same
 *    `parseSitesConfig` the server uses, with `production: true`, so a config
 *    this script produces cannot be one the server then refuses to start on.
 *    That check is the difference between a setup tool and a text templater.
 *
 * Every answer can also arrive by flag, and `--yes` takes every default and
 * asks nothing — which is how a container sets itself up at start.
 *
 *   npm run init
 *   npm run init -- --name "My Store" --origins https://shop.example --yes
 *
 * The pure half lives in `scripts/init-lib.mjs` so `scripts/check-init.mjs` can
 * assert it. This file is the interview and the I/O.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { DATA_DIR } from "./data-dir.mjs";
import {
  accentValid,
  configText,
  emailValid,
  embedTag,
  envAdditions,
  envEntriesFor,
  isExactOrigin,
  keyFromName,
  keyValid,
  originsValid,
  rawBlock,
  required,
  secretEnvFor,
  siteBlock,
  templateValid,
  urlValid,
} from "./init-lib.mjs";

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  cy: (s) => `\x1b[36m${s}\x1b[0m`,
};

const die = (msg) => {
  console.error(`\n${c.r("stopped:")} ${msg}\n`);
  process.exit(1);
};

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const YES = flag("yes");

// Run from the gateway directory or not at all. `findConfigFile()` looks in
// `process.cwd()`, so a config written one directory up would be invisible to
// the server that has to read it — a failure with no error message anywhere.
if (
  !fs.existsSync(path.join(process.cwd(), "app", "lib", "config.server.ts"))
) {
  die(
    `run this from the agent-gateway directory.\n         you are in ${process.cwd()}`,
  );
}

// Write where the server reads, and nowhere else.
//
// Both of these are ordinarily the obvious thing: the config beside the app,
// the `.env` at the repository root, which is what `loadRootEnv()` reads. In a
// container neither is durable — `/app` is a layer and `/` is a layer — so the
// entrypoint points both at the mounted data volume through the same two
// variables the server itself resolves. If these two ever disagree with
// `findConfigFile()` and `loadRootEnv()`, init writes a configuration nothing
// loads and reports success. `scripts/check-docker.mjs` asserts they agree.
const ENV_FILE = process.env.CHAPMAN_ENV_FILE?.trim()
  ? path.resolve(process.env.CHAPMAN_ENV_FILE.trim())
  : path.join(process.cwd(), "..", ".env");

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
 * Asking
 * ------------------------------------------------------------------ */

const interactive = !YES && process.stdin.isTTY;
const rl = interactive
  ? readline.createInterface({ input: process.stdin, output: process.stdout })
  : null;

/**
 * One question.
 *
 * `validate` returns null when the answer is good and a sentence saying what is
 * wrong when it is not. The sentence is shown and the question repeats, so a
 * typo costs one line rather than a failed run and a file to clean up.
 */
async function ask(question, { def, hint, validate, preset } = {}) {
  const check = (v) => (validate ? validate(v) : null);

  // A flag answer is validated too. Automation that passes rubbish should hear
  // about it here, not from the server three commands later.
  if (preset !== undefined && preset !== null && preset !== "") {
    const bad = check(preset);
    if (bad) die(`${question}\n         "${preset}" — ${bad}`);
    return preset;
  }

  if (!rl) {
    const bad = check(def ?? "");
    if (bad)
      die(
        `${question}\n         no answer given and the default is not usable — ${bad}`,
      );
    return def ?? "";
  }

  for (;;) {
    if (hint) console.log(c.dim(`   ${hint}`));
    const suffix = def ? c.dim(` [${def}]`) : "";
    const raw = (
      await rl.question(`   ${c.b(question)}${suffix}\n   > `)
    ).trim();
    const value = raw || def || "";
    const bad = check(value);
    if (!bad) {
      console.log("");
      return value;
    }
    console.log(`   ${c.r("×")} ${bad}`);
  }
}

async function askYesNo(question, def = false) {
  if (!rl) return def;
  for (;;) {
    const raw = (
      await rl.question(
        `   ${c.b(question)} ${c.dim(def ? "[Y/n]" : "[y/N]")}\n   > `,
      )
    )
      .trim()
      .toLowerCase();
    console.log("");
    if (!raw) return def;
    if (["y", "yes"].includes(raw)) return true;
    if (["n", "no"].includes(raw)) return false;
    console.log(`   ${c.r("×")} answer y or n.`);
  }
}

/* ------------------------------------------------------------------ *
 * The interview
 * ------------------------------------------------------------------ */

const rel = (p) => {
  const r = path.relative(process.cwd(), p).replace(/\\/g, "/");
  // A CHAPMAN_DATA_DIR elsewhere on the disk relativises into a ladder of ../..
  // that is harder to read than the absolute path it came from.
  return r.startsWith("../..") ? p.replace(/\\/g, "/") : r;
};

console.log(`
${c.b("CHAPMAN setup")}

  This asks about your storefront, generates the secrets, and writes:

    ${c.cy(rel(process.env.CHAPMAN_DATABASE_PATH || path.join(DATA_DIR, "chapman.sqlite")))}   storefront and console account
    ${c.cy(rel(ENV_FILE))}   generated secrets, appended

  Nothing already stored is overwritten. Press enter to take a
  default. Ctrl-C is safe at any point — nothing is written until the end.
`);

if (!interactive && !YES) {
  console.log(
    `  ${c.y("Not a terminal")}, so every question takes its default or its flag.\n` +
      `  Pass ${c.cy("--yes")} to say that is what you meant.\n`,
  );
}

/* ---- an existing config decides what kind of run this is ------------- */

const SITE_DB = await load("app/lib/sites.server.ts", "init-sites.mjs");
const DATABASE = await load("app/lib/database.server.ts", "init-database.mjs");
const carried = SITE_DB.allSites();

/* ---- the shop -------------------------------------------------------- */

console.log(c.b("\n  Your storefront\n"));

const name = await ask("What is the shop called?", {
  preset: arg("name"),
  def: "My Store",
  validate: required("A name"),
  hint: "Shown to shoppers as the shop the assistant is answering for.",
});

const key = await ask("Short key for it?", {
  preset: arg("key"),
  def: keyFromName(name),
  validate: (v) =>
    keyValid(v) ??
    (carried.some((s) => s?.key === v)
      ? `"${v}" is already in this config.`
      : null),
  hint: "Goes in the embed tag and in your UCP URLs. Public, and permanent-ish — changing it later orphans the shop's stored data.",
});

const originsRaw = await ask("Which origins will the widget be embedded on?", {
  preset: arg("origins"),
  def: "http://localhost:4000",
  validate: originsValid,
  hint: "Comma-separated, scheme and host only. https://shop.example and https://www.shop.example are two different origins to a browser, and so are http and https — list every one you serve from.",
});
const origins = originsRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const catalogFeedUrl = await ask("Where is your product feed?", {
  preset: arg("catalog"),
  def: `${origins[0]}/catalog.json`,
  validate: urlValid,
  hint: "JSON, reachable from wherever CHAPMAN runs — which is not necessarily from your laptop. The shape is in docs/catalog-format.md.",
});

const productUrlTemplate = await ask("How do product URLs look?", {
  preset: arg("product-url"),
  def: "/products/{handle}",
  validate: templateValid,
  hint: "With {handle} where the product's handle goes. Leave empty if your URLs cannot be built that way — every link then falls back to your front page.",
});

// Not asked. Two paths that only matter if the merchant proxies our recovery
// pages from their own domain, which is a paragraph of explanation for a field
// most shops will never set — so it is a flag rather than a question, and the
// demo container passes it. A hand-written value survives a re-run either way:
// carried sites are re-emitted verbatim.
const recoverPath = arg("recover-path");
const restorePath = arg("restore-path");

const greeting = await ask("First line the widget shows?", {
  preset: arg("greeting"),
  def: "Ask me anything about our products.",
});

const accent = await ask("Accent colour?", {
  preset: arg("accent"),
  def: "#1f2937",
  validate: accentValid,
});

/* ---- order access ---------------------------------------------------- */

console.log(c.b("\n  Order history\n"));
console.log(
  c.dim(
    "  Off by default, because turning it on changes what the assistant can say\n" +
      "  about a person. Without it the assistant answers from your catalogue and\n" +
      "  declines anything personal — a perfectly good state for a shop to be in.\n",
  ),
);

const ordersFeedFlag = arg("orders-feed");
const wantOrders =
  ordersFeedFlag !== undefined ||
  (await askYesNo(
    "Publish an order feed, so shoppers can ask about their orders?",
    false,
  ));
const orders = wantOrders
  ? {
      feedUrl: await ask("Where is it?", {
        preset: ordersFeedFlag,
        def: `${origins[0]}/api/orders`,
        validate: urlValid,
        hint: "Read-only, on your side. We sign our requests to it with this shop's secret, so you can verify they came from us.",
      }),
    }
  : null;

/* ---- payments -------------------------------------------------------- */

console.log(c.b("\n  Payments\n"));
console.log(
  c.dim(
    "  Only needed if CHAPMAN takes payment for you. You name the variables here;\n" +
      "  the values go in your .env, which this script will not ask you to type.\n",
  ),
);

const wantPay =
  flag("razorpay") ||
  (await askYesNo("Take payment through CHAPMAN, via Razorpay?", false));
const razorpay = wantPay
  ? {
      keyIdEnv: await ask("Variable name for the key id?", {
        preset: arg("razorpay-key-id-env"),
        def: "RAZORPAY_KEY_ID",
        validate: required("A variable name"),
      }),
      keySecretEnv: await ask("Variable name for the key secret?", {
        preset: arg("razorpay-key-secret-env"),
        def: "RAZORPAY_KEY_SECRET",
        validate: required("A variable name"),
      }),
      webhookSecretEnv: await ask("Variable name for the webhook secret?", {
        preset: arg("razorpay-webhook-secret-env"),
        def: "RAZORPAY_WEBHOOK_SECRET",
        validate: required("A variable name"),
        hint: "Strongly recommended. Without a webhook, settlement rides the browser return path and a buyer who closes the tab after paying gets no order.",
      }),
    }
  : null;

/* ---- where CHAPMAN itself lives -------------------------------------- */

console.log(c.b("\n  This gateway\n"));

const gatewayOrigin = await ask("Where will CHAPMAN itself be reachable?", {
  preset: arg("gateway"),
  def: "http://localhost:3000",
  validate: (v) =>
    urlValid(v) ??
    (isExactOrigin(v)
      ? null
      : "scheme and host only, no path and no trailing slash."),
  hint: "The origin your embed tag points at, and the base for the recovery links we send shoppers.",
});

/* ---- the console account --------------------------------------------- */

console.log(c.b("\n  Your console account\n"));

const { createMerchant, grantSite, readMerchants } = await load(
  "app/lib/auth.server.ts",
  "init-auth.mjs",
);
const existingAccounts = readMerchants();
if (existingAccounts.length > 0) {
  console.log(
    c.dim(
      `  Already here: ${existingAccounts.map((m) => m.email).join(", ")}\n`,
    ),
  );
}

const email = await ask("Email to sign in with?", {
  preset: arg("email"),
  def: existingAccounts[0]?.email ?? "you@example.com",
  validate: emailValid,
  hint: "There is no sign-up page. Accounts are made here or with npm run merchant:add — a console anyone can register for is a console anyone can probe.",
});

/* ------------------------------------------------------------------ *
 * Validate, then write
 * ------------------------------------------------------------------ */

rl?.close();

const secretEnv = secretEnvFor(key);
const siteSecret = randomSecret();

const site = {
  key,
  name,
  origins,
  catalogFeedUrl,
  productUrlTemplate: productUrlTemplate.trim() || undefined,
  recoverPath,
  restorePath,
  greeting,
  accent,
  secretEnv,
  orders,
  razorpay,
};

const text = configText([...carried.map(rawBlock), siteBlock(site)]);

// The gate. Parsed with `production: true`, and with secrets resolved exactly
// as the server resolves them: `secret()` loads the repo-root .env, which is
// where a CARRIED site's secret already lives. Reading process.env alone made
// every "add a second storefront" run fail on the first storefront.
const { parseSitesConfig } = await load(
  "app/lib/config.server.ts",
  "init-config.mjs",
);
const { secret: envSecret } = await load(
  "app/lib/env.server.ts",
  "init-env.mjs",
);
const report = parseSitesConfig(text, "chapman.config.json", {
  resolveSecret: (n) => (n === secretEnv ? siteSecret : envSecret(n)),
  production: true,
});

// Errors are prefixed `sites[N].`, and the site just built is the last one.
// Splitting on that matters: a problem in a storefront that was already in the
// file is no reason to throw away answers someone has just typed, and blaming
// init for it would send them looking in the wrong place.
const mine = `sites[${carried.length}].`;
const newErrors = report.errors.filter((e) => e.startsWith(mine));
const oldErrors = report.errors.filter((e) => !e.startsWith(mine));

if (newErrors.length > 0) {
  console.error(
    `\n${c.r("This would not have started, so nothing was written:")}`,
  );
  for (const e of newErrors) console.error(`  - ${e}`);
  console.error(
    `\n  If the storefront you just described is a reasonable one, that is a bug in\n` +
      `  npm run init rather than in your answers. Meanwhile: copy\n` +
      `  chapman.config.example.json to chapman.config.json and edit it by hand.\n`,
  );
  process.exit(1);
}

/* ---- config ---------------------------------------------------------- */

SITE_DB.saveSite(site);

/* ---- .env ------------------------------------------------------------ */

let envText = "";
try {
  envText = fs.readFileSync(ENV_FILE, "utf8");
} catch {
  /* absent is fine — we are about to create it */
}
const env = envAdditions(
  envText,
  envEntriesFor({
    site,
    siteSecret,
    consoleSecret: randomSecret(),
    gatewayOrigin,
  }),
);
if (env.append) {
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.appendFileSync(ENV_FILE, env.append, "utf8");
}

/* ---- console account -------------------------------------------------- */

const password = arg("password") ?? crypto.randomBytes(9).toString("base64url");
let accountLine;
let accountPassword = null;
try {
  const m = createMerchant({ email, name, password, sites: [key] });
  accountLine = `created ${m.email}`;
  accountPassword = password;
} catch (e) {
  if (String(e?.message ?? e).includes("already exists")) {
    const m = grantSite(email, key);
    accountLine = `kept ${email} — it can now reach ${m.sites.join(", ")}.`;
  } else {
    accountLine = `${c.r("could not create the account")} — ${String(e?.message ?? e)}`;
  }
}

/* ------------------------------------------------------------------ *
 * What just happened, and what to do next
 * ------------------------------------------------------------------ */

console.log(`\n${c.g("Done.")}\n`);
console.log(`  ${c.cy(DATABASE.databasePath())}`);
console.log(
  `     ${carried.length ? `${carried.length} existing storefront${carried.length === 1 ? "" : "s"} kept, ` : ""}${c.b(key)} added`,
);
console.log(`  ${c.cy(rel(ENV_FILE))}`);
if (env.added.length)
  console.log(`     added ${env.added.map((k) => c.b(k)).join(", ")}`);
if (env.kept.length)
  console.log(
    `     ${c.dim(`already set, left alone: ${env.kept.join(", ")}`)}`,
  );
console.log(`  ${c.cy(DATABASE.databasePath())}`);
console.log(`     ${accountLine}`);
if (accountPassword) {
  console.log(`     password: ${c.b(accountPassword)}`);
  console.log(
    `     ${c.dim("stored scrypt-hashed. This is the only time it is shown.")}`,
  );
}

if (razorpay) {
  console.log(
    `\n  ${c.y("Before payments work")}, fill these in ${rel(ENV_FILE)}:`,
  );
  console.log(
    `     ${razorpay.keyIdEnv}, ${razorpay.keySecretEnv}, ${razorpay.webhookSecretEnv}`,
  );
  console.log(
    `  ${c.dim(`then register the webhook at ${gatewayOrigin}/webhooks/razorpay/${key}`)}`,
  );
}

if (oldErrors.length > 0) {
  console.log(
    `\n  ${c.r("But the server will not start.")} A storefront that was already in`,
  );
  console.log(
    `  this file is not valid. That was true before this run, and still is:`,
  );
  for (const e of oldErrors) console.log(`     - ${e}`);
}

for (const w of report.warnings) console.log(`\n  ${c.y("note")}  ${w}`);

const tag = embedTag(gatewayOrigin, key)
  .split("\n")
  .map((l) => `     ${c.cy(l)}`)
  .join("\n");

console.log(`
${c.b("  Start it")}

     npm run dev:gateway            ${c.dim("development")}
     npm run build && npm start     ${c.dim("production")}

${c.b("  Then")}

     npm run doctor                 ${c.dim("check what is reachable and what is not")}
     ${gatewayOrigin}/login${" ".repeat(Math.max(1, 24 - gatewayOrigin.length))}${c.dim("sign in")}

${c.b("  And paste this into your storefront template, before </body>")}

${tag}

  ${c.dim("That one tag is the whole integration. Everything else — agent access,")}
  ${c.dim("basket recovery, order lookup — is optional. See INSTALL.md.")}
`);
