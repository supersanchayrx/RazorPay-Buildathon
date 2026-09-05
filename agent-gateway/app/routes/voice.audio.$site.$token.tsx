import type { LoaderFunctionArgs } from "react-router";
import fs from "node:fs";
import { findSite } from "../lib/sites.server";
import { verifyVoiceToken } from "../lib/identity.server";
import { draftById } from "../lib/outreach.server";
import { config, render } from "../lib/voice.server";
import { record } from "../lib/ledger.server";

/**
 * The audio itself: one draft, spoken by Sarvam, streamed to Twilio.
 *
 * THIS ROUTE HAS NO SIGNATURE TO CHECK, AND THAT IS WORTH SAYING OUT LOUD.
 * Twilio signs the webhooks it POSTs to you; it does not sign the bare GET it
 * sends to fetch a `<Play>` URL. So the only thing standing in front of this
 * endpoint is the `a1.` token — HMAC-SHA256, bound to one site, naming one
 * draft, valid for fifteen minutes.
 *
 * That is a deliberate, bounded exposure rather than an oversight, and the
 * bound is what makes it acceptable: whoever holds a live token can hear one
 * sentence the shop already decided to say to one person. They cannot make it
 * say anything else, cannot learn whose basket it is (the token names a draft,
 * not a cart or a customer), and cannot use it fifteen minutes from now.
 *
 * The cache is the second reason the exposure is small: a replayed token
 * re-serves a file that already exists and spends nothing.
 */

export async function loader({ params }: LoaderFunctionArgs) {
  const site = findSite(params.site ?? null);
  const c = config();
  if (!site || !c) return new Response("not found", { status: 404 });

  const v = verifyVoiceToken(params.token, { site: site.key, secret: site.secret });
  if (!v.ok) {
    record({ shop: site.key, kind: "tool_error", message: `voice audio: token ${v.reason}` });
    // 404 rather than 403: a caller who cannot present a valid token should not
    // learn that a valid token would have found something here.
    return new Response("not found", { status: 404 });
  }

  const draft = draftById(site.key, v.claim.draft);
  if (!draft) return new Response("not found", { status: 404 });

  const out = await render(draft.text, c);
  if (!out.ok) {
    record({ shop: site.key, kind: "tool_error", message: `voice audio: ${out.error}` });
    // 502, not 200-with-silence. Twilio logs a fetch failure we can find later;
    // silence on the line is indistinguishable from a working call nobody heard.
    return new Response("could not render audio", { status: 502 });
  }

  if (!out.cached) {
    record({
      shop: site.key,
      kind: "reply",
      message: `voice audio rendered for draft ${draft.id}: ${out.bytes} bytes, ${c.voice}/${c.language}`,
      detail: { cartId: draft.cartId },
    });
  }

  const body = fs.readFileSync(out.file);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(body.length),
      /**
       * Never cached by anything in between. The URL is short-lived on purpose,
       * and an intermediary holding a copy of somebody's recovery message after
       * the token expires quietly undoes the expiry.
       */
      "Cache-Control": "no-store, private",
    },
  });
}
