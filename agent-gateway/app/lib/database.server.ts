/**
 * Chapman's authoritative SQLite database.
 *
 * Runtime repositories in this codebase have deliberately synchronous APIs:
 * pricing, bounds checks and settlement all call them in the middle of one
 * decision. Node's built-in synchronous SQLite driver lets those contracts
 * stay small while replacing the unsafe read/append/rewrite file pattern with
 * real constraints and transactions. Prisma still owns Shopify's Session
 * model and can use this same file.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { registerShutdownTask } from "./runtime-lifecycle.server";
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths.server";

type Migration = { version: number; name: string; sql: string };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "authoritative_chapman_store",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS stores (
        id TEXT PRIMARY KEY,
        site_key TEXT NOT NULL UNIQUE,
        name TEXT,
        catalog_mode TEXT NOT NULL DEFAULT 'feed'
          CHECK (catalog_mode IN ('feed','csv','crawler','shopify')),
        catalog_feed_url TEXT,
        product_url_template TEXT,
        recover_path TEXT,
        restore_path TEXT,
        greeting TEXT,
        accent TEXT,
        site_secret_env TEXT,
        orders_json TEXT,
        razorpay_json TEXT,
        active_catalog_snapshot_id TEXT,
        configured INTEGER NOT NULL DEFAULT 0 CHECK (configured IN (0,1)),
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (active_catalog_snapshot_id) REFERENCES catalog_snapshots(id)
          ON DELETE SET NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS store_origins (
        store_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        PRIMARY KEY (store_id, origin),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS merchant_stores (
        merchant_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin','analyst')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (merchant_id, store_id),
        FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS store_settings (
        store_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        updated_at TEXT,
        updated_by TEXT,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS feature_flags (
        store_id TEXT NOT NULL,
        feature TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        PRIMARY KEY (store_id, feature),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS feature_flag_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL,
        feature TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
        changed_at TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_feature_events_store_time
        ON feature_flag_events(store_id, changed_at DESC);

      CREATE TABLE IF NOT EXISTS catalog_snapshots (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('feed','csv','crawler','shopify')),
        source_url TEXT,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('building','ready','failed')),
        error TEXT,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        UNIQUE (store_id, content_hash),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_catalog_snapshots_store_time
        ON catalog_snapshots(store_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS catalog_products (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        handle TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        product_type TEXT,
        vendor TEXT,
        url TEXT,
        image TEXT,
        currency TEXT NOT NULL,
        total_inventory INTEGER,
        UNIQUE (snapshot_id, handle),
        FOREIGN KEY (snapshot_id) REFERENCES catalog_snapshots(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS catalog_variants (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        title TEXT NOT NULL,
        sku TEXT,
        price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
        currency TEXT NOT NULL,
        available INTEGER NOT NULL CHECK (available IN (0,1)),
        inventory_quantity INTEGER,
        FOREIGN KEY (product_id) REFERENCES catalog_products(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_catalog_variants_product
        ON catalog_variants(product_id);
      CREATE INDEX IF NOT EXISTS idx_catalog_variants_sku
        ON catalog_variants(sku) WHERE sku IS NOT NULL;

      CREATE TABLE IF NOT EXISTS catalog_tags (
        product_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (product_id, tag),
        FOREIGN KEY (product_id) REFERENCES catalog_products(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS catalog_policies (
        snapshot_id TEXT NOT NULL,
        policy_type TEXT NOT NULL CHECK (policy_type IN ('returns','shipping','cod')),
        body TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, policy_type),
        FOREIGN KEY (snapshot_id) REFERENCES catalog_snapshots(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS carts (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        client_reference_hash TEXT,
        customer_id TEXT,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        updated_at TEXT NOT NULL,
        recovered INTEGER NOT NULL DEFAULT 0 CHECK (recovered IN (0,1)),
        UNIQUE (store_id, client_reference_hash),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_carts_store_time ON carts(store_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS cart_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cart_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_cart_events_cart_time ON cart_events(cart_id, occurred_at);

      CREATE TABLE IF NOT EXISTS pending_checkouts (
        gateway_order_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
        currency TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        customer_id TEXT,
        cart_ref TEXT,
        recovery_grant_id TEXT,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_pending_store_time
        ON pending_checkouts(store_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS placed_orders (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        gateway_order_id TEXT NOT NULL UNIQUE,
        gateway_payment_id TEXT,
        created_at TEXT NOT NULL,
        settled_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('paid','authorized','failed')),
        method TEXT,
        amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
        currency TEXT NOT NULL,
        customer_id TEXT,
        fingerprint TEXT NOT NULL,
        settled_by TEXT NOT NULL CHECK (settled_by IN ('browser','webhook')),
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_placed_orders_store_time
        ON placed_orders(store_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS payment_events (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        gateway_order_id TEXT NOT NULL,
        gateway_payment_id TEXT,
        kind TEXT NOT NULL,
        received_at TEXT NOT NULL,
        payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_event_provider
        ON payment_events(gateway_payment_id, kind)
        WHERE gateway_payment_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS offer_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('approve','reject','revoke')),
        decided_at TEXT NOT NULL,
        decided_by TEXT NOT NULL,
        note TEXT,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_offer_decisions_candidate
        ON offer_decisions(store_id, candidate_id, decided_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS recovery_grants (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        cart_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        redeemed_at TEXT,
        redeemed_order_id TEXT,
        margin_cost_minor INTEGER NOT NULL CHECK (margin_cost_minor >= 0),
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        UNIQUE (store_id, cart_id),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_grants_store_issued
        ON recovery_grants(store_id, issued_at DESC);

      CREATE TABLE IF NOT EXISTS grant_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grant_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('issued','redeemed')),
        occurred_at TEXT NOT NULL,
        payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
        FOREIGN KEY (grant_id) REFERENCES recovery_grants(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS recovery_conversations (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        cart_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('asked','answered','remedied','recovered','closed')),
        finished INTEGER NOT NULL DEFAULT 0 CHECK (finished IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (store_id, cart_id),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS recovery_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('asked','answered','remedied','recovered','closed')),
        occurred_at TEXT NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        UNIQUE (conversation_id, sequence),
        FOREIGN KEY (conversation_id) REFERENCES recovery_conversations(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS outreach_drafts (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_outreach_drafts_store_time
        ON outreach_drafts(store_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS outreach_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_key TEXT NOT NULL,
        store_id TEXT NOT NULL,
        draft_id TEXT,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_ref TEXT,
        attempted_at TEXT NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        UNIQUE (attempt_key, status),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
        FOREIGN KEY (draft_id) REFERENCES outreach_drafts(id) ON DELETE SET NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_outreach_attempts_store_time
        ON outreach_attempts(store_id, attempted_at DESC);

      CREATE TABLE IF NOT EXISTS voice_transcript_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        UNIQUE (call_id, sequence),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS decision_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        gate TEXT,
        message TEXT NOT NULL,
        detail TEXT CHECK (detail IS NULL OR json_valid(detail)),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ledger_store_time
        ON decision_ledger(store_id, occurred_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS shopper_memories (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('preference','context','habit','boundary')),
        text TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('chat','voice','recovery')),
        evidence TEXT,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        UNIQUE (store_id, subject, content_hash),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_memories_subject_expiry
        ON shopper_memories(store_id, subject, expires_at, last_used_at DESC);

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL CHECK (dimensions > 0),
        vector BLOB NOT NULL,
        embedded_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, model),
        FOREIGN KEY (memory_id) REFERENCES shopper_memories(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS embedding_jobs (
        memory_id TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','running','failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        PRIMARY KEY (memory_id, model),
        FOREIGN KEY (memory_id) REFERENCES shopper_memories(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS idx_embedding_jobs_due
        ON embedding_jobs(status, next_attempt_at);

      CREATE TABLE IF NOT EXISTS store_documents (
        store_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (store_id, kind),
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
      ) STRICT, WITHOUT ROWID;
    `,
  },
  {
    version: 2,
    name: "normalised_commerce_lines",
    sql: `
      CREATE TABLE IF NOT EXISTS cart_lines (
        cart_id TEXT NOT NULL,
        line_key TEXT NOT NULL,
        handle TEXT NOT NULL,
        sku TEXT,
        title TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
        unit_cost_minor INTEGER CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0),
        line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
        PRIMARY KEY (cart_id, line_key),
        FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS pending_checkout_lines (
        gateway_order_id TEXT NOT NULL,
        line_index INTEGER NOT NULL CHECK (line_index >= 0),
        handle TEXT NOT NULL,
        sku TEXT,
        title TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
        line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
        PRIMARY KEY (gateway_order_id, line_index),
        FOREIGN KEY (gateway_order_id) REFERENCES pending_checkouts(gateway_order_id)
          ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS placed_order_lines (
        order_id TEXT NOT NULL,
        line_index INTEGER NOT NULL CHECK (line_index >= 0),
        handle TEXT NOT NULL,
        sku TEXT,
        title TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
        line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
        PRIMARY KEY (order_id, line_index),
        FOREIGN KEY (order_id) REFERENCES placed_orders(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID;
    `,
  },
];

let current: { path: string; db: DatabaseSync } | null = null;

export function databasePath(): string {
  const explicit = process.env.CHAPMAN_DATABASE_PATH?.trim();
  return path.resolve(explicit || dataPath("chapman.sqlite"));
}

function configure(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT
  `);
  const applied = db.prepare("SELECT version FROM schema_migrations").all()
    .map((row) => Number((row as { version: number }).version));
  const have = new Set(applied);
  for (const migration of MIGRATIONS) {
    if (have.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* original error wins */ }
      throw error;
    }
  }
}

export function database(): DatabaseSync {
  const wanted = databasePath();
  if (current?.path === wanted) return current.db;
  current?.db.close();
  fs.mkdirSync(path.dirname(wanted), { recursive: true });
  const db = new DatabaseSync(wanted);
  configure(db);
  migrate(db);
  current = { path: wanted, db };
  return db;
}

export type DatabaseHealth = {
  ok: true;
  migration: { current: number; expected: number };
  foreignKeys: true;
  journalMode: "wal";
  writable: true;
};

/** Fast local dependency check; never calls a model, storefront, or provider. */
export function databaseHealth(): DatabaseHealth {
  const db = database();
  const migration = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };
  const foreignKeys = Number((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys);
  const journalMode = String((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toLowerCase();
  const expected = MIGRATIONS.at(-1)?.version ?? 0;
  fs.accessSync(path.dirname(databasePath()), fs.constants.W_OK);
  fs.accessSync(databasePath(), fs.constants.W_OK);
  if (migration.version !== expected) throw new Error(`database migration ${migration.version}/${expected}`);
  if (foreignKeys !== 1) throw new Error("SQLite foreign keys are disabled");
  if (journalMode !== "wal") throw new Error(`SQLite journal mode is ${journalMode}, expected wal`);
  return {
    ok: true,
    migration: { current: migration.version, expected },
    foreignKeys: true,
    journalMode: "wal",
    writable: true,
  };
}

export function transaction<T>(work: (db: DatabaseSync) => T): T {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* original error wins */ }
    throw error;
  }
}

/** Create a tenant shell for records written before onboarding finishes. */
export function ensureStore(siteKey: string): string {
  const db = database();
  const found = db.prepare("SELECT id FROM stores WHERE site_key = ?").get(siteKey) as
    | { id: string }
    | undefined;
  if (found) return found.id;
  const id = `store_${Buffer.from(siteKey).toString("base64url").slice(0, 40)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO stores(id, site_key, configured, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?)
  `).run(id, siteKey, now, now);
  return (db.prepare("SELECT id FROM stores WHERE site_key = ?").get(siteKey) as { id: string }).id;
}

export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function readStoreDocument<T>(siteKey: string, kind: string, fallback: T): T {
  const row = database().prepare(`
    SELECT d.payload FROM store_documents d JOIN stores s ON s.id = d.store_id
    WHERE s.site_key = ? AND d.kind = ?
  `).get(siteKey, kind) as { payload: string } | undefined;
  return row ? parseJson<T>(row.payload, fallback) : fallback;
}

export function writeStoreDocument(
  siteKey: string,
  kind: string,
  payload: unknown,
  by = "system",
): void {
  database().prepare(`
    INSERT INTO store_documents(store_id, kind, payload, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(store_id, kind) DO UPDATE SET payload = excluded.payload,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(ensureStore(siteKey), kind, json(payload), new Date().toISOString(), by);
}

export function readDocuments<T>(kind: string): T[] {
  return (database().prepare(`
    SELECT payload FROM store_documents WHERE kind = ? ORDER BY store_id
  `).all(kind) as Array<{ payload: string }>).flatMap((row) => {
    const value = parseJson<T | T[]>(row.payload, []);
    return Array.isArray(value) ? value : [value];
  });
}

export function values(...input: SQLInputValue[]): SQLInputValue[] {
  return input;
}

export function closeDatabase(): void {
  if (!current) return;
  const db = current.db;
  current = null;
  try {
    // Fold committed WAL pages into the main file before the volume is handed
    // to the next container. SQLite remains crash-safe without this, but a
    // clean shutdown should leave the smallest, simplest recovery surface.
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

registerShutdownTask("sqlite.checkpoint_and_close", closeDatabase, 200);
