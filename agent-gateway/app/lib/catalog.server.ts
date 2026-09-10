/**
 * Catalogue access, behind one interface.
 *
 * The assistant must not care where products come from. Shopify hands us an
 * Admin API; a custom site hands us a JSON feed we crawled or were pointed at.
 * Same shape out of both, so there is exactly one assistant rather than one
 * per platform — and the filtering below is shared, so the two cannot drift.
 */

export type CatalogVariant = {
  title: string;
  price: string;
  currency: string;
  sku: string | null;
  availableForSale: boolean;
  inventoryQuantity: number | null;
};

export type CatalogProduct = {
  handle: string;
  title: string;
  description: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  url: string | null;
  image: string | null;
  minPrice: string;
  maxPrice: string;
  currency: string;
  totalInventory: number | null;
  variants: CatalogVariant[];
};

export type ShopPolicies = { returns?: string; shipping?: string; cod?: string };

/**
 * Search arguments are parameters, not separate tools.
 *
 * "products under 5000" and "products over 3000" are one capability with
 * different arguments. Splitting them into two tools costs a round trip, adds
 * latency, and gives the reasoner one more chance to pick the wrong one.
 * A tool is a capability, not a verb.
 */
export type SearchArgs = {
  query?: string;
  priceMin?: number;
  priceMax?: number;
  inStockOnly?: boolean;
  tags?: string[];
  productType?: string;
  sort?: "relevance" | "price_asc" | "price_desc";
  limit?: number;
};

export interface CatalogSource {
  readonly kind: "shopify" | "json-feed";
  search(args: SearchArgs): Promise<CatalogProduct[]>;
  get(handle: string): Promise<CatalogProduct | null>;
  /** Products that go with this one. Retrieval, not persuasion. */
  complements(handle: string, limit?: number): Promise<CatalogProduct[]>;
  policies(): Promise<ShopPolicies>;
}

/* ------------------------------------------------------------------ */
/* Filtering and ranking — shared by every source                      */
/* ------------------------------------------------------------------ */

const STOP = new Set([
  "the", "a", "an", "do", "you", "have", "any", "got", "i", "me", "my", "we", "is", "are",
  "for", "of", "to", "in", "on", "and", "or", "what", "which", "show", "find", "looking",
  "want", "need", "can", "with", "under", "below", "less", "than", "upto", "up", "cheaper",
  "some", "please", "rs", "inr", "something", "anything", "there", "about",
  // Generic nouns. A shopper saying "things above 1000" has stated a price
  // bound and nothing else; letting "things" survive turns a valid filter into
  // a keyword search no product can satisfy, and the store looks empty.
  "thing", "things", "stuff", "item", "items", "product", "products",
  "option", "options", "everything", "else", "one", "ones",
  // Contractions the tokeniser would otherwise treat as product words.
  "whats", "hows", "wheres", "theres", "its", "youre", "dont", "doesnt",
]);

export function terms(query?: string): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function haystack(p: CatalogProduct): string {
  return [p.title, p.description, p.productType, p.vendor, ...p.tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasAvailableVariant(product: CatalogProduct): boolean {
  return product.variants.some(
    (variant) =>
      variant.availableForSale &&
      (variant.inventoryQuantity === null || variant.inventoryQuantity > 0),
  );
}

export function applySearch(all: CatalogProduct[], args: SearchArgs): CatalogProduct[] {
  const limit = Math.min(Math.max(args.limit ?? 8, 1), 20);
  let out = all;

  if (args.inStockOnly) out = out.filter(hasAvailableVariant);

  if (args.productType) {
    const t = args.productType.toLowerCase();
    out = out.filter((p) => (p.productType ?? "").toLowerCase().includes(t));
  }

  if (args.tags?.length) {
    const want = args.tags.map((t) => t.toLowerCase());
    out = out.filter((p) => p.tags.some((t) => want.includes(t.toLowerCase())));
  }

  // A price bound applies to what the shopper could actually pay: at least one
  // variant must sit inside the range, not merely overlap it.
  if (args.priceMin !== undefined || args.priceMax !== undefined) {
    const lo = args.priceMin ?? -Infinity;
    const hi = args.priceMax ?? Infinity;
    out = out.filter((p) =>
      p.variants.some((v) => Number(v.price) >= lo && Number(v.price) <= hi),
    );
  }

  const t = terms(args.query);
  if (t.length) {
    const scored = out
      .map((p) => {
        const hay = haystack(p);
        const title = p.title.toLowerCase();
        const tags = p.tags.join(" ").toLowerCase();
        const strong = t.some((w) => title.includes(w) || tags.includes(w));
        const score = t.reduce(
          (s, w) =>
            s + (title.includes(w) ? 4 : 0) + (tags.includes(w) ? 2 : 0) + (hay.includes(w) ? 1 : 0),
          0,
        );
        return { p, score, strong };
      })
      .filter((x) => x.score > 0);

    // If anything matched on a title or tag, drop the description-only
    // matches entirely. Otherwise "cold brew" returns the cupping set because
    // its description mentions brewing — technically a match, and useless.
    const strong = scored.filter((x) => x.strong);
    out = (strong.length ? strong : scored).sort((a, b) => b.score - a.score).map((x) => x.p);
  }

  if (args.sort === "price_asc") {
    out = [...out].sort((a, b) => Number(a.minPrice) - Number(b.minPrice));
  }
  if (args.sort === "price_desc") {
    out = [...out].sort((a, b) => Number(b.minPrice) - Number(a.minPrice));
  }

  return out.slice(0, limit);
}

/**
 * Complements, from what the catalogue already knows: shared tags first, then a
 * different product type from the same store.
 *
 * Deliberately a retrieval heuristic, not a recommendation model. Real
 * co-purchase data replaces it once order history exists. What matters now is
 * that every suggestion is a real, in-stock product — grounded, so the bounds
 * hold.
 */
export function applyComplements(
  all: CatalogProduct[],
  handle: string,
  limit = 3,
): CatalogProduct[] {
  const seed = all.find((p) => p.handle === handle);
  if (!seed) return [];
  const seedTags = new Set(seed.tags.map((t) => t.toLowerCase()));
  return all
    .filter((p) => p.handle !== handle && hasAvailableVariant(p))
    .map((p) => {
      const shared = p.tags.filter((t) => seedTags.has(t.toLowerCase())).length;
      const differentType = p.productType !== seed.productType ? 1 : 0;
      return { p, score: shared * 2 + differentType };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

/* ------------------------------------------------------------------ */
/* Shopify                                                             */
/* ------------------------------------------------------------------ */

type AdminClient = {
  graphql: (q: string, o?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const FIELDS = `
  handle title description productType vendor tags onlineStoreUrl totalInventory
  featuredMedia { preview { image { url } } }
  priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
  variants(first: 25) { nodes { title price sku availableForSale inventoryQuantity } }
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromShopify(n: any): CatalogProduct {
  const min = n.priceRangeV2?.minVariantPrice;
  const cur = min?.currencyCode ?? "USD";
  return {
    handle: n.handle,
    title: n.title,
    description: (n.description ?? "").slice(0, 600),
    productType: n.productType || null,
    vendor: n.vendor || null,
    tags: n.tags ?? [],
    url: n.onlineStoreUrl ?? (n.handle ? `/products/${n.handle}` : null),
    image: n.featuredMedia?.preview?.image?.url ?? null,
    minPrice: min?.amount ?? "0",
    maxPrice: n.priceRangeV2?.maxVariantPrice?.amount ?? "0",
    currency: cur,
    totalInventory: n.totalInventory ?? null,
    variants: (n.variants?.nodes ?? []).map((v: any) => ({
      title: v.title,
      price: v.price,
      currency: cur,
      sku: v.sku || null,
      availableForSale: Boolean(v.availableForSale),
      inventoryQuantity: v.inventoryQuantity ?? null,
    })),
  };
}

export function shopifyCatalog(admin: AdminClient): CatalogSource {
  async function page(query: string | null, n: number): Promise<CatalogProduct[]> {
    const res = await admin.graphql(
      `query AgentCatalog($q: String, $n: Int!) { products(first: $n, query: $q) { nodes { ${FIELDS} } } }`,
      { variables: { q: query, n } },
    );
    const body = (await res.json()) as any;
    if (body.errors) throw new Error(`catalog read failed: ${JSON.stringify(body.errors)}`);
    return (body.data?.products?.nodes ?? []).map(fromShopify);
  }

  return {
    kind: "shopify",
    // Shopify's product query DSL cannot express our price and stock rules, so
    // fetch a wider page and apply the shared filter. Identical behaviour on
    // both sources, which is the whole point of having one.
    async search(args) {
      return applySearch(await page(args.query?.trim() || null, 50), args);
    },
    async get(handle) {
      const res = await admin.graphql(
        `query AgentProduct($h: String!) { productByIdentifier(identifier: { handle: $h }) { ${FIELDS} } }`,
        { variables: { h: handle } },
      );
      const body = (await res.json()) as any;
      if (body.errors) throw new Error(`product fetch failed: ${JSON.stringify(body.errors)}`);
      return body.data?.productByIdentifier ? fromShopify(body.data.productByIdentifier) : null;
    },
    async complements(handle, limit) {
      return applyComplements(await page(null, 100), handle, limit);
    },
    async policies() {
      return {};
    },
  };
}

/* ------------------------------------------------------------------ */
/* JSON feed (custom sites)                                            */
/* ------------------------------------------------------------------ */

type Feed = {
  shop?: { currency?: string; policies?: ShopPolicies };
  products?: any[];
};

function fromFeed(p: any, currency: string, base: string): CatalogProduct {
  const variants: CatalogVariant[] = (p.variants ?? []).map((v: any) => ({
    title: v.title ?? "Default",
    price: String(v.price ?? 0),
    currency,
    sku: v.sku ?? null,
    availableForSale: v.inStock !== false,
    inventoryQuantity: typeof v.inventory === "number" ? v.inventory : null,
  }));
  const prices = variants.map((v) => Number(v.price)).filter((n) => !Number.isNaN(n));
  const abs = (u: string | null) => (u && u.startsWith("/") ? new URL(u, base).toString() : u);
  const inventoryIsKnown = variants.every(
    (variant) => variant.inventoryQuantity !== null,
  );
  return {
    handle: p.handle,
    title: p.title,
    description: String(p.description ?? "").slice(0, 600),
    productType: p.type ?? null,
    vendor: p.vendor ?? null,
    tags: p.tags ?? [],
    url: abs(p.url ?? `/product.html?handle=${p.handle}`),
    image: abs(p.image ?? null),
    minPrice: String(prices.length ? Math.min(...prices) : 0),
    maxPrice: String(prices.length ? Math.max(...prices) : 0),
    currency,
    totalInventory: inventoryIsKnown
      ? variants.reduce((a, v) => a + (v.inventoryQuantity ?? 0), 0)
      : null,
    variants,
  };
}

/** Cached because one shopper conversation makes several reads in a row. */
const feedCache = new Map<string, { at: number; feed: Feed }>();
const FEED_TTL_MS = 60_000;

function storeCatalogSnapshot(
  feedUrl: string,
  products: CatalogProduct[],
  policies: ShopPolicies,
): void {
  const db = database();
  const stores = db.prepare(`
    SELECT id FROM stores WHERE configured = 1 AND catalog_feed_url = ?
  `).all(feedUrl) as Array<{ id: string }>;
  if (!stores.length) return;
  const contentHash = crypto.createHash("sha256")
    .update(json({ products, policies })).digest("hex");
  for (const store of stores) {
    const existing = db.prepare(`
      SELECT id FROM catalog_snapshots WHERE store_id = ? AND content_hash = ?
    `).get(store.id, contentHash) as { id: string } | undefined;
    if (existing) {
      db.prepare(`UPDATE stores SET active_catalog_snapshot_id = ? WHERE id = ?`)
        .run(existing.id, store.id);
      continue;
    }
    const snapshotId = `cat_${crypto.randomBytes(10).toString("hex")}`;
    const now = new Date().toISOString();
    transaction((tx) => {
      tx.prepare(`
        INSERT INTO catalog_snapshots(
          id, store_id, source, source_url, content_hash, status, created_at, activated_at
        ) VALUES (?, ?, 'feed', ?, ?, 'ready', ?, ?)
      `).run(snapshotId, store.id, feedUrl, contentHash, now, now);
      const productInsert = tx.prepare(`
        INSERT INTO catalog_products(
          id, snapshot_id, handle, title, description, product_type, vendor,
          url, image, currency, total_inventory
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const variantInsert = tx.prepare(`
        INSERT INTO catalog_variants(
          id, product_id, title, sku, price_minor, currency, available, inventory_quantity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tagInsert = tx.prepare(`INSERT INTO catalog_tags(product_id, tag) VALUES (?, ?)`);
      for (const product of products) {
        const productId = `prd_${crypto.randomBytes(10).toString("hex")}`;
        productInsert.run(
          productId, snapshotId, product.handle, product.title, product.description,
          product.productType, product.vendor, product.url, product.image,
          product.currency, product.totalInventory,
        );
        for (const variant of product.variants) {
          variantInsert.run(
            `var_${crypto.randomBytes(10).toString("hex")}`, productId,
            variant.title, variant.sku, Math.round(Number(variant.price) * 100),
            variant.currency, variant.availableForSale ? 1 : 0,
            variant.inventoryQuantity,
          );
        }
        for (const tag of new Set(product.tags)) tagInsert.run(productId, tag);
      }
      const policyInsert = tx.prepare(`
        INSERT INTO catalog_policies(snapshot_id, policy_type, body) VALUES (?, ?, ?)
      `);
      for (const key of ["returns", "shipping", "cod"] as const) {
        if (policies[key]) policyInsert.run(snapshotId, key, policies[key]);
      }
      tx.prepare(`
        UPDATE stores SET active_catalog_snapshot_id = ?, updated_at = ? WHERE id = ?
      `).run(snapshotId, now, store.id);
    });
  }
}

function storedCatalog(feedUrl: string): { products: CatalogProduct[]; policies: ShopPolicies } | null {
  const db = database();
  const snapshot = db.prepare(`
    SELECT cs.id FROM stores s JOIN catalog_snapshots cs
      ON cs.id = s.active_catalog_snapshot_id
    WHERE s.configured = 1 AND s.catalog_feed_url = ? LIMIT 1
  `).get(feedUrl) as { id: string } | undefined;
  if (!snapshot) return null;
  const rows = db.prepare(`
    SELECT * FROM catalog_products WHERE snapshot_id = ? ORDER BY rowid
  `).all(snapshot.id) as Array<Record<string, unknown>>;
  const variants = db.prepare(`
    SELECT * FROM catalog_variants WHERE product_id = ? ORDER BY rowid
  `);
  const tags = db.prepare(`SELECT tag FROM catalog_tags WHERE product_id = ? ORDER BY tag`);
  const products: CatalogProduct[] = rows.map((row) => {
    const vs = variants.all(row.id as string) as Array<Record<string, unknown>>;
    const mapped = vs.map((v) => ({
      title: String(v.title), price: (Number(v.price_minor) / 100).toFixed(2),
      currency: String(v.currency), sku: v.sku === null ? null : String(v.sku),
      availableForSale: Number(v.available) === 1,
      inventoryQuantity: v.inventory_quantity === null ? null : Number(v.inventory_quantity),
    }));
    const prices = mapped.map((v) => Number(v.price));
    return {
      handle: String(row.handle), title: String(row.title), description: String(row.description),
      productType: row.product_type === null ? null : String(row.product_type),
      vendor: row.vendor === null ? null : String(row.vendor),
      tags: (tags.all(row.id as string) as Array<{ tag: string }>).map((x) => x.tag),
      url: row.url === null ? null : String(row.url),
      image: row.image === null ? null : String(row.image),
      minPrice: String(prices.length ? Math.min(...prices) : 0),
      maxPrice: String(prices.length ? Math.max(...prices) : 0),
      currency: String(row.currency),
      totalInventory: row.total_inventory === null ? null : Number(row.total_inventory),
      variants: mapped,
    };
  });
  const policyRows = db.prepare(`
    SELECT policy_type, body FROM catalog_policies WHERE snapshot_id = ?
  `).all(snapshot.id) as Array<{ policy_type: keyof ShopPolicies; body: string }>;
  const policies: ShopPolicies = {};
  for (const row of policyRows) policies[row.policy_type] = row.body;
  return { products, policies };
}

export function jsonFeedCatalog(feedUrl: string): CatalogSource {
  async function load(): Promise<Feed> {
    const hit = feedCache.get(feedUrl);
    if (hit && Date.now() - hit.at < FEED_TTL_MS) return hit.feed;
    const res = await fetch(feedUrl);
    if (!res.ok) throw new Error(`catalogue feed ${feedUrl} returned ${res.status}`);
    const feed = (await res.json()) as Feed;
    feedCache.set(feedUrl, { at: Date.now(), feed });
    return feed;
  }

  async function all(): Promise<CatalogProduct[]> {
    try {
      const feed = await load();
      const currency = feed.shop?.currency ?? "INR";
      const products = (feed.products ?? []).map((p) => fromFeed(p, currency, feedUrl));
      storeCatalogSnapshot(feedUrl, products, feed.shop?.policies ?? {});
      return products;
    } catch (error) {
      const snapshot = storedCatalog(feedUrl);
      if (snapshot) return snapshot.products;
      throw error;
    }
  }

  return {
    kind: "json-feed",
    // A search that matches nothing returns nothing. Never fall back to
    // "here is everything" — that is how an assistant ends up confidently
    // recommending an unrelated product.
    async search(args) {
      return applySearch(await all(), args);
    },
    async get(handle) {
      return (await all()).find((p) => p.handle === handle) ?? null;
    },
    async complements(handle, limit) {
      return applyComplements(await all(), handle, limit);
    },
    async policies() {
      try {
        const feed = await load();
        const products = await all();
        storeCatalogSnapshot(feedUrl, products, feed.shop?.policies ?? {});
        return feed.shop?.policies ?? {};
      } catch (error) {
        const snapshot = storedCatalog(feedUrl);
        if (snapshot) return snapshot.policies;
        throw error;
      }
    },
  };
}
import crypto from "node:crypto";
import { database, json, parseJson, transaction } from "./database.server";
