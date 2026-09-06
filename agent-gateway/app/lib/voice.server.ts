/**
 * The voice channel — speech (Sarvam) and telephony (Twilio), kept apart.
 *
 * This is the third and most dangerous outreach channel, and the architecture
 * has been explicit about why since before a line of it existed:
 *
 *   Voice is the channel where a fabricated discount is hardest to retract and
 *   hardest to prove. There is no screenshot. The shopper heard it, the shop
 *   has no record of what was said, and "the agent offered me fifteen percent"
 *   is unanswerable.
 *
 * So this file contains NO MODEL, and there is nowhere to put one. What it does
 * is read out a sentence that already exists:
 *
 *   remedies.server.ts decided     -+
 *   grants.server.ts issued         +--> Draft.text --> Sarvam --> Twilio
 *   checkReply passed the text     -+        (a string, spoken verbatim)
 *
 * `speak()` takes a draft id, not a string. There is deliberately no way to
 * hand this module free-form text, for the same reason `buildQuote` takes a
 * grant id rather than a discount depth: a caller that could pass a sentence
 * could pass any sentence, and the browser is a caller.
 *
 * FOUR OTHER THINGS WORTH KNOWING.
 *
 * 1. TWILIO SIGNS ITS WEBHOOKS; IT DOES NOT SIGN ITS MEDIA FETCHES. The TwiML
 *    route verifies `X-Twilio-Signature`. The audio route cannot — Twilio pulls
 *    `<Play>` URLs with a bare GET — so that route is protected by the `a1.`
 *    token alone: HMAC'd, site-bound, fifteen minutes. Stated plainly because
 *    an undocumented asymmetry in who-checks-what is how open endpoints happen.
 *
 * 2. 8 kHz MP3, NOT 24 kHz WAV. The phone network is 8 kHz; anything finer is
 *    bytes Twilio will throw away, and on this store the same sentence is 37 KB
 *    as 8 kHz mp3 against 399 KB as 24 kHz wav. Ten times less to pull through
 *    a tunnel before the shopper hears anything.
 *
 * 3. RENDERED ONCE, CACHED ON DISK. Twilio may re-fetch a `<Play>` URL, and a
 *    Sarvam round trip inside a live call is silence on the line. The cache key
 *    is a hash of (text, voice, language), so editing a template invalidates it
 *    without anybody having to remember to.
 *
 * 4. `isConfigured` READS CREDENTIALS, NOT A SETTING. The voice channel is
 *    available when speech and telephony credentials both exist and an origin
 *    Twilio can reach is known. A merchant cannot turn this on by ticking a
 *    box, because the thing in the way is a purchase, not a preference.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths.server";

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/** Voices Sarvam's bulbul:v3 accepts. v2's names are NOT interchangeable. */
export const VOICES = [
  "priya", "kavya", "neha", "pooja", "simran", "ishita", "shreya", "roopa", "tanya", "ritu",
  "aditya", "ashutosh", "rahul", "rohan", "amit", "dev", "ratan", "varun", "manan", "sumit",
  "kabir", "aayan", "shubh", "advait", "anand", "tarun",
] as const;
export type Voice = (typeof VOICES)[number];

export const LANGUAGES = [
  "en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
] as const;
export type Language = (typeof LANGUAGES)[number];

export type VoiceConfig = {
  sarvamKey: string;
  twilioSid: string;
  twilioToken: string;
  twilioFrom: string;
  /** Public origin Twilio can reach. In development, the ngrok tunnel. */
  origin: string;
  voice: Voice;
  language: Language;
  /**
   * How fast she talks. Bulbul v3 accepts 0.5–2.0; 1.0 is the model's default
   * and is noticeably slower than an Indian shop assistant actually speaks on
   * the phone. Slightly quicker reads as competent rather than rushed, and it
   * shortens every call — which on a metered trial is real money and on a real
   * campaign is real patience.
   */
  pace: number;
};

/**
 * What is missing, named precisely.
 *
 * Returned as a list rather than a boolean because "voice is unavailable" is
 * not an actionable thing to tell a merchant and "TWILIO_FROM is unset" is.
 */
export function missing(): string[] {
  const need = ["SARVAM_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "PUBLIC_ORIGIN"];
  return need.filter((k) => !process.env[k]);
}

export const isConfigured = () => missing().length === 0;

export function config(): VoiceConfig | null {
  if (!isConfigured()) return null;
  const voice = (process.env.SARVAM_VOICE ?? "priya") as Voice;
  const language = (process.env.SARVAM_LANGUAGE ?? "en-IN") as Language;
  return {
    sarvamKey: process.env.SARVAM_API_KEY!,
    twilioSid: process.env.TWILIO_ACCOUNT_SID!,
    twilioToken: process.env.TWILIO_AUTH_TOKEN!,
    twilioFrom: process.env.TWILIO_FROM!,
    origin: process.env.PUBLIC_ORIGIN!.replace(/\/+$/, ""),
    voice: (VOICES as readonly string[]).includes(voice) ? voice : "priya",
    language: (LANGUAGES as readonly string[]).includes(language) ? language : "en-IN",
    // Clamped rather than trusted: the API rejects anything outside 0.5–2.0,
    // and a rejected render is a silent call.
    pace: Math.min(2, Math.max(0.5, Number(process.env.SARVAM_PACE ?? 1.15))),
  };
}

/* ------------------------------------------------------------------ *
 * Speech
 * ------------------------------------------------------------------ */

const CACHE_DIR = dataPath("voice");

/**
 * bulbul:v3 caps a request at 2500 characters. Recovery drafts run to a few
 * hundred, so this should never fire — which is exactly why it is here rather
 * than assumed. A silently truncated sentence on a phone call is a sentence
 * that ends mid-promise.
 */
const MAX_CHARS = 2500;

const cacheKey = (text: string, c: VoiceConfig) =>
  crypto.createHash("sha256").update(`${c.voice}|${c.language}|${c.pace}|${text}`).digest("hex").slice(0, 32);

export type Rendered =
  | { ok: true; file: string; bytes: number; cached: boolean }
  | { ok: false; error: string };

/**
 * Render one sentence to 8 kHz mp3, cached by content.
 *
 * Takes text rather than a draft id because the caller has already resolved the
 * draft and checked it — this is the transport half. `speak()` is the entry
 * point that enforces "drafts only".
 */
export async function render(text: string, c: VoiceConfig): Promise<Rendered> {
  if (!text.trim()) return { ok: false, error: "nothing to say" };
  if (text.length > MAX_CHARS) {
    return {
      ok: false,
      error: `${text.length} characters; bulbul:v3 accepts ${MAX_CHARS}. Not truncating a sentence mid-promise.`,
    };
  }

  const file = path.join(CACHE_DIR, `${cacheKey(text, c)}.mp3`);
  try {
    const stat = fs.statSync(file);
    if (stat.size > 0) return { ok: true, file, bytes: stat.size, cached: true };
  } catch {
    /* not cached yet */
  }

  let res: Response;
  try {
    res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      /**
       * A timeout, because there wasn't one.
       *
       * A `fetch` with no signal waits as long as the other end likes. Inside a
       * live call that is not a slow render, it is a dropped call: Twilio gives
       * up at fifteen seconds and tells the caller it could not reach us. Six
       * is well past the two-and-a-half a normal render takes.
       */
      signal: AbortSignal.timeout(Number(process.env.SARVAM_TIMEOUT_MS ?? 3000)),
      headers: { "api-subscription-key": c.sarvamKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language_code: c.language,
        model: "bulbul:v3",
        speaker: c.voice,
        pace: c.pace,
        // The phone network is 8 kHz. Anything finer is bytes Twilio discards.
        output_audio_codec: "mp3",
        speech_sample_rate: 8000,
      }),
    });
  } catch (e) {
    return { ok: false, error: `sarvam unreachable: ${(e as Error).message}` };
  }

  const body = await res.text();
  if (!res.ok) {
    // Sarvam names the offending field on a 400 (speaker/model mismatch, bad
    // language code). Passing that through beats "TTS failed".
    let msg = body.slice(0, 300);
    try {
      msg = JSON.parse(body)?.error?.message ?? msg;
    } catch {
      /* keep the raw body */
    }
    return { ok: false, error: `sarvam ${res.status}: ${msg}` };
  }

  let audio: string | undefined;
  try {
    audio = JSON.parse(body)?.audios?.[0];
  } catch {
    return { ok: false, error: "sarvam returned a body that is not JSON" };
  }
  if (!audio) return { ok: false, error: "sarvam returned no audio" };

  const buf = Buffer.from(audio, "base64");
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, buf);
  } catch (e) {
    return { ok: false, error: `could not cache audio: ${(e as Error).message}` };
  }
  return { ok: true, file, bytes: buf.length, cached: false };
}

/* ------------------------------------------------------------------ *
 * Twilio request signatures
 * ------------------------------------------------------------------ */

/**
 * Is this request actually from Twilio?
 *
 * Twilio HMAC-SHA1s the full URL plus, for a POST, every form parameter sorted
 * by key and concatenated as key+value, keyed by the account's auth token.
 *
 * Without this the TwiML route is an open endpoint on a public tunnel that
 * renders arbitrary speech on our Sarvam credit. WITH it, note what is still
 * true: Twilio does NOT sign the GET it sends for a `<Play>` URL, so the audio
 * route has no signature to check and leans entirely on the `a1.` token.
 *
 * The URL must be the one Twilio signed, byte for byte — the public origin,
 * not whatever a proxy in front of us rewrote the Host header to. Getting this
 * wrong produces a signature failure that looks exactly like an attack.
 */
export function verifyTwilioSignature(opts: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
  authToken: string;
}): boolean {
  if (!opts.signature) return false;
  const data =
    opts.url +
    Object.keys(opts.params)
      .sort()
      .map((k) => k + opts.params[k])
      .join("");
  const expected = crypto
    .createHmac("sha1", opts.authToken)
    .update(Buffer.from(data, "utf8"))
    .digest("base64");
  const a = Buffer.from(opts.signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ *
 * Telephony
 * ------------------------------------------------------------------ */

export type PlacedCall = { ok: true; sid: string; status: string } | { ok: false; error: string };

/**
 * Place one outbound call that fetches its TwiML from `twimlUrl`.
 *
 * Deliberately NOT the inline `Twiml=` parameter, which Twilio refuses on trial
 * accounts ("trial accounts have limited parameter access"). Measured, not
 * assumed: the same request with `Url=` returns 201 and with `Twiml=` returns
 * 400. Fetching from a URL is also the only shape that can serve audio, so
 * there is nothing to regret here.
 */
export async function placeCall(opts: {
  to: string;
  twimlUrl: string;
  c: VoiceConfig;
}): Promise<PlacedCall> {
  const form = new URLSearchParams({ To: opts.to, From: opts.c.twilioFrom, Url: opts.twimlUrl });
  const auth = Buffer.from(`${opts.c.twilioSid}:${opts.c.twilioToken}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${opts.c.twilioSid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (e) {
    return { ok: false, error: `twilio unreachable: ${(e as Error).message}` };
  }

  const body = await res.text();
  let parsed: { sid?: string; status?: string; message?: string; code?: number } = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: `twilio ${res.status}: ${body.slice(0, 200)}` };
  }
  if (!res.ok || !parsed.sid) {
    return {
      ok: false,
      error: `twilio ${res.status}${parsed.code ? ` [${parsed.code}]` : ""}: ${parsed.message ?? body.slice(0, 200)}`,
    };
  }
  return { ok: true, sid: parsed.sid, status: parsed.status ?? "queued" };
}

/** Test seam. */
export function _cacheDir() {
  return CACHE_DIR;
}
