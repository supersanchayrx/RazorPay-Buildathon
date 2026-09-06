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
import { dataPath } from "./paths.server";

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
function resolveLedgerFile(): string {
  const current = dataPath("decision-ledger.jsonl");
  const legacy = path.join(process.cwd(), "decision-ledger.jsonl");
  if (path.resolve(legacy) !== path.resolve(current)) {
    try {
      if (fs.existsSync(legacy) && !fs.existsSync(current)) {
        try {
          fs.renameSync(legacy, current);
        } catch {
          // A rename cannot cross a filesystem, and a mounted data volume is
          // very often a different one. Copy first and only then drop the
          // original, so an interruption leaves two ledgers rather than none.
          fs.copyFileSync(legacy, current);
          fs.rmSync(legacy);
        }
      }
    } catch {
      // Nothing can be done from in here. `npm run doctor` reports it instead.
    }
  }
  return current;
}

const FILE = resolveLedgerFile();

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
