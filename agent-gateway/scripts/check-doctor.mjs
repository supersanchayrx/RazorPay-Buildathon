/**
 * `npm run doctor`, as a thing that has to keep working.
 *
 * Doctor is almost all I/O, so this runs it as a subprocess against configs
 * built here and reads its `--json`. Every run passes `--offline`: the check
 * suite must not need the internet or a running demo store, and asserting that
 * `--offline` really does suppress the network is itself one of the checks.
 *
 * The four properties worth locking down:
 *
 *   1. It never crashes. A diagnostic that throws on a broken config is
 *      useless precisely when it is needed, and the configs it meets in the
 *      wild are broken ones.
 *   2. Every FAIL carries a fix. A verdict with no next step is a verdict that
 *      sends someone to the source.
 *   3. It never prints a secret. Sentinel values go in the environment and
 *      must not come back out in the output — same rule as `describe()`.
 *   4. Optional things that are not configured never FAIL. Shopify and voice
 *      are opt-in, and a red line about a feature nobody asked for teaches
 *      people to skim.
 *
 * Run:  node scripts/check-doctor.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failed = 0;
const check = (label, ok, detail) => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chapman-doctor-"));
const cleanup = () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* a leftover temp directory is not worth failing a check over */
  }
};

/** Sentinels. If any of these reaches the output, something is printing values. */
const SECRETS = {
  SITE_SECRET_MONSOON_MARKET: "sentinel-site-secret-9f2c",
  RAZORPAY_TEST_API_KEY_ID1: "sentinel-rzp-id-3a72",
  RAZORPAY_TEST_API_KEY_SECRET1: "sentinel-rzp-secret-4b81",
  RAZORPAY_WEBHOOK_SECRET1: "sentinel-rzp-hook-6c14",
  CONSOLE_SESSION_SECRET: "sentinel-console-secret-7d30",
};

/**
 * Run doctor with a controlled environment.
 *
 * Optional integrations are set to the empty string rather than deleted:
 * `loadRootEnv()` fills in anything UNDEFINED from the repo-root `.env`, so
 * deleting a key would let the developer's own credentials leak into the run
 * and make the result depend on whose machine it is.
 */
function doctor(extraEnv = {}, extraArgs = []) {
  const r = spawnSync(
    process.execPath,
    ["scripts/doctor.mjs", "--offline", "--json", ...extraArgs],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...SECRETS,
        CHAPMAN_DATA_DIR: path.join(tmp, "data"),
        SARVAM_API_KEY: "",
        TWILIO_ACCOUNT_SID: "",
        TWILIO_AUTH_TOKEN: "",
        TWILIO_FROM: "",
        PUBLIC_ORIGIN: "",
        SHOPIFY_API_KEY: "",
        SHOPIFY_API_SECRET: "",
        SHOPIFY_APP_URL: "",
        OPENROUTER_API_KEY: "",
        ...extraEnv,
      },
    },
  );
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* reported by the caller — a doctor that cannot emit JSON is the finding */
  }
  return { ...r, json };
}

const rowsIn = (json, label) =>
  (json?.rows ?? []).filter((x) => x.label === label);
const statuses = (json, label) => rowsIn(json, label).map((x) => x.status);

/* ------------------------------------------------------------------ *
 * 1. A healthy install
 * ------------------------------------------------------------------ */

console.log("\n-- the shipped demo config --\n");

const good = doctor({
  // The fixture is deliberately not an implicit runtime fallback. Tests that
  // want it name it just as an operator would.
  CHAPMAN_CONFIG: path.resolve("chapman.config.demo.json"),
});

check(
  "doctor runs and does not crash",
  good.status !== null && good.status < 2,
  `exit ${good.status}, stderr: ${(good.stderr || "").slice(0, 200)}`,
);
check(
  "--json emits parseable JSON",
  good.json !== null,
  (good.stdout || "").slice(0, 120),
);

if (good.json) {
  const j = good.json;
  check(
    "the summary counts everything",
    j.pass + j.fail + j.warn + j.skip === j.rows.length,
  );
  check("ok agrees with the fail count", j.ok === (j.fail === 0));
  check(
    "the exit code agrees with ok",
    (good.status === 0) === j.ok,
    `exit ${good.status}, ok ${j.ok}`,
  );
  check(
    "the explicitly selected demo config produces no failures",
    j.fail === 0,
    j.rows
      .filter((r) => r.status === "FAIL")
      .map((r) => `${r.label}: ${r.detail}`)
      .join(" | "),
  );

  check(
    "every row has a section, a status and a label",
    j.rows.every(
      (r) =>
        r.section &&
        ["PASS", "FAIL", "WARN", "SKIP"].includes(r.status) &&
        r.label,
    ),
  );
  check(
    "every FAIL carries a fix",
    j.rows.filter((r) => r.status === "FAIL").every((r) => r.fix),
    j.rows
      .filter((r) => r.status === "FAIL" && !r.fix)
      .map((r) => r.label)
      .join(", "),
  );

  // The sections a merchant needs to see, whatever else changes.
  for (const want of [
    "This machine",
    "Configuration",
    "Secrets",
    "Data directory",
    "Assistant",
    "Optional",
  ]) {
    check(
      `section "${want}" is reported`,
      j.rows.some((r) => r.section === want),
    );
  }
  check(
    "the storefront gets a section of its own",
    j.rows.some((r) => r.section.startsWith("Storefront:")),
  );

  /* -- the discipline: names, never values -------------------------- */
  const printed = JSON.stringify(j);
  for (const [name, value] of Object.entries(SECRETS)) {
    check(`${name}'s VALUE is never printed`, !printed.includes(value));
  }
  check(
    "but a secret's NAME is, so the merchant knows what to set",
    printed.includes("CONSOLE_SESSION_SECRET"),
  );

  /* -- --offline really is offline ----------------------------------- */
  check(
    "--offline skips the catalogue fetch",
    statuses(j, "Catalogue feed").every((s) => s === "SKIP"),
    statuses(j, "Catalogue feed").join(","),
  );
  check(
    "--offline skips the order feed fetch",
    statuses(j, "Order feed").every((s) => s === "SKIP"),
    statuses(j, "Order feed").join(","),
  );

  /* -- optional things stay quiet ------------------------------------ */
  check(
    "unconfigured Shopify is a SKIP, not a FAIL",
    statuses(j, "Shopify").join(",") === "SKIP",
  );
  check(
    "unconfigured voice is a SKIP, not a FAIL",
    statuses(j, "Voice").join(",") === "SKIP",
  );
  check(
    "a missing model key warns rather than fails",
    statuses(j, "OPENROUTER_API_KEY").join(",") === "WARN",
    "the deterministic reasoner is a real fallback, not an outage",
  );

  /* -- CHAPMAN_DATA_DIR is honoured ---------------------------------- */
  const writable = rowsIn(j, "Writable")[0];
  check(
    "the reported data directory is the one CHAPMAN_DATA_DIR names",
    writable?.detail?.includes(path.join(tmp, "data").replace(/\\/g, "/")),
    writable?.detail,
  );
}

/* ------------------------------------------------------------------ *
 * 1b. Legacy Docker key names satisfy the canonical site references
 * ------------------------------------------------------------------ */

console.log("\n-- legacy Razorpay environment names --\n");

const aliasConfig = path.join(tmp, "alias.config.json");
fs.writeFileSync(
  aliasConfig,
  JSON.stringify({
    sites: [
      {
        key: "pk_alias_test",
        name: "Alias Test Store",
        origins: ["http://localhost:4000"],
        catalogFeedUrl: "http://localhost:4000/catalog.json",
        secretEnv: "SITE_SECRET_MONSOON_MARKET",
        razorpay: {
          keyIdEnv: "RAZORPAY_KEY_ID",
          keySecretEnv: "RAZORPAY_KEY_SECRET",
          webhookSecretEnv: "RAZORPAY_WEBHOOK_SECRET",
        },
      },
    ],
  }),
);

const aliases = doctor({
  CHAPMAN_CONFIG: aliasConfig,
  // Empty canonical variables reproduce `docker compose exec`: the startup
  // shell's exports are absent, while the legacy variables from Compose remain.
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
  RAZORPAY_WEBHOOK_SECRET: "",
});
check(
  "doctor accepts legacy Razorpay keys for canonical config references",
  statuses(aliases.json, "Razorpay keys").join(",") === "PASS",
  rowsIn(aliases.json, "Razorpay keys")[0]?.detail,
);
check(
  "doctor accepts the legacy webhook secret for its canonical reference",
  statuses(aliases.json, "Razorpay webhook").join(",") === "PASS",
  rowsIn(aliases.json, "Razorpay webhook")[0]?.detail,
);
check(
  "Razorpay alias values remain absent from doctor output",
  !Object.values(SECRETS).some((value) =>
    JSON.stringify(aliases.json).includes(value),
  ),
);

/* ------------------------------------------------------------------ *
 * 2. A broken config
 * ------------------------------------------------------------------ */

console.log("\n-- a config with four different mistakes in it --\n");

const badFile = path.join(tmp, "bad.config.json");
fs.writeFileSync(
  badFile,
  JSON.stringify({
    sites: [
      {
        key: "pk bad key",
        origins: ["https://shop.example/"],
        catalogFeedUrl: "not-a-url",
      },
    ],
  }),
);

const bad = doctor({ CHAPMAN_CONFIG: badFile });
check(
  "doctor still runs on a config it rejects",
  bad.json !== null,
  (bad.stderr || "").slice(0, 200),
);
if (bad.json) {
  check("it exits non-zero", bad.status === 1, `exit ${bad.status}`);
  check(
    "it reports failures rather than throwing",
    bad.json.fail >= 4,
    `${bad.json.fail} failures`,
  );
  check(
    "every one of them still carries a fix",
    bad.json.rows.filter((r) => r.status === "FAIL").every((r) => r.fix),
  );
  const detail = bad.json.rows.map((r) => r.detail ?? "").join(" ");
  check("the bad key is named", detail.includes("pk bad key"));
  check(
    "the trailing slash on the origin is named",
    detail.includes("https://shop.example/"),
  );
  check("the missing shop name is named", detail.includes("name"));
  check(
    "the unusable catalogue URL is named",
    detail.includes("catalogFeedUrl"),
  );
  check(
    "a storefront that failed validation gets no section of its own",
    !bad.json.rows.some((r) => r.section.startsWith("Storefront:")),
    "a half-validated site would be reported against fields that were never checked",
  );
}

/* ------------------------------------------------------------------ *
 * 3. Not valid JSON at all
 * ------------------------------------------------------------------ */

console.log("\n-- a config with a trailing comma, the usual mistake --\n");

const commaFile = path.join(tmp, "comma.config.json");
fs.writeFileSync(
  commaFile,
  '{ "sites": [ { "key": "pk_a", "name": "A", }, ] }',
);
const comma = doctor({ CHAPMAN_CONFIG: commaFile });
check(
  "doctor survives unparseable JSON",
  comma.json !== null,
  (comma.stderr || "").slice(0, 200),
);
if (comma.json) {
  check("it exits non-zero", comma.status === 1);
  check(
    "and says a trailing comma is the usual cause",
    comma.json.rows.some((r) => (r.detail ?? "").includes("trailing comma")),
    comma.json.rows
      .filter((r) => r.status === "FAIL")
      .map((r) => r.detail)
      .join(" | "),
  );
}

/* ------------------------------------------------------------------ *
 * 4. No config at all
 * ------------------------------------------------------------------ */

console.log("\n-- no config anywhere --\n");

const none = doctor({ CHAPMAN_CONFIG: path.join(tmp, "does-not-exist.json") });
check(
  "doctor survives having nothing to read",
  none.json !== null,
  (none.stderr || "").slice(0, 200),
);
if (none.json) {
  const registry = rowsIn(none.json, "Site registry")[0];
  check(
    "it says the registry is missing",
    registry?.status === "FAIL",
    registry?.status,
  );
  check(
    "and the fix is npm run init",
    (registry?.fix ?? "").includes("npm run init"),
    registry?.fix,
  );
  check(
    "and the dashboard onboarding path is named",
    (registry?.fix ?? "").includes("Configure storefront"),
    registry?.fix,
  );
  check(
    "and it says Shopify-only installs do not need one",
    (registry?.fix ?? "").toLowerCase().includes("shopify"),
    registry?.fix,
  );
}

/* ------------------------------------------------------------------ *
 * 5. Wiring
 * ------------------------------------------------------------------ */

console.log("\n-- wiring --\n");

{
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  check(
    "npm run doctor exists",
    pkg.scripts.doctor === "node scripts/doctor.mjs",
  );
  check(
    "check-doctor is in the check chain",
    pkg.scripts.check.includes("check-doctor.mjs"),
  );
  const src = fs.readFileSync("scripts/doctor.mjs", "utf8");
  check(
    "doctor's own network calls all go through one place",
    (src.match(/await fetch\(/g) ?? []).length === 1,
    "a fetch outside reach() has no timeout and can hang the diagnostic",
  );
  check("doctor clears its abort timers", src.includes("clearTimeout(timer)"));
  // The verdict must not call process.exit(): fetch handles may still be
  // settling, and tearing them down mid-flight is what tripped a libuv
  // assertion on Windows. The one exit() that is allowed is the guard at the
  // very top, which fires before any of this script has run at all.
  // Line-based, because doctor's own header comment mentions process.exit()
  // in prose, and a naive search finds the sentence rather than the call.
  // Same trap as the one check-streaming.mjs walked into.
  const exitLines = src
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("process.exit("));
  const firstExitAt = exitLines.length > 0 ? src.indexOf(exitLines[0]) : -1;
  check(
    "the verdict sets exitCode rather than calling exit()",
    src.includes("process.exitCode ="),
  );
  check(
    "the only process.exit() is the run-from-the-wrong-directory guard",
    exitLines.length === 1 && firstExitAt < src.indexOf("function say("),
    `${exitLines.length} call(s): ${exitLines.join(" ")}`,
  );
}

/* ------------------------------------------------------------------ */

cleanup();
console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`}\n`);
process.exitCode = failed === 0 ? 0 : 1;
