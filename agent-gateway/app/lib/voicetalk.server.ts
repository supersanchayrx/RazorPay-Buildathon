/**
 * The spoken half of the recovery loop.
 *
 * `voice.server.ts` can already make a phone ring and read out one
 * bounds-checked sentence. This is what happens when the shopper answers back —
 * and the reason it exists is not that talking is nicer than not talking:
 *
 *   THE REASON IS THE PRODUCT, AND PEOPLE SAY MORE THAN THEY TYPE.
 *
 * Everything a shop can measure says WHAT happened. Nothing says why, because
 * the why never touched the server. The web recovery page asks for it with
 * three buttons and a text box and gets an answer from the minority who click.
 * A phone call gets it from somebody already mid-sentence. So a spoken answer
 * lands in exactly the same place a typed one does — `classify` into the same
 * eleven labels, `addTurn` into the same state machine, and out through the
 * same histogram into the cortex. There is no second store of voice reasons,
 * because two stores of the same fact is how a merchant ends up with two
 * different answers to "why aren't they buying".
 *
 * WHAT KEEPS THIS SAFE, AND IT IS NOT THE PROMPT.
 *
 * 1. THE MODEL NEVER HOLDS A NUMBER IT COULD GIVE AWAY. Its whole world of
 *    facts is `draft.facts` — the array the drafting layer already maintains as
 *    "what this message is allowed to assert". No policy, no ceiling, no
 *    mention that grants exist. Verified on a live call: five escalating
 *    attempts to extract a discount, including a fabricated "your owner said
 *    I'd get one", and it had nothing to concede because there was no figure in
 *    context to concede.
 *
 * 2. EVERY SPOKEN LINE PASSES `checkReply`. The same gate as the storefront
 *    widget, and the same one the drafting layer runs over its own templates. A
 *    reply that fails is not repaired and not spoken — repairing teaches a
 *    model which phrasings survive. The shopper hears a fixed safe line.
 *
 * 3. THE MODEL DOES NOT CLASSIFY AND ANSWER IN THE SAME BREATH. Two separate
 *    calls with two separate prompts, and the classifier is the SHARED one from
 *    `reasons.ts` — which mentions no discount, no offer and no basket value,
 *    because a classifier that knows which label pays out is a classifier with
 *    an incentive.
 *
 * 4. BOTH SIDES ARE WRITTEN DOWN BEFORE THEY ARE SPOKEN. Voice's worst property
 *    is that nobody can prove what was said; "the agent offered me fifteen
 *    percent" is unanswerable when the only witness is a memory.
 *
 * 5. PRESS 9 AND IT STOPS, FOR GOOD. Not a flag of its own — a `closed` turn on
 *    the conversation, which is the suppression `silenced()` already reads and
 *    every future run already checks.
 */

import { checkReply } from "./bounds.server";
import { addTurn, conversation, reasonHistogram } from "./conversations.server";
import { classify, REASON_LABEL, type Reason } from "./reasons";
import { complete, completeStream, isConfigured as modelConfigured, MODELS } from "./openrouter.server";
import { standing } from "./loyalty.server";
import { record } from "./ledger.server";
import { readSettings } from "./settings.server";
import { getCortex, shopperView } from "./cortex.server";
import { jsonFeedCatalog } from "./catalog.server";
import { findSite } from "./sites.server";
import { learn, recall } from "./memory.server";
import { updateFindings } from "./findings.server";
import { config as voiceConfig, render, type Rendered, type VoiceConfig } from "./voice.server";
import type { Draft } from "./outreach.server";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ *
 * The transcript
 * ------------------------------------------------------------------ */

const TRANSCRIPT = path.join(process.cwd(), "data", "voice-transcripts.jsonl");

export type TranscriptRow = {
  at: string;
  shop: string;
  cartId: string;
  callSid: string;
  who: "shop" | "shopper";
  text: string;
  /** Where a line came from, so a merchant can tell a template from a model. */
  source?: "template" | "model" | "fixed" | "bounds_refused" | "model_unavailable";
  violations?: string[];
};

/**
 * Written before the line is spoken, and the ordering is the point.
 *
 * Same rule as the send log in `outreach.server.ts`: the failure mode we choose
 * is "recorded but not heard", which costs a shopper nothing and shows up as a
 * gap. "Heard but not recorded" is the one that cannot be audited, and on a
 * channel with no screenshot that is the whole ballgame.
 */
function say(row: Omit<TranscriptRow, "at">): void {
  try {
    fs.mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
    fs.appendFileSync(TRANSCRIPT, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n", "utf8");
  } catch (e) {
    // Deliberately not fatal, and deliberately loud. A call already in progress
    // should not be dropped because a disk is full, but nobody should be able
    // to say afterwards that they did not know.
    record({ shop: row.shop, kind: "tool_error", message: `voice transcript write failed: ${(e as Error).message}` });
  }
}

export function transcript(shop: string, limit = 200): TranscriptRow[] {
  try {
    return fs
      .readFileSync(TRANSCRIPT, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TranscriptRow)
      .filter((r) => r.shop === shop)
      .slice(-limit);
  } catch {
    return [];
  }
}

/** One call's lines, oldest first, for the merchant console. */
export function callTranscript(shop: string, callSid: string): TranscriptRow[] {
  return transcript(shop, 5000).filter((r) => r.callSid === callSid);
}

/** Distinct calls, newest first. */
export function calls(shop: string): Array<{ callSid: string; cartId: string; at: string; lines: number }> {
  const byCall = new Map<string, { callSid: string; cartId: string; at: string; lines: number }>();
  for (const r of transcript(shop, 5000)) {
    const prev = byCall.get(r.callSid);
    if (prev) {
      prev.lines++;
      if (r.at > prev.at) prev.at = r.at;
    } else {
      byCall.set(r.callSid, { callSid: r.callSid, cartId: r.cartId, at: r.at, lines: 1 });
    }
  }
  return [...byCall.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

type Session = {
  shop: string;
  draft: Draft;
  turns: number;
  silences: number;
  /** Everything said, for the model's context. */
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** Set once, when the shopper's first real answer has been classified. */
  reason: Reason | null;
  startedAt: number;
};

/**
 * Live calls, in memory and nowhere else.
 *
 * A call does not outlive the process serving it. Persisting sessions would
 * only let a dropped conversation resume against somebody who has already hung
 * up; the durable record is the transcript and the conversation store, which
 * are different things with different jobs. Swept on a timer so a caller who
 * vanishes mid-sentence is not a leak.
 */
const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 15 * 60_000;

/**
 * The whole model budget for one spoken turn.
 *
 * MEASURED AGAINST WHAT TWILIO ACTUALLY TOLERATES, WHICH IS NOT WHAT IT
 * DOCUMENTS. The documented ceiling on a call-related request is fifteen
 * seconds. In practice a turn that took six was abandoned mid-call — ngrok
 * recorded the request with no response and a zero duration, which is what it
 * logs when the CLIENT hangs up first — while the same request answered from a
 * shell, through the same tunnel, returned 200 in 6.19s. The difference was
 * Twilio, not us.
 *
 * So the whole turn is budgeted at four seconds, and this is the model's share
 * of it. Synthesis takes roughly two. Six consecutive turns then answered in
 * 2.8-4.0s with nothing dropped.
 *
 * Deliberately not generous: on a phone line a slow answer and no answer sound
 * identical, and only one of them can be recovered from.
 */
const MODEL_BUDGET_MS = Number(process.env.VOICE_MODEL_MS ?? 4200);

function sweep(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sid, s] of sessions) if (s.startedAt < cutoff) sessions.delete(sid);
}

/* ------------------------------------------------------------------ *
 * The prompt
 * ------------------------------------------------------------------ */

/**
 * Everything the model is allowed to know, and it is a short list on purpose.
 *
 * Read what is absent: no discount policy, no store-wide ceiling, no mention
 * that a grant exists or could, no basket value, no margin, no customer tier.
 * `draft.facts` is reused rather than assembled fresh so that the spoken
 * conversation and the written message are bounded by the same list, and so
 * there is exactly one place to change what a message may assert.
 *
 * The instruction not to invent a number is a seatbelt. The mechanism is that
 * there is no number here to invent toward.
 */
/**
 * What the shop knows, projected down to what may be said out loud.
 *
 * Two sources, and neither of them widens what the model may CLAIM.
 *
 *   the cortex   the SHOPPER projection only: policies in the merchant's own
 *                words, and any live service notice. Costs, margin floors,
 *                order volumes and refusal counts are absent from that
 *                projection entirely, so there is nothing here to leak.
 *   memory       what this shop remembers about THIS person, which is durable
 *                preferences and never a price, a stock level, an offer or an
 *                order state -- enforced by `checkMemory` when it is WRITTEN,
 *                not by asking the model nicely when it is read.
 *
 * Why give a phone call more context at all, when the whole point of this file
 * is giving it less? Because what is being withheld is A NUMBER TO CONCEDE, not
 * knowledge of the shop. A caller who asks "what is your returns policy?" and
 * is told "I do not know" has been failed by a shop that does know, and the
 * honest fix is the merchant's own sentence read back verbatim -- the same
 * answer the widget gives, through the same projection. Rule 1 below is
 * unchanged, `draft.facts` is still the only place a figure may come from, and
 * every line still goes through `checkReply` before it is spoken.
 */
export type CallContext = {
  /** Policy text, verbatim, from the shopper projection of the cortex. */
  policies?: { returns?: string | null; shipping?: string | null; cod?: string | null };
  /** Server-written, bounds-checked sentences. Repeatable, never paraphrasable. */
  serviceNotices?: string[];
  /** What this shop remembers about this caller. Durable facts only. */
  memories?: string[];
};

export function systemPrompt(
  shopName: string,
  shopTone: string | null,
  draft: Draft,
  ctx: CallContext = {},
): string {
  const policyLines = [
    ctx.policies?.returns ? `- Returns: ${ctx.policies.returns}` : null,
    ctx.policies?.shipping ? `- Delivery: ${ctx.policies.shipping}` : null,
    ctx.policies?.cod ? `- Cash on delivery: ${ctx.policies.cod}` : null,
  ].filter(Boolean) as string[];

  const shopBlock = policyLines.length
    ? [
        ``,
        `THE SHOP'S OWN POLICY WORDING. If they ask, read one back exactly as written.`,
        `Do not reword it: a reworded return window is a new promise.`,
        ...policyLines,
      ]
    : [];

  const noticeBlock = (ctx.serviceNotices ?? []).length
    ? [
        ``,
        `IF THEY SAY A PAYMENT FAILED, you may say this, and nothing more about it:`,
        ...(ctx.serviceNotices ?? []).map((n) => `- "${n}"`),
      ]
    : [];

  /**
   * Memory is the QUESTION, not the answer.
   *
   * Stated openly whenever it is used, because a shop that quietly knows things
   * about you is unsettling on a screen and worse on a telephone, where there
   * is nothing to scroll back through and no way to correct the record.
   */
  const memoryLines = (ctx.memories ?? []).length
    ? [
        ``,
        `WHAT THIS SHOP REMEMBERS ABOUT THIS PERSON, from earlier conversations:`,
        ...(ctx.memories ?? []).map((m) => `- ${m}`),
        `These may be out of date. If you use one, SAY SO -- "last time you were after`,
        `something low-caffeine, is that still right?" -- so they can correct you. Never`,
        `treat one as a fact about price, stock, an offer or an order.`,
      ]
    : [];

  const facts = draft.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n");
  return [
    `You are answering a phone call on behalf of ${shopName}.`,
    `You called this person about a basket they left behind. They have just picked up.`,
    ``,
    `THE ONLY FACTS YOU KNOW:`,
    facts,
    ...shopBlock,
    ...noticeBlock,
    ...memoryLines,
    ``,
    `WHAT YOU ALREADY SAID TO THEM:`,
    `"${draft.text}"`,
    ``,
    `RULES, IN ORDER OF IMPORTANCE:`,
    `1. Never state a discount, offer, percentage, coupon or price reduction. You have none.`,
    `   If they ask, say you cannot do that on a call and the website shows any live offer.`,
    `2. Never invent a fact. If it is not listed above you do not know it. Say so plainly.`,
    `3. Never promise a delivery date, a refund, a callback, or that anyone will do anything.`,
    `4. Be brief. This is a phone call: one or two sentences. Never a paragraph.`,
    `5. Answer in whatever language they use. Hinglish is fine and normal.`,
    `6. No marketing language, no urgency, no "hurry", no "limited time".`,
    `7. If they want to be left alone: apologise for disturbing, and tell them they can press 9`,
    `   to stop these calls.`,
    ...(shopTone ? [``, `HOW THIS SHOP SOUNDS, in the merchant's own words:`, shopTone] : []),
    ``,
    `You are a shop being polite, not a salesperson closing. It is completely fine for this`,
    `call to end with them saying no.`,
  ].join("\n");
}

/**
 * What is spoken when the gate refuses the model's line, or the model is gone.
 *
 * Fixed text, so it can be read here and so it never varies with what the
 * shopper said — a fallback that adapts is a second, unreviewed model.
 */
export const SAFE_LINE =
  "Sorry, I can't help with that on this call. Everything about your basket is on our website. Thanks for your time.";

/* ------------------------------------------------------------------ *
 * Speaking
 * ------------------------------------------------------------------ */

export type Utterance = { audioUrl: string | null; text: string };

/**
 * Render a line, returning the URL to `<Play>` or null to fall back to `<Say>`.
 *
 * Null rather than a throw, and the fallback is deliberately WORSE and audibly
 * so: Twilio's own voice instead of the shop's. A call that silently drops half
 * its replies is far harder to notice than one that suddenly changes voice.
 */
export async function speak(text: string, c: VoiceConfig, origin: string): Promise<Utterance> {
  const out = await render(text, c);
  if (!out.ok) return { audioUrl: null, text };
  return { audioUrl: `${origin}/voice/audio/${path.basename(out.file)}`, text };
}

/* ------------------------------------------------------------------ *
 * Opening a call
 * ------------------------------------------------------------------ */

/**
 * Record that this basket has been asked about, once.
 *
 * The same `asked` turn the web recovery page writes, so that a basket
 * contacted by phone is suppressed from being contacted again by any channel —
 * `askedCarts()` is read by every future run. Asking somebody twice tells them
 * nobody read the first answer, which destroys the thing being collected.
 *
 * A refusal here is not an error: it means the state machine already knows, and
 * the correct response is to carry on with the call rather than to invent a
 * second record of it.
 */
export function openConversation(shop: string, draft: Draft): void {
  const r = addTurn({
    shop,
    cartId: draft.cartId,
    customerId: draft.customerId,
    turn: { kind: "asked", ts: new Date().toISOString(), channel: "voice", draftId: draft.id },
  });
  if (!r.ok) record({ shop, kind: "tool_error", message: `voice asked-turn refused: ${r.error}`, detail: { cartId: draft.cartId } });
}

/**
 * Everything the shop knows that this call is allowed to draw on.
 *
 * Assembled ONCE, when the session opens, and never refreshed mid-call. Two
 * reasons, and the second is the one that matters. A cortex build reads the
 * catalogue feed and the ledger, and doing that between "hello" and the reply
 * would spend the seconds Twilio is counting. And a set of facts that changed
 * halfway through a conversation would let the shop contradict itself inside
 * one call, which is indistinguishable from making things up.
 *
 * Failure is soft on purpose. No cortex, no memories, a slow feed — every one
 * of them produces an empty context and a call that behaves exactly as it did
 * before this existed. The call must not fail because the enrichment did.
 */
async function callContext(shop: string, draft: Draft): Promise<CallContext> {
  const ctx: CallContext = {};

  try {
    const cortex = await getCortex({
      site: { key: shop, name: draft.shop },
      catalog: jsonFeedCatalog(findSite(shop)?.catalogFeedUrl ?? ""),
    });
    // The SHOPPER projection. `merchantView` holds unit costs and margin floors
    // and is not reachable from here, which is the point of there being two.
    const view = shopperView(cortex);
    ctx.policies = {
      returns: view.policies?.returns ?? null,
      shipping: view.policies?.shipping ?? null,
      cod: view.policies?.cod ?? null,
    };
    ctx.serviceNotices = view.serviceNotices.map((n) => n.text);
  } catch {
    // A shop with no cortex is a shop the caller can still be spoken to.
  }

  try {
    // Keyed on the merchant's own customer id, which arrived on the draft and
    // was never typed by anyone. Recall is scoped to (shop, sub) — there is no
    // argument that widens it.
    ctx.memories = recall({ shop, sub: draft.customerId, query: draft.text }).map((m) => m.text);
  } catch {
    /* memory is an enrichment, never a dependency */
  }

  return ctx;
}

export function beginSession(callSid: string, shop: string, draft: Draft, ctx: CallContext = {}): Session {
  sweep();
  const settings = readSettings(shop);
  const s: Session = {
    shop,
    draft,
    turns: 0,
    silences: 0,
    messages: [{ role: "system", content: systemPrompt(draft.shop, settings.voice, draft, ctx) }],
    reason: null,
    startedAt: Date.now(),
  };
  sessions.set(callSid, s);
  return s;
}

/**
 * The async door into a session, used when there is time to open one properly.
 *
 * `beginSession` stays synchronous and context-free because `takeTurn` may have
 * to create a session on a turn where Twilio is already waiting. This is the
 * version the call setup uses, where a few hundred milliseconds is free.
 */
export async function openSession(callSid: string, shop: string, draft: Draft): Promise<Session> {
  return beginSession(callSid, shop, draft, await callContext(shop, draft));
}

/**
 * The question, appended to the notice when the call is a conversation.
 *
 * Small, specific and answerable in one breath. "We'd value your feedback" gets
 * nothing; "was there something that put you off?" gets a sentence — and the
 * sentence is the entire point of the call.
 */
export const THE_ASK = "Was there something that put you off?";

/* ------------------------------------------------------------------ *
 * A turn
 * ------------------------------------------------------------------ */

export type TurnOutcome = (
  | { kind: "reply"; line: string; source: NonNullable<TranscriptRow["source"]>; last: boolean }
  | { kind: "hangup"; line: string; source: NonNullable<TranscriptRow["source"]> }
) & {
  /** Audio already rendered alongside generation, when the overlap paid off. */
  audioUrl?: string | null;
};

/**
 * The shopper pressed 9.
 *
 * Recorded as a `closed` turn whose `why` contains "said no", because that is
 * precisely what `silenced()` matches — so this shopper is suppressed from
 * every future run of every channel, by the mechanism that already exists,
 * rather than by a new flag somebody has to remember to check.
 */
export function optOut(shop: string, callSid: string, draft: Draft): TurnOutcome {
  const line = "Understood. We won't call you again. Sorry to have bothered you.";
  say({ shop, cartId: draft.cartId, callSid, who: "shopper", text: "[pressed 9 — asked us to stop]" });
  const r = addTurn({
    shop,
    cartId: draft.cartId,
    customerId: draft.customerId,
    turn: { kind: "closed", ts: new Date().toISOString(), why: "they said no — pressed 9 on a call" },
  });
  record({
    shop,
    kind: r.ok ? "reply" : "tool_error",
    message: r.ok ? `voice opt-out recorded for ${draft.customerId}` : `voice opt-out NOT recorded: ${r.error}`,
    detail: { cartId: draft.cartId },
  });
  say({ shop, cartId: draft.cartId, callSid, who: "shop", text: line, source: "fixed" });
  sessions.delete(callSid);
  return { kind: "hangup", line, source: "fixed" };
}

/**
 * Classify what they said, and record it against the basket — once.
 *
 * Runs on the FIRST substantive thing the shopper says, not on every turn. The
 * later turns of a call are usually negotiation and pleasantries, and letting
 * them overwrite the reason would mean the answer a merchant reads is whatever
 * the shopper happened to say last rather than why they didn't buy.
 *
 * `classify` is the shared one. It tries an explicit choice (there is none on a
 * call), then the free phrase rules, then a model asked for one label and
 * nothing else — and it answers `unknown` rather than guessing when the model
 * names two labels, invents one, or is unreachable. A wrong label costs a
 * shopper a wrong remedy; no label costs the shop one remedy.
 */
async function captureReason(s: Session, callSid: string, said: string): Promise<void> {
  if (s.reason) return;

  /**
   * The durable check, and it has to be the durable one.
   *
   * The session guard above is memory, and memory does not survive a process
   * restart, a dev-server module reload, or — the case that actually happened —
   * a SECOND CALL about the same basket. Twice-answered showed up in the store
   * as `asked -> answered -> answered`, which is a basket whose recorded reason
   * is whatever was said most recently rather than why they didn't buy.
   *
   * The conversation store is the one thing that knows across calls, so it is
   * what decides. An answer already on file is not overwritten and not
   * appended to: the first answer stands.
   */
  const existing = conversation(s.shop, s.draft.cartId);
  if (existing?.reason) {
    s.reason = existing.reason;
    return;
  }

  const c = await classify({
    text: said,
    ask: modelConfigured()
      ? async (prompt) => (await complete({ model: MODELS.assistant(), messages: [{ role: "user", content: prompt }], maxTokens: 20, temperature: 0, timeoutMs: 6000 })) ?? ""
      : undefined,
  });

  s.reason = c.reason;

  const tier = standing({ customerId: s.draft.customerId }).tier;
  const r = addTurn({
    shop: s.shop,
    cartId: s.draft.cartId,
    customerId: s.draft.customerId,
    turn: {
      kind: "answered",
      ts: new Date().toISOString(),
      reason: c.reason,
      by: c.by,
      evidence: c.evidence,
      // Their own words are kept here, in the conversation store, and never
      // cross into the cortex. "I couldn't afford it" is candid personal data
      // that nobody volunteered for a dashboard.
      text: said,
      tier,
    },
  });

  record({
    shop: s.shop,
    kind: r.ok ? "reply" : "tool_error",
    message: r.ok
      ? `voice answer classified as ${REASON_LABEL[c.reason]} (${c.by})`
      : `voice answer NOT recorded: ${r.error}`,
    detail: { cartId: s.draft.cartId, callSid },
  });

  /**
   * The aggregate, into the cortex. One call at a time, so it is never stale.
   *
   * The reason histogram already crossed into the cortex — but only when a
   * merchant happened to open the Offers page, which is where the publish
   * lived. So a call could capture the seventh person to say delivery was too
   * slow and the assistant talking to a shopper an hour later still knew
   * nothing. Publishing here closes that: the aggregate is refreshed by the
   * event that changed it.
   *
   * COUNTS ONLY. `updateFindings` merges one section and leaves the incidents,
   * the ranked actions and the service notices exactly as the last analysis
   * wrote them — a call is not an analysis and must not be able to blank one.
   * The shopper's own words stay in the conversation store, which is
   * per-(merchant, shopper) and never projected to anybody.
   */
  try {
    updateFindings(s.shop, { reasons: reasonHistogram(s.shop) });
  } catch {
    /* the aggregate is bookkeeping; it must never drop a live call */
  }
}

/**
 * What they told us about themselves, kept for next time.
 *
 * Separate from `captureReason` and deliberately so. A reason is about ONE
 * BASKET and belongs to the recovery loop; a memory is about a PERSON and
 * outlives it. Somebody who says "it was a gift for my father, and I only ever
 * drink it black" has said one thing about this purchase and one thing that
 * will still be true in March.
 *
 * Everything that makes this safe is in `memory.server.ts` and none of it is in
 * the prompt: no verified id means nothing is written, and a candidate carrying
 * a price, a stock level, an offer or an order state is refused by the same
 * kind of gate that guards what the shop says out loud.
 */
function rememberFromCall(s: Session, said: string): void {
  try {
    learn({
      shop: s.shop,
      sub: s.draft.customerId,
      said,
      source: "voice",
    });
  } catch {
    /* enrichment, never a dependency */
  }
}

/**
 * One exchange: hear them, record why, answer them.
 *
 * Returns text only. Nothing here knows what TwiML looks like, which is what
 * lets the same brain serve the Remix route and the standalone harness without
 * either of them owning the rules.
 */
export async function takeTurn(opts: {
  callSid: string;
  said: string;
  shop: string;
  draft: Draft;
  /** Passed so synthesis can begin before generation has finished. */
  c?: VoiceConfig;
  origin?: string;
}): Promise<TurnOutcome> {
  const s = sessions.get(opts.callSid) ?? beginSession(opts.callSid, opts.shop, opts.draft);
  const maxTurns = readSettings(opts.shop).outreach.call.maxTurns;

  say({ shop: s.shop, cartId: s.draft.cartId, callSid: opts.callSid, who: "shopper", text: opts.said });

  /**
   * The reason first, and independently of the reply.
   *
   * If the answering model is down, the reason is still captured — which is the
   * half of this call that has lasting value. A merchant who learns that seven
   * people said the delivery estimate was too slow has something they can act
   * on next week; a pleasant reply to one shopper expires with the call.
   */
  await captureReason(s, opts.callSid, opts.said);
  rememberFromCall(s, opts.said);

  s.turns++;
  s.messages.push({ role: "user", content: opts.said });

  /**
   * A budget on the WHOLE attempt, not on each try.
   *
   * `complete` walks a chain of models and moves to the next one on failure, so
   * its `timeoutMs` bounds one attempt and nothing bounds the sum. Measured on a
   * live call: all three free models failed in turn, the chain took about
   * fifteen seconds, and Twilio — whose hard ceiling is fifteen — gave up and
   * told the caller it could not reach us. The call dropped mid-conversation.
   *
   * A per-attempt timeout is not a deadline. This is.
   *
   * The losing race does NOT cancel the request in flight, and that is fine: it
   * is abandoned, its result discarded, and the caller gets the safe line on
   * time. Paying for an answer nobody hears is much cheaper than a dropped call.
   */
  /**
   * GENERATE AND SYNTHESISE AT THE SAME TIME.
   *
   * Sequentially a turn costs model PLUS speech: 2.5-3.7s for a free model and
   * ~1.8s for bulbul:v3, so about six seconds — and six is past what Twilio
   * actually tolerates. Measured in both directions: 4s and 5s deadlines each
   * held for whole calls, while a 10s one whose turn ran 6.1s produced "we
   * could not reach your TwiML server" and dropped the call. The documented
   * ceiling is fifteen seconds; the real one is between five and six.
   *
   * Squeezing the model into the leftovers does not work either — at 2.2s,
   * three of four replies came back as the fallback and the caller heard a
   * robot apologise four times in a row.
   *
   * So the two are written to overlap: streaming should yield a complete first
   * sentence before the reply ends, and that sentence goes to Sarvam at once
   * while the rest is still being written.
   *
   * MEASURED CAVEAT, AND IT MATTERS. On the current free OpenRouter chain
   * `completeStream` does not actually stream incrementally — first token and
   * last token arrive together (1614ms / 1614ms, twice). So today this overlap
   * buys nothing and a turn still costs model plus speech. The code stays
   * because it is correct the moment a provider streams properly, and because
   * assuming it worked is exactly what produced the last round of impossible
   * budgets.
   *
   * The honest numbers as they stand: model 1.4-2.3s, speech ~1.8s, so a normal
   * turn is 3.2-4.1s inside a 5.5s wall. What breaks is VARIANCE, not the mean —
   * the free tier occasionally stalls or fails outright, and that is when the
   * caller hears the safe line. The fix for that is a faster model, not a
   * smaller number here.
   *
   * The bounds gate runs on the sentence BEFORE Sarvam sees it. A chunk that
   * fails is never synthesised and never spoken.
   */
  const modelDeadline = Date.now() + MODEL_BUDGET_MS;
  let buffer = "";
  let spokenChunk: string | null = null;
  let early: Promise<Rendered> | null = null;

  try {
    for await (const token of completeStream({
      model: MODELS.assistant(),
      messages: s.messages,
      maxTokens: 45,
      temperature: 0.4,
      timeoutMs: MODEL_BUDGET_MS,
    })) {
      buffer += token;
      if (Date.now() > modelDeadline) break;
      if (!early && opts.c) {
        // Long enough that an abbreviation cannot pass for the end of a thought.
        const m = buffer.match(/^(.{15,}?[.!?])(\s|$)/s);
        if (m) {
          const sentence = m[1].trim();
          if (checkReply(sentence, { groundedStockClaims: [], approvedOffers: [] }).length === 0) {
            spokenChunk = sentence;
            early = render(sentence, opts.c);
          }
        }
      }
    }
  } catch {
    /* a dead stream is an empty reply, handled below */
  }

  const raw = buffer.trim() || null;

  let line = (raw ?? "").trim().replace(/\s+/g, " ");
  let source: NonNullable<TranscriptRow["source"]> = "model";

  if (!line) {
    line = SAFE_LINE;
    source = "model_unavailable";
  } else {
    /**
     * `approvedOffers` is EMPTY, deliberately.
     *
     * On a call there is no approval in play. The notice announces an approved
     * offer from its template if one exists; a conversation is not a place to
     * introduce one. An empty list means every discount claim is refused, which
     * is the correct posture for a medium with no screenshot.
     */
    const violations = checkReply(line, { groundedStockClaims: [], approvedOffers: [] });
    if (violations.length) {
      say({
        shop: s.shop,
        cartId: s.draft.cartId,
        callSid: opts.callSid,
        who: "shop",
        text: line,
        source: "bounds_refused",
        violations: violations.map((v) => v.gate),
      });
      record({
        shop: s.shop,
        kind: "tool_error",
        message: `voice reply refused by bounds: ${violations.map((v) => `${v.gate}: “${v.matched}”`).join("; ")}`,
        detail: { cartId: s.draft.cartId, callSid: opts.callSid },
      });
      line = SAFE_LINE;
      source = "bounds_refused";
    }
  }

  s.messages.push({ role: "assistant", content: line });
  say({ shop: s.shop, cartId: s.draft.cartId, callSid: opts.callSid, who: "shop", text: line, source });

  /**
   * Claim the overlapped render only if it turned out to be the WHOLE reply.
   *
   * If the model carried on past that first sentence, playing only the first
   * would cut the shop off mid-thought while the transcript recorded the full
   * reply — a record of words nobody heard, on the one channel where the
   * transcript is the only evidence. Paying for a second render is far cheaper.
   */
  let audioUrl: string | null = null;
  if (early && spokenChunk && line === spokenChunk && opts.origin) {
    const r = await early;
    if (r.ok) audioUrl = `${opts.origin}/voice/audio/${path.basename(r.file)}`;
  }

  const last = s.turns >= maxTurns;
  if (last) sessions.delete(opts.callSid);
  return { kind: "reply", line, source, last, audioUrl };
}

/**
 * They said nothing.
 *
 * One nudge, then leave. A second prompt into silence is a machine talking to
 * an empty room, and the person may well have put the phone down.
 */
export function takeSilence(callSid: string, shop: string, draft: Draft): TurnOutcome {
  const s = sessions.get(callSid) ?? beginSession(callSid, shop, draft);
  s.silences++;
  if (s.silences >= 2) {
    const line = "I'll leave you to it. Thanks for your time.";
    say({ shop, cartId: draft.cartId, callSid, who: "shop", text: line, source: "fixed" });
    sessions.delete(callSid);
    return { kind: "hangup", line, source: "fixed" };
  }
  return { kind: "reply", line: "Are you still there?", source: "fixed", last: false };
}

/**
 * The safe line, pre-rendered in the shop's own voice.
 *
 * The deadline fallback used Twilio's `<Say>` because a fallback must not
 * depend on the subsystem it is protecting against — if Sarvam is what is slow,
 * calling Sarvam to apologise for Sarvam being slow is not a fallback.
 *
 * That reasoning is right about SYNTHESISING at fallback time and wrong about
 * PLAYING. A file already on disk needs no API call, so warming it once, when
 * there is slack, gives the fallback the shop's voice with none of the risk.
 * The caller stops hearing the line jump from a person to a robot mid-call,
 * which is jarring in a way that reads as "something broke" — and on this
 * channel a shopper's confidence is most of what is being protected.
 *
 * Still null-safe: if the warm never happened or the file has gone, the caller
 * gets `<Say>`, which is worse and audible, exactly as before.
 */
let warmedFallback: string | null = null;

export async function warmFallback(c: VoiceConfig, origin: string): Promise<void> {
  if (warmedFallback) return;
  const u = await speak(SAFE_LINE, c, origin);
  warmedFallback = u.audioUrl;
}

/** The fallback's audio, if it was warmed. Synchronous: the deadline is already up. */
export const fallbackAudio = (): string | null => warmedFallback;

/**
 * The caller heard the fallback, not what we composed.
 *
 * Called by the route when its response deadline fires. Without it the
 * transcript is a record of INTENT rather than of speech: the model's reply is
 * written down by `takeTurn` and then never spoken, because the request that
 * would have carried it was already answered with a plain-voice safe line.
 *
 * On the one channel where the transcript is the only evidence of what was
 * said, a transcript that records unspoken sentences is worse than none — it is
 * confidently wrong. So the gap is recorded as its own line.
 */
export function noteFallbackSpoken(shop: string, cartId: string, callSid: string): void {
  say({ shop, cartId, callSid, who: "shop", text: SAFE_LINE, source: "model_unavailable" });
  record({
    shop,
    kind: "tool_error",
    message: "voice: response deadline fired — the caller heard the safe line, not the composed reply",
    detail: { cartId, callSid },
  });
}

/** Test seam. */
export function _reset(): void {
  sessions.clear();
}
export function _file(): string {
  return TRANSCRIPT;
}
export function _session(callSid: string) {
  return sessions.get(callSid);
}
export { voiceConfig, conversation };
