/**
 * The recovery conversation — one per abandoned basket, and only ever one.
 *
 * WHY THIS IS A STATE MACHINE AND NOT A CHAT LOG.
 *
 * The whole value of asking why is destroyed by asking twice. A shopper who
 * answers "too expensive", gets a remedy, and is then asked the same question
 * again next Tuesday has learned that nobody read the first answer. So the
 * states below are ordered and terminal states are terminal: there is no
 * transition out of `closed`, and `asked` cannot be re-entered.
 *
 *   asked ──▶ answered ──▶ remedied ──▶ recovered
 *     │           │            │
 *     └───────────┴────────────┴──▶ closed        (they said no, or we gave up)
 *
 * WHAT IT HOLDS THAT NOTHING ELSE MAY.
 *
 * A shopper's own words about why they didn't buy. That is personal data of a
 * particularly candid kind — "I couldn't afford it" is not something anyone
 * volunteered for a dashboard — so it lives here, keyed by (shop, cart), and
 * the only thing that crosses into the shop cortex is the COUNT per reason.
 * `reasonHistogram` is the whole export surface for that, and it returns
 * numbers.
 *
 * The raw text is kept because a merchant reading "unknown ×7" needs to be able
 * to look at the seven sentences and see whether the classifier is failing or
 * the shoppers are being vague. It is kept for that, and shown only in the
 * merchant console.
 */

import fs from "node:fs";
import path from "node:path";
import type { Reason } from "./reasons";
import type { Tier } from "./loyalty.server";

export type ConvState = "asked" | "answered" | "remedied" | "recovered" | "closed";

export type ConvTurn =
  | { kind: "asked"; ts: string; channel: string; draftId: string }
  | { kind: "answered"; ts: string; reason: Reason; by: string; evidence: string; text: string | null; tier: Tier }
  | { kind: "remedied"; ts: string; remedy: string; grantId?: string; blocked: string[] }
  | { kind: "recovered"; ts: string; gatewayOrderId: string; total: number }
  | { kind: "closed"; ts: string; why: string };

export type Conversation = {
  shop: string;
  cartId: string;
  customerId: string;
  state: ConvState;
  turns: ConvTurn[];
  /** Convenience projections, derived on read so they cannot drift from `turns`. */
  reason: Reason | null;
  answeredAt: string | null;
  grantId: string | null;
  /** True once the shopper has told us to stop, or the machine has finished. */
  finished: boolean;
};

const FILE = path.join(process.cwd(), "data", "recovery-conversations.jsonl");

type Row = { shop: string; cartId: string; customerId: string; turn: ConvTurn };

function readAll(): Row[] {
  try {
    return fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row);
  } catch {
    return [];
  }
}

function append(r: Row): boolean {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(r) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * The order states may be entered in.
 *
 * Used as a rank rather than a list of allowed transitions, because the only
 * rule is "never backwards" and a transition table for five states is four
 * times the code for the same guarantee.
 */
const RANK: Record<ConvState, number> = { asked: 0, answered: 1, remedied: 2, recovered: 3, closed: 3 };
const TERMINAL: ConvState[] = ["recovered", "closed"];

function fold(rows: Row[]): Conversation | null {
  if (!rows.length) return null;
  const turns = rows.map((r) => r.turn).sort((a, b) => a.ts.localeCompare(b.ts));
  let state: ConvState = "asked";
  for (const t of turns) if (RANK[t.kind as ConvState] >= RANK[state]) state = t.kind as ConvState;
  const answered = turns.find((t): t is Extract<ConvTurn, { kind: "answered" }> => t.kind === "answered");
  const remedied = turns.find((t): t is Extract<ConvTurn, { kind: "remedied" }> => t.kind === "remedied");
  return {
    shop: rows[0].shop,
    cartId: rows[0].cartId,
    customerId: rows[0].customerId,
    state,
    turns,
    reason: answered?.reason ?? null,
    answeredAt: answered?.ts ?? null,
    grantId: remedied?.grantId ?? null,
    finished: TERMINAL.includes(state),
  };
}

export function conversation(shop: string, cartId: string): Conversation | null {
  return fold(readAll().filter((r) => r.shop === shop && r.cartId === cartId));
}

export function conversations(shop: string): Conversation[] {
  const by = new Map<string, Row[]>();
  for (const r of readAll()) {
    if (r.shop !== shop) continue;
    const list = by.get(r.cartId) ?? [];
    list.push(r);
    by.set(r.cartId, list);
  }
  return [...by.values()].map(fold).filter((c): c is Conversation => c !== null);
}

/** Baskets we have already opened a conversation about, in any state. */
export function askedCarts(shop: string): Set<string> {
  return new Set(conversations(shop).map((c) => c.cartId));
}

/**
 * Customers who have told us to stop.
 *
 * A refusal is about the PERSON, not the basket. Somebody who says they changed
 * their mind about a kettle has not invited a message about their tea order
 * next week, and reading the suppression narrowly is a technically-correct way
 * to be told to go away twice.
 */
export function silenced(shop: string): Set<string> {
  return new Set(
    conversations(shop)
      .filter((c) => c.state === "closed" && c.turns.some((t) => t.kind === "closed" && /said no|changed|browsing/i.test(t.why)))
      .map((c) => c.customerId),
  );
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export type AppendResult = { ok: true; conversation: Conversation } | { ok: false; error: string };

/**
 * Add a turn, refusing anything that would move a conversation backwards or
 * restart a finished one.
 *
 * The refusal is the point. Without it, a retried webhook or a shopper
 * refreshing the page re-opens a conversation that ended, and the second
 * remedy is issued against a state that no longer exists.
 */
export function addTurn(input: { shop: string; cartId: string; customerId: string; turn: ConvTurn }): AppendResult {
  const current = conversation(input.shop, input.cartId);

  if (current) {
    if (current.finished && input.turn.kind !== "recovered") {
      return { ok: false, error: `this conversation is ${current.state}; nothing further is recorded against it` };
    }
    if (RANK[input.turn.kind as ConvState] < RANK[current.state]) {
      return { ok: false, error: `cannot go from ${current.state} back to ${input.turn.kind}` };
    }
    if (input.turn.kind === "asked") {
      return { ok: false, error: "this basket has already been asked about; asking twice is the failure this store exists to prevent" };
    }
  } else if (input.turn.kind !== "asked") {
    return { ok: false, error: "nothing has been asked about this basket yet" };
  }

  if (!append({ shop: input.shop, cartId: input.cartId, customerId: input.customerId, turn: input.turn })) {
    return { ok: false, error: "could not write the conversation; nothing was recorded" };
  }
  return { ok: true, conversation: conversation(input.shop, input.cartId)! };
}

/* ------------------------------------------------------------------ *
 * The part that crosses into the cortex
 * ------------------------------------------------------------------ */

/**
 * Counts per reason. Numbers only.
 *
 * This is the answer to the question no analytics package can reach: not what
 * happened, but why. A shop learning that 31% of its abandonments cite the
 * delivery charge has learned something worth more than the baskets it
 * recovered, and it is actionable at the shop level rather than one shopper at
 * a time.
 *
 * Returns nothing at all below `minAnswers`. A histogram over four answers is a
 * histogram that will be read as a finding, and four people are not a finding —
 * same reasoning as the proposer's sample floor.
 */
export function reasonHistogram(
  shop: string,
  opts: { minAnswers?: number; sinceDays?: number; asOf?: Date } = {},
): { total: number; enough: boolean; counts: Array<{ reason: Reason; count: number; share: number }> } {
  const asOf = opts.asOf ?? new Date();
  const minAnswers = opts.minAnswers ?? 10;
  const since = opts.sinceDays ? asOf.getTime() - opts.sinceDays * 86_400_000 : 0;

  const answered = conversations(shop)
    .map((c) => c.turns.find((t): t is Extract<ConvTurn, { kind: "answered" }> => t.kind === "answered"))
    .filter((t): t is Extract<ConvTurn, { kind: "answered" }> => Boolean(t) && Date.parse(t!.ts) >= since);

  const counts = new Map<Reason, number>();
  for (const a of answered) counts.set(a.reason, (counts.get(a.reason) ?? 0) + 1);

  return {
    total: answered.length,
    enough: answered.length >= minAnswers,
    counts: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count, share: count / Math.max(1, answered.length) }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Answer rate — how many of the baskets we asked about replied at all. */
export function answerRate(shop: string): { asked: number; answered: number; rate: number } {
  const all = conversations(shop);
  const answered = all.filter((c) => c.answeredAt !== null).length;
  return { asked: all.length, answered, rate: all.length ? answered / all.length : 0 };
}

/** Test seam. */
export function _file(): string {
  return FILE;
}
