/**
 * The outreach layer — channels, and the record of what was actually sent.
 *
 * CHAPMAN's rule has been "reads are tools; speech and money are chokepoints".
 * Outreach is the third thing, and it is the most dangerous of the three:
 * speech at a distance, to someone who is not in a conversation, arriving
 * unsolicited on a channel they gave us for a different purpose. Nobody is
 * present to say "that's wrong". So the bar is HIGHER here than in the widget,
 * not lower.
 *
 * FOUR PROPERTIES, EACH ENFORCED BY CODE RATHER THAN BY CARE.
 *
 * 1. A CHANNEL IS A CAPABILITY, NOT A CONFIG FLAG. `whatsapp`, `sms` and
 *    `voice` exist below as objects that answer `available: false` and say what
 *    would unlock them. They cannot be switched on by editing a settings file,
 *    because there is no delivery function behind them to switch on. The same
 *    reasoning as two tool registries instead of one with a permission flag:
 *    the thing that stops a message going out should be the absence of a code
 *    path, not the presence of a boolean set the right way.
 *
 * 2. THE SEND LOG IS THE ONLY SOURCE OF "HAVE WE CONTACTED THEM". Cooldowns
 *    and frequency caps read from an append-only file, never from a counter in
 *    memory. A process restart that resets a frequency cap is a process restart
 *    that messages everyone twice.
 *
 * 3. NOTHING IS SENT THAT WAS NOT DRAFTED, CHECKED AND APPROVED. `deliver`
 *    takes a `Draft`, and a `Draft` is only produced by `recovery.server.ts`
 *    after the bounds layer has passed its text. There is no way to hand this
 *    module a free string.
 *
 * 4. A SEND THAT COULD NOT BE LOGGED DID NOT HAPPEN. The log write comes first.
 *    If it fails we do not deliver, because an unlogged message is a message
 *    the cooldown cannot see, and a cooldown that cannot see a message will
 *    cheerfully authorise the next one.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths.server";
import { record } from "./ledger.server";
import { featureOn } from "./featureflags.server";
import { quietNow, readSettings } from "./settings.server";
import { mintVoiceToken } from "./identity.server";
import { findSite } from "./sites.server";
import {
  config as voiceConfig,
  isConfigured as voiceConfigured,
  missing as voiceMissing,
  placeCall,
  render as renderVoice,
  VOICE_FILLER,
} from "./voice.server";
import { SAFE_LINE, THE_ASK } from "./voicetalk.server";

/* ------------------------------------------------------------------ *
 * What a channel is
 * ------------------------------------------------------------------ */

export type ChannelId = "draft" | "whatsapp" | "sms" | "voice" | "email";

export type Draft = {
  /** Idempotency key. The same cart never produces two live drafts. */
  id: string;
  shop: string;
  cartId: string;
  customerId: string;
  /** Where it would go. Held here, never written to the cortex. */
  to: { phone: string | null; email: string | null };
  channel: ChannelId;
  /** Bounds-checked text. Nothing may reach a channel that did not pass. */
  text: string;
  /** Where the message points. Empty means the shop's front page. */
  link: string;
  /** Why this person is being written to, in one word, for the audit. */
  treatment: string;
  /** The numbers the text is allowed to contain, for after-the-fact checking. */
  facts: Array<{ label: string; value: string }>;
  marginAtStake: number;
};

export type Channel = {
  id: ChannelId;
  label: string;
  /** Whether a delivery path exists. Not a preference — a fact about the code. */
  available: boolean;
  /**
   * Whether this channel puts a message in front of a person.
   *
   * `draft` does not: it writes to a file a human reads on purpose, so quiet
   * hours have nothing to protect. Every other channel does, and is gated. The
   * distinction is a property of the channel rather than a setting, because
   * "does this wake somebody up" is not a thing a merchant should be able to
   * answer wrongly.
   */
  reachesPerson: boolean;
  /** For anything unavailable: the precise thing standing in the way. */
  unlockedBy?: string;
  /** Regulatory or practical notes a merchant should read before enabling it. */
  note?: string;
  deliver?: (d: Draft) => Promise<{ ok: boolean; ref?: string; error?: string }>;
};

const DRAFT_FILE = dataPath("outreach-drafts.jsonl");
const SEND_FILE = dataPath("outreach-log.jsonl");

/**
 * The only channel with a delivery path today: write the message down.
 *
 * This is not a placeholder for a real channel — it is a real channel, and on
 * a merchant's first campaign it should be the one they use. A file of drafts
 * a human reads before anything leaves the building is how you find out that
 * your recovery agent has been addressing everyone as "Dear {{first_name}}".
 */
const draftChannel: Channel = {
  id: "draft",
  label: "Drafts for review",
  available: true,
  reachesPerson: false,
  note: "Writes each message to a file and sends nothing. The safe way to run a campaign for the first time.",
  deliver: async (d) => {
    const w = appendDraft(d);
    return w.ok ? { ok: true, ref: d.id } : { ok: false, error: w.error };
  },
};

/**
 * Write one draft down, verbatim.
 *
 * Extracted from the draft channel because a channel that SPEAKS also has to
 * write the sentence down first, and for a stronger reason than review. Voice's
 * worst property is that there is no record of what was said — "the agent
 * offered me fifteen percent" is unanswerable when the only witness is the
 * shopper's memory. Persisting the exact text before dialling turns the draft
 * file into the transcript, and it is written BEFORE the call is placed for the
 * same reason the send log is: an unlogged message is one nothing can audit.
 */
export function appendDraft(d: Draft): { ok: true } | { ok: false; error: string } {
  try {
    fs.mkdirSync(path.dirname(DRAFT_FILE), { recursive: true });
    fs.appendFileSync(DRAFT_FILE, JSON.stringify({ at: new Date().toISOString(), ...d }) + "\n", "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * One draft by id, for a channel that has to resolve it again later.
 *
 * The voice routes need this: Twilio calls back seconds after the call is
 * placed, in a different request, and asks what to say. It presents a token
 * naming a draft — never the text — so this is the only path from that token to
 * a sentence, and the sentence it finds is the one that passed `checkReply`.
 */
export function draftById(shop: string, id: string): (Draft & { at: string }) | null {
  try {
    return (
      fs
        .readFileSync(DRAFT_FILE, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Draft & { at: string })
        .find((d) => d.shop === shop && d.id === id) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Everything else. Declared, described, and deliberately without a `deliver`.
 *
 * Written out in full rather than omitted, because a merchant deciding whether
 * this feature is worth turning on needs to see what it will eventually cost
 * them in setup and in compliance — and because each `unlockedBy` is a real
 * piece of work someone has to do, not a shrug.
 */
export const CHANNELS: Channel[] = [
  draftChannel,
  {
    id: "whatsapp",
    label: "WhatsApp",
    available: false,
    reachesPerson: true,
    unlockedBy:
      "A WhatsApp Business account, a Meta-approved message template per treatment, and an opt-in " +
      "recorded per shopper. Utility templates carry a per-message fee; marketing templates carry a " +
      "higher one and a stricter opt-in.",
    note:
      "Templates are approved by Meta before use, which means the wording below is reviewed by a third " +
      "party and cannot be changed at send time. That is a constraint worth having.",
  },
  {
    id: "sms",
    label: "SMS",
    available: false,
    reachesPerson: true,
    unlockedBy:
      "In India, DLT registration: the entity, the six-character sender header, and EVERY content " +
      "template are filed with the telecom regulator through a carrier portal before one message can be " +
      "sent. Then either an aggregator (MSG91, Gupshup, Kaleyra) or, for low volume, a self-hosted " +
      "Android gateway on a spare handset.",
    note:
      "The template requirement is a constraint worth having, and it is the same one this codebase " +
      "already imposes on itself: the body is fixed and reviewed by somebody else, and only the variables " +
      "move. A system that generated free-form message text with a model could not be sent over Indian " +
      "SMS at all. Promotional traffic is additionally bound by the DND registry and a 09:00-21:00 window.",
  },
  {
    id: "voice",
    label: "Voice callback",
    /**
     * Available when the credentials exist — not when a merchant ticks a box.
     *
     * This is still the rule stated at the top of the file. What stands in the
     * way of voice is two purchases (speech from Sarvam, telephony from Twilio)
     * and a public origin Twilio can reach. `voiceMissing()` names whichever is
     * absent, so an unavailable channel says "TWILIO_FROM is unset" rather than
     * "unavailable", and a merchant can act on it.
     */
    get available() {
      return voiceConfigured();
    },
    reachesPerson: true,
    get unlockedBy() {
      const gaps = voiceMissing();
      return gaps.length
        ? `Two separate purchases, and one of them is not done: ${gaps.join(", ")} unset. ` +
            "Speech is Sarvam, whose Hinglish handling matters more here than accuracy on either " +
            "language alone, because that is how the shopper actually talks. Telephony is Twilio " +
            "(Exotel or Plivo on Indian rails for production). Beyond the keys: a recorded-consent " +
            "trail, and a script signed off line by line."
        : "";
    },
    note:
      "The channel where a fabricated discount is hardest to retract and hardest to prove - there is no " +
      "screenshot and the shopper heard it. Which is why the script must be TEMPLATED and bounds-checked " +
      "before the call is placed, exactly as the text messages are, rather than generated live inside the " +
      "conversation. A voice agent improvising a number is the worst version of every failure this module " +
      "refuses.",
    /**
     * Speak one draft down a phone line.
     *
     * Read the order of operations, because it is the whole design:
     *
     *   1. write the sentence down     <- the transcript, before anyone hears it
     *   2. render and cache the audio  <- never make Twilio wait on Sarvam
     *   3. mint a token naming it      <- not the text; a token, for 15 minutes
     *   4. ring the phone              <- Twilio calls US back to ask what to say
     *
     * Step 1 comes first for the reason the send log comes first in `send()`:
     * voice's worst property is that there is no record of what was said, and
     * a call placed before the sentence was persisted is a call nobody can
     * audit. Step 2 prevents a slow speech API from turning an answered call
     * into Twilio's generic application-error message. Step 3 exists so that
     * step 4 can carry an identifier rather than a payload — the same reason
     * `buildQuote` takes a grant id.
     *
     * There is no model anywhere in this path, and nowhere to put one. What
     * gets spoken is `d.text`, which `recovery.server.ts` composed from a
     * template and `checkReply` allowed.
     */
    deliver: async (d) => {
      const c = voiceConfig();
      if (!c) return { ok: false, error: `voice is not configured: ${voiceMissing().join(", ")} unset` };

      const site = findSite(d.shop);
      if (!site) return { ok: false, error: `no such site: ${d.shop}` };
      if (!d.to.phone) return { ok: false, error: "no phone number on this draft" };

      const written = appendDraft(d);
      if (!written.ok) return { ok: false, error: `could not write the transcript: ${written.error}` };

      // Synthesis belongs before dialling, while nobody is waiting. Twilio's
      // later audio request must be a cached file read, never a Sarvam round
      // trip that can time out after the person has answered.
      const audio = await renderVoice(d.text, c, { timeoutMs: 10_000 });
      if (!audio.ok) {
        return {
          ok: false,
          error: `could not prepare voice audio; nothing was dialled: ${audio.error}`,
        };
      }

      // The conversation route must acknowledge Twilio immediately while the
      // agent and Sarvam finish the real reply. Warm that acknowledgement now,
      // before anyone is on the line, so it stays in the same Sarvam voice.
      const filler = await renderVoice(VOICE_FILLER, c, { timeoutMs: 10_000 });
      if (!filler.ok) {
        return {
          ok: false,
          error: `could not prepare conversation audio; nothing was dialled: ${filler.error}`,
        };
      }

      // The question and the deadline fallback are also reachable before a
      // dynamic reply exists. Warm both so no normal demo branch changes from
      // the configured Sarvam speaker to Twilio's synthetic voice.
      for (const [label, line] of [
        ["conversation question", THE_ASK],
        ["safe fallback", SAFE_LINE],
      ] as const) {
        const warm = await renderVoice(line, c, { timeoutMs: 10_000 });
        if (!warm.ok) {
          return {
            ok: false,
            error: `could not prepare ${label}; nothing was dialled: ${warm.error}`,
          };
        }
      }

      const token = mintVoiceToken({ site: site.key, draft: d.id, secret: site.secret });
      const call = await placeCall({
        to: d.to.phone,
        twimlUrl: `${c.origin}/voice/twiml/${site.key}/${token}`,
        statusCallbackUrl: `${c.origin}/voice/status/${site.key}/${token}`,
        c,
      });

      return call.ok ? { ok: true, ref: call.sid } : { ok: false, error: call.error };
    },
  },
  {
    id: "email",
    label: "Email",
    available: false,
    reachesPerson: true,
    unlockedBy: "A sending domain with SPF, DKIM and DMARC aligned, and a one-click unsubscribe header.",
  },
];

export const channel = (id: ChannelId): Channel | undefined => CHANNELS.find((c) => c.id === id);

/* ------------------------------------------------------------------ *
 * The send log
 * ------------------------------------------------------------------ */

export type SendRecord = {
  ts: string;
  shop: string;
  draftId: string;
  cartId: string;
  customerId: string;
  channel: ChannelId;
  treatment: string;
  ok: boolean;
  ref?: string;
  error?: string;
};

export function readSends(shop?: string): SendRecord[] {
  try {
    return fs
      .readFileSync(SEND_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as SendRecord)
      .filter((r) => !shop || r.shop === shop);
  } catch {
    return [];
  }
}

function appendSend(r: SendRecord): boolean {
  try {
    fs.mkdirSync(path.dirname(SEND_FILE), { recursive: true });
    fs.appendFileSync(SEND_FILE, JSON.stringify(r) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * When each customer was last contacted, and how often this month.
 *
 * Returned as maps rather than as a predicate, because the suppression stage
 * needs to tell the merchant *why* someone was skipped and by how much they
 * missed — "contacted 6 days ago, cooldown is 30" is actionable and "skipped"
 * is not.
 */
export function contactHistory(shop: string, asOf = new Date()) {
  const monthAgo = asOf.getTime() - 30 * 86_400_000;
  const lastAt = new Map<string, string>();
  const inLastMonth = new Map<string, number>();
  const cartsSent = new Set<string>();
  for (const r of readSends(shop)) {
    if (!r.ok) continue;
    cartsSent.add(r.cartId);
    const prev = lastAt.get(r.customerId);
    if (!prev || r.ts > prev) lastAt.set(r.customerId, r.ts);
    if (Date.parse(r.ts) >= monthAgo)
      inLastMonth.set(r.customerId, (inLastMonth.get(r.customerId) ?? 0) + 1);
  }
  return { lastAt, inLastMonth, cartsSent };
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/**
 * Deliver one draft, log first.
 *
 * The ordering is the whole point. We write the send record, and only if that
 * write succeeded do we hand the message to a channel. The failure mode we are
 * choosing is "logged but not delivered", which costs a shopper nothing and
 * shows up as a gap the merchant can see. The alternative failure mode —
 * delivered but not logged — is invisible, and it uncaps the frequency limit
 * for that person permanently.
 */
export async function send(d: Draft): Promise<SendRecord> {
  const ch = channel(d.channel);
  const base: SendRecord = {
    ts: new Date().toISOString(),
    shop: d.shop,
    draftId: d.id,
    cartId: d.cartId,
    customerId: d.customerId,
    channel: d.channel,
    treatment: d.treatment,
    ok: false,
  };

  if (!ch || !ch.available || !ch.deliver) {
    return { ...base, error: ch ? `${ch.label} has no delivery path: ${ch.unlockedBy ?? "not built"}` : "no such channel" };
  }

  /**
   * The two feature switches, checked at the last possible moment.
   *
   * Here rather than in the console, because this function is what actually
   * reaches a person and the console is only one of its callers. A switch
   * enforced in the page it is rendered on is a switch that a script, a cron
   * or next year's caller walks straight past.
   *
   * Both return a refusal instead of writing a send record, matching the
   * branch above: nothing left, so nothing is logged as having left. The
   * frequency cap counts sends, and a phantom row would silently consume a
   * shopper's monthly allowance for a message they never got.
   */
  if (!featureOn(d.shop, "recovery")) {
    return { ...base, error: "basket recovery is switched off for this shop" };
  }
  if (d.channel === "voice" && !featureOn(d.shop, "voice")) {
    return { ...base, error: "voice outreach is switched off for this shop" };
  }

  /**
   * Quiet hours, checked at SEND time.
   *
   * They belong here rather than in the recovery agent because they are a
   * property of delivery, not of drafting. A campaign assembled at midnight and
   * sent at nine is fine; the same campaign delivered at midnight is not, and
   * only this function knows which of those is happening.
   */
  const settings = readSettings(d.shop);
  if (ch.reachesPerson && quietNow(settings, new Date())) {
    const { fromHour, toHour, tz } = settings.outreach.quietHours;

    /**
     * The one way past quiet hours, and the shape of it is the argument.
     *
     * A voice channel that cannot be tested between nine at night and nine in
     * the morning cannot be tested by anybody building it in the evening, which
     * is when it gets built. But quiet hours are not editable on purpose — a
     * dial that turns up is a dial that gets turned up, and a 2am call about a
     * teapot is the last message that shopper ever reads.
     *
     * So the escape is not a setting and not a boolean. It is an ENV VAR
     * HOLDING ONE PHONE NUMBER, and it only fires when the draft is going to
     * exactly that number. What it can authorise is therefore bounded to the
     * handset of whoever configured the server — a person who is awake, in the
     * room, and expecting the call. It cannot reach a shopper, cannot be turned
     * on from the merchant console, and cannot become a campaign, because it
     * admits exactly one destination at a time.
     *
     * It is also loud: the bypass is recorded in the ledger as its own event,
     * so a run that used it can never be mistaken for a run that did not.
     */
    const testPhone = process.env.VOICE_QUIET_HOURS_TEST_NUMBER;
    const isTestHandset = Boolean(testPhone) && d.to.phone === testPhone;

    if (!isTestHandset) {
      return {
        ...base,
        error: `quiet hours — nothing unsolicited goes out between ${fromHour}:00 and ${toHour}:00 ${tz}`,
      };
    }

    record({
      shop: d.shop,
      kind: "tool_error",
      message:
        `QUIET HOURS BYPASSED for the configured test handset — this would NOT have been sent to a shopper. ` +
        `Window is ${fromHour}:00–${toHour}:00 ${tz}.`,
      detail: { cartId: d.cartId, channel: d.channel },
    });
  }

  if (!appendSend({ ...base, ok: true })) {
    return { ...base, error: "could not write the send log; nothing was delivered" };
  }

  const out: { ok: boolean; ref?: string; error?: string } = await ch
    .deliver(d)
    .catch((e: Error) => ({ ok: false, error: e.message }));

  record({
    shop: d.shop,
    kind: out.ok ? "reply" : "tool_error",
    message: `outreach ${d.treatment} via ${d.channel}: ${out.ok ? "sent" : out.error}`,
    detail: { cartId: d.cartId, marginAtStake: d.marginAtStake },
  });

  return { ...base, ok: out.ok, ref: out.ref, error: out.error };
}

/** Drafts written by the draft channel, newest first, for the console. */
export function readDrafts(shop: string, limit = 100): Array<Draft & { at: string }> {
  try {
    return fs
      .readFileSync(DRAFT_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Draft & { at: string })
      .filter((d) => d.shop === shop)
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Test seam. */
export function _files() {
  return { drafts: DRAFT_FILE, sends: SEND_FILE };
}
