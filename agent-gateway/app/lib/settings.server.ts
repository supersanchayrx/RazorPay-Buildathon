/**
 * The things only the merchant can tell us.
 *
 * The cortex has always been able to *hold* a voice — `buildCortex` takes one —
 * and no caller has ever supplied one, so every cortex ever assembled reported
 * the same gap: "How the shop should sound — a sentence or two in the
 * merchant's own words". The gap was real and permanent, because there was
 * nowhere to type an answer. A memory the merchant cannot write to is a report,
 * not a memory. This is the writable half.
 *
 * WHAT BELONGS HERE, AND WHAT DOES NOT.
 *
 * Only what we genuinely cannot compute. Order volume, bestsellers, categories,
 * out-of-stock lines, refusal counts — all derived, all absent from this file,
 * because a typed number is a number that goes stale silently while looking
 * authoritative. What survives the test is: how the shop should sound, and the
 * limits the merchant wants us to operate inside. Neither is discoverable from
 * data at any price.
 *
 * THE OUTREACH BLOCK IS A SET OF CEILINGS, NOT A SET OF GOALS.
 *
 * Every field in it can only ever reduce what gets sent. There is no
 * `minPerRun`, no target, no "make sure we contact at least". A settings file
 * that can be turned up as well as down is a settings file that will be turned
 * up, and the first bad week of a recovery campaign is the week it stops being
 * a recovery campaign and starts being spam sent under the merchant's name.
 *
 * JSONL's cousin: a single JSON document per install, because unlike the ledger
 * these values are overwritten rather than appended, and the history of a
 * setting is not something anyone has asked to audit. Becomes a Prisma row.
 */

import fs from "node:fs";
import path from "node:path";
// Types only — erased at build, so this file stays as cheap to import as it was.
import type { Reason } from "./reasons";
import type { Tier } from "./loyalty.server";

export type ConsentBasis =
  /**
   * The shopper handed us this phone number or email during a checkout they
   * started themselves, minutes ago. One message about that specific checkout
   * is a service message. It is not a licence to market to them.
   */
  | "transactional"
  /** They ticked a box. Recorded separately, and we do not have this yet. */
  | "marketing";

export type OutreachSettings = {
  /** Off until a merchant turns it on. Nothing about outreach is a default. */
  enabled: boolean;
  consentBasis: ConsentBasis;
  /**
   * Local hours during which nothing unsolicited may go out, in the shop's own
   * timezone. India's TRAI rules put promotional traffic behind a 09:00–21:00
   * window and a DND registry; even where the rule does not bind, a 2am
   * WhatsApp about a teapot is the last message that shopper ever reads.
   */
  quietHours: { fromHour: number; toHour: number; tz: string };
  /** Days that must pass before the same person hears from us again. */
  cooldownDays: number;
  /** Hard ceiling per person per rolling month, across every channel. */
  maxPerCustomerPerMonth: number;
  /** Hard ceiling on one campaign run, so a data bug cannot become a broadcast. */
  maxPerRun: number;
  /**
   * Margin at stake below which a cart is not worth a message.
   *
   * Margin, never basket value. Chasing a ₹400 basket that carries ₹190 of
   * margin with a message that costs ₹0.35 and a unit of the shopper's patience
   * is a different calculation from chasing ₹400 of revenue, and only one of
   * them is the merchant's actual position.
   */
  minMarginAtStake: number;
  /**
   * The window in which a cart is worth chasing.
   *
   * `minHours` because someone who abandoned twelve minutes ago may be in
   * another tab finishing; a message then is an interruption of a purchase in
   * progress. `maxHours` because a cart from March is archaeology, and writing
   * to someone about it tells them exactly how long we have been sitting on
   * their data.
   */
  cartAgeHours: { min: number; max: number };
  /** Channel ids the merchant has enabled. Availability is decided elsewhere. */
  channels: string[];
  /** How a phone call behaves, when the voice channel is one of them. */
  call: CallSettings;
};

/**
 * What a voice call is allowed to be.
 *
 * `mode` is the only setting in this file that changes what KIND of thing goes
 * out rather than how much of it, and it defaults to the smaller thing.
 *
 *   notice        one bounds-checked sentence, then hang up. No model anywhere
 *                 near the audio. This is the channel the architecture
 *                 specifies and the one a merchant should start with.
 *
 *   conversation  the same opening sentence, then the shopper can answer and be
 *                 answered. A model writes the replies, every one of them
 *                 passes `checkReply` before it is spoken, and the reason they
 *                 give is classified into the same closed set as the web page.
 *
 * The upgrade is deliberate and one-way in the merchant's head: `conversation`
 * is strictly more capability and strictly more risk, so it is a thing somebody
 * chooses, never a thing that happens because a model became available.
 */
export type CallSettings = {
  mode: "notice" | "conversation";
  /**
   * Hard ceiling on exchanges before the call is wound up politely.
   *
   * A ceiling like every other in this file: it can only ever shorten a call.
   * There is no `minTurns`, because nothing about this should keep a person on
   * the phone. Also bounded above by Twilio's own limit on how many TwiML
   * documents one call may fetch — exceed it and the call dies mid-sentence
   * with a machine error, which is a worse ending than any we would choose.
   */
  maxTurns: number;
  /** Sarvam speaker. Validated against the model's own list at render time. */
  speaker: string;
  /** BCP-47 language for both synthesis and recognition. */
  language: string;
};


/**
 * What the recovery agent may do about an answer, and how far it may go.
 *
 * THIS IS AN APPROVAL WITH AN EXPOSURE CAP, in the same shape as `OfferTerms` —
 * not a feature flag. A merchant reading it should be able to say out loud what
 * they have agreed to: *"up to 8% off, only for people who have bought from me
 * before, at most 20 of those a month and at most ₹4,000 of my margin, each one
 * dying after 48 hours."*
 *
 * THE AGENT NEVER CHOOSES A DEPTH. It reads `maxDepthPct` and applies it, or it
 * offers nothing. There is no negotiation, no sliding scale, and no second
 * offer — a shopper who says "still too expensive" gets the same grant back,
 * because an agent that improves its offer under pressure is an agent that can
 * be argued into anything, and word of that travels faster than any campaign.
 *
 * `requiresTier` may not be `new`, and that is validated rather than defaulted.
 * Money for whoever complains teaches everybody to complain.
 */
export type RecoveryPolicy = {
  /** Off until a merchant turns it on. */
  enabled: boolean;
  /**
   * The reasons a discount is allowed to answer.
   *
   * Deliberately a list rather than "any reason a model thinks warrants one".
   * Discounting a shopper who said delivery was too slow does not address what
   * they told you, and they will notice.
   */
  discountFor: Reason[];
  /** Whole percent. Capped again, at read time, against the merchant's own discount ceiling. */
  maxDepthPct: number;
  /** The standing a shopper must have. Never `new`. */
  requiresTier: Tier;
  /** Grants issued per rolling month. A count, so a bug cannot become a giveaway. */
  monthlyGrantCap: number;
  /** Rupees of gross margin the merchant is willing to give up per rolling month. */
  monthlyMarginCap: number;
  /** How long one grant lives. Short: it is an answer to a conversation, not a coupon. */
  grantTtlHours: number;
};

export type MerchantSettings = {
  /** How the shop sounds, in the merchant's own words. The cortex's missing half. */
  voice: string | null;
  outreach: OutreachSettings;
  recovery: RecoveryPolicy;
  /** Set whenever anything here is written, so the cortex can age the fact. */
  updatedAt: string | null;
  updatedBy: string | null;
};

export const DEFAULTS: MerchantSettings = {
  voice: null,
  outreach: {
    enabled: false,
    consentBasis: "transactional",
    quietHours: { fromHour: 21, toHour: 9, tz: "Asia/Kolkata" },
    cooldownDays: 30,
    maxPerCustomerPerMonth: 1,
    maxPerRun: 25,
    minMarginAtStake: 150,
    cartAgeHours: { min: 4, max: 336 },
    channels: ["draft"],
    call: { mode: "notice", maxTurns: 6, speaker: "priya", language: "en-IN" },
  },
  recovery: {
    enabled: false,
    discountFor: ["price_too_high"],
    maxDepthPct: 8,
    requiresTier: "returning",
    monthlyGrantCap: 20,
    monthlyMarginCap: 4000,
    grantTtlHours: 48,
  },
  updatedAt: null,
  updatedBy: null,
};

const file = (shop: string) =>
  path.join(process.cwd(), "data", `settings-${shop.replace(/[^a-z0-9_]/gi, "_")}.json`);

/**
 * Read, with the defaults filled in field by field.
 *
 * Merged rather than replaced, because a settings file written by an older
 * version of this code is missing whatever was added since, and the failure
 * mode of a spread-once merge is an `undefined` ceiling — which reads as "no
 * limit" at every call site that checks it. A ceiling that vanishes when a
 * field is absent is worse than no ceiling at all, because nobody looks for it.
 */
export function readSettings(shop: string): MerchantSettings {
  let raw: Partial<MerchantSettings> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file(shop), "utf8")) as Partial<MerchantSettings>;
  } catch {
    return { ...DEFAULTS, outreach: { ...DEFAULTS.outreach }, recovery: { ...DEFAULTS.recovery } };
  }
  const o = (raw.outreach ?? {}) as Partial<OutreachSettings>;
  return {
    voice: typeof raw.voice === "string" && raw.voice.trim() ? raw.voice.trim() : null,
    outreach: {
      enabled: o.enabled ?? DEFAULTS.outreach.enabled,
      consentBasis: o.consentBasis ?? DEFAULTS.outreach.consentBasis,
      quietHours: { ...DEFAULTS.outreach.quietHours, ...(o.quietHours ?? {}) },
      cooldownDays: num(o.cooldownDays, DEFAULTS.outreach.cooldownDays),
      maxPerCustomerPerMonth: num(o.maxPerCustomerPerMonth, DEFAULTS.outreach.maxPerCustomerPerMonth),
      maxPerRun: num(o.maxPerRun, DEFAULTS.outreach.maxPerRun),
      minMarginAtStake: num(o.minMarginAtStake, DEFAULTS.outreach.minMarginAtStake),
      cartAgeHours: { ...DEFAULTS.outreach.cartAgeHours, ...(o.cartAgeHours ?? {}) },
      channels: Array.isArray(o.channels) ? o.channels : DEFAULTS.outreach.channels,
      call: {
        // Field by field, and `mode` falls back to `notice` on anything it does
        // not recognise. A settings file corrupted into `mode: "conversatoin"`
        // must not silently become the more capable thing.
        mode: o.call?.mode === "conversation" ? "conversation" : DEFAULTS.outreach.call.mode,
        maxTurns: num(o.call?.maxTurns, DEFAULTS.outreach.call.maxTurns),
        speaker: typeof o.call?.speaker === "string" && o.call.speaker.trim() ? o.call.speaker.trim() : DEFAULTS.outreach.call.speaker,
        language: typeof o.call?.language === "string" && o.call.language.trim() ? o.call.language.trim() : DEFAULTS.outreach.call.language,
      },
    },
    recovery: {
      ...DEFAULTS.recovery,
      ...((raw.recovery ?? {}) as Partial<RecoveryPolicy>),
      // Merged field by field for the same reason as the outreach block: an
      // absent cap read as `undefined` is a cap every call site treats as
      // infinite.
      discountFor: Array.isArray(raw.recovery?.discountFor)
        ? (raw.recovery.discountFor as Reason[])
        : DEFAULTS.recovery.discountFor,
      maxDepthPct: num(raw.recovery?.maxDepthPct, DEFAULTS.recovery.maxDepthPct),
      monthlyGrantCap: num(raw.recovery?.monthlyGrantCap, DEFAULTS.recovery.monthlyGrantCap),
      monthlyMarginCap: num(raw.recovery?.monthlyMarginCap, DEFAULTS.recovery.monthlyMarginCap),
      grantTtlHours: num(raw.recovery?.grantTtlHours, DEFAULTS.recovery.grantTtlHours),
    },
    updatedAt: raw.updatedAt ?? null,
    updatedBy: raw.updatedBy ?? null,
  };
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * Validation lives here rather than in the form.
 *
 * The console is one caller. A script, a seed, and whatever posts to this next
 * year are others, and the invariant belongs with the data instead of with the
 * page that happens to be writing today. Same reasoning as `decide()` in the
 * approval store.
 */
export function writeSettings(
  shop: string,
  patch: {
    voice?: string | null;
    outreach?: Partial<OutreachSettings>;
    recovery?: Partial<RecoveryPolicy>;
  },
  by: string,
): { ok: boolean; error?: string; settings: MerchantSettings } {
  const current = readSettings(shop);
  const o = { ...current.outreach, ...(patch.outreach ?? {}) };
  const r = { ...current.recovery, ...(patch.recovery ?? {}) };

  if (patch.outreach?.quietHours) o.quietHours = { ...current.outreach.quietHours, ...patch.outreach.quietHours };
  if (patch.outreach?.cartAgeHours) o.cartAgeHours = { ...current.outreach.cartAgeHours, ...patch.outreach.cartAgeHours };
  if (patch.outreach?.call) o.call = { ...current.outreach.call, ...patch.outreach.call };

  const bad = (error: string) => ({ ok: false, error, settings: current });

  if (o.cooldownDays < 1) return bad("a cooldown under a day is not a cooldown");
  if (o.maxPerCustomerPerMonth < 1 || o.maxPerCustomerPerMonth > 4)
    return bad("between 1 and 4 messages a month per person; above that this is not recovery");
  if (o.maxPerRun < 1 || o.maxPerRun > 500) return bad("a run sends between 1 and 500 messages");
  if (o.minMarginAtStake < 0) return bad("margin at stake cannot be negative");
  if (o.cartAgeHours.min < 1) return bad("wait at least an hour — they may still be checking out");
  if (o.cartAgeHours.max <= o.cartAgeHours.min) return bad("the age window must be a window");
  if (!(o.quietHours.fromHour >= 0 && o.quietHours.fromHour <= 23)) return bad("quiet hours start is a clock hour");
  if (!(o.quietHours.toHour >= 0 && o.quietHours.toHour <= 23)) return bad("quiet hours end is a clock hour");

  /**
   * The call, and the one ceiling here that is not ours.
   *
   * `maxTurns` is capped at 8 because Twilio counts every TwiML document a call
   * fetches against a per-call budget — 10 on a trial account — and a
   * conversation that runs past it does not end politely, it dies mid-sentence
   * with a machine reading out an error. A merchant cannot be expected to know
   * that, so the setting refuses the value rather than letting them discover it
   * on somebody's phone.
   */
  if (o.call.mode !== "notice" && o.call.mode !== "conversation")
    return bad("a call is either a notice or a conversation");
  if (!(o.call.maxTurns >= 1 && o.call.maxTurns <= 8))
    return bad("between 1 and 8 exchanges — beyond that a call outruns the number of steps the carrier allows it");

  /**
   * The recovery policy, validated hard because it is the only thing in CHAPMAN
   * that lets an agent give money away without a human in the loop for each
   * one.
   */
  if (r.enabled) {
    if (!(r.maxDepthPct >= 1 && r.maxDepthPct <= 50))
      return bad("a recovery discount is between 1% and 50% — and your own discount ceiling caps it further");
    if (r.requiresTier === "new")
      return bad(
        "a recovery discount cannot be offered to first-time shoppers — money for whoever complains teaches everybody to complain",
      );
    if (!(r.monthlyGrantCap >= 1 && r.monthlyGrantCap <= 500))
      return bad("between 1 and 500 grants a month");
    if (!(r.monthlyMarginCap > 0)) return bad("a monthly margin cap of zero would issue nothing; switch it off instead");
    if (!(r.grantTtlHours >= 1 && r.grantTtlHours <= 168))
      return bad("a grant lives between an hour and a week — it answers a conversation, it is not a coupon");
    if (!Array.isArray(r.discountFor) || r.discountFor.length === 0)
      return bad("say which answers a discount may respond to, or switch it off");
  }

  const next: MerchantSettings = {
    voice:
      patch.voice === undefined
        ? current.voice
        : typeof patch.voice === "string" && patch.voice.trim()
          ? patch.voice.trim().slice(0, 600)
          : null,
    outreach: o,
    recovery: r,
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };

  try {
    fs.mkdirSync(path.dirname(file(shop)), { recursive: true });
    fs.writeFileSync(file(shop), JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch (e) {
    return bad(`could not save: ${(e as Error).message}`);
  }
  return { ok: true, settings: next };
}

/**
 * Is it currently a time when nothing unsolicited may go out?
 *
 * Computed in the SHOP's timezone rather than the server's, which is the whole
 * difference between a rule and a decoration: a box in Virginia deciding that
 * 21:00 has not arrived yet in Coimbatore is how a merchant's customers get
 * messaged at half past two in the morning.
 *
 * The window wraps midnight (21:00 -> 09:00), so the comparison is an OR rather
 * than the obvious AND. Getting that backwards inverts the rule completely and
 * the result still looks plausible in a code review.
 */
export function quietNow(s: MerchantSettings, asOf = new Date()): boolean {
  const { fromHour, toHour, tz } = s.outreach.quietHours;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(asOf),
  );
  return fromHour > toHour ? hour >= fromHour || hour < toHour : hour >= fromHour && hour < toHour;
}

/** Test seam. */
export function _file(shop: string): string {
  return file(shop);
}
