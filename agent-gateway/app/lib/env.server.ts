/**
 * Server-side secrets, loaded from the repo-root `.env`.
 *
 * Vite only exposes `VITE_`-prefixed variables to the browser, and nothing here
 * carries that prefix — so a Razorpay key secret cannot end up in a client
 * bundle by accident. That is not a convention to remember; it is the bundler
 * refusing.
 *
 * Two rules that the rest of the codebase depends on:
 *
 *   1. SECRETS ARE REFERENCED BY NAME, NEVER BY VALUE. The site registry stores
 *      `keySecretEnv: "RAZORPAY_TEST_API_KEY_SECRET1"`, not the secret itself,
 *      and resolves it at the moment of use. So no object that might be
 *      serialised into a page, a log line, or the shop cortex can be holding
 *      one in the first place.
 *
 *   2. NOTHING HERE IS EVER LOGGED. `describe()` exists so diagnostics can say
 *      "configured" without saying what.
 */
import fs from "node:fs";
import path from "node:path";

let loaded = false;

/**
 * Merge the repo-root `.env` into `process.env` without overwriting anything
 * already set. Existing values win because a real deployment sets them in the
 * environment, and a stale file must not quietly override production.
 */
export function loadRootEnv(root = path.join(process.cwd(), "..")): void {
  if (loaded) return;
  loaded = true;
  // CHAPMAN_ENV_FILE names the file outright, for the case where the repository
  // root is not a durable place: in a container `..` is `/`, which is a layer,
  // so the generated secrets live in the mounted data volume instead. Unset —
  // which is every non-container install — this resolves to the repo-root .env
  // exactly as before. `npm run init` writes to the same variable.
  const explicit = process.env.CHAPMAN_ENV_FILE?.trim();
  const file = explicit ? path.resolve(explicit) : path.join(root, ".env");
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      let value = t.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // Absent is a valid state: a deployment sets these in the environment, and
    // the whole custom-site path works without any Razorpay key at all.
  }
}

/** Read a secret by variable name. Returns null rather than throwing. */
export function secret(name: string): string | null {
  loadRootEnv();
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}

/**
 * Whether a set of variables is present — and nothing else about them.
 *
 * Every diagnostic surface uses this. A dashboard that renders "configured" is
 * useful; one that renders four characters of a live key is a slow leak into
 * screenshots and screen shares.
 */
export function describe(names: string[]): { configured: boolean; missing: string[] } {
  const missing = names.filter((n) => !secret(n));
  return { configured: missing.length === 0, missing };
}
