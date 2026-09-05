/**
 * TwiML, in one place.
 *
 * Small on purpose. It exists because three routes and a test harness all have
 * to agree on what a listening `<Gather>` looks like, and a `<Gather>` that
 * differs between them is a bug that only appears on a phone — the kind nobody
 * finds by reading. Two of its attributes were each worth an hour:
 *
 *   `actionOnEmptyResult="true"`  without it, Twilio falls through on silence
 *                                 WITHOUT calling back, so "no callback" means
 *                                 both "they said nothing" and "the gather
 *                                 never ran". That ambiguity produced a
 *                                 confident, wrong conclusion that speech
 *                                 recognition was disabled on the account.
 *
 *   `timeout` vs `speechTimeout`  two different clocks. `timeout` is how long
 *                                 to wait for speech to BEGIN; `speechTimeout`
 *                                 is the pause after speech that ends the turn.
 *                                 Conflating them makes a call that hangs up on
 *                                 anybody who pauses to think.
 */

const escapeXml = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const xml = (body: string, status = 200) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });

/**
 * Speak a line: the shop's own voice if Sarvam rendered it, Twilio's if not.
 *
 * The fallback is audibly worse, and that is the point — a call that silently
 * drops half its replies is much harder to notice than one that suddenly
 * changes voice mid-conversation.
 */
export const reply = (u: { audioUrl: string | null; text: string }) =>
  u.audioUrl ? `<Play>${escapeXml(u.audioUrl)}</Play>` : `<Say>${escapeXml(u.text)}</Say>`;

export const hangup = (line: string) => `<Say>${escapeXml(line)}</Say><Hangup/>`;

/**
 * The listening half, identical wherever it appears.
 *
 * `input="speech dtmf"` so a keypress is always available even when the speech
 * recogniser is struggling — which matters most for the one keypress that has
 * to work: 9, to stop the calls.
 */
export const listen = (actionUrl: string) =>
  `<Gather input="speech dtmf" numDigits="1" language="en-IN" speechTimeout="auto" timeout="6" ` +
  `actionOnEmptyResult="true" action="${escapeXml(actionUrl)}" method="POST"/>`;

/**
 * Model work parked across a redirect, keyed by call.
 *
 * Lives here rather than in the route because two routes touch it — the one
 * that starts the work and the one that collects it — and module state in a
 * route module is state that reloads when that route does.
 */
export const pending = new Map<string, Promise<unknown>>();

/**
 * Collect parked work, with our own deadline.
 *
 * Deliberately longer than the model's per-request timeout: `complete` retries
 * down a chain, so a deadline equal to one attempt throws away answers that did
 * in fact arrive — measured once at 8.6 seconds of work against an 8 second
 * deadline, which paid the full latency AND delivered the fallback.
 */
export async function collect<T>(callSid: string, ms = 11_000): Promise<T | null> {
  const p = pending.get(callSid) as Promise<T> | undefined;
  if (!p) return null;
  pending.delete(callSid);
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export { escapeXml };

/**
 * Answer Twilio within a fixed budget, whatever happens upstream.
 *
 * THIS IS THE LAST LINE, AND IT EXISTS BECAUSE EVERY EARLIER ONE LEAKED.
 *
 * "We could not reach your TwiML server" was chased three times through three
 * different causes: a model chain that gave each of three models five seconds
 * and so took fifteen in total; a synthesis call with no timeout at all; and a
 * deadline that was shorter than the work it was waiting on. Each fix was
 * correct and none of them was sufficient, because they were all bounds on ONE
 * slow thing, and the caller does not care which thing was slow.
 *
 * So the budget belongs to the RESPONSE, not to any of its parts. Whatever is
 * happening upstream, Twilio gets valid TwiML in time — and if the real answer
 * missed the deadline, the fallback is spoken by Twilio's own voice rather than
 * the shop's, because that needs no synthesis and therefore cannot itself be
 * the thing that is slow.
 *
 * A fallback that depends on the subsystem it is protecting against is not a
 * fallback.
 *
 * Twilio's hard ceiling on a call-related request is 15s. Nine leaves six
 * seconds of margin for the tunnel, the network and Twilio's own parsing —
 * generous, because the cost of being a second late is a dropped call and the
 * cost of being early is one slightly worse sentence.
 */
export async function respondWithin(
  ms: number,
  work: Promise<Response>,
  fallback: () => string,
): Promise<Response> {
  const late = Symbol("late");
  const raced = await Promise.race([
    work,
    new Promise<typeof late>((r) => setTimeout(() => r(late), ms)),
  ]);
  if (raced !== late) return raced as Response;
  return xml(fallback());
}
