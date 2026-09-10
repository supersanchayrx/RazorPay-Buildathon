/**
 * `npm run doctor` — what is configured, what is reachable, and what is not.
 *
 * The question this answers is the one nobody can answer from a stack trace:
 * "I have set this up; is it going to work?" Configuration in CHAPMAN is spread
 * across a JSON file, an `.env`, a data directory and, optionally, someone
 * else's HTTP endpoint. Each of those fails differently and most of them fail
 * silently — an unreachable catalogue feed surfaces as an assistant that knows
 * about no products, which reads as a bad model rather than a bad URL.
 *
 * FOUR VERDICTS, and the distinction between the last three is the point:
 *
 *   PASS   checked, and fine.
 *   FAIL   this will not work. Every FAIL carries the command or the edit that
 *          fixes it. Any FAIL exits non-zero.
 *   WARN   works now, will bite later — a demo secret in production, a Razorpay
 *          key named but unset, an empty data directory.
 *   SKIP   not configured, and did not need to be. Shopify, voice and payments
 *          are all optional, and a diagnostic that shouts about the features
 *          you deliberately did not turn on is a diagnostic people stop reading.
 *
 * Network checks are real fetches with a short timeout. `--offline` drops them
 * all, which is what `npm run check` uses: the check suite must not need the
 * internet or a running demo store to pass.
 *
 *   npm run doctor
 *   npm run doctor -- --url http://localhost:3000   also probe a running gateway
 *   npm run doctor -- --offline                     configuration only
 *   npm run doctor -- --json                        for a script to read
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const OFFLINE = flag("offline");
const JSON_OUT = flag("json");
const URL_BASE = arg("url")?.replace(/\/+$/, "") ?? null;
const TIMEOUT_MS = Number(arg("timeout", "6000"));

const useColour = !JSON_OUT && process.stdout.isTTY;
const paint = (code) => (s) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  dim: paint(2),
  b: paint(1),
  g: paint(32),
  y: paint(33),
  r: paint(31),
  cy: paint(36),
};

if (
  !fs.existsSync(path.join(process.cwd(), "app", "lib", "config.server.ts"))
) {
  console.error(
    `\nstopped: run this from the agent-gateway directory. You are in ${process.cwd()}\n`,
  );
  process.exit(1);
}

/**
 * One bundle for every module doctor needs.
 *
 * Bundling each separately would give each its own copy of `env.server`'s
 * "already loaded" flag and `paths.server`'s cached root — so two modules could
 * disagree about the data directory inside one diagnostic run, which is exactly
 * the class of bug this script exists to catch. A single synthetic entry keeps
 * one module graph, the same one the server has.
 */
const ENTRY = `
export { readConfig, CONFIG_FILENAMES, findConfigFile } from "./app/lib/config.server";
export { secret, describe, loadRootEnv } from "./app/lib/env.server";
export { dataDir, dataPath } from "./app/lib/paths.server";
export { SWITCHES, ALWAYS_ON, readFlags } from "./app/lib/featureflags.server";
export { isConfigured as openrouterReady } from "./app/lib/openrouter.server";
export { isConfigured as razorpayReady } from "./app/lib/razorpay.server";
export { missing as voiceMissing } from "./app/lib/voice.server";
export { shopifyConfigured } from "./app/shopify.server";
export { readMerchants } from "./app/lib/auth.server";
export { allSites } from "./app/lib/sites.server";
export { databaseHealth, databasePath } from "./app/lib/database.server";
`;

const out = path.join(process.cwd(), "node_modules", ".cache", "doctor.mjs");
fs.mkdirSync(path.dirname(out), { recursive: true });
await esbuild.build({
  stdin: {
    contents: ENTRY,
    resolveDir: process.cwd(),
    loader: "ts",
    sourcefile: "doctor-entry.ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "silent",
  // Keep the real dependencies external. Bundling the Shopify SDK and its
  // transitive world costs seconds and proves nothing about this install.
  packages: "external",
});
const lib = await import(pathToFileURL(out).href);

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const rows = [];
let section = "";

const heading = (title) => {
  section = title;
  if (!JSON_OUT) console.log(`\n${c.b(title)}`);
};

const MARK = {
  PASS: c.g("PASS"),
  FAIL: c.r("FAIL"),
  WARN: c.y("WARN"),
  SKIP: c.dim("SKIP"),
};

function say(status, label, detail, fix) {
  rows.push({
    section,
    status,
    label,
    detail: detail ?? null,
    fix: fix ?? null,
  });
  if (JSON_OUT) return;
  console.log(
    `  ${MARK[status]}  ${label}${detail ? `  ${c.dim(detail)}` : ""}`,
  );
  if (fix) console.log(`        ${c.cy("fix:")} ${fix}`);
}

const pass = (l, d) => say("PASS", l, d);
const fail = (l, d, fix) => say("FAIL", l, d, fix);
const warn = (l, d, fix) => say("WARN", l, d, fix);
const skip = (l, d) => say("SKIP", l, d);

/**
 * Every network call in this script goes through here, so none can hang.
 *
 * The timer is owned and cleared rather than left to `AbortSignal.timeout()`:
 * that one stays armed after the fetch resolves, and a live libuv timer at
 * `process.exit()` trips an assertion inside libuv on Windows. The diagnostic
 * printing a crash after its own summary is not a good look for a diagnostic.
 */
async function reach(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    return { ok: true, res };
  } catch (e) {
    const msg = String(e?.message ?? e);
    return {
      ok: false,
      why: ctl.signal.aborted ? `no answer in ${TIMEOUT_MS}ms` : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * 1. This machine
 * ------------------------------------------------------------------ */

heading("This machine");

{
  const engines = JSON.parse(fs.readFileSync("package.json", "utf8")).engines
    ?.node;
  const major = Number(process.versions.node.split(".")[0]);
  // The range in package.json excludes 22.0–22.11; .npmrc sets engine-strict,
  // so npm has already refused to install on a version outside it. Restating
  // the range beats re-implementing semver here.
  const ok = major >= 22;
  say(
    ok ? "PASS" : "FAIL",
    "Node",
    `${process.versions.node}, needs ${engines}`,
    ok ? null : `install Node ${engines}`,
  );
}

{
  const built = fs.existsSync(path.join("build", "server", "index.js"));
  if (built) pass("Production build", "build/server/index.js is present");
  else
    skip(
      "Production build",
      "not built — fine for npm run dev:gateway, needed before npm start (npm run build)",
    );
}

/* ------------------------------------------------------------------ *
 * 2. Configuration
 * ------------------------------------------------------------------ */

heading("Configuration");

const production = process.env.NODE_ENV === "production";
say(
  "PASS",
  "NODE_ENV",
  production
    ? "production — development fallbacks are refused"
    : `${process.env.NODE_ENV ?? "unset"} — development fallbacks are allowed`,
);

const report = lib.readConfig();
let sites = report.sites;

if (!report.source) {
  sites = lib.allSites();
  if (sites.length) pass("Site registry", `${sites.length} storefront(s) in SQLite`);
  else
    fail(
      "Site registry",
      "no configured storefront in SQLite",
      "sign in and choose Configure storefront, or run npm run init — for Shopify-only installs, ignore this",
    );
} else {
  const name = path.basename(report.source);
  if (name === "chapman.config.demo.json") {
    warn(
      "Site registry",
      `using the explicitly selected demo fixture, ${name}`,
      "unset CHAPMAN_CONFIG or point it at your own chapman.config.json",
    );
  } else {
    pass("Site registry", report.source.replace(/\\/g, "/"));
  }
}

if (report.errors.length > 0) {
  for (const e of report.errors)
    fail("Config", e, "edit the file above and run this again");
} else if (report.source) {
  pass(
    "Config validates",
    `${sites.length} storefront${sites.length === 1 ? "" : "s"}`,
  );
}
for (const w of report.warnings) warn("Config", w);

/* ------------------------------------------------------------------ *
 * 3. Secrets and data
 * ------------------------------------------------------------------ */

heading("Secrets");

{
  const envFile = path.join(process.cwd(), "..", ".env");
  if (fs.existsSync(envFile)) pass(".env", envFile.replace(/\\/g, "/"));
  else
    skip(
      ".env",
      "none at the repo root — fine if the environment is set another way, e.g. by Docker",
    );
}

{
  const set = Boolean(lib.secret("CONSOLE_SESSION_SECRET"));
  const fallback = lib.dataPath(".session-secret");
  if (set) pass("CONSOLE_SESSION_SECRET", "set");
  else if (production)
    warn(
      "CONSOLE_SESSION_SECRET",
      `unset, falling back to ${path.basename(fallback)} in the data directory`,
      "set it in .env — the file fallback is per-process, so two containers will not accept each other's sessions",
    );
  else
    skip(
      "CONSOLE_SESSION_SECRET",
      "unset, generated into the data directory on first run",
    );
}

heading("Data directory");

{
  const dir = lib.dataDir();
  const configured = Boolean(process.env.CHAPMAN_DATA_DIR?.trim());
  const probe = path.join(dir, `.doctor-${process.pid}`);
  try {
    fs.writeFileSync(probe, "x");
    fs.rmSync(probe);
    pass(
      "Writable",
      `${dir.replace(/\\/g, "/")}${configured ? "" : " (default — set CHAPMAN_DATA_DIR to move it off the repo)"}`,
    );
  } catch (e) {
    fail(
      "Writable",
      `${dir.replace(/\\/g, "/")} — ${e.message}`,
      "create it, or point CHAPMAN_DATA_DIR somewhere writable",
    );
  }

  const files = ["chapman.sqlite", "backups"];
  const have = files.filter((f) => fs.existsSync(path.join(dir, f)));
  if (have.length === 0)
    skip("Contents", "empty — nothing has been written yet");
  else pass("Contents", have.join(", "));
}

try {
  const health = lib.databaseHealth();
  pass(
    "SQLite",
    `${lib.databasePath().replace(/\\/g, "/")} — migration ${health.migration.current}/${health.migration.expected}, WAL, foreign keys on`,
  );
} catch (e) {
  fail(
    "SQLite",
    e.message,
    "check the mounted volume permissions, then run npm run db:migrate",
  );
}

{
  const accounts = lib.readMerchants();
  if (accounts.length > 0)
    pass("Console accounts", accounts.map((m) => m.email).join(", "));
  else
    warn(
      "Console accounts",
      "none — nobody can sign in to the merchant console",
      "npm run init, or npm run merchant:add -- --email you@shop.com --name 'My Store' --sites <key>",
    );
}

/* ------------------------------------------------------------------ *
 * 4. Each storefront
 * ------------------------------------------------------------------ */

for (const site of sites) {
  heading(`Storefront: ${site.key}  ${c.dim(site.name)}`);

  pass("Origins", site.origins.join(", "));
  if (
    site.origins.some(
      (o) =>
        o.startsWith("http://") &&
        !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(o),
    )
  ) {
    warn(
      "Origins",
      "an origin is plain http on a non-local host",
      "serve the storefront over https — session tokens and basket contents cross this boundary",
    );
  }

  /* -- catalogue ------------------------------------------------------ */
  if (OFFLINE) {
    skip("Catalogue feed", `${site.catalogFeedUrl} — not fetched (--offline)`);
  } else {
    const r = await reach(site.catalogFeedUrl, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) {
      fail(
        "Catalogue feed",
        `${site.catalogFeedUrl} — ${r.why}`,
        "check the URL is reachable from where CHAPMAN runs, not only from your laptop",
      );
    } else if (!r.res.ok) {
      fail(
        "Catalogue feed",
        `${site.catalogFeedUrl} returned ${r.res.status}`,
        "the assistant will know about no products until this answers 200",
      );
    } else {
      let body;
      try {
        body = await r.res.json();
      } catch (e) {
        body = null;
        fail(
          "Catalogue feed",
          `${site.catalogFeedUrl} is not JSON — ${e.message}`,
          "see docs/catalog-format.md",
        );
      }
      if (body) {
        // `{ products: [...] }` and nothing else. A bare top-level array is the
        // obvious guess and it is wrong: `jsonFeedCatalog` reads `feed.products`,
        // so an array loads cleanly and yields zero products — an assistant that
        // knows about nothing, with no error anywhere to explain it.
        const items = Array.isArray(body.products) ? body.products : null;
        if (!items) {
          fail(
            "Catalogue feed",
            Array.isArray(body)
              ? 'a bare JSON array — it must be wrapped as { "products": [ ... ] }'
              : 'JSON, but with no "products" list at the top level',
            "see docs/catalog-format.md",
          );
        } else if (items.length === 0) {
          warn(
            "Catalogue feed",
            "reachable, but empty",
            "the assistant can only talk about what is in here",
          );
        } else {
          const first = items[0] ?? {};
          const missing = ["handle", "title"].filter((k) => !(k in first));
          if (missing.length > 0) {
            warn(
              "Catalogue feed",
              `${items.length} products, but the first is missing ${missing.join(", ")}`,
              "see docs/catalog-format.md",
            );
          } else {
            pass("Catalogue feed", `${items.length} products`);
          }
        }
      }
    }
  }

  /* -- order feed ------------------------------------------------------ */
  if (!site.orders?.feedUrl) {
    skip(
      "Order feed",
      "not configured — the assistant declines anything personal, which is a fine state",
    );
  } else if (OFFLINE) {
    skip("Order feed", `${site.orders.feedUrl} — not fetched (--offline)`);
  } else {
    // Unsigned on purpose. A merchant endpoint that answers 401 to an unsigned
    // request is behaving correctly, and that is worth reporting as a pass:
    // the alternative is doctor forging a signature and telling you nothing
    // about whether your verification works.
    const r = await reach(site.orders.feedUrl, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) {
      fail(
        "Order feed",
        `${site.orders.feedUrl} — ${r.why}`,
        "order lookup will fail until this answers",
      );
    } else if (r.res.status >= 400 && r.res.status < 500) {
      // 400, 401 and 403 are all a feed saying "not like that" to a request
      // carrying no signature and naming no shopper. Which one it picks is a
      // matter of taste; refusing at all is the thing worth checking.
      pass(
        "Order feed",
        `answering, and refusing an unsigned request (${r.res.status}) — correct`,
      );
    } else if (r.res.ok) {
      warn(
        "Order feed",
        `answered ${r.res.status} to an UNSIGNED request`,
        "verify the Signature header — otherwise anyone who guesses the URL can read your customers' orders",
      );
    } else {
      warn(
        "Order feed",
        `answered ${r.res.status}`,
        "a 5xx here is your own server, not ours",
      );
    }
  }

  /* -- payments -------------------------------------------------------- */
  if (!site.razorpay) {
    skip(
      "Payments",
      "not configured — checkout is not offered for this storefront",
    );
  } else {
    const need = [site.razorpay.keyIdEnv, site.razorpay.keySecretEnv];
    const d = lib.describe(need);
    if (d.configured) pass("Razorpay keys", `${need.join(", ")} — set`);
    else
      fail(
        "Razorpay keys",
        `${d.missing.join(", ")} named in the config but not set`,
        `add them to .env — payments decline until then`,
      );

    const hook = site.razorpay.webhookSecretEnv;
    if (!hook)
      warn(
        "Razorpay webhook",
        "no webhookSecretEnv",
        "settlement rides the browser return path; a buyer who closes the tab after paying gets no order",
      );
    else if (lib.secret(hook)) pass("Razorpay webhook", `${hook} — set`);
    else
      warn(
        "Razorpay webhook",
        `${hook} named but not set`,
        `register the webhook against <gateway>/webhooks/razorpay/${site.key} and put its secret in .env — until then, a buyer who closes the tab after paying gets no order`,
      );

    if (site.razorpay.methods?.includes("upi")) {
      warn(
        "Payment methods",
        "upi is advertised to agents",
        "make sure KYC has cleared — advertising it early means an agent tells a buyer to pay by a method your checkout will not offer",
      );
    }
  }

  /* -- feature switches ------------------------------------------------- */
  {
    const flags = lib.readFlags(site.key);
    const off = lib.SWITCHES.filter((s) => flags[s.key] === false);
    if (off.length === 0) pass("Feature switches", "all on");
    else
      warn(
        "Feature switches",
        `off: ${off.map((s) => s.name).join(", ")}`,
        "deliberate? then ignore this. Otherwise turn them back on at /dashboard/features",
      );
  }
}

/* ------------------------------------------------------------------ *
 * 5. The assistant, and the optional halves
 * ------------------------------------------------------------------ */

heading("Assistant");

if (lib.openrouterReady())
  pass("OPENROUTER_API_KEY", "set — the model chains are available");
else
  warn(
    "OPENROUTER_API_KEY",
    "unset — every reply falls back to the deterministic reasoner",
    "the shop still works and stays within bounds; replies are templated rather than written",
  );

heading("Optional");

if (lib.shopifyConfigured())
  pass(
    "Shopify",
    "SHOPIFY_API_KEY, SHOPIFY_API_SECRET and SHOPIFY_APP_URL are set",
  );
else
  skip(
    "Shopify",
    "not configured — the custom-storefront path does not need it",
  );

{
  const missing = lib.voiceMissing();
  if (missing.length === 0) pass("Voice", "Sarvam and Twilio are set");
  else if (missing.length === 5)
    skip("Voice", "not configured — recovery calls are off");
  else
    warn(
      "Voice",
      `partly configured, missing ${missing.join(", ")}`,
      "set the rest or unset the others — half-configured voice fails at call time",
    );
}

/* ------------------------------------------------------------------ *
 * 6. A running gateway
 * ------------------------------------------------------------------ */

if (URL_BASE && !OFFLINE) {
  heading(`Running gateway at ${URL_BASE}`);

  const first = sites[0];
  const probes = [
    { label: "Widget script", url: `${URL_BASE}/embed.js`, want: (r) => r.ok },
    first && {
      label: "Widget probe",
      url: `${URL_BASE}/embed/chat?site=${encodeURIComponent(first.key)}`,
      // Sent as the storefront, because that is who asks. Without an Origin
      // header the gateway answers 403 — correctly — and the probe would be
      // measuring the CORS check rather than the widget behind it.
      init: { headers: { Origin: first.origins[0] } },
      want: (r) => r.ok,
      note: async (r) => {
        const j = await r.json().catch(() => null);
        return j?.enabled === false
          ? "answering, and the assistant is switched OFF for this shop"
          : "answering";
      },
    },
    first && {
      label: "UCP profile",
      url: `${URL_BASE}/ucp/${encodeURIComponent(first.key)}/profile`,
      want: (r) => r.ok,
    },
  ].filter(Boolean);

  for (const p of probes) {
    const r = await reach(p.url, p.init ?? {});
    if (!r.ok) {
      fail(
        p.label,
        `${p.url} — ${r.why}`,
        "is the server running, and on that port?",
      );
    } else if (!p.want(r.res)) {
      // A 404 on a UCP surface is what an agent_front switch set to off looks
      // like. Said out loud, because it is indistinguishable from a broken
      // route from the outside — which is the whole design of that switch.
      fail(
        p.label,
        `${p.url} returned ${r.res.status}`,
        r.res.status === 404
          ? "either the site key is wrong, or agent access is switched off at /dashboard/features"
          : r.res.status === 403
            ? `the gateway does not accept ${first?.origins[0]} as an origin for this shop — check "origins" in your config`
            : "check the server log",
      );
    } else {
      pass(p.label, p.note ? await p.note(r.res) : `${r.res.status}`);
    }
  }
} else if (URL_BASE) {
  heading("Running gateway");
  skip("Probes", "--offline was given");
}

/* ------------------------------------------------------------------ *
 * Verdict
 * ------------------------------------------------------------------ */

const count = (s) => rows.filter((r) => r.status === s).length;
const failures = count("FAIL");

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        ok: failures === 0,
        pass: count("PASS"),
        fail: failures,
        warn: count("WARN"),
        skip: count("SKIP"),
        rows,
      },
      null,
      2,
    ),
  );
} else {
  const parts = [
    `${count("PASS")} pass`,
    failures ? c.r(`${failures} fail`) : "0 fail",
    count("WARN") ? c.y(`${count("WARN")} warn`) : "0 warn",
    `${count("SKIP")} skip`,
  ];
  console.log(`\n${c.b(parts.join("   "))}`);
  if (failures === 0) {
    console.log(
      `\n${c.g("Nothing is broken.")}${count("WARN") ? " The warnings above are worth reading before you go live." : ""}\n`,
    );
  } else {
    console.log(
      `\n${c.r("Fix the FAIL lines above.")} Each one has the command or the edit next to it.\n`,
    );
  }
}

// exitCode rather than exit(): there is nothing left to do, and letting Node
// finish on its own avoids tearing down handles that are still settling.
process.exitCode = failures === 0 ? 0 : 1;
