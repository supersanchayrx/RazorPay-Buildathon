import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { findSite } from "../lib/sites.server";
import { verifyVoiceToken } from "../lib/identity.server";
import { draftById } from "../lib/outreach.server";
import { config } from "../lib/voice.server";
import { fallbackAudio, noteFallbackSpoken, optOut, takeSilence, takeTurn, speak, SAFE_LINE } from "../lib/voicetalk.server";
import { hangup, listen, pending, reply, xml , respondWithin } from "../lib/twiml.server";
import { record } from "../lib/ledger.server";

const DEADLINE_MS = Number(process.env.VOICE_DEADLINE_MS ?? 5500);

const LATE_LISTEN = (params: { site?: string; token?: string }) =>
  listen(`${config()?.origin ?? ""}/voice/turn/${params.site}/${params.token}`);

/**
 * One exchange: what the shopper said, and what the shop says back.
 *
 * TWILIO MUST NEVER WAIT ON THE MODEL, and this route is shaped entirely around
 * that. Measured on live calls, a turn runs about five seconds — model plus
 * synthesis — and every one of those seconds is silence on a phone line that a
 * person reads as a dropped call, not as thinking. Twilio's own ceiling is a
 * hard fifteen seconds that cannot be raised.
 *
 * But the obvious fix, answering instantly with a filler and a `<Redirect>`,
 * has its own ceiling: Twilio counts every TwiML document a call fetches
 * against a per-call budget — ten on a trial account — so a filler doubles the
 * cost of every turn and the conversation dies at the fifth with a machine
 * reading out an error. Both constraints are real and they pull opposite ways.
 *
 * So the wait is adaptive:
 *
 *   answer lands inside the window   ->  speak it here. One hop, no filler.
 *   answer is slow                   ->  "one moment" plus a redirect. Two hops.
 *
 * The common case pays neither cost, and the rare case pays the one that is
 * survivable.
 */

async function inner({ request, params }: LoaderFunctionArgs | ActionFunctionArgs) {
  const site = findSite(params.site ?? null);
  const c = config();
  if (!site || !c) return xml(hangup("Sorry, this call cannot continue."));

  const v = verifyVoiceToken(params.token, { site: site.key, secret: site.secret });
  if (!v.ok) {
    record({ shop: site.key, kind: "tool_error", message: `voice turn: token ${v.reason}` });
    return xml(hangup("Sorry, this call has expired."));
  }

  const draft = draftById(site.key, v.claim.draft);
  if (!draft) return xml(hangup("Sorry, this call cannot continue."));

  const form = request.method === "POST" ? await request.formData() : new FormData();
  const callSid = String(form.get("CallSid") ?? "unknown");
  const said = String(form.get("SpeechResult") ?? "").trim();
  const digit = String(form.get("Digits") ?? "");
  const turnUrl = `${c.origin}/voice/turn/${site.key}/${params.token}`;

  /* ---- press 9 ---------------------------------------------------- */

  /**
   * Checked before anything else, and it is the only branch that cannot be
   * reached by saying something.
   *
   * A person who wants the call to stop should not have to phrase it well, get
   * past a speech recogniser, or be understood by a model. A keypress is the
   * one input on this channel that cannot be misheard.
   */
  if (digit === "9") {
    const out = optOut(site.key, callSid, draft);
    return xml(reply(await speak(out.line, c, c.origin)) + "<Hangup/>");
  }

  if (digit) {
    const line = "Sorry, I didn't catch that. Just say it, or press 9 if you'd rather we stopped calling.";
    return xml(reply(await speak(line, c, c.origin)) + listen(turnUrl));
  }

  /* ---- silence ---------------------------------------------------- */

  if (!said) {
    const out = takeSilence(callSid, site.key, draft);
    const utt = await speak(out.line, c, c.origin);
    return xml(out.kind === "hangup" ? reply(utt) + "<Hangup/>" : reply(utt) + listen(turnUrl));
  }

  /* ---- the exchange ----------------------------------------------- */

  const work = takeTurn({ callSid, said, shop: site.key, draft, c, origin: c.origin });

  /**
   * The window, sized from measurement rather than taste.
   *
   * llm 2.4–3.7s plus tts 2.4–2.7s puts a normal turn near five seconds. Seven
   * covers that with headroom and leaves eight seconds of Twilio's fifteen
   * unspent. It is deliberately LARGER than the model's own per-request
   * timeout, because `complete` walks a chain of models and retries: setting
   * them equal is how a fallback model's answer arrives one moment after
   * anything was still waiting for it.
   */
  const quick = await Promise.race([
    work,
    new Promise<null>((r) => setTimeout(() => r(null), Number(process.env.VOICE_INLINE_MS ?? 5200))),
  ]);

  if (quick) {
    const utt = await speak(quick.line, c, c.origin);
    if (quick.kind === "hangup") return xml(reply(utt) + "<Hangup/>");
    return xml(
      reply(utt) +
        (quick.last
          ? `<Say>Thanks for your time.</Say><Hangup/>`
          : listen(turnUrl)),
    );
  }

  // Slow path. Park the work and let the filler cover it.
  pending.set(callSid, work);
  /**
   * A fixed noise that promises nothing.
   *
   * Not "let me check that for you", which implies a lookup that is not
   * happening, and not "sure!", which implies agreement to a question no
   * model has read yet. It means "still here", which is all it is for.
   */
  const filler = await speak("One moment.", c, c.origin);
  return xml(reply(filler) + `<Redirect method="POST">${c.origin}/voice/reply/${site.key}/${params.token}</Redirect>`);
}

/** Twilio POSTs; GET is accepted so the route can be exercised by hand. */
/**
 * The deadline wrapper, and the fallback keeps the call alive.
 *
 * Late means the model or Sarvam is struggling, which is our problem and not
 * the shopper's — so the caller hears one plain sentence in Twilio's own voice
 * and is still listened to. Hanging up on our own slowness cuts off somebody
 * who was mid-thought.
 */
async function handle(args: LoaderFunctionArgs | ActionFunctionArgs) {
  const t0 = Date.now();
  const res = await respondWithin(
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
  // eslint-disable-next-line no-console
  console.log(`[voice.turn] answered in ${Date.now() - t0}ms`);
  return res;
}

export const loader = handle;
export const action = handle;

/*
 * There was an `export { SAFE_LINE }` here and it broke `npm run build`.
 *
 * React Router strips server code from a route by removing `loader`, `action`,
 * `middleware` and `headers`. ANY OTHER export keeps the whole module graph
 * alive in the client bundle — so one re-export dragged `voicetalk.server`, and
 * with it Twilio, Sarvam and the model chain, towards the browser. Dev mode
 * does not care, which is why it survived a commit.
 *
 * Nothing imported it from here: `check-voice.mjs` takes `SAFE_LINE` from
 * `voicetalk.server` directly, which is where it lives. Third occurrence of
 * this exact class after `features.ts` and `reasons.ts`, and the first on a
 * route rather than a module — the rule is the same either way. A route
 * exports loader and action, and nothing else.
 */
