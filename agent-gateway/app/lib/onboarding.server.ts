/**
 * First-store onboarding for an authenticated merchant.
 *
 * The console account exists before a storefront does. This module performs
 * the one transition from that empty state to a real site registry. It writes
 * no payment credential and returns no secret to the browser: the only secret
 * it creates is the per-site signing key, persisted in CHAPMAN_ENV_FILE.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { grantSite, type Merchant } from "./auth.server";
import { parseSitesConfig } from "./config.server";
import { allSites, saveSite, setCatalogFeed } from "./sites.server";

export type FirstStoreInput = {
  name: string;
  key: string;
  origin: string;
  catalogFeedUrl: string;
  productUrlTemplate: string;
  ordersFeedUrl: string;
  greeting: string;
  payments: boolean;
};

export type FirstStoreResult =
  | { ok: true; key: string }
  | { ok: false; error: string; fields?: Record<string, string> };

export type CatalogFeedUpdateResult =
  { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

const envFile = () =>
  process.env.CHAPMAN_ENV_FILE?.trim()
    ? path.resolve(process.env.CHAPMAN_ENV_FILE.trim())
    : path.join(process.cwd(), "..", ".env");

const secretName = (key: string) =>
  `SITE_SECRET_${
    key
      .replace(/^pk_/, "")
      .replace(/[^a-z0-9]/gi, "_")
      .toUpperCase() || "STORE"
  }`;

const envValue = (text: string, name: string): string | null => {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match?.[1] !== name) continue;
    const value = match[2].trim().replace(/^("|')|("|')$/g, "");
    return value || null;
  }
  return null;
};

export function firstStoreDefaults() {
  return {
    name: process.env.CHAPMAN_SITE_NAME?.trim() || "My Store",
    key: process.env.CHAPMAN_SITE_KEY?.trim() || "pk_my_store",
    origin:
      (process.env.CHAPMAN_SITE_ORIGINS?.split(",")[0] ?? "").trim() ||
      "http://localhost:4000",
    catalogFeedUrl:
      process.env.CHAPMAN_SITE_CATALOG?.trim() ||
      "http://localhost:4000/catalog.json",
    productUrlTemplate:
      process.env.CHAPMAN_SITE_PRODUCT_URL?.trim() ||
      "/product.html?handle={handle}",
    ordersFeedUrl: process.env.CHAPMAN_SITE_ORDERS_FEED?.trim() || "",
    greeting:
      process.env.CHAPMAN_SITE_GREETING?.trim() ||
      "Ask me anything about our products.",
    payments: Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
    ),
  };
}

export function createFirstStore(
  merchant: Merchant,
  input: FirstStoreInput,
): FirstStoreResult {
  if (merchant.sites.length > 0) {
    return {
      ok: false,
      error:
        "This account already has a storefront. First-store onboarding is closed.",
    };
  }

  if (allSites().length > 0) {
    return {
      ok: false,
      error:
        "A storefront registry already exists. Ask an owner to grant this account access.",
    };
  }

  const key = input.key.trim();
  const signingSecretEnv = secretName(key);
  const targetEnv = envFile();
  let envText = "";
  try {
    envText = fs.readFileSync(targetEnv, "utf8");
  } catch {
    // A fresh data volume has no env file until bootstrap creates it.
  }
  const signingSecret =
    process.env[signingSecretEnv] ||
    envValue(envText, signingSecretEnv) ||
    crypto.randomBytes(32).toString("hex");

  const site = {
    key,
    name: input.name.trim(),
    origins: [input.origin.trim()],
    catalogFeedUrl: input.catalogFeedUrl.trim(),
    productUrlTemplate: input.productUrlTemplate.trim() || undefined,
    greeting: input.greeting.trim() || "Ask me anything about our products.",
    accent: "#1f4037",
    secretEnv: signingSecretEnv,
    ...(input.ordersFeedUrl.trim()
      ? { orders: { feedUrl: input.ordersFeedUrl.trim() } }
      : {}),
    ...(input.payments
      ? {
          razorpay: {
            keyIdEnv: "RAZORPAY_KEY_ID",
            keySecretEnv: "RAZORPAY_KEY_SECRET",
            webhookSecretEnv: "RAZORPAY_WEBHOOK_SECRET",
          },
        }
      : {}),
  };
  const text = JSON.stringify({ sites: [site] }, null, 2) + "\n";
  const report = parseSitesConfig(text, "merchant onboarding", {
    resolveSecret: (name) => {
      if (name === signingSecretEnv) return signingSecret;
      const value = process.env[name] || envValue(envText, name);
      return value || null;
    },
    production: true,
  });

  if (report.errors.length > 0) {
    const fields: Record<string, string> = {};
    for (const error of report.errors) {
      if (error.includes(".name:")) fields.name = error;
      else if (error.includes(".key:")) fields.key = error;
      else if (error.includes(".origins")) fields.origin = error;
      else if (error.includes(".catalogFeedUrl:"))
        fields.catalogFeedUrl = error;
      else if (error.includes(".productUrlTemplate:"))
        fields.productUrlTemplate = error;
      else if (error.includes(".orders.feedUrl:")) fields.ordersFeedUrl = error;
    }
    return { ok: false, error: report.errors.join(" "), fields };
  }

  try {
    if (
      !process.env[signingSecretEnv] &&
      !envValue(envText, signingSecretEnv)
    ) {
      fs.mkdirSync(path.dirname(targetEnv), { recursive: true });
      fs.appendFileSync(
        targetEnv,
        `\n# Signs shopper sessions and order-feed requests for ${key}.\n${signingSecretEnv}=${signingSecret}\n`,
        "utf8",
      );
    }
    process.env[signingSecretEnv] = signingSecret;

    saveSite(site);
    grantSite(merchant.email, key);
    return { ok: true, key };
  } catch (error) {
    return {
      ok: false,
      error: `The storefront could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Change only the public catalogue URL for a storefront the merchant owns.
 *
 * The raw registry is edited rather than serialising loadSites(): the loaded
 * representation contains resolved secrets, while the file must contain only
 * environment-variable names.
 */
export function updateCatalogFeed(
  merchant: Merchant,
  siteKey: string,
  catalogFeedUrl: string,
): CatalogFeedUpdateResult {
  if (!merchant.sites.includes(siteKey)) {
    return { ok: false, error: "You do not have access to this storefront." };
  }

  try {
    const value = catalogFeedUrl.trim();
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        ok: false,
        error: "The catalogue URL must use http or https.",
        fields: { catalogFeedUrl: "Enter an absolute http(s) URL." },
      };
    }
    if (!setCatalogFeed(siteKey, value)) {
      return { ok: false, error: "The storefront is no longer registered." };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `The catalogue URL could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export { closeDatabase as _closeDatabase } from "./database.server";
