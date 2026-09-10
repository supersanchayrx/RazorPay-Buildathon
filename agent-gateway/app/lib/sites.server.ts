/**
 * Site registry for custom (non-Shopify) merchants.
 *
 * On Shopify, identity comes free: every App Proxy request is HMAC-signed by
 * Shopify and names the shop. A custom site gives us none of that, so a site
 * is registered here with a public key and the origins it may be embedded on.
 *
 * The key is public — it sits in the merchant's HTML and anyone can read it.
 * It is an identifier, not a secret. The actual check is the `Origin` header,
 * which a browser sets itself and page JavaScript cannot forge. A non-browser
 * client can send any origin it likes, but that attacker is only burning quota,
 * which a per-key rate limit handles. Stronger proof (a DNS TXT record or a
 * .well-known file) belongs as an upgrade, never as a requirement to start.
 *
 * The entries themselves live in `chapman.config.json`, not here — a shop's
 * origins and catalogue URL are the merchant's data, not our source code. See
 * `config.server.ts` for the loader and the validation rules.
 */

import type { RazorpayRef } from "./razorpay.server";
import { database, ensureStore, json, parseJson, transaction } from "./database.server";
import { secret as resolveSecret } from "./env.server";

export type Site = {
  key: string;
  name: string;
  /** Exact origins allowed to embed the widget. */
  origins: string[];
  /** Where the catalogue is read from. Discovery will populate this later. */
  catalogFeedUrl: string;

  /**
   * How to build a product page URL, with `{handle}` substituted.
   *
   * Needed the moment anything we write has to point somewhere the shopper can
   * act — a recovery message, an agent handoff, a card in the widget. Absent is
   * a legitimate state and means every link falls back to the shop's front
   * page, which is worse but never wrong.
   */
  productUrlTemplate?: string;

  /**
   * A path on the merchant's own origin that proxies our recovery page.
   *
   * When set, the "why didn't you buy?" link in a recovery message points at
   * the merchant's domain rather than at ours, and their server forwards it
   * here — the same fifteen-line proxy as `/.well-known/ucp`. A shopper who
   * was on nilgiripost.example is then asked the question on
   * nilgiripost.example, which is both less alarming and more likely to be
   * answered.
   *
   * Absent is a valid state: the link falls back to our own origin, which
   * works and looks like a third party, in that order.
   */
  recoverPath?: string;

  /**
   * A path on the merchant's origin that restores a basket from a signed link.
   *
   * Without it, a recovery message can only point at a product page and the
   * shopper has to add everything again — honest, and one avoidable step away
   * from the thing we asked them to do.
   */
  restorePath?: string;
  greeting: string;
  accent: string;

  /**
   * Shared secret with the merchant. Unlike the site key this IS a secret: it
   * signs the session tokens that assert who a shopper is, and it signs our
   * requests to their order feed. It never leaves the server.
   */
  secret: string;

  /**
   * Order access is opt-in and off by default, because turning it on changes
   * what the assistant can say about a person. Absent means the assistant
   * answers from the catalogue and declines anything personal — which is a
   * perfectly good state for a store to be in.
   */
  orders?: {
    /** A read-only endpoint the merchant publishes. Preferred. */
    feedUrl?: string;
    /** Development only: read our own synthetic fixture instead. */
    useSeedFixture?: boolean;
  };

  /**
   * Payment credentials, held as environment variable NAMES rather than values.
   *
   * This object gets logged, serialised into diagnostics, and read by the shop
   * cortex. Storing the secret itself would put it one careless `console.log`
   * from a screen share; storing its name puts nothing anywhere.
   */
  razorpay?: RazorpayRef;
};

/**
 * Read once, held for the process lifetime.
 *
 * Every lookup below goes through this rather than a module-level constant, so
 * a merchant edits JSON and restarts instead of editing TypeScript and
 * rebuilding. The signatures are unchanged, which is the point: thirty-seven
 * call sites did not have to know this moved.
 */
type StoredSite = Omit<Site, "secret"> & { secretEnv: string };

const sites = (): Site[] => {
  const db = database();
  const rows = db.prepare(`
    SELECT id, site_key, name, catalog_feed_url, product_url_template,
      recover_path, restore_path, greeting, accent, site_secret_env,
      orders_json, razorpay_json
    FROM stores WHERE configured = 1 AND archived_at IS NULL
    ORDER BY created_at, site_key
  `).all() as Array<{
    id: string; site_key: string; name: string; catalog_feed_url: string;
    product_url_template: string | null; recover_path: string | null;
    restore_path: string | null; greeting: string; accent: string;
    site_secret_env: string; orders_json: string | null; razorpay_json: string | null;
  }>;
  const origins = db.prepare("SELECT origin FROM store_origins WHERE store_id = ? ORDER BY origin");
  return rows.map((row) => ({
    key: row.site_key,
    name: row.name,
    origins: (origins.all(row.id) as Array<{ origin: string }>).map((x) => x.origin),
    catalogFeedUrl: row.catalog_feed_url,
    ...(row.product_url_template ? { productUrlTemplate: row.product_url_template } : {}),
    ...(row.recover_path ? { recoverPath: row.recover_path } : {}),
    ...(row.restore_path ? { restorePath: row.restore_path } : {}),
    greeting: row.greeting,
    accent: row.accent,
    secret: resolveSecret(row.site_secret_env) ?? "",
    ...(row.orders_json ? { orders: parseJson(row.orders_json, undefined) } : {}),
    ...(row.razorpay_json ? { razorpay: parseJson(row.razorpay_json, undefined) } : {}),
  }));
};

/** Persist a validated storefront without ever storing its secret value. */
export function saveSite(site: StoredSite): void {
  const storeId = ensureStore(site.key);
  const now = new Date().toISOString();
  transaction((db) => {
    db.prepare(`
      UPDATE stores SET name = ?, catalog_mode = 'feed', catalog_feed_url = ?,
        product_url_template = ?, recover_path = ?, restore_path = ?, greeting = ?,
        accent = ?, site_secret_env = ?, orders_json = ?, razorpay_json = ?,
        configured = 1, archived_at = NULL, updated_at = ? WHERE id = ?
    `).run(
      site.name, site.catalogFeedUrl, site.productUrlTemplate ?? null,
      site.recoverPath ?? null, site.restorePath ?? null, site.greeting,
      site.accent, site.secretEnv, site.orders ? json(site.orders) : null,
      site.razorpay ? json(site.razorpay) : null, now, storeId,
    );
    db.prepare("DELETE FROM store_origins WHERE store_id = ?").run(storeId);
    const insert = db.prepare("INSERT INTO store_origins(store_id, origin) VALUES (?, ?)");
    for (const origin of site.origins) insert.run(storeId, origin);
  });
}

export function setCatalogFeed(siteKey: string, feedUrl: string): boolean {
  const changed = database().prepare(`
    UPDATE stores SET catalog_feed_url = ?, catalog_mode = 'feed', updated_at = ?
    WHERE site_key = ? AND configured = 1
  `).run(feedUrl, new Date().toISOString(), siteKey);
  return Number(changed.changes) === 1;
}

export function allSites(): Site[] {
  return sites();
}

/**
 * The storefronts one merchant may administer.
 *
 * Every console loader goes through this rather than `allSites()`, so a page
 * cannot show another merchant's shop by forgetting to filter. Scoping at the
 * lookup is the difference between authorisation and a convention.
 */
export function sitesForMerchant(keys: string[]): Site[] {
  return sites().filter((s) => keys.includes(s.key));
}

export function findSite(key: string | null): Site | null {
  if (!key) return null;
  return sites().find((s) => s.key === key) ?? null;
}

/** Returns the origin to echo back, or null if this origin may not embed. */
export function allowedOrigin(site: Site, origin: string | null): string | null {
  if (!origin) return null;
  return site.origins.includes(origin) ? origin : null;
}

export { closeDatabase as _closeDatabase } from "./database.server";
