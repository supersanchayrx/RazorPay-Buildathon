import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { findSite } from "../lib/sites.server";
import { verifyVoiceToken } from "../lib/identity.server";
import { draftById } from "../lib/outreach.server";
import { config, verifyTwilioSignature } from "../lib/voice.server";
import { record } from "../lib/ledger.server";
import { readSettings } from "../lib/settings.server";
import { openConversation, openSession, speak, THE_ASK, warmFallback } from "../lib/voicetalk.server";
import { listen, reply, respondWithin } from "../lib/twiml.server";
import { readPublicFormData } from "../lib/http-security.server";

/**
 * What the shop says when the shopper picks up.
 *
 * Twilio does not carry the message — it rings the phone and then asks us what
 * to play. That callback is this route, and the shape of it is the point:
 *
 *   the call carries a TOKEN, and the token names a DRAFT.
 *
 * There is no `?text=` parameter and there will not be one. A URL that carried
 * the sentence would mean anyone able to form a URL could make the shop's voice
 * say anything, on a channel with no screenshot and no record. It is the same
 * rule that makes `buildQuote` take a grant id rather than a discount depth,
 * and the same rule that makes the recovery page take a cart token rather than
 * a cart id: the caller names the thing, the server reads what it is worth.
 *
 * So by the time a sentence reaches a speaker it has passed through
 * `remedies.server.ts` (which decided), `checkReply` (which allowed it) and
 * `appendDraft` (which wrote it down). This route only looks it up.
 *
 * TWO CHECKS, AND THEY ARE NOT THE SAME CHECK.
 *
 *   the signature   proves TWILIO sent this request
 *   the token       proves WE authorised this draft to be spoken
 *
 * Neither implies the other. A valid signature on a forged token is Twilio
 * faithfully delivering somebody else's idea; a valid token with no signature
 * is our own URL being replayed by anyone who saw it. Both, or nothing.
 */

const xml = (body: string, status = 200) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });

/**
 * What a caller hears when something is wrong on our side.
 *
 * Deliberately not silence and not a Twilio error tone. Somebody's phone rang
 * and they answered; the least we owe them is a sentence saying nobody is
 * there. It names no shop and no basket, because at this point we have not
 * established which either would be.
 */
const apology = () =>
  xml("<Response><Say>Sorry, there is nothing to play. Please ignore this call.</Say><Hangup/></Response>");

async function inner({ request, params }: LoaderFunctionArgs | ActionFunctionArgs) {
  const site = findSite(params.site ?? null);
  const c = config();

  // Order matters only for what we can log. Without a site we have no secret to
  // verify anything with, so nothing below is knowable.
  if (!site || !c) return apology();

  /* ---- 1. is this actually Twilio? ------------------------------- */

  /**
   * The URL must be the one Twilio signed, byte for byte. Behind ngrok the
   * inbound Host header is the tunnel's, but Twilio signed the public origin we
   * handed it, so the signature is computed against PUBLIC_ORIGIN rather than
   * against `request.url`. Get this wrong and every legitimate request fails a
   * signature check, which reads exactly like an attack and is not one.
   */
  const url = new URL(request.url);
  const signedUrl = `${c.origin}${url.pathname}${url.search}`;

  let formParams: Record<string, string> = {};
  if (request.method === "POST") {
    let form: FormData;
    try {
      form = await readPublicFormData(request, "voice");
    } catch {
      return xml("<Response><Say>Sorry, this request was too large.</Say><Hangup/></Response>", 413);
    }
    for (const [k, v] of form.entries()) formParams[k] = String(v);
  }

  /**
   * MEASURED, AND IT CONTRADICTS THE DOCUMENTATION.
   *
   * Twilio's security guide says it "signs all HTTP requests to your app with
   * an X-Twilio-Signature header". On this account it does not. A call created
   * through the REST API with `Url=` arrives carrying only:
   *
   *   accept-encoding, content-length, content-type, host, user-agent,
   *   x-forwarded-for, x-forwarded-host, x-forwarded-proto
   *
   * That was not inferred from a failure. The control was to send the same
   * request through the same tunnel to the same route with the header attached
   * by hand: it arrived intact, so nothing between Twilio and this function
   * strips headers, and the only remaining explanation is that Twilio did not
   * send one. It is the same shape of divergence as the `Twiml=` parameter,
   * which the docs describe without mentioning that a trial account refuses it.
   *
   * SO THE RULE IS: VERIFY WHAT IS PRESENT, NEVER INVENT WHAT IS ABSENT.
   *
   *   a signature that is present and wrong  ->  403, always, no exceptions
   *   a signature that is absent             ->  the token decides, and we log
   *
   * The second line is a real reduction in defence and is written down rather
   * than smoothed over. What still stands in front of this route is the `a1.`
   * token: HMAC-SHA256 over the site secret, naming one draft, dead in fifteen
   * minutes. That is the primary authenticator and always was; the signature is
   * corroboration that the fetcher is Twilio.
   *
   * `VOICE_REQUIRE_TWILIO_SIGNATURE=1` makes the absent case fail too, for a
   * deployment on a paid account where the header does arrive. It is not the
   * default, because a default that silently breaks the whole channel the day
   * you switch accounts is worse than one that logs.
   */
  const presented = request.headers.get("X-Twilio-Signature");
  const strict = process.env.VOICE_REQUIRE_TWILIO_SIGNATURE === "1";

  if (presented || strict) {
    const signed = verifyTwilioSignature({
      signature: presented,
      url: signedUrl,
      params: formParams,
      authToken: c.twilioToken,
    });
    if (!signed) {
      record({
        shop: site.key,
        kind: "tool_error",
        message: `voice twiml: X-Twilio-Signature ${presented ? "did not verify" : "absent and strict mode is on"}`,
        detail: { signedUrl },
      });
      // 403 rather than the apology: a request that fails this is not a caller
      // with a phone to their ear, it is somebody probing the tunnel.
      return new Response("forbidden", { status: 403 });
    }
  } else {
    record({
      shop: site.key,
      kind: "tool_error",
      message:
        "voice twiml: no X-Twilio-Signature on the request — proceeding on the a1. token alone. " +
        `Fetcher was "${request.headers.get("User-Agent") ?? "unknown"}".`,
      detail: { signedUrl },
    });
  }

  /* ---- 2. did we authorise this draft to be spoken? --------------- */

  const v = verifyVoiceToken(params.token, { site: site.key, secret: site.secret });
  if (!v.ok) {
    record({ shop: site.key, kind: "tool_error", message: `voice twiml: token ${v.reason}` });
    return apology();
  }

  const draft = draftById(site.key, v.claim.draft);
  if (!draft || !draft.text.trim()) {
    record({ shop: site.key, kind: "tool_error", message: `voice twiml: no draft ${v.claim.draft}` });
    return apology();
  }

  /* ---- 3. notice, or conversation --------------------------------- */

  /**
   * The merchant's choice, and the default is the smaller thing.
   *
   *   notice        play the sentence, hang up. No `<Gather>` — because a
   *                 `<Gather>` invites an answer, and inviting a reply that
   *                 nobody is listening to is the failure `conversations.server`
   *                 refuses in text and which is far worse aloud, where the
   *                 person is talking into silence in real time.
   *
   *   conversation  the same sentence, then the question, then listen. Every
   *                 word of the opening is still the template that passed
   *                 `checkReply` before the phone rang; the model only ever
   *                 speaks in RESPONSE to something.
   *
   * That last point is what makes the conversational mode's worst case
   * acceptable: a model that is down, rate-limited or refused by the bounds
   * layer degrades this call to exactly the notice, which is a channel the
   * merchant already approved.
   */
  const audio = `${c.origin}/voice/audio/${site.key}/${params.token}`;
  // An integration test proves transport only. Even if this shop configured
  // conversational recovery, the test must play its fixed identification and
  // hang up rather than asking a person why they abandoned an imaginary cart.
  const mode =
    draft.treatment === "integration_test"
      ? "notice"
      : readSettings(site.key).outreach.call.mode;

  record({
    shop: site.key,
    kind: "reply",
    message: `voice ${mode} served for draft ${draft.id} (${draft.treatment})`,
    detail: { cartId: draft.cartId },
  });

  if (mode !== "conversation") {
    return xml(`<Response><Play>${audio}</Play><Hangup/></Response>`);
  }

  /**
   * `asked`, recorded once, before a word is spoken.
   *
   * The same turn the web recovery page writes, so a basket asked about by
   * phone is suppressed from being asked about again on any channel. It goes in
   * here rather than after the shopper replies because the ask is what we did,
   * not what they did — a person who hangs up on the question was still asked.
   */
  openConversation(site.key, draft);

  /**
   * Open the session HERE, where there is slack, rather than lazily on the
   * first thing the shopper says.
   *
   * The session carries what the shop knows — its own policy wording, any live
   * service notice, and what it remembers about this caller — and assembling
   * that reads the cortex and the memory store. Doing it on the first turn
   * would spend those milliseconds inside the window Twilio is counting, on the
   * one request where being late means the shopper hears silence. Doing it now
   * costs nothing: the opening audio is usually already rendered.
   *
   * `takeTurn` still creates a session if this one never happened, so a call
   * that arrives by some other path degrades to the facts-only prompt rather
   * than failing.
   */
  const callSid = formParams.CallSid ?? "";
  if (callSid) void openSession(callSid, site.key, draft);

  // Warmed here because the opening has slack and every later turn does not.
  void warmFallback(c, c.origin);

  const ask = await speak(THE_ASK, c, c.origin);
  return xml(
    `<Response><Play>${audio}</Play>` +
      reply(ask) +
      listen(`${c.origin}/voice/turn/${site.key}/${params.token}`) +
      `</Response>`,
  );
}

/**
 * A deadline on the opening too.
 *
 * The opening is the least likely to be slow — its audio is usually cached from
 * when the campaign was drafted — but "usually" is not a guarantee, and this is
 * the request where being late means the shopper answers the phone to silence
 * and a machine error instead of hearing the shop at all.
 */
async function handle(args: LoaderFunctionArgs | ActionFunctionArgs) {
  return respondWithin(
    Number(process.env.VOICE_DEADLINE_MS ?? 5500),
    inner(args),
    () => `<Say>Sorry, we could not connect this call. Please ignore it.</Say><Hangup/>`,
  );
}

/** Twilio POSTs by default; GET is accepted so the route is testable by hand. */
export const loader = handle;
export const action = handle;
