import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { conversation } from "../lib/conversations.server";
import { findGrant } from "../lib/grants.server";
import { verifyVoiceToken } from "../lib/identity.server";
import { record } from "../lib/ledger.server";
import { draftById, readSends } from "../lib/outreach.server";
import { sendDiscountFollowupTemplate } from "../lib/recovery-message.server";
import { findSite } from "../lib/sites.server";
import { config, verifyTwilioSignature } from "../lib/voice.server";
import { callTranscript } from "../lib/voicetalk.server";

const empty = (status = 204) => new Response(null, { status });

/**
 * Twilio calls this only after the outbound call reaches a terminal state.
 * A completed call gets one fixed follow-up SMS iff the durable conversation
 * contains a grant and that exact call's transcript proves the offer was said.
 */
async function handle({ request, params }: LoaderFunctionArgs | ActionFunctionArgs) {
  const site = findSite(params.site ?? null);
  const c = config();
  if (!site || !c) return empty(404);

  const verified = verifyVoiceToken(params.token, {
    site: site.key,
    secret: site.secret,
  });
  if (!verified.ok) return empty(403);

  const draft = draftById(site.key, verified.claim.draft);
  if (!draft) return empty(404);

  const form =
    request.method === "POST" ? await request.formData() : new FormData();
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) values[key] = String(value);

  const url = new URL(request.url);
  const signedUrl = `${c.origin}${url.pathname}${url.search}`;
  const signature = request.headers.get("X-Twilio-Signature");
  const strict = process.env.VOICE_REQUIRE_TWILIO_SIGNATURE === "1";
  if (
    (signature || strict) &&
    !verifyTwilioSignature({
      signature,
      url: signedUrl,
      params: values,
      authToken: c.twilioToken,
    })
  ) {
    return empty(403);
  }
  if (values.AccountSid && values.AccountSid !== c.twilioSid) return empty(403);

  const callSid = values.CallSid ?? "";
  if (values.CallStatus !== "completed" || !callSid) return empty();

  // Bind the provider callback to the call Chapman actually placed. The token
  // alone names a draft; it does not prove a call was made from that draft.
  const placed = readSends(site.key).some(
    (send) =>
      send.ok &&
      send.channel === "voice" &&
      send.draftId === draft.id &&
      send.ref === callSid,
  );
  if (!placed) return empty(403);

  const conv = conversation(site.key, draft.cartId);
  const grant = conv?.grantId ? findGrant(site.key, conv.grantId) : null;
  if (!grant) return empty();

  const percent = Math.round(grant.depth * 100);
  const offered = callTranscript(site.key, callSid).some(
    (line) =>
      line.who === "shop" &&
      line.source === "fixed" &&
      line.text.includes(`${percent}% off approve`),
  );
  if (!offered) return empty();

  const sent = await sendDiscountFollowupTemplate(site, draft, grant);
  if (!sent.ok) {
    record({
      shop: site.key,
      kind: "tool_error",
      message: `voice status follow-up stopped: ${sent.error}`,
      detail: { callSid, cartId: draft.cartId, grantId: grant.id },
    });
  }
  return empty();
}

export const loader = handle;
export const action = handle;
