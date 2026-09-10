/**
 * Merchant-controlled linking for Chapman's Razorpay checkout surface.
 *
 * The site registry stores environment-variable NAMES, never credential
 * values. Feature controls can therefore link an existing storefront without
 * asking a merchant to paste a secret into a form or exposing it to the
 * browser. Switching checkout off is handled by feature flags and deliberately
 * leaves this link intact, so turning it back on is reversible.
 */
import { database, databasePath, json } from "./database.server";
import { secret } from "./env.server";
import {
  isConfigured as razorpayConfigured,
  type RazorpayRef,
} from "./razorpay.server";
import type { Site } from "./sites.server";

export const DEFAULT_AGENT_RAZORPAY_REF: RazorpayRef = {
  keyIdEnv: "RAZORPAY_KEY_ID",
  keySecretEnv: "RAZORPAY_KEY_SECRET",
  webhookSecretEnv: "RAZORPAY_WEBHOOK_SECRET",
};

export type AgentPaymentControlState = {
  linked: boolean;
  credentialsReady: boolean;
  ready: boolean;
  keyIdEnv: string;
  keySecretEnv: string;
};

/** Only booleans and variable names may cross the loader boundary. */
export function agentPaymentControlState(site: Site): AgentPaymentControlState {
  const ref = site.razorpay ?? DEFAULT_AGENT_RAZORPAY_REF;
  const credentialsReady = razorpayConfigured(ref);
  return {
    linked: Boolean(site.razorpay),
    credentialsReady,
    ready: Boolean(site.razorpay) && credentialsReady,
    keyIdEnv: ref.keyIdEnv,
    keySecretEnv: ref.keySecretEnv,
  };
}

type LinkOptions = {
  /** Test seam. Production always uses the registry selected by config.server. */
  configFile?: string;
  resolveSecret?: (name: string) => string | null;
};

/**
 * Link one registered storefront to the canonical Razorpay variable names.
 *
 * Existing custom mappings are preserved. The replacement is validated and
 * atomic, and a backup is kept beside the registry. Credential values are
 * never arguments to this function and therefore cannot enter the file.
 */
export function linkAgentRazorpay(
  siteKey: string,
  options: LinkOptions = {},
): { changed: boolean; file: string; backup: string | null } {
  void options.configFile;
  const db = database();
  const row = db.prepare(`
    SELECT id, razorpay_json FROM stores WHERE site_key = ? AND configured = 1
  `).get(siteKey) as { id: string; razorpay_json: string | null } | undefined;
  if (!row) throw new Error(`Storefront ${siteKey} is not registered.`);
  if (row.razorpay_json) {
    return { changed: false, file: databasePath(), backup: null };
  }
  const getSecret = options.resolveSecret ?? secret;
  const missing = [
    DEFAULT_AGENT_RAZORPAY_REF.keyIdEnv,
    DEFAULT_AGENT_RAZORPAY_REF.keySecretEnv,
  ].filter((name) => !getSecret(name));
  if (missing.length) {
    throw new Error(`The Razorpay link is missing ${missing.join(" and ")}.`);
  }
  db.prepare(`
    UPDATE stores SET razorpay_json = ?, updated_at = ? WHERE id = ?
  `).run(json(DEFAULT_AGENT_RAZORPAY_REF), new Date().toISOString(), row.id);
  return { changed: true, file: databasePath(), backup: null };
}

export { closeDatabase as _closeDatabase } from "./database.server";
