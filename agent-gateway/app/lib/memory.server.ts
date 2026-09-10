/**
 * Shopper memory — what this shop knows about one person.
 *
 * The shop cortex holds what is true about a MERCHANT and has no type that can
 * carry a person. That rule is not being relaxed here; this is the other half
 * of it. Shop knowledge is merchant-owned and shared by every tool. Knowledge
 * about a human being is personal data, and it lives in its own store, keyed on
 * (merchant, shopper), with a TTL and a delete button.
 *
 * Two stores rather than one pool is the same reasoning as two tool registries
 * rather than one with a permission flag: the separation should be structural,
 * so that leaking a shopper's preference into a merchant report requires
 * writing a new code path rather than forgetting a check.
 *
 * ── THE RULE THAT MAKES THIS SAFE ──────────────────────────────────────────
 *
 *   MEMORY SUPPLIES THE QUESTION. TOOLS SUPPLY THE ANSWER.
 *
 * Memory says "they prefer low caffeine". The catalogue then says which
 * products are low caffeine, at what price, in stock today. A memory never
 * short-circuits a tool. So a stale memory can be wrong about a preference —
 * recoverable, the shopper corrects it in one sentence — and can never be wrong
 * about a price, because it is not allowed to contain one.
 *
 * That is enforced below by `checkMemory`, not by instructing a model. A
 * candidate carrying a price, a stock level, a discount, an order status or a
 * delivery date is REFUSED and the reason recorded. It is `bounds.server.ts`
 * pointed at storage instead of at speech, and for the same reason: a memory is
 * retrieved weeks later and rendered into a reply, so anything time-sensitive
 * inside one is a fabrication waiting for its moment.
 *
 * ── FOUR MORE PROPERTIES, EACH DELIBERATE ──────────────────────────────────
 *
 * 1. NO IDENTITY, NO MEMORY. `remember` refuses without a verified `sub`. An
 *    anonymous shopper gets session memory only — held by the caller, never
 *    written here. Not squeamishness: with no identity there is no way to
 *    honour a deletion request, so persisting would be collecting something we
 *    could never give back.
 *
 * 2. PER MERCHANT, ALWAYS. The key is (shop, sub). The same human shopping at
 *    two CHAPMAN merchants has two disjoint memories that never meet. This is
 *    the DPDP position and it is also the only version a merchant would accept.
 *
 * 3. STATED, NOT SILENT. Retrieval returns the sentence the shop would say out
 *    loud — "last time you were after something low-caffeine" — because stated
 *    memory is correctable and silent memory is spooky, and when it is wrong it
 *    is invisible.
 *
 * 4. IT AGES OUT. 180 days, refreshed on use. A dormant profile expires rather
 *    than accumulating forever, and `forget` deletes on demand.
 *
 * ── WHERE THIS GOES NEXT ───────────────────────────────────────────────────
 *
 * Retrieval here is deterministic term overlap, not embeddings. That is the
 * documented build order — the pre-filter and the content rules are testable
 * with no model at all, exactly like `stubReasoner`, and they decide how much
 * the model layer above them costs. `pgvector` replaces `score()` and nothing
 * else in this file when Prisma arrives; the store shape below is the schema.
 */
import { database, databasePath, ensureStore, json, parseJson } from "./database.server";
import crypto from "node:crypto";

/** Written this way so no shell or build step can mangle an escape. */
const NL = String.fromCharCode(10);

export const MEMORY_TTL_DAYS = 180;

/** How many memories may be recalled into one reply. */
export const RECALL_LIMIT = 4;

/** The most this store will hold for one person before the oldest are dropped. */
export const PER_SHOPPER_CAP = 40;

export type MemoryKind =
  /** A durable taste: low caffeine, drinks it black, dislikes smoky. */
  | "preference"
  /** Who or what they buy for: gifts for a colleague, brews for two. */
  | "context"
  /** How they shop: usually spends 500-800, buys every six weeks. */
  | "habit"
  /** Something they told us not to do. Highest priority on recall. */
  | "boundary";

export type Memory = {
  id: string;
  shop: string;
  sub: string;
  kind: MemoryKind;
  /** One sentence, in the third person, as the shop would say it back. */
  text: string;
  /** Where it came from, so a merchant reading one can tell chat from a call. */
  source: "chat" | "voice" | "recovery";
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /** The shopper's own words that produced it. Never rendered to anyone else. */
  evidence?: string | null;
};

/* ------------------------------------------------------------------ *
 * The content gate
 * ------------------------------------------------------------------ */

export type MemoryViolation = {
  gate: "expiring_fact" | "price" | "stock" | "offer" | "order_state" | "payment" | "too_long";
  matched: string;
};

const FORBIDDEN: Array<{ gate: MemoryViolation["gate"]; re: RegExp }> = [
  // A price in a memory is a price that will be wrong when it is recalled.
  { gate: "price", re: /(?:₹|rs\.?\s?|inr\s?)\s?\d[\d,]*(?:\.\d+)?/i },
  { gate: "price", re: /\b\d[\d,]*\s?(?:rupees|paise)\b/i },
  { gate: "stock", re: /\b(?:only\s+)?\d+\s+(?:left|remaining|in stock)\b/i },
  { gate: "stock", re: /\b(?:in|out of)\s+stock\b/i },
  { gate: "offer", re: /\b\d{1,2}\s?%\s?(?:off|discount)\b/i },
  { gate: "offer", re: /\b(?:discount|coupon|promo code|voucher|offer code)\b/i },
  { gate: "order_state", re: /\border\s+(?:#|no\.?|number|id)?\s?[a-z0-9_-]{4,}\b/i },
  { gate: "order_state", re: /\b(?:shipped|dispatched|out for delivery|delivered on|arriving)\b/i },
  { gate: "payment", re: /\b(?:card|upi|vpa|netbanking|wallet)\b.{0,20}\b(?:ending|number|id|failed|declined)\b/i },
  { gate: "payment", re: /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/ },
  // A dated promise. "usually shops in October" is a habit; "will get it on the
  // 14th" is a delivery date wearing a preference's clothes.
  { gate: "expiring_fact", re: /\b(?:by|on|before)\s+(?:today|tomorrow|tonight|\d{1,2}(?:st|nd|rd|th)?\s+\w+|\d{4}-\d{2}-\d{2})\b/i },
  { gate: "expiring_fact", re: /\b(?:this|next)\s+(?:week|weekend|month)\b/i },
];

/** The longest a memory may be. One or two sentences, not a transcript. */
const MAX_LEN = 180;

/**
 * Whether a candidate may be stored.
 *
 * Returns every violation rather than the first, because a merchant looking at
 * a rejected candidate wants to know what is wrong with it, not what is wrong
 * with it first.
 */
export function checkMemory(text: string): MemoryViolation[] {
  const out: MemoryViolation[] = [];
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_LEN) {
    out.push({ gate: "too_long", matched: `${t.length} characters; the ceiling is ${MAX_LEN}` });
  }
  for (const { gate, re } of FORBIDDEN) {
    const m = t.match(re);
    if (m) out.push({ gate, matched: m[0] });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The deterministic pre-filter
 * ------------------------------------------------------------------ */

const FIRST_PERSON =
  /\b(?:i|i'm|im|i've|ive|my|mine|we|we're|our|us|me)\b|\b(?:looking for|prefer|usually|always|never|can't stand|cannot stand|hate|love)\b/i;

/**
 * Routes that carry nothing about a person.
 *
 * "do you have cold brew" is a catalogue query and a policy question is a
 * policy question. Neither says anything durable, and running a grader model
 * over them is the rate-limit problem wearing a different hat.
 */
const EMPTY_ROUTES = new Set([
  "catalog_query",
  "policy_returns",
  "policy_shipping",
  "policy_cod",
  "order_status",
  "order_history",
  "payment_trouble",
]);

export type Candidate = {
  /** What the shopper actually said. */
  text: string;
  /** The route that message took, when there was one. */
  route?: string | null;
};

/**
 * Does this turn deserve a model's attention?
 *
 * Route first, reason second — the same lever as everywhere else. Most chats
 * are "do you have cold brew" and contain nothing about a person, so the cheap
 * check runs first and the grader becomes a per-candidate cost rather than a
 * per-conversation one.
 *
 * Deliberately returns a REASON when it declines, so the merchant console can
 * show why nothing was learned from a conversation instead of leaving a blank.
 */
export function worthLearning(
  c: Candidate,
  opts: { identified: boolean },
): { ok: true } | { ok: false; because: string } {
  if (!opts.identified) return { ok: false, because: "nobody was signed in, so there is nothing to attach it to" };
  const t = c.text.trim();
  if (t.length < 12) return { ok: false, because: "too short to carry a durable fact" };
  if (!FIRST_PERSON.test(t)) return { ok: false, because: "no first-person statement — it is about the shop, not the shopper" };
  if (c.route && EMPTY_ROUTES.has(c.route)) {
    return { ok: false, because: `routed to ${c.route}, which is a question about the shop` };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

/** A delete leaves a tombstone, so the append-only log stays append-only. */
type Row = ({ op: "put" } & Memory) | { op: "forget"; shop: string; sub: string; id?: string; at: string };

function readRows(): Row[] {
  return (database().prepare(`
    SELECT s.site_key, m.id, m.subject, m.kind, m.text, m.source,
      m.created_at, m.last_used_at, m.expires_at, m.evidence
    FROM shopper_memories m JOIN stores s ON s.id = m.store_id
    ORDER BY m.created_at, m.id
  `).all() as Array<{
    site_key: string; id: string; subject: string; kind: MemoryKind;
    text: string; source: Memory["source"]; created_at: string;
    last_used_at: string; expires_at: string; evidence: string | null;
  }>).map((r) => ({
    op: "put", id: r.id, shop: r.site_key, sub: r.subject, kind: r.kind,
    text: r.text, source: r.source, createdAt: r.created_at,
    lastUsedAt: r.last_used_at, expiresAt: r.expires_at, evidence: r.evidence,
  }));
}

function appendRow(row: Row): boolean {
  try {
    const storeId = ensureStore(row.shop);
    if (row.op === "forget") {
      if (row.id) {
        database().prepare(`
          DELETE FROM shopper_memories WHERE store_id = ? AND subject = ? AND id = ?
        `).run(storeId, row.sub, row.id);
      } else {
        database().prepare(`
          DELETE FROM shopper_memories WHERE store_id = ? AND subject = ?
        `).run(storeId, row.sub);
      }
    } else {
      const hash = crypto.createHash("sha256").update(row.text.trim().toLowerCase()).digest("hex");
      database().prepare(`
        INSERT INTO shopper_memories(
          id, store_id, subject, kind, text, source, evidence, content_hash,
          created_at, last_used_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, text = excluded.text,
          source = excluded.source, evidence = excluded.evidence,
          content_hash = excluded.content_hash, last_used_at = excluded.last_used_at,
          expires_at = excluded.expires_at
      `).run(
        row.id, storeId, row.sub, row.kind, row.text, row.source,
        row.evidence ?? null, hash, row.createdAt, row.lastUsedAt, row.expiresAt,
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Every live memory for one person at one shop.
 *
 * Expiry is applied on read rather than by a sweeper, so a memory that aged out
 * is invisible from the moment it should be, whether or not anything has run.
 */
export function memories(shop: string, sub: string, now = new Date()): Memory[] {
  if (!shop || !sub) return [];
  const live = new Map<string, Memory>();
  for (const row of readRows()) {
    if (row.shop !== shop || row.sub !== sub) continue;
    if (row.op === "forget") {
      if (row.id) live.delete(row.id);
      else live.clear();
      continue;
    }
    live.set(row.id, row);
  }
  const iso = now.toISOString();
  return [...live.values()]
    .filter((m) => m.expiresAt > iso)
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

export type RememberResult =
  | { ok: true; memory: Memory }
  | { ok: false; error: string; violations?: MemoryViolation[] };

/**
 * Store one thing about one person.
 *
 * Refuses without an identity, refuses anything the content gate rejects, and
 * refuses a near-duplicate of something already known — three separate reasons
 * that all produce the same outcome and must not be reported as the same one,
 * because only one of them means the extractor is misbehaving.
 */
export function remember(input: {
  shop: string;
  /** A VERIFIED subject. There is no code path that accepts a typed one. */
  sub: string | null | undefined;
  kind: MemoryKind;
  text: string;
  source: Memory["source"];
  evidence?: string | null;
  /**
   * This write REPLACES lines that are still on file, so skip the duplicate
   * check. Used by `consolidate` and by nothing else.
   *
   * The dedupe exists to stop the extractor recording the same fact twice in
   * slightly different words. Consolidation is the opposite operation — it is
   * deliberately writing a line that resembles what is already there, and then
   * tombstoning the originals. Found by running it against a real model: every
   * merged line was refused as "already known" and the whole consolidation
   * failed at the last step, reporting a content-gate failure that had not
   * happened. The unit test missed it because its fixture summary was phrased
   * differently enough to clear the threshold, which a faithful summary never
   * is.
   */
  replacing?: boolean;
  now?: Date;
}): RememberResult {
  if (!input.sub) {
    return { ok: false, error: "no verified shopper — anonymous sessions are not persisted" };
  }
  const text = input.text.trim().replace(/\s+/g, " ");

  const violations = checkMemory(text);
  if (violations.length) {
    return {
      ok: false,
      error: `a memory may not contain ${violations.map((v) => v.gate).join(", ")}`,
      violations,
    };
  }

  const now = input.now ?? new Date();
  const existing = memories(input.shop, input.sub, now);
  if (!input.replacing && existing.some((m) => similar(m.text, text))) {
    return { ok: false, error: "already known" };
  }

  const memory: Memory = {
    id: "mem_" + crypto.randomBytes(8).toString("hex"),
    shop: input.shop,
    sub: input.sub,
    kind: input.kind,
    text,
    source: input.source,
    createdAt: now.toISOString(),
    lastUsedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MEMORY_TTL_DAYS * 86_400_000).toISOString(),
    evidence: input.evidence ?? null,
  };

  if (!appendRow({ op: "put", ...memory })) {
    return { ok: false, error: "could not write the memory" };
  }

  // Oldest-used first, so what survives the cap is what the shop actually uses.
  const over = [...existing, memory].length - PER_SHOPPER_CAP;
  if (over > 0) {
    const doomed = [...existing].sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt)).slice(0, over);
    for (const d of doomed) appendRow({ op: "forget", shop: input.shop, sub: input.sub, id: d.id, at: now.toISOString() });
  }

  return { ok: true, memory };
}

/** Delete everything about one person, or one memory. Their right, not a favour. */
export function forget(shop: string, sub: string, id?: string): boolean {
  if (!shop || !sub) return false;
  return appendRow({ op: "forget", shop, sub, id, at: new Date().toISOString() });
}

/* ------------------------------------------------------------------ *
 * Recall
 * ------------------------------------------------------------------ */

const STOP = new Set(
  ("a an the and or but if then this that these those is are was were be been being do does did " +
    "i me my we our you your it its of to in on for with at by from as have has had will would " +
    "can could should about like want need get got some any all not no yes so very just really")
    .split(" "),
);

const terms = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Near-duplicate detection, over content words.
 *
 * The threshold is 0.7 rather than 0.8 because two rules legitimately fire on
 * one phrase: "I usually prefer low caffeine blends" is both a habit and a
 * preference, and produces "Usually prefer low caffeine blends." alongside
 * "Prefers low caffeine blends." Those overlap on three content words out of
 * four — 0.75 — so at 0.8 the shop remembered the same fact twice, in slightly
 * different words, and would eventually say both in one breath.
 *
 * It is not looser than it looks: the differing word is the whole content of a
 * real distinction. "Prefers oolong" against "Prefers jasmine" shares only
 * "prefers", which is 0.5, so genuinely different preferences stay separate.
 */
function similar(a: string, b: string): boolean {
  const ta = new Set(terms(a));
  const tb = new Set(terms(b));
  if (!ta.size || !tb.size) return a.toLowerCase() === b.toLowerCase();
  let shared = 0;
  for (const t of tb) if (ta.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.7;
}

/**
 * Term overlap, with a boundary always winning.
 *
 * This is the seam an encoder replaces, and it is written as one function so
 * that swapping it for pgvector touches nothing else. Until then, overlap is
 * honest about what it is: it will miss "decaf" against "low caffeine", and a
 * miss costs a slightly less personal reply, which is the failure direction to
 * prefer.
 */
function score(m: Memory, queryTerms: string[]): number {
  if (m.kind === "boundary") return 1000;
  if (queryTerms.length === 0) return m.kind === "preference" ? 2 : 1;
  const mt = new Set(terms(m.text));
  let hits = 0;
  for (const q of queryTerms) if (mt.has(q)) hits++;
  return hits * 10 + (m.kind === "preference" ? 2 : 1);
}

/**
 * What this shop should have in mind while answering.
 *
 * Recall REFRESHES the TTL on what it returns: a memory that keeps proving
 * useful should outlive one that never comes up, and that is a better ageing
 * rule than a fixed clock from the day it was written.
 */
export function recall(input: {
  shop: string;
  sub: string | null | undefined;
  /** The message being answered, so recall is about this turn, not the person in general. */
  query?: string;
  limit?: number;
  now?: Date;
}): Memory[] {
  if (!input.sub) return [];
  const now = input.now ?? new Date();
  const all = memories(input.shop, input.sub, now);
  if (!all.length) return [];

  const q = terms(input.query ?? "");
  const picked = all
    .map((m) => ({ m, s: score(m, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.m.lastUsedAt.localeCompare(a.m.lastUsedAt))
    .slice(0, input.limit ?? RECALL_LIMIT)
    .map((x) => x.m);

  for (const m of picked) {
    appendRow({
      op: "put",
      ...m,
      lastUsedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MEMORY_TTL_DAYS * 86_400_000).toISOString(),
    });
  }
  return picked;
}

/**
 * Memories as a prompt block.
 *
 * Third person, labelled as possibly wrong, and explicitly not an answer to
 * anything. The last line is the one that matters: it tells the model that
 * these are the QUESTION, and that the tools are still where answers come from.
 */
export function memoryBlock(ms: Memory[]): string | null {
  if (!ms.length) return null;
  return [
    `WHAT THIS SHOP REMEMBERS ABOUT THIS SHOPPER:`,
    ...ms.map((m) => `- ${m.text}`),
    ``,
    `These are from earlier conversations and may be out of date. Use them to ask a better`,
    `question or make a better suggestion, and say so openly when you do ("last time you`,
    `were after something low-caffeine — still?"). Never treat one as a fact about price,`,
    `stock, an offer or an order: look those up.`,
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

/**
 * Deterministic extraction, which is most of it.
 *
 * These are the shapes people actually use to state a durable preference, and
 * catching them needs no model at all. Anything subtler falls through to the
 * grader, which only runs on what `worthLearning` already let past — so a shop
 * with no model configured still builds a useful memory, exactly as it still
 * answers questions without one.
 */
const RULES: Array<{ kind: MemoryKind; re: RegExp; say: (m: RegExpMatchArray) => string }> = [
  {
    kind: "boundary",
    re: /\b(?:don'?t|do not|please don'?t|stop)\s+(?:ever\s+)?(?:call|phone|ring|message|text|contact)\s+me\b/i,
    say: () => "Asked not to be contacted about baskets they leave behind.",
  },
  {
    kind: "preference",
    re: /\bi\s+(?:really\s+)?(?:don'?t like|dislike|hate|can'?t stand|cannot stand)\s+([a-z][a-z\s-]{2,40})/i,
    say: (m) => `Dislikes ${m[1]}.`,
  },
  {
    kind: "preference",
    re: /\bi\s+(?:(?:only|ever|always|usually|really)\s+)*(?:like|love|prefer|drink|want)\s+([a-z][a-z\s-]{2,40})/i,
    say: (m) => `Prefers ${m[1]}.`,
  },
  {
    kind: "preference",
    re: /\b(?:i'?m|i am)\s+(?:looking for|after)\s+(?:something\s+)?([a-z][a-z\s-]{2,40})/i,
    say: (m) => `Was looking for something ${m[1]}.`,
  },
  {
    kind: "context",
    re: /\b(?:it'?s|it is|this is|they'?re)\s+(?:a\s+)?(?:gift|present)\s+for\s+(?:my\s+)?([a-z][a-z\s-]{2,30})/i,
    say: (m) => `Buys gifts for their ${m[1]}.`,
  },
  {
    kind: "habit",
    re: /\bi\s+(?:usually|normally|always)\s+([a-z][a-z\s-]{2,45})/i,
    say: (m) => `Usually ${m[1]}.`,
  },
];

export type Extracted = { kind: MemoryKind; text: string };

/**
 * Trailing filler that survives the capture and reads badly when said back.
 *
 * "Dislikes smoky teas at all" is what the pattern produces and not what a shop
 * would say. These get READ ALOUD on a call, so an awkward clause is not a
 * cosmetic problem.
 */
const TRAILING = /\s+(?:at all|really|very much|much|though|actually|tbh|to be honest)\b\.?$/i;

/**
 * Whether a figure was cut off the end of the capture.
 *
 * The capture classes are letters, spaces and hyphens — deliberately, because a
 * durable preference does not contain a figure. But a class that EXCLUDES
 * digits does not reject a sentence containing one; it stops just before it. So
 * "I usually spend about 800 rupees a month" captured "spend about" and
 * produced the memory "Usually spend about." — truncated into meaninglessness,
 * and past the content gate precisely BECAUSE the number had been cut off.
 *
 * The test is the character immediately after the capture, and it must be a
 * DIGIT specifically. A first version tested for any alphanumeric, which also
 * fires whenever the capture simply hit its length cap mid-word — so every
 * reasonably long sentence was silently discarded and the shop learned nothing
 * from the most informative answers it got. Caught by running it against a live
 * call rather than a fixture, which is the only reason it was caught at all:
 * both versions pass every unit test that does not happen to be long enough.
 *
 * Over-long captures are a different problem with a different fix — `tidy`
 * below cuts them at a clause boundary instead of throwing them away.
 */
function numberCut(said: string, m: RegExpMatchArray): boolean {
  if (m.index === undefined || !m[1]) return false;
  return /[0-9]/.test(said.charAt(m.index + m[0].length));
}

/**
 * Turn a raw capture into a sentence a shop would actually say.
 *
 * Three cuts, in order, and each one exists because the raw version read badly
 * out loud — these get spoken on a phone call, so an awkward clause is not a
 * cosmetic concern.
 *
 *   1. At the first clause connector. "prefer low caffeine blends and it is a
 *      gift for my father" is two facts, and the second belongs to a different
 *      rule that will find it independently.
 *   2. At the last whole word, when the length cap landed mid-word.
 *   3. Trailing filler — "at all", "really", "though".
 */
function tidy(captured: string): string {
  let t = captured.trim();
  t = t.split(/\s+(?:and|but|so|because|though)\s+/i)[0];
  t = t.split(/[,;:]/)[0];
  // A cap that landed mid-word leaves a fragment; drop it rather than say it.
  if (/[a-z]$/i.test(t) && t.includes(" ")) {
    const words = t.split(/\s+/);
    if (words[words.length - 1].length <= 2) words.pop();
    t = words.join(" ");
  }
  return t.replace(TRAILING, "").replace(/[.\s]+$/, "");
}

/** Pull durable facts out of one thing a shopper said. No model. */
export function extract(said: string): Extracted[] {
  const out: Extracted[] = [];
  for (const rule of RULES) {
    const m = said.match(rule.re);
    if (!m) continue;
    if (numberCut(said, m)) continue;

    /**
     * Rules with no capture group produce a FIXED sentence.
     *
     * `tidy` operates on a captured phrase, and running it on an absent one
     * returns an empty string — which the length guard below then discarded.
     * The casualty was the boundary rule ("don't call me again"), the single
     * most important thing this extractor can learn and the one whose loss is
     * silent. So the guard applies only where there is something to guard.
     */
    let text: string;
    if (m[1] === undefined) {
      text = rule.say(m);
    } else {
      const cleaned = tidy(m[1]);
      if (cleaned.length < 3) continue;
      text = rule.say([m[0], cleaned] as unknown as RegExpMatchArray);
    }

    // Our own extractor, through our own gate. A rule that widened by one word
    // and started capturing "I prefer the 500 rupee one" is exactly the case
    // this catches, and it costs nothing to check.
    if (checkMemory(text).length) continue;
    if (!out.some((o) => similar(o.text, text))) out.push({ kind: rule.kind, text });
  }
  return out;
}

/**
 * Learn from one turn, storing whatever survives every gate.
 *
 * Returns what it stored AND what it declined, because "we learned nothing from
 * that conversation" is a fact a merchant should be able to see the reason for.
 */
export function learn(input: {
  shop: string;
  sub: string | null | undefined;
  said: string;
  route?: string | null;
  source: Memory["source"];
  now?: Date;
}): { stored: Memory[]; skipped: Array<{ text: string; because: string }> } {
  const stored: Memory[] = [];
  const skipped: Array<{ text: string; because: string }> = [];

  const gate = worthLearning({ text: input.said, route: input.route }, { identified: Boolean(input.sub) });
  if (!gate.ok) return { stored, skipped: [{ text: input.said.slice(0, 80), because: gate.because }] };

  const candidates = extract(input.said);
  if (candidates.length === 0) {
    /**
     * The pre-filter let it through and the extractor found nothing.
     *
     * Reported rather than returned silently, because "we learned nothing from
     * that conversation" and "we never looked" are different facts and a
     * merchant staring at an empty page cannot tell them apart. This is also
     * where a model-backed grader would go: the pre-filter has already decided
     * this turn is worth a look, so the cost would be per-candidate rather than
     * per-conversation.
     */
    skipped.push({
      text: input.said.slice(0, 80),
      because: "nothing durable in it — no preference, context, habit or boundary stated",
    });
    return { stored, skipped };
  }

  for (const cand of candidates) {
    const res = remember({
      shop: input.shop,
      sub: input.sub,
      kind: cand.kind,
      text: cand.text,
      source: input.source,
      evidence: input.said.slice(0, 300),
      now: input.now,
    });
    if (res.ok) stored.push(res.memory);
    else skipped.push({ text: cand.text, because: res.error });
  }
  return { stored, skipped };
}

/** Test seam. */
export function _file(): string {
  return databasePath();
}

/* ------------------------------------------------------------------ *
 * Merchant view
 * ------------------------------------------------------------------ */

/**
 * Everything this shop remembers, grouped by person.
 *
 * Merchant-only, and shown to them in full rather than summarised, because the
 * whole position of this feature is that memory is STATED and correctable. A
 * merchant who cannot read what their assistant believes about a customer
 * cannot correct it either, and "the bot said something odd about me" then has
 * no answer.
 *
 * The subject id is the merchant's OWN customer id. It is not an email and not
 * a phone number — this store has never held either.
 */
export function memoryBySubject(
  shop: string,
  now = new Date(),
): Array<{ sub: string; memories: Memory[] }> {
  const bySub = new Map<string, Memory[]>();
  const live = new Map<string, Memory>();

  for (const row of readRows()) {
    if (row.shop !== shop) continue;
    if (row.op === "forget") {
      if (row.id) live.delete(`${row.sub}::${row.id}`);
      else for (const k of [...live.keys()]) if (k.startsWith(`${row.sub}::`)) live.delete(k);
      continue;
    }
    live.set(`${row.sub}::${row.id}`, row);
  }

  const iso = now.toISOString();
  for (const m of live.values()) {
    if (m.expiresAt <= iso) continue;
    const list = bySub.get(m.sub) ?? [];
    list.push(m);
    bySub.set(m.sub, list);
  }

  return [...bySub.entries()]
    .map(([sub, ms]) => ({
      sub,
      memories: ms.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)),
    }))
    .sort((a, b) => b.memories.length - a.memories.length);
}

/** Headline counts for the console. */
export function memoryStats(shop: string, now = new Date()) {
  const groups = memoryBySubject(shop, now);
  const all = groups.flatMap((g) => g.memories);
  const byKind: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const m of all) {
    byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
    bySource[m.source] = (bySource[m.source] ?? 0) + 1;
  }
  return { people: groups.length, total: all.length, byKind, bySource };
}

/* ------------------------------------------------------------------ *
 * Consolidation
 * ------------------------------------------------------------------ */

/** Above this many memories about one person, the pile is worth condensing. */
export const CONSOLIDATE_ABOVE = 8;

export type Consolidation = {
  before: number;
  after: number;
  /** What was written, and roughly how many lines each one replaced. */
  merged: Array<{ text: string; kind: MemoryKind; replaced: number }>;
  /** Why nothing happened, when nothing did. */
  because?: string;
  /** Whether a model was involved, or only the deterministic pass. */
  by: "rules" | "model";
};

/**
 * A looser relation than `similar`, for GROUNDING rather than deduping.
 *
 * A merged line legitimately says less than the two lines it replaced, so
 * demanding near-identity would reject every genuine merge. What is being
 * tested here is weaker and is the thing that actually matters: does this
 * sentence share real content with something a person said, or did it come out
 * of nowhere?
 */
function overlaps(a: string, b: string): boolean {
  const ta = new Set(terms(a));
  const tb = terms(b);
  if (!ta.size || !tb.length) return false;
  let shared = 0;
  for (const t of tb) if (ta.has(t)) shared++;
  return shared >= 2 || (tb.length <= 2 && shared >= 1);
}

/**
 * Condense what a shop remembers about one person.
 *
 * The extractor writes one line per fact it recognises, so a chatty regular
 * accumulates a pile: "Prefers oolong", "Prefers oolong tea", "Was looking for
 * something smoky", "Dislikes smoky teas" — overlapping, occasionally
 * contradictory, and eventually longer than the reply it is meant to inform.
 * Four good sentences beat twelve fragments, and since `RECALL_LIMIT` caps what
 * reaches a reply anyway, the twelfth fragment is not doing anything except
 * crowding out something better.
 *
 * ── THE GUARD, WHICH IS THE WHOLE REASON A SUMMARISER IS SAFE HERE ─────────
 *
 * This is a model writing sentences that will be said to a customer weeks later
 * as things the shop knows about them. Asking it nicely not to invent is not a
 * control. So every line it returns must survive three checks before anything
 * is stored, and if ANY line fails the whole consolidation is abandoned and the
 * originals stand — no partial application, because a half-merged pile is worse
 * than an untidy one.
 *
 *   1. `checkMemory` — the same content gate as any other memory. No price, no
 *      stock, no offer, no order state, no date.
 *   2. GROUNDED IN THE INPUT. Every output must overlap an input it could
 *      plausibly have come from. A summariser that returns "Prefers Assam" when
 *      nobody ever mentioned Assam is caught here, mechanically, rather than by
 *      somebody happening to read the dashboard in three weeks.
 *   3. IT MAY ONLY REDUCE. Fewer lines out than in, or there was no gain to
 *      weigh against the risk and we do not take it.
 *
 * ── A BOUNDARY IS NEVER MERGED ─────────────────────────────────────────────
 *
 * "Asked not to be contacted" is the one memory whose loss actually harms
 * somebody, and a summariser softening it into "prefers less contact" would be
 * the worst single failure in this file. Boundaries are held out of the input
 * entirely, so there is no prompt that could reach one.
 *
 * ── AND THE DETERMINISTIC PASS RUNS FIRST ──────────────────────────────────
 *
 * Route first, reason second, as everywhere else. Near-duplicates merge with no
 * model at all, so a shop with no key configured still gets a tidier pile: the
 * model is an improvement on the rules, never a dependency of them.
 *
 * NOT ON THE SHOPPER'S PATH. `recall` runs while somebody is waiting for a
 * reply; this reads a person's whole history and may call a model. It belongs
 * to the merchant console, or to the moment after a call has ended.
 */
export async function consolidate(input: {
  shop: string;
  sub: string;
  /** Injected, so the caller owns the model policy and tests need no key. */
  ask?: (prompt: string) => Promise<string>;
  now?: Date;
}): Promise<Consolidation> {
  const now = input.now ?? new Date();
  const current = memories(input.shop, input.sub, now);
  const before = current.length;

  if (before <= CONSOLIDATE_ABOVE) {
    return {
      before,
      after: before,
      merged: [],
      by: "rules",
      because: `only ${before} on file; a short list is not a pile`,
    };
  }

  /* ---- pass one: no model at all ---------------------------------- */

  const boundaries = current.filter((m) => m.kind === "boundary");
  const rest = current.filter((m) => m.kind !== "boundary");

  const kept: Memory[] = [];
  const absorbed: string[] = [];
  for (const m of rest) {
    if (kept.some((k) => k.kind === m.kind && similar(k.text, m.text))) {
      absorbed.push(m.id);
      continue;
    }
    kept.push(m);
  }
  for (const id of absorbed) {
    appendRow({ op: "forget", shop: input.shop, sub: input.sub, id, at: now.toISOString() });
  }

  const afterRules = boundaries.length + kept.length;
  if (!input.ask || kept.length <= CONSOLIDATE_ABOVE) {
    return {
      before,
      after: afterRules,
      merged: [],
      by: "rules",
      because: input.ask
        ? undefined
        : "no summariser configured, so near-duplicates were merged by rule and nothing else was touched",
    };
  }

  /* ---- pass two: the summariser ----------------------------------- */

  const prompt = [
    `Here is what a shop has recorded about one customer, one line each.`,
    `Rewrite them as FEWER, clearer lines. Merge anything that overlaps. Where two`,
    `disagree, keep the more recent one — they are listed oldest first.`,
    ``,
    ...kept.map((m, i) => `${i + 1}. ${m.text}`),
    ``,
    `RULES:`,
    `- Return ONLY the rewritten lines, one per line. No numbering, no commentary.`,
    `- Say nothing that is not already in the list above. Do not infer or expand.`,
    `- Never include a price, a stock level, a discount, an order, or a date.`,
    `- Each line is one short sentence in the third person, like the ones above.`,
    `- Return fewer lines than you were given.`,
  ].join(NL);

  let raw = "";
  try {
    raw = (await input.ask(prompt)) ?? "";
  } catch {
    return { before, after: afterRules, merged: [], by: "rules", because: "the summariser did not answer" };
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 3);

  const reject = (because: string): Consolidation => ({
    before,
    after: afterRules,
    merged: [],
    by: "rules",
    because,
  });

  if (!lines.length) return reject("the summariser returned nothing usable");
  if (lines.length >= kept.length) {
    return reject("the summariser did not reduce anything, so there was no gain to weigh against the risk");
  }
  for (const line of lines) {
    if (checkMemory(line).length) {
      return reject(`the summariser produced something a memory may not contain: "${line}"`);
    }
    if (!kept.some((m) => similar(m.text, line) || overlaps(m.text, line))) {
      return reject(`the summariser wrote something nobody said: "${line}"`);
    }
  }

  /* ---- commit: write the new, then tombstone the old --------------- */

  const merged: Consolidation["merged"] = [];
  for (const line of lines) {
    /**
     * The KIND is inherited from the closest input, never asked for.
     *
     * A model choosing a label is a model choosing whether something counts as
     * a boundary, and it must not have that. Boundaries are not in this list
     * at all, so the worst a wrong inheritance can do is file a preference as a
     * habit.
     */
    const source = kept.find((m) => similar(m.text, line) || overlaps(m.text, line));
    const res = remember({
      shop: input.shop,
      sub: input.sub,
      kind: source?.kind ?? "preference",
      text: line,
      source: source?.source ?? "chat",
      evidence: source?.evidence ?? null,
      // The originals are still on file at this point, deliberately: writing
      // first and tombstoning after means a failed write loses nothing.
      replacing: true,
      now,
    });
    if (res.ok) merged.push({ text: line, kind: res.memory.kind, replaced: 0 });
  }

  if (!merged.length) return reject("nothing the summariser wrote survived the content gate");

  for (const m of kept) {
    appendRow({ op: "forget", shop: input.shop, sub: input.sub, id: m.id, at: now.toISOString() });
  }
  for (const r of merged) r.replaced = Math.round(kept.length / merged.length);

  return { before, after: memories(input.shop, input.sub, now).length, merged, by: "model" };
}
