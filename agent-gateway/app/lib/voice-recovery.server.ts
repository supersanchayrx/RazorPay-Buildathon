/** Apply the web recovery policy to the first durable answer on a voice call. */
import { jsonFeedCatalog } from "./catalog.server";
import { addTurn } from "./conversations.server";
import { readFindings } from "./findings.server";
import { standing } from "./loyalty.server";
import { record } from "./ledger.server";
import { remember } from "./memory.server";
import type { Draft } from "./outreach.server";
import {
  readRecoveryCart,
  readRecoveryInputs,
} from "./recovery-context.server";
import { createRecoveryCheckout } from "./recovery-checkout.server";
import {
  canSendDiscountFollowupTemplate,
  canSendDiscountHandoff,
  sendDiscountHandoff,
  type DiscountHandoffResult,
} from "./recovery-message.server";
import { chooseRemedy, type RemedyDecision } from "./remedies.server";
import type { Reason } from "./reasons";
import { readSettings } from "./settings.server";
import type { Site } from "./sites.server";

export type VoiceRecoveryResult =
  | {
      ok: true;
      decision: RemedyDecision;
      handoff: DiscountHandoffResult | null;
      followup: "template_after_call" | "discount_link_sent" | null;
    }
  | { ok: false; error: string };

export async function resolveVoiceRecovery(
  site: Site,
  draft: Draft,
  reason: Reason,
): Promise<VoiceRecoveryResult> {
  const cart = readRecoveryCart(site.key, draft.cartId);
  if (!cart)
    return { ok: false, error: "The abandoned basket is no longer available." };
  if (cart.customer?.id && cart.customer.id !== draft.customerId) {
    return {
      ok: false,
      error: "The abandoned basket does not belong to this call.",
    };
  }

  const settings = readSettings(site.key);
  const catalog = jsonFeedCatalog(site.catalogFeedUrl);
  const notices = readFindings(site.key)?.serviceNotices ?? [];
  const decision = await chooseRemedy({
    shop: site.key,
    cartId: cart.id,
    reason,
    standing: standing({ customerId: draft.customerId }),
    basket: cart.lines.map((line) => ({
      handle: line.handle,
      title: line.title,
      sku: line.sku,
      qty: line.qty,
      unitPrice: line.unitPrice,
    })),
    policy: settings.recovery,
    inputs: readRecoveryInputs(),
    catalog,
    policies: await catalog.policies().catch(() => ({})),
    serviceNotice:
      notices.find(
        (notice) =>
          notice.about.includes("netbanking") || notice.about.includes("card"),
      )?.text ?? null,
  });

  // A grant is not announced, spent or messaged unless its remedy is durable.
  const saved = addTurn({
    shop: site.key,
    cartId: cart.id,
    customerId: draft.customerId,
    turn: {
      kind: "remedied",
      ts: new Date().toISOString(),
      remedy: decision.remedy.say,
      grantId:
        decision.remedy.kind === "discount"
          ? decision.remedy.grant.id
          : undefined,
      blocked: decision.blocked,
    },
  });
  if (!saved.ok) return { ok: false, error: saved.error };

  if (decision.remedy.kind === "closed") {
    addTurn({
      shop: site.key,
      cartId: cart.id,
      customerId: draft.customerId,
      turn: {
        kind: "closed",
        ts: new Date().toISOString(),
        why: `they said no (${reason})`,
      },
    });
  }

  let handoff: DiscountHandoffResult | null = null;
  let followup: "template_after_call" | "discount_link_sent" | null = null;
  if (decision.remedy.kind === "discount") {
    const templateReady = canSendDiscountFollowupTemplate(
      site,
      draft,
      decision.remedy.grant,
    );
    const ready = await canSendDiscountHandoff(
      site,
      draft,
      decision.remedy.grant,
    );
    if (!ready.ok) {
      handoff = ready;
      record({
        shop: site.key,
        kind: "tool_error",
        message: `recovery payment handoff stopped: ${ready.error}`,
        detail: { cartId: draft.cartId, grantId: decision.remedy.grant.id },
      });
    } else {
      const checkout = await createRecoveryCheckout({
        site,
        cart,
        customerId: draft.customerId,
        grant: decision.remedy.grant,
      });
      handoff = checkout.ok
        ? await sendDiscountHandoff(
            site,
            draft,
            decision.remedy.grant,
            checkout.path,
          )
        : { ok: false, error: checkout.error };
      if (!checkout.ok) {
        record({
          shop: site.key,
          kind: "tool_error",
          message: `recovery checkout stopped: ${checkout.error}`,
          detail: { cartId: draft.cartId, grantId: decision.remedy.grant.id },
        });
      }
    }

    // Personal memory stays historical and contains no expiring discount,
    // percentage, payment id or raw transcript. Those belong to grants,
    // pending checkouts and conversations respectively.
    if (handoff.ok) {
      followup = "discount_link_sent";
      remember({
        shop: site.key,
        sub: draft.customerId,
        kind: "context",
        text: "A price-related recovery remedy was sent after they said cost was the blocker.",
        source: "recovery",
      });
    } else if (templateReady.ok) {
      followup = "template_after_call";
    }
  }
  return { ok: true, decision, handoff, followup };
}

/** Fixed words for sharp outcomes; a model never authors the offer. */
export function voiceRemedyLine(result: VoiceRecoveryResult): string | null {
  if (!result.ok) return null;
  const remedy = result.decision.remedy;
  if (remedy.kind === "discount") {
    const percent = Math.round(remedy.grant.depth * 100);
    const approved =
      remedy.grant.tier === "regular" || remedy.grant.tier === "lapsed"
        ? `Aap hamare regular shopper hain, isliye is basket par ${percent}% off approve hua hai.`
        : `Batane ke liye thank you. Is basket par ${percent}% off approve hua hai.`;
    const followup =
      result.followup === "discount_link_sent"
        ? " Aapka discounted UPI payment link SMS par bhej diya gaya hai."
        : result.followup === "template_after_call"
          ? " Call khatam hone ke baad aapko discount confirmation SMS aayega."
          : "";
    return approved + followup;
  }
  if (remedy.kind === "closed") {
    return "Bilkul theek, batane ke liye thank you. Hum is basket ke baare mein aapko dobara contact nahi karenge.";
  }
  if (remedy.kind === "cross_sell") {
    const names = remedy.products.map((product) => product.title).join(", ");
    return names ? `${remedy.say} ${names}.` : remedy.say;
  }

  // The policy already wrote the grounded answer. Speak that exact answer
  // instead of asking the conversational model to rediscover it from a prompt
  // that deliberately contains neither the policy nor the remedy. Falling
  // through here used to turn a perfectly good delivery explanation into the
  // generic "can't help" line whenever the model timed out or refused.
  return remedy.say;
}
