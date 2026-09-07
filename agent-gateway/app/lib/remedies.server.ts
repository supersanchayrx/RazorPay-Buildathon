/**
 * What to do about an answer.
 *
 * A shopper told us why they didn't buy. This decides what happens next, and it
 * is a **pure function of (reason, standing, basket, policy, budget)** — not a
 * conversation, not a judgement call, and not something a model participates in.
 * The model's only contribution upstream was turning a sentence into one of
 * eleven labels, and it did that without knowing that one of those labels can
 * lead to money.
 *
 * THE FOUR RULES THAT MATTER
 *
 * 1. THE CHEAPEST TRUE ANSWER FIRST. Most reasons have a remedy that costs
 *    nothing and addresses what was actually said. Somebody who abandoned over
 *    a ₹60 delivery charge while ₹140 short of free delivery does not want 8%
 *    off; they want to be told they are ₹140 short. Discounting is the last
 *    resort in this file, not the first, and for most reasons it is not
 *    reachable at all.
 *
 * 2. NEVER DISCOUNT WHAT WASN'T THE COMPLAINT. A shopper who said delivery was
 *    too slow and receives money off the goods has been answered by a machine
 *    that did not read their message. `discountFor` is a merchant-set list, and
 *    it defaults to the one reason where money is genuinely responsive.
 *
 * 3. "I CHANGED MY MIND" ENDS THE CONVERSATION. There is no counter-offer
 *    branch below for it, deliberately. The honest response to somebody saying
 *    they don't want the thing is to thank them and go away — and to record it
 *    so nothing writes to them about that basket again. A recovery agent that
 *    treats "no" as an opening position is the reason people block businesses.
 *
 * 4. THE DEPTH IS READ, NEVER CHOSEN. It comes from the policy, is capped again
 *    by the merchant's own discount ceiling, and is refused outright if the
 *    discounted basket would fall through the margin floor. Every gate that
 *    stops a discount writes down WHY, in `blocked`, for the merchant — and
 *    none of that reaches the shopper, who is simply offered the next best
 *    thing without being told what they nearly got.
 */

import type { CatalogProduct, CatalogSource, ShopPolicies } from "./catalog.server";
import { freeShippingThreshold } from "./quote.server";
import type { MerchantInputs } from "./detectors.server";
import type { RecoveryPolicy } from "./settings.server";
import { meetsTier, type Standing } from "./loyalty.server";
import { grantFor, issue, monthlySpend, type GrantState, type RecoveryGrant } from "./grants.server";
import type { Reason } from "./reasons";

export type BasketLine = { handle: string; title: string; sku: string; qty: number; unitPrice: number };

export type Remedy =
  /** Nothing to offer, and we say so plainly rather than filling the silence. */
  | { kind: "none"; say: string }
  /** A true fact from the shop's own policies or catalogue. Costs nothing. */
  | { kind: "answer"; say: string }
  /** Cheaper things that are actually in stock. */
  | { kind: "cross_sell"; say: string; products: Array<{ handle: string; title: string; price: number }> }
  /** A merchant-approved, bounded, single-use discount on this basket. */
  | { kind: "discount"; say: string; grant: RecoveryGrant & { state: GrantState }; reissued: boolean }
  /** They said no. We stop. */
  | { kind: "closed"; say: string; suppressFurther: true };

export type RemedyDecision = {
  remedy: Remedy;
  /**
   * Why a discount was not issued, in the merchant's language.
   *
   * Merchant-only, always. A shopper told "you would have got 8% if you had
   * ordered once more" has been handed a reason to be annoyed and a strategy
   * for next time.
   */
  blocked: string[];
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/* ------------------------------------------------------------------ *
 * The free remedies
 * ------------------------------------------------------------------ */

/**
 * Cheaper things, in stock, of the same kind.
 *
 * "Of the same kind" matters. Answering "the chai is too expensive" with a
 * cheaper kettle is a non-sequitur that reads as a machine matching on price
 * alone. Same product type first, shared tags second, and if neither finds
 * anything we say nothing rather than reaching further.
 */
async function cheaperAlternatives(
  catalog: CatalogSource,
  basket: BasketLine[],
): Promise<Array<{ handle: string; title: string; price: number }>> {
  const dearest = basket.reduce((a, b) => (a.unitPrice >= b.unitPrice ? a : b));
  const all = await catalog.search({ limit: 200 }).catch(() => [] as CatalogProduct[]);
  const anchor = all.find((p) => p.handle === dearest.handle);
  if (!anchor) return [];

  const tags = new Set((anchor.tags ?? []).map((t) => t.toLowerCase()));
  const related = (p: CatalogProduct) =>
    (anchor.productType && p.productType === anchor.productType) ||
    (p.tags ?? []).some((t) => tags.has(t.toLowerCase()));

  return all
    .filter((p) => p.handle !== anchor.handle && related(p))
    .map((p) => ({
      handle: p.handle,
      title: p.title,
      price: Number(p.minPrice),
      inStock: p.variants.some((v) => v.availableForSale !== false && (v.inventoryQuantity ?? 1) > 0),
    }))
    .filter((p) => Number.isFinite(p.price) && p.price < dearest.unitPrice && p.inStock)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map(({ handle, title, price }) => ({ handle, title, price }));
}

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

export async function chooseRemedy(opts: {
  shop: string;
  cartId: string;
  reason: Reason;
  standing: Standing;
  basket: BasketLine[];
  policy: RecoveryPolicy;
  inputs: MerchantInputs | null;
  catalog: CatalogSource;
  policies: ShopPolicies;
  /** A live service notice, when the reason is a payment failure. */
  serviceNotice?: string | null;
  asOf?: Date;
}): Promise<RemedyDecision> {
  const asOf = opts.asOf ?? new Date();
  const blocked: string[] = [];
  const subtotal = opts.basket.reduce((s, l) => s + l.unitPrice * l.qty, 0);

  /* ---- 1. the answers that end the conversation ------------------- */

  if (opts.reason === "changed_mind" || opts.reason === "just_browsing") {
    /**
     * No counter-offer branch, and that absence is the feature.
     *
     * Every instinct in commerce says this is the moment to try one more thing.
     * It is the moment somebody told you plainly that they do not want it, and
     * the value of being a shop that hears that is worth more than the basket.
     */
    return {
      remedy: {
        kind: "closed",
        say:
          opts.reason === "changed_mind"
            ? "That's completely fine — thanks for telling us. We won't write to you about this one again."
            : "No problem at all — thanks for saying. We'll leave you to it.",
        suppressFurther: true,
      },
      blocked: ["they said no; nothing further is offered, by design"],
    };
  }

  /* ---- 2. the true, free answers ---------------------------------- */

  if (opts.reason === "payment_failed") {
    return {
      remedy: {
        kind: "answer",
        say:
          (opts.serviceNotice ? `${opts.serviceNotice} ` : "") +
          "Nothing was charged for an attempt that failed. Your basket is still here whenever you want it.",
      },
      blocked: ["a payment failure is our problem to fix, not one to discount"],
    };
  }

  if (opts.reason === "shipping_cost") {
    const threshold = freeShippingThreshold(opts.policies);
    const short = threshold - subtotal;
    const approvedForDiscount =
      opts.policy.enabled &&
      opts.policy.discountFor.includes("shipping_cost") &&
      meetsTier(opts.standing.tier, opts.policy.requiresTier);

    // Delivery policy remains the free, truthful default. Only an explicit
    // merchant approval plus an eligible returning/regular shopper lets this
    // reason continue into the same margin, budget and grant gates as price.
    if (!approvedForDiscount) {
      return {
        remedy: {
          kind: "answer",
          say:
            short > 0
              ? `Delivery is ${inr(60)} on this basket, and it's free over ${inr(threshold)} — you're ${inr(short)} short. ` +
                `Adding anything above that takes the delivery charge off.`
              : `That basket is over ${inr(threshold)}, so delivery on it is already free — if you were charged, tell us and we'll look.`,
        },
        blocked: ["they objected to the delivery charge, so the answer is the delivery policy"],
      };
    }
  }

  if (opts.reason === "shipping_speed" && opts.policies.shipping) {
    return {
      remedy: { kind: "answer", say: opts.policies.shipping },
      blocked: ["money does not make a parcel arrive sooner"],
    };
  }

  if (opts.reason === "payment_method" && opts.policies.cod) {
    return {
      remedy: { kind: "answer", say: opts.policies.cod },
      blocked: ["a payment method they wanted; the answer is what we take"],
    };
  }

  if (opts.reason === "out_of_stock") {
    const alts = await cheaperAlternatives(opts.catalog, opts.basket);
    return {
      remedy: alts.length
        ? { kind: "cross_sell", say: "That one's not available in what you wanted. These are in stock now:", products: alts }
        : { kind: "none", say: "That's not available right now, and we'd rather say so than guess at a date." },
      blocked: ["nothing was in stock to discount"],
    };
  }

  if (opts.reason === "checkout_friction" || opts.reason === "trust") {
    /**
     * Neither is a price problem, and discounting either is worse than doing
     * nothing: money offered to somebody who said they weren't sure the shop
     * was real reads as exactly the thing they were worried about.
     */
    return {
      remedy: {
        kind: "none",
        say:
          opts.reason === "trust"
            ? "That's fair, and thank you for saying it — we've passed it on to the shop."
            : "Sorry it got in the way. We've passed that on to the shop so someone can look at it.",
      },
      blocked: [
        opts.reason === "trust"
          ? "money offered to someone who doubted the shop confirms the doubt"
          : "a broken checkout is a bug to fix, not a discount to give",
      ],
    };
  }

  if (opts.reason === "unknown") {
    return {
      remedy: { kind: "none", say: "Thanks for telling us — that's genuinely useful." },
      blocked: ["the answer was not clear enough to act on, and a guess is worse than nothing"],
    };
  }

  /* ---- 3. merchant-approved cost objections can reach money ------- */

  // Whatever happens below, an existing grant is returned unchanged. This is
  // checked FIRST so that no gate below can produce a different answer on a
  // second pass — a shopper pushing back gets the same grant, not a better one.
  const existing = grantFor(opts.shop, opts.cartId);
  if (existing) {
    return {
      remedy:
        existing.state === "live"
          ? {
              kind: "discount",
              say: sayGrant(existing),
              grant: existing,
              reissued: true,
            }
          : {
              kind: "none",
              say:
                existing.state === "expired"
                  ? "The discount we sent you has expired, I'm afraid — I can't issue another one."
                  : "That discount has already been used on an order.",
            },
      blocked: [`a grant already exists for this basket (${existing.state}); it is never improved on a second ask`],
    };
  }

  const dearest = opts.basket.reduce((a, b) => (a.unitPrice >= b.unitPrice ? a : b));
  const alternatives = await cheaperAlternatives(opts.catalog, opts.basket);
  const fallback = (): RemedyDecision => ({
    remedy: alternatives.length
      ? {
          kind: "cross_sell",
          say: "I can't move on the price of that one, but these are in stock and cost less:",
          products: alternatives,
        }
      : {
          kind: "none",
          say: "I can't change the price, I'm afraid — the shop sets those. Thanks for telling us, though; it does get read.",
        },
    blocked,
  });

  if (!opts.policy.enabled) {
    blocked.push("the merchant has not switched recovery discounts on");
    return fallback();
  }
  if (!opts.policy.discountFor.includes(opts.reason)) {
    blocked.push(`“${opts.reason}” is not on the list of answers a discount may respond to`);
    return fallback();
  }
  if (!meetsTier(opts.standing.tier, opts.policy.requiresTier)) {
    blocked.push(
      `standing is ${opts.standing.tier} (${opts.standing.orders} orders); the policy requires ${opts.policy.requiresTier}`,
    );
    return fallback();
  }
  if (!opts.inputs) {
    blocked.push("no unit costs on file, so the margin floor cannot be checked — and an unchecked discount is not issued");
    return fallback();
  }
  if (opts.inputs.floors.neverDiscount.includes(dearest.handle)) {
    blocked.push(`${dearest.title} is on the never-discount list`);
    return fallback();
  }

  // The depth is the smaller of what the recovery policy allows and what the
  // merchant's own discount ceiling allows. Two independent limits, and the
  // tighter one wins — a recovery policy cannot be used to walk around a floor
  // set for the offer proposer.
  const depthPct = Math.min(opts.policy.maxDepthPct, opts.inputs.floors.maxDiscountPct);
  const depth = depthPct / 100;

  const cost = opts.inputs.unitCost[dearest.sku] ?? 0;
  if (cost <= 0) {
    blocked.push(`no unit cost for ${dearest.sku}, so the margin after discount is unknown`);
    return fallback();
  }
  const discountedPrice = dearest.unitPrice * (1 - depth);
  const marginPct = ((discountedPrice - cost) / discountedPrice) * 100;
  if (marginPct < opts.inputs.floors.minMarginPct) {
    blocked.push(
      `${depthPct}% off ${dearest.title} leaves ${marginPct.toFixed(1)}% margin, under your ${opts.inputs.floors.minMarginPct}% floor`,
    );
    return fallback();
  }

  const qtyCap = opts.basket.filter((l) => l.handle === dearest.handle).reduce((s, l) => s + l.qty, 0);
  const marginCost = (dearest.unitPrice - discountedPrice) * qtyCap;

  const spent = monthlySpend(opts.shop, asOf);
  if (spent.count >= opts.policy.monthlyGrantCap) {
    blocked.push(`${spent.count} grants already issued this month; the cap is ${opts.policy.monthlyGrantCap}`);
    return fallback();
  }
  if (spent.margin + marginCost > opts.policy.monthlyMarginCap) {
    blocked.push(
      `${inr(spent.margin)} of margin already given this month; this would add ${inr(marginCost)} against a ${inr(opts.policy.monthlyMarginCap)} cap`,
    );
    return fallback();
  }

  const { grant, created } = issue({
    shop: opts.shop,
    cartId: opts.cartId,
    customerId: opts.standing.customerId,
    handle: dearest.handle,
    title: dearest.title,
    depth,
    qtyCap,
    marginCost,
    reason: opts.reason,
    tier: opts.standing.tier,
    expiresAt: new Date(asOf.getTime() + opts.policy.grantTtlHours * 3_600_000).toISOString(),
    under: { maxDepthPct: opts.policy.maxDepthPct, requiresTier: opts.policy.requiresTier },
  });

  return { remedy: { kind: "discount", say: sayGrant(grant), grant, reissued: !created }, blocked };
}

/**
 * What the shopper is told.
 *
 * Three things it does not say: how much margin this costs, what standing they
 * have, and that a bigger one exists anywhere. It also does not say "just for
 * you" or "as a one-off" — both are the language of a negotiation, and this is
 * not one.
 */
function sayGrant(g: RecoveryGrant & { state: GrantState }): string {
  const hours = Math.max(1, Math.round((Date.parse(g.expiresAt) - Date.now()) / 3_600_000));
  return (
    `Thanks for telling us. There's ${Math.round(g.depth * 100)}% off ${g.title} on this basket — ` +
    `up to ${g.qtyCap} ${g.qtyCap === 1 ? "unit" : "units"}, and it's held for you for about ${hours} hours. ` +
    `It comes off at the payment page; there's no code to enter.`
  );
}
