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
import fs from "node:fs";
import path from "node:path";

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

const FILE = path.join(process.cwd(), "decision-ledger.jsonl");

export function record(entry: Omit<LedgerEntry, "ts">) {
  const row: LedgerEntry = { ts: new Date().toISOString(), ...entry };
  try {
    fs.appendFileSync(FILE, JSON.stringify(row) + "\n", "utf8");
  } catch {
    // Never let logging break a shopper's conversation.
  }
  return row;
}

export function readLedger(limit = 200): LedgerEntry[] {
  try {
    return fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((l) => JSON.parse(l) as LedgerEntry);
  } catch {
    return [];
  }
}
