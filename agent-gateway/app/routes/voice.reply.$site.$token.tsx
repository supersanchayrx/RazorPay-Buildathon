import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { findSite } from "../lib/sites.server";
import { verifyVoiceToken } from "../lib/identity.server";
import { draftById } from "../lib/outreach.server";
import { config } from "../lib/voice.server";
import { fallbackAudio, noteFallbackSpoken, speak, SAFE_LINE, type TurnOutcome } from "../lib/voicetalk.server";
import { collect, hangup, listen, reply, xml , respondWithin } from "../lib/twiml.server";
import { record } from "../lib/ledger.server";

const DEADLINE_MS = Number(process.env.VOICE_DEADLINE_MS ?? 5500);

const LATE_LISTEN = (params: { site?: string; token?: string }) =>
  listen(`${config()?.origin ?? ""}/voice/turn/${params.site}/${params.token}`);

/**
 * Where the slow path lands: the answer the previous request parked.
 *
 * Only reached when a turn ran long enough that Twilio was given a filler and a
 * `<Redirect>` instead of an answer. By the time it arrives the filler has
 * played, so the model has had that long for free and the caller has already
 * heard a voice.
 *
 * Two hops were spent to get here, out of the ten a call is allowed, which is
 * why the fast path in `voice.turn` exists at all.
 */

async function inner({ request, params }: LoaderFunctionArgs | ActionFunctionArgs) {
  const site = findSite(params.site ?? null);
  const c = config();
  if (!site || !c) return xml(hangup("Sorry, this call cannot continue."));

  const v = verifyVoiceToken(params.token, { site: site.key, secret: site.secret });
  if (!v.ok) return xml(hangup("Sorry, this call has expired."));

  const draft = draftById(site.key, v.claim.draft);
  if (!draft) return xml(hangup("Sorry, this call cannot continue."));

  const form = request.method === "POST" ? await request.formData() : new FormData();
  const callSid = String(form.get("CallSid") ?? "unknown");
  const turnUrl = `${c.origin}/voice/turn/${site.key}/${params.token}`;

  const out = await collect<TurnOutcome>(callSid);

  if (!out) {
    /**
     * Nothing arrived in time. Say the safe line and KEEP LISTENING.
     *
     * A slow model is our problem, not theirs. Hanging up on it means a shopper
     * who was mid-thought is cut off by our own infrastructure, which is a
     * worse ending than an unhelpful sentence. The turn cap still bounds the
     * call, so this cannot loop forever.
     */
    record({ shop: site.key, kind: "tool_error", message: `voice reply: nothing ready for ${callSid}`, detail: { cartId: draft.cartId } });
    return xml(reply(await speak(SAFE_LINE, c, c.origin)) + listen(turnUrl));
  }

  const utt = out.audioUrl ? { audioUrl: out.audioUrl, text: out.line } : await speak(out.line, c, c.origin);
  if (out.kind === "hangup") return xml(reply(utt) + "<Hangup/>");
  return xml(reply(utt) + (out.last ? `<Say>Thanks for your time.</Say><Hangup/>` : listen(turnUrl)));
}

/**
 * The deadline wrapper, and the fallback keeps the call alive.
 *
 * Late means the model or Sarvam is struggling, which is our problem and not
 * the shopper's — so the caller hears one plain sentence in Twilio's own voice
 * and is still listened to. Hanging up on our own slowness cuts off somebody
 * who was mid-thought.
 */
async function handle(args: LoaderFunctionArgs | ActionFunctionArgs) {
  return respondWithin(
    DEADLINE_MS,
    inner(args),
    () => {
      /**
       * Record that THIS is what was heard, not the reply being composed.
       *
       * The basket is resolved from the token rather than the form, because the
       * request body has already been consumed by the handler that is still
       * running. The call id is not available here for the same reason, and is
       * recorded as unknown rather than guessed — a transcript that invents an
       * identifier is a transcript nobody can join on.
       */
      const site = findSite(args.params.site ?? null);
      const v = site ? verifyVoiceToken(args.params.token, { site: site.key, secret: site.secret }) : null;
      const d = site && v?.ok ? draftById(site.key, v.claim.draft) : null;
      if (site) noteFallbackSpoken(site.key, d?.cartId ?? "unknown", "unknown");
      const warm = fallbackAudio();
      return (warm ? `<Play>${warm}</Play>` : `<Say>${SAFE_LINE}</Say>`) + LATE_LISTEN(args.params);
    },
  );
}

export const loader = handle;
export const action = handle;
