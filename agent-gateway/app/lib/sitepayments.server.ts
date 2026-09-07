/**
 * Merchant-controlled linking for Chapman's Razorpay checkout surface.
 *
 * The site registry stores environment-variable NAMES, never credential
 * values. Feature controls can therefore link an existing storefront without
 * asking a merchant to paste a secret into a form or exposing it to the
 * browser. Switching checkout off is handled by feature flags and deliberately
 * leaves this link intact, so turning it back on is reversible.
 */
import crypto from "node:crypto";
import fs from "node:fs";

import {
  findConfigFile,
  parseSitesConfig,
  resetConfigCache,
  stripJsonComments,
} from "./config.server";
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

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

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
  const file = options.configFile ?? findConfigFile();
  if (!file) throw new Error("No Chapman storefront registry exists yet.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(fs.readFileSync(file, "utf8")));
  } catch (error) {
    throw new Error(
      `The Chapman storefront registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!object(parsed) || !Array.isArray(parsed.sites)) {
    throw new Error(
      'The Chapman storefront registry needs a top-level "sites" list.',
    );
  }

  const matches = parsed.sites.filter(
    (entry) => object(entry) && entry.key === siteKey,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Storefront ${siteKey} is not registered.`
        : `Storefront ${siteKey} appears more than once.`,
    );
  }

  const existing = matches[0].razorpay;
  if (object(existing)) {
    return { changed: false, file, backup: null };
  }

  const next = structuredClone(parsed) as Record<string, unknown> & {
    sites: unknown[];
  };
  const site = next.sites.find(
    (entry: unknown) => object(entry) && entry.key === siteKey,
  ) as Record<string, unknown>;
  site.razorpay = { ...DEFAULT_AGENT_RAZORPAY_REF };

  const text = `${JSON.stringify(next, null, 2)}\n`;
  const report = parseSitesConfig(text, file, {
    production: true,
    resolveSecret: options.resolveSecret ?? secret,
  });
  if (report.errors.length > 0) {
    throw new Error(
      `The Razorpay link did not validate: ${report.errors.join(" ")}`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = crypto.randomBytes(4).toString("hex");
  const backup = `${file}.before-agent-razorpay-${stamp}-${nonce}`;
  const temporary = `${file}.tmp-${process.pid}-${nonce}`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original write error. The registry and backup still exist.
    }
    throw new Error(
      `The Razorpay link could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  resetConfigCache();
  return { changed: true, file, backup };
}
