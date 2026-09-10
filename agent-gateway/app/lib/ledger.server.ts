/**
 * The decision ledger.
 *
 * One append-only log covering every moment the assistant wanted to act and a
 * gate stopped it, plus the actions it did take. It is deliberately a single
 * table rather than two features: merchant-rejected offer proposals and
 * agent-side refusals are the same shape, and the buildplan wants both counted.
 *
 * JSONL for now so it survives restarts with no migration. It should become a
 * Prisma model before this is more than a demo — the shape below is the schema.
 */
import { database, ensureStore, json, parseJson } from "./database.server";

export type LedgerEntry = {
  ts: string;
  shop: string;
  kind:
    | "reply"
    | "refusal"
    | "tool_error"
    /** Money. Separated from conversation because it is audited differently. */
    | "quote"
    | "payment_started"
    | "payment_verified"
    | "payment_rejected";
  /** Which gate fired. Closed set so it aggregates. */
  gate?:
    | "unverifiable_discount"
    | "unverifiable_urgency"
    | "unapproved_event"
    | "assumed_observance"
    | "ungrounded_claim"
    | "insufficient_data";
  message: string;
  detail?: unknown;
};

/**
 * The ledger moved, and an existing one is carried across.
 *
 * It used to be written to the repo root, which put a shop's audit trail
 * inside a git working tree and left it behind whenever a container was
 * replaced. It now lives with everything else CHAPMAN writes, under
 * `CHAPMAN_DATA_DIR`.
 *
 * The move happens here, once, rather than in a migration script a merchant
 * has to know to run. This is the record of every refusal made on their
 * behalf — the one file in CHAPMAN whose worth is precisely that it is
 * complete — so quietly starting a fresh one and orphaning the old is the
 * worst outcome available. It is skipped when a ledger already exists at the
 * destination, so it can never overwrite, and it is silent on failure because
 * a logging module must not be the reason a shop fails to boot.
 */
export function record(entry: Omit<LedgerEntry, "ts">) {
  const row: LedgerEntry = { ts: new Date().toISOString(), ...entry };
  try {
    database().prepare(`
      INSERT INTO decision_ledger(store_id, occurred_at, kind, gate, message, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      ensureStore(row.shop), row.ts, row.kind, row.gate ?? null, row.message,
      row.detail === undefined ? null : json(row.detail),
    );
  } catch {
    // Never let logging break a shopper's conversation.
  }
  return row;
}

export function readLedger(limit = 200): LedgerEntry[] {
  const rows = database().prepare(`
    SELECT s.site_key, l.occurred_at, l.kind, l.gate, l.message, l.detail
    FROM decision_ledger l JOIN stores s ON s.id = l.store_id
    ORDER BY l.id DESC LIMIT ?
  `).all(Math.max(0, limit)) as Array<{
    site_key: string; occurred_at: string; kind: LedgerEntry["kind"];
    gate: LedgerEntry["gate"] | null; message: string; detail: string | null;
  }>;
  return rows.reverse().map((r) => ({
    ts: r.occurred_at,
    shop: r.site_key,
    kind: r.kind,
    ...(r.gate ? { gate: r.gate } : {}),
    message: r.message,
    ...(r.detail !== null ? { detail: parseJson(r.detail, null) } : {}),
  }));
}

export { closeDatabase } from "./database.server";
