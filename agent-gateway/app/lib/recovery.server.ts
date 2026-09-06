/**
 * The abandoned-cart recovery agent.
 *
 * The proposer already finds the *opportunity* — "82 baskets held a kettle and
 * were never completed, worth about ₹437 a month". That is a finding, and a
 * finding is not a campaign. This module is what turns one into the other:
 * which specific baskets, which specific person, what exactly to say to them,
 * and — far more often than the industry admits — the decision not to say
 * anything at all.
 *
 * THE THREE THINGS THAT MAKE THIS DIFFERENT FROM A MARKETING AUTOMATION.
 *
 * 1. IT NEVER ASKS FOR A DISCOUNT.
 *
 *    The reflex answer to an abandoned cart is money off, and it is the wrong
 *    one: it pays people who were going to buy anyway, it teaches the rest to
 *    abandon deliberately, and — the part that matters here — it puts the
 *    system in the business of inventing offers, which is the exact thing
 *    CHAPMAN is built not to do. So there is no code path below that creates an
 *    offer. If the merchant has already approved one on a product in the
 *    basket, the message may ANNOUNCE it, on the same terms as the widget: the
 *    percentage must match an approval exactly, and the discount is applied by
 *    the server at the payment page, never by this message. If there is no
 *    approval, the shopper gets a plain reminder, and that is the intended
 *    outcome rather than a degraded one.
 *
 * 2. ITS BEST ANSWER IS OFTEN "WE BROKE IT", NOT "HERE'S 10% OFF".
 *
 *    A basket that died on the payment step during a live payment incident is
 *    not a wavering shopper. It is our failure wearing a shopper's clothes, and
 *    the correct message says so and points at a route that works. This module
 *    reads the incident detector for exactly that reason, and it is the one
 *    place where two subsystems that were built for unrelated jobs turn out to
 *    answer each other's question. Note what it still does NOT claim: we cannot
 *    tie a specific cart to a specific bank — the cart record has no payment
 *    method — so the message is hedged to the strength of the evidence ("if
 *    that was what happened"), not to the strength of the hunch.
 *
 * 3. SUPPRESSION IS COMPUTED FIRST AND SHOWN IN FULL.
 *
 *    Same discipline as `rejected` in the proposer. The interesting output of a
 *    recovery run is not the list of people to message; it is the list of
 *    people not to, with the reason attached. A campaign tool that only shows
 *    you its reach has hidden the only number that can embarrass you.
 *
 * AND ONE PROPERTY THAT IS INHERITED RATHER THAN INVENTED: every drafted
 * message goes through `checkReply`, the same bounds layer that guards the
 * storefront widget. A message that fails is not repaired and it is not sent —
 * the cart is suppressed with `blocked_by_bounds` and the merchant sees it.
 * Outreach is speech at a distance, to someone with nobody present to correct
 * it, so the bar here is the widget's bar and then some.
 *
 * WHAT THIS MODULE HOLDS THAT THE CORTEX MUST NEVER: people. Phone numbers,
 * emails, per-customer contact history. The cortex is shop knowledge and has no
 * type that can carry a person; recovery is per-(merchant, shopper) by nature.
 * Only the aggregate crosses back — see `recoverySummary`.
 */

import fs from "node:fs";
import path from "node:path";
import { checkReply } from "./bounds.server";
import { paymentFailures, type DetectorInput, type HistoryCart, type HistoryOrder, type MerchantInputs } from "./detectors.server";
import { activeOffers, type ActiveOffer } from "./approvals.server";
import { readSettings, type MerchantSettings } from "./settings.server";
import { contactHistory, type ChannelId, type Draft } from "./outreach.server";
import { askedCarts, silenced } from "./conversations.server";
import { mintRecoveryToken } from "./identity.server";
import { liveCarts } from "./carts.server";

/**
 * The recovery rate we assume, because we have never run this outreach here and
 * therefore have no rate to cite.
 *
 * Deliberately identical to the abandonment detector's assumption. Two numbers
 * for the same unknown, drifting apart in two files, is how the offers page and
 * the recovery page end up quoting different money for the same baskets — and a
 * merchant who catches that stops believing both. `check-recovery.mjs` asserts
 * they still match.
 */
export const ASSUMED_RECOVERY = 0.08;

/* ------------------------------------------------------------------ *
 * Output shapes
 * ------------------------------------------------------------------ */

export type SuppressionReason =
  | "outreach_off"
  | "recovered"
  | "already_bought"
  | "no_channel"
  | "no_consent"
  | "too_soon"
  | "too_old"
  | "already_messaged_cart"
  | "contacted_recently"
  | "frequency_cap"
  | "margin_too_thin"
  | "duplicate_customer"
  | "over_run_cap"
  | "already_asked"
  | "said_no"
  | "blocked_by_bounds";

export const SUPPRESSION_LABEL: Record<SuppressionReason, string> = {
  outreach_off: "Outreach is switched off",
  recovered: "The basket was already recovered",
  already_bought: "They bought it afterwards anyway",
  no_channel: "No phone or email on the basket",
  no_consent: "No consent basis for this message",
  too_soon: "Too recent — they may still be checking out",
  too_old: "Too old to write about",
  already_messaged_cart: "We have already written about this basket",
  contacted_recently: "Inside the cooldown",
  frequency_cap: "At their monthly limit",
  margin_too_thin: "Not enough margin at stake to be worth a message",
  duplicate_customer: "Same person, a more valuable basket was chosen",
  over_run_cap: "Beyond the cap on one run",
  already_asked: "We have already asked them about this basket",
  said_no: "They told us to stop",
  blocked_by_bounds: "The drafted message failed the bounds check",
};

export type Suppressed = {
  cartId: string;
  customerId: string;
  reason: SuppressionReason;
  /** The specific numbers, so "skipped" becomes something a merchant can argue with. */
  detail: string;
  marginAtStake: number;
};

export type Treatment =
  /** A payment we probably broke. Points at a route that works. Never carries an offer. */
  | "service"
  /** Plain reminder. No offer, no deadline, no scarcity. */
  | "reminder"
  /** A merchant-approved offer already live on something in the basket, announced. */
  | "offer";

export type RecoveryTarget = {
  cartId: string;
  customerId: string;
  to: { phone: string | null; email: string | null };
  cartAt: string;
  ageHours: number;
  lastStep: string;
  items: Array<{ handle: string; title: string; qty: number }>;
  subtotal: number;
  marginAtStake: number;
  expectedValue: number;
  treatment: Treatment;
  /** Why this treatment and not another, in the merchant's language. */
  because: string;
  incident?: { key: string; onsetAt: string };
  offer?: ActiveOffer;
  link: string;
  linkKind: "product" | "shop" | "recover";
  channel: ChannelId;
  text: string;
  facts: Array<{ label: string; value: string }>;
};

export type RecoveryRun = {
  ranAt: string;
  shop: string;
  settings: MerchantSettings;
  targets: RecoveryTarget[];
  suppressed: Suppressed[];
  suppressedBy: Array<{ reason: SuppressionReason; label: string; count: number; margin: number }>;
  totals: {
    cartsConsidered: number;
    marginAtStake: number;
    expectedValue: number;
    assumedRecovery: number;
  };
  /** Live payment incidents, which is what makes the `service` treatment possible. */
  incidents: Array<{ key: string; onsetAt: string }>;
  /** What the merchant would have to supply to make this better. */
  gaps: Array<{ what: string; who: "merchant" | "us"; unlocks: string }>;
  emptyReason?: string;
};

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

function readJsonl<T>(file: string): T[] {
  try {
    return fs
      .readFileSync(path.join(process.cwd(), "data", file), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

function readInputs(): MerchantInputs | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "merchant-inputs.json"), "utf8"),
    ) as MerchantInputs;
  } catch {
    return null;
  }
}

/** Carts carry contact details; the history types used by the detectors do not. */
type CartWithContact = HistoryCart & {
  customer?: { id: string; phone?: string | null; email?: string | null };
  subtotal?: number;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

const itemList = (items: RecoveryTarget["items"]) =>
  items.length === 1
    ? items[0].title
    : items.length === 2
      ? `${items[0].title} and ${items[1].title}`
      : `${items[0].title} and ${items.length - 1} other things`;

/**
 * `netbanking/HDFC` is how the detector groups payments. It is not how a person
 * says it, and a service message that reads like a log line tells the shopper
 * they are being written to by a script.
 */
const humanMethod = (key: string) => {
  const [method, bank] = key.split("/");
  return bank ? `${bank} ${method}` : method;
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

/**
 * Write the message.
 *
 * Templates, not a model, and that is the intended end state rather than a
 * stepping stone. There are three things to say here, each of them short, and
 * every degree of freedom handed to a generator is a degree of freedom in which
 * "your basket is waiting!" acquires an exclamation mark and a deadline. When a
 * model is eventually allowed near this, its job is to REWRITE one of these and
 * the rewrite is accepted only if it passes the same bounds check and contains
 * no number that is not in `facts` — the proposal-prose rule, applied to a
 * channel where the mistake cannot be retracted.
 *
 * Note what none of the three contain: scarcity, a deadline we invented, a
 * reason for them to feel bad, or the word "just". And note the opt-out, which
 * is on every one of them and is not conditional on the channel.
 */
/**
 * Which channels are heard rather than read.
 *
 * Not a cosmetic distinction. A message written for a screen and played down a
 * phone line is a DIFFERENT MESSAGE, and the first draft of this file proved it:
 * the service template ends in a signed recovery link, and read aloud that link
 * is two hundred characters of base64 spoken one letter at a time. The audio
 * went from 37 KB to 650 KB, most of it a robot reciting `eyJzaXRlIjoicGtf`.
 *
 * It would be easy to fix that in the voice channel by stripping URLs on the
 * way out. That is the wrong place, and the rule it breaks is the one the whole
 * outreach layer rests on: A CHANNEL IS A TRANSPORT AND NEVER AN AUTHOR. A
 * channel that edits text has an opinion about what the shop meant to say, and
 * whatever it produces was never seen by `checkReply`.
 *
 * So the composer is told the medium and writes for it, and the text that goes
 * to the bounds gate is the text that will be spoken.
 */
const SPOKEN: ReadonlySet<ChannelId> = new Set<ChannelId>(["voice"]);

function compose(
  t: Omit<RecoveryTarget, "text" | "facts">,
  shopName: string,
  channel: ChannelId,
): { text: string; facts: RecoveryTarget["facts"] } {
  const spoken = SPOKEN.has(channel);
  const facts: RecoveryTarget["facts"] = [
    { label: "basket", value: itemList(t.items) },
    { label: "abandoned", value: `${Math.round(t.ageHours)} hours ago` },
    { label: "margin at stake", value: inr(t.marginAtStake) },
  ];

  /**
   * The sign-off, and why the spoken one is a different promise.
   *
   * "Reply STOP" is meaningless on a call — there is nothing to reply to, and
   * an instruction the listener cannot follow is worse than none, because it
   * sounds like an opt-out while being a dead end.
   *
   * What replaces it is a claim, so it had better be true. It is, and by
   * construction rather than by intention: `already_messaged_cart` suppresses
   * any basket the send log has seen, `cooldownDays` is 30 and
   * `maxPerCustomerPerMonth` defaults to 1. One basket, one contact. The
   * sentence is a description of the suppression rules, which is the only kind
   * of promise this codebase makes out loud.
   *
   * NOT SUFFICIENT ON ITS OWN — see the note in `voice.server.ts`. A real voice
   * opt-out needs a keypress the caller can actually press, and that needs a
   * `<Gather>` and somewhere to record it. Until then this channel is for
   * numbers whose owner is in the room.
   */
  const stop = spoken
    ? `This is the only call you'll get about it.`
    : `Reply STOP and we won't write again.`;

  /**
   * The question, and why it is the point of the message.
   *
   * Everything a shop can measure says WHAT happened. Nothing it can measure
   * says why, because the why never touched the server. One answer — "the
   * delivery estimate was too slow for a gift" — is worth more than the basket
   * it came from, because it is actionable across the whole shop and the basket
   * is worth ₹400 once.
   *
   * So the ask is small, specific and answerable in one line. "We'd like your
   * feedback" gets nothing; "what stopped you?" with the basket on screen and
   * three buttons gets an answer.
   */
  const canAsk = t.linkKind === "recover";
  const ask = canAsk ? `we'd just like to know what stopped you, if you don't mind saying: ${t.link}` : "";

  if (t.treatment === "service" && t.incident) {
    facts.push({ label: "incident", value: t.incident.key });
    facts.push({ label: "incident began around", value: t.incident.onsetAt });
    return {
      text: spoken
        ? /**
           * The spoken service notice: the same claim, hedged the same way, with
           * the link removed rather than recited.
           *
           * What is dropped is only the URL. The hedge — "if that's what
           * happened" — survives verbatim, because the cart record carries no
           * payment method and we still cannot tie this basket to that bank.
           * The temptation on a phone call is to sound more certain than the
           * evidence, and the sentence that does that is the one nobody can
           * take back.
           */
          `Hi, this is ${shopName}. Your payment for ${itemList(t.items)} didn't go through. ` +
          `Some ${humanMethod(t.incident.key)} payments were failing then — if that's what happened, it wasn't you, ` +
          `and nothing was charged. Your basket is still saved. ` +
          stop
        : `Hi — this is ${shopName}. You got as far as paying for ${itemList(t.items)} and it didn't go through. ` +
          `Some ${humanMethod(t.incident.key)} payments were failing around then; if that's what happened, it wasn't you. ` +
          `UPI and cards are going through normally. ` +
          (canAsk
            ? `Your basket is here, and if it was something else that stopped you there's a box to tell us: ${t.link}`
            : `Here's the same thing again: ${t.link}`) +
          `\n${stop}`,
      facts,
    };
  }

  if (t.treatment === "offer" && t.offer) {
    facts.push({ label: "approved offer", value: `${Math.round(t.offer.depth * 100)}% off ${t.offer.title}` });
    facts.push({ label: "approved until", value: t.offer.endsAt.slice(0, 10) });
    return {
      text: spoken
        ? /**
           * The percentage and the end date are spoken exactly as approved.
           *
           * This is the sentence the whole no-model-in-the-audio-path rule
           * exists to protect. The figure came from a merchant clicking approve
           * on that exact number; it is not rounded for the ear, not softened,
           * and not restated. If the approval is revoked the treatment falls
           * back to `reminder` and this branch is never reached.
           */
          `Hi, this is ${shopName}. There's ${Math.round(t.offer.depth * 100)} percent off ${t.offer.title} until ${day(t.offer.endsAt)}. ` +
          `It comes off at the payment page — no code needed. ` +
          stop
        : `Hi — this is ${shopName}. You were looking at ${itemList(t.items)} the other day. ` +
          `There's ${Math.round(t.offer.depth * 100)}% off ${t.offer.title} at the moment, approved until ` +
          `${day(t.offer.endsAt)}, and it comes off at the payment page rather than needing a code: ${t.link}` +
          (canAsk ? ` If something else stopped you, that page has a box to tell us.` : "") +
          `\n${stop}`,
      facts,
    };
  }

  return {
    text: spoken
      ? /**
         * The plain reminder, spoken.
         *
         * It cannot ask why — the question needs a page with buttons and a text
         * box, and there is nothing on the other end of a spoken answer yet. So
         * it does not pretend to ask. An invitation to reply that nobody is
         * listening to is the loudest possible version of "nobody read your
         * answer", which is the exact thing `conversations.server.ts` refuses.
         */
        `Hi, this is ${shopName}. You left ${itemList(t.items)} in your basket — it's still saved on our website. ` +
        `No offer attached and nothing running out. ` +
        stop
      : `Hi — this is ${shopName}. You were looking at ${itemList(t.items)} and didn't finish checking out. ` +
        (canAsk
          ? `No offer attached and nothing running out — ${ask} It takes one line, and your basket is on that page if you want it.`
          : `No offer attached and nothing running out — it's simply still here if you'd like it: ${t.link}`) +
        `\n${stop}`,
    facts,
  };
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

export function runRecovery(opts: {
  shop: string;
  shopName: string;
  /** Origin of the merchant's storefront, for building a real link. */
  storefrontOrigin?: string;
  /** `{handle}` is substituted. Absent means every link goes to the shop front. */
  productUrlTemplate?: string;
  /**
   * Where CHAPMAN itself is reachable, and the shop's shared secret.
   *
   * Both are needed to mint a signed link to the one page that can ASK. Without
   * them the agent can still write a reminder, but it cannot ask why — which is
   * the more valuable half, so their absence is reported as a gap rather than
   * passed over.
   */
  gatewayOrigin?: string;
  siteSecret?: string;
  /**
   * A path on the MERCHANT's origin that proxies our recovery page.
   *
   * Set it and the question gets asked on their domain instead of ours. Absent
   * is a perfectly good state and means the link points here.
   */
  recoverPath?: string;
  asOf?: Date;
  channel?: ChannelId;
}): RecoveryRun {
  const asOf = opts.asOf ?? new Date();
  const settings = readSettings(opts.shop);
  /**
   * Seeded history and real baskets, in one list.
   *
   * They are deliberately NOT one file. `npm run seed` rewrites `carts.jsonl`
   * from scratch, which is what makes the fixture deterministic and what
   * `check-history` asserts against — so a live basket written there survives
   * until the next seed and then vanishes. Merging at read time gives the
   * detectors one corpus without letting either half overwrite the other.
   *
   * Live rows are `synthetic: false`, so nothing downstream has to guess which
   * kind it is holding, and a demo can be honest about which baskets are real.
   */
  const carts = [
    ...readJsonl<CartWithContact>("carts.jsonl"),
    ...(liveCarts(opts.shop) as unknown as CartWithContact[]),
  ].filter((c) => c.lines?.length);
  const orders = readJsonl<HistoryOrder>("orders.jsonl").filter((o) => o.lines?.length);
  const inputs = readInputs();
  const channel: ChannelId = opts.channel ?? (settings.outreach.channels[0] as ChannelId) ?? "draft";

  const base: RecoveryRun = {
    ranAt: asOf.toISOString(),
    shop: opts.shop,
    settings,
    targets: [],
    suppressed: [],
    suppressedBy: [],
    totals: { cartsConsidered: carts.length, marginAtStake: 0, expectedValue: 0, assumedRecovery: ASSUMED_RECOVERY },
    incidents: [],
    gaps: [],
  };

  if (!inputs) {
    return {
      ...base,
      emptyReason:
        "No unit costs on file. Without them a basket has a value but no margin, and chasing revenue " +
        "rather than margin is how a recovery campaign ends up costing more than it returns.",
    };
  }
  if (!carts.length) {
    return { ...base, emptyReason: "No abandoned baskets on record. Nothing to recover." };
  }

  /* ---- live payment incidents ------------------------------------ */
  const incidents: Array<{ key: string; onsetAt: string }> = [];
  if (orders.length >= 60) {
    const detIn: DetectorInput = { orders, carts: carts as HistoryCart[], inputs, asOf };
    for (const c of paymentFailures(detIn)) {
      const key = c.id.replace(/^payment_incident:/, "");
      const onsetAt = c.facts.find((f) => f.label === "estimated onset")?.value ?? "";
      if (onsetAt) incidents.push({ key, onsetAt });
    }
  }
  base.incidents = incidents;

  /* ---- what each basket is worth --------------------------------- */
  const costOf = (sku: string, fallback: number) => inputs.unitCost[sku] ?? fallback;

  const marginOf = (c: CartWithContact) =>
    c.lines.reduce((s, l) => {
      const unitCost = costOf(l.sku, (l as { unitCost?: number }).unitCost ?? 0);
      return s + Math.max(0, l.unitPrice - unitCost) * (l.qty || 1);
    }, 0);

  /* ---- who bought anyway ----------------------------------------- */
  const boughtAfter = new Map<string, string[]>();
  for (const o of orders) {
    if (o.status !== "placed") continue;
    const id = o.customer?.id;
    if (!id) continue;
    const list = boughtAfter.get(id) ?? [];
    for (const l of o.lines) list.push(`${o.ts}|${l.handle}`);
    boughtAfter.set(id, list);
  }

  const { lastAt, inLastMonth, cartsSent } = contactHistory(opts.shop, asOf);
  const offers = activeOffers(opts.shop, asOf);
  const alreadyAsked = askedCarts(opts.shop);
  const toldUsToStop = silenced(opts.shop);

  const suppressed: Suppressed[] = [];
  const drop = (c: CartWithContact, reason: SuppressionReason, detail: string) =>
    suppressed.push({
      cartId: c.id,
      customerId: c.customer?.id ?? "unknown",
      reason,
      detail,
      marginAtStake: marginOf(c),
    });

  /**
   * The order of these checks is the order a merchant would want them read.
   *
   * Facts about the shopper first ("they already bought it"), our own rules
   * after ("we wrote to them last week"), and our arithmetic last ("not worth
   * it"). Reversed, the report reads as a machine explaining its ceilings to
   * someone asking a question about people.
   */
  const eligible: Array<{ cart: CartWithContact; margin: number }> = [];

  for (const c of carts) {
    const margin = marginOf(c);
    const ageHours = (asOf.getTime() - Date.parse(c.ts)) / 3_600_000;

    if (c.recovered) {
      drop(c, "recovered", "the basket was completed later");
      continue;
    }
    const cust = c.customer?.id ?? null;
    const purchases = cust ? (boughtAfter.get(cust) ?? []) : [];
    const alsoBought = c.lines.find((l) => purchases.some((p) => p.endsWith(`|${l.handle}`) && p.slice(0, 24) > c.ts));
    if (alsoBought) {
      drop(c, "already_bought", `they ordered ${alsoBought.title} after abandoning this basket`);
      continue;
    }
    if (!c.customer?.phone && !c.customer?.email) {
      drop(c, "no_channel", "the basket carries no way to reach them");
      continue;
    }
    if (settings.outreach.consentBasis === "marketing") {
      drop(c, "no_consent", "set to marketing consent, and no opt-in is recorded for this shopper");
      continue;
    }
    if (ageHours < settings.outreach.cartAgeHours.min) {
      drop(c, "too_soon", `abandoned ${ageHours.toFixed(1)}h ago; the floor is ${settings.outreach.cartAgeHours.min}h`);
      continue;
    }
    if (ageHours > settings.outreach.cartAgeHours.max) {
      drop(
        c,
        "too_old",
        `abandoned ${Math.round(ageHours / 24)} days ago; the ceiling is ${Math.round(settings.outreach.cartAgeHours.max / 24)} days`,
      );
      continue;
    }
    if (cartsSent.has(c.id)) {
      drop(c, "already_messaged_cart", "a message about this exact basket has already gone out");
      continue;
    }
    if (alreadyAsked.has(c.id)) {
      drop(c, "already_asked", "1 conversation is already open or finished about this basket");
      continue;
    }
    /**
     * A refusal is about the PERSON, not the basket.
     *
     * Somebody who said they'd changed their mind about a kettle has not
     * invited a message about their tea next week. Reading the suppression
     * narrowly is a technically-correct way to be told to go away twice.
     */
    if (cust && toldUsToStop.has(cust)) {
      drop(c, "said_no", "1 earlier answer asked us to stop; that applies to them, not just to that basket");
      continue;
    }
    if (cust) {
      const last = lastAt.get(cust);
      if (last) {
        const days = (asOf.getTime() - Date.parse(last)) / 86_400_000;
        if (days < settings.outreach.cooldownDays) {
          drop(c, "contacted_recently", `written to ${days.toFixed(0)} days ago; the cooldown is ${settings.outreach.cooldownDays} days`);
          continue;
        }
      }
      if ((inLastMonth.get(cust) ?? 0) >= settings.outreach.maxPerCustomerPerMonth) {
        drop(c, "frequency_cap", `already had ${inLastMonth.get(cust)} this month; the cap is ${settings.outreach.maxPerCustomerPerMonth}`);
        continue;
      }
    }
    if (margin < settings.outreach.minMarginAtStake) {
      drop(c, "margin_too_thin", `${inr(margin)} of margin against a floor of ${inr(settings.outreach.minMarginAtStake)}`);
      continue;
    }
    eligible.push({ cart: c, margin });
  }

  /**
   * One message per person, and the basket with the most margin wins.
   *
   * Two messages about two baskets is the moment a recovery agent stops reading
   * as a shop and starts reading as a system. Deduping on margin rather than on
   * recency is deliberate: the newest basket is the one they remember, but the
   * valuable one is the one worth a message.
   */
  eligible.sort((a, b) => b.margin - a.margin);
  const chosen = new Map<string, number>();
  const deduped: typeof eligible = [];
  for (const e of eligible) {
    const cust = e.cart.customer?.id ?? e.cart.id;
    const already = chosen.get(cust);
    if (already !== undefined) {
      drop(e.cart, "duplicate_customer", `${inr(e.margin)} basket; their ${inr(already)} one was chosen instead`);
      continue;
    }
    chosen.set(cust, e.margin);
    deduped.push(e);
  }

  /* ---- treatment, link, text ------------------------------------- */
  const targets: RecoveryTarget[] = [];

  for (const { cart: c, margin } of deduped) {
    if (targets.length >= settings.outreach.maxPerRun) {
      drop(c, "over_run_cap", `${inr(margin)} basket, beyond the ${settings.outreach.maxPerRun} this run may send`);
      continue;
    }

    const ageHours = (asOf.getTime() - Date.parse(c.ts)) / 3_600_000;
    const items = c.lines.map((l) => ({ handle: l.handle, title: l.title, qty: l.qty || 1 }));

    // A basket that died on the payment step, after a payment incident began.
    // Correlation, and the copy is written to the strength of it.
    const incident = c.lastStep === "payment" ? incidents.find((i) => c.ts.slice(0, 10) >= i.onsetAt) : undefined;
    const offer = offers.find((o) => items.some((i) => i.handle === o.handle));

    const treatment: Treatment = incident ? "service" : offer ? "offer" : "reminder";
    const because = incident
      ? `Stopped on the payment step while ${humanMethod(incident.key)} payments were failing. This is a service message, not a promotion.`
      : offer
        ? `${Math.round(offer.depth * 100)}% off ${offer.title} is approved and live until ${offer.endsAt.slice(0, 10)}, so it can be mentioned.`
        : `Nothing is approved on anything in this basket, so this is a plain reminder — which is the intended outcome, not a fallback.`;

    /**
     * Where the message points.
     *
     * The recovery page first, because that is the only link that can carry a
     * question — and the question is worth more than the click-through. It
     * falls back to the product page and then to the shop front, each of which
     * is honest and progressively less useful.
     */
    const single = items.length === 1;
    const canAsk = Boolean(opts.gatewayOrigin && opts.siteSecret && c.customer?.id);

    /**
     * On the merchant's own domain when they have wired the route, on ours when
     * they have not.
     *
     * A shopper who was on nilgiripost.example and is asked why they left
     * should not be answering the question on a domain they have never heard
     * of. The merchant proxies one path — exactly the `ucp.go` pattern, fifteen
     * lines — and the link becomes theirs. The token is unchanged either way:
     * it is signed with the site secret and verified by us, so moving the URL
     * moves no trust.
     *
     * The site key stays out of the shopper-facing URL in the proxied form,
     * because the merchant's own handler already knows which shop it is.
     */
    const askBase =
      opts.recoverPath && opts.storefrontOrigin
        ? `${opts.storefrontOrigin}${opts.recoverPath}`
        : `${opts.gatewayOrigin}/recover/${opts.shop}`;

    const link = canAsk
      ? `${askBase}/${mintRecoveryToken({
          site: opts.shop,
          cart: c.id,
          sub: c.customer!.id,
          secret: opts.siteSecret!,
        })}`
      : single && opts.productUrlTemplate && opts.storefrontOrigin
        ? `${opts.storefrontOrigin}${opts.productUrlTemplate.replace("{handle}", items[0].handle)}`
        : (opts.storefrontOrigin ?? "");
    const linkKind: RecoveryTarget["linkKind"] = canAsk
      ? "recover"
      : single && opts.productUrlTemplate
        ? "product"
        : "shop";

    const draft: Omit<RecoveryTarget, "text" | "facts"> = {
      cartId: c.id,
      customerId: c.customer?.id ?? "unknown",
      to: { phone: c.customer?.phone ?? null, email: c.customer?.email ?? null },
      cartAt: c.ts,
      ageHours,
      lastStep: c.lastStep,
      items,
      subtotal: c.subtotal ?? c.lines.reduce((s, l) => s + l.lineTotal, 0),
      marginAtStake: margin,
      expectedValue: margin * ASSUMED_RECOVERY,
      treatment,
      because,
      incident,
      offer,
      link,
      linkKind,
      channel,
    };

    const { text, facts } = compose(draft, opts.shopName, channel);

    /**
     * The same gate as the storefront widget, on text we wrote ourselves.
     *
     * Checking our own templates looks like theatre until the day a template is
     * edited by someone in a hurry before a festival. The gate does not care who
     * wrote the sentence, which is the only reason it is worth anything.
     */
    const violations = checkReply(text, {
      groundedStockClaims: [],
      approvedOffers: offers.map((o) => ({
        handle: o.handle,
        title: o.title,
        percent: Math.round(o.depth * 100),
        endsAt: o.endsAt,
      })),
      asOf: asOf.toISOString().slice(0, 10),
    });
    if (violations.length) {
      drop(c, "blocked_by_bounds", violations.map((v) => `${v.gate}: “${v.matched}”`).join("; "));
      continue;
    }

    targets.push({ ...draft, text, facts });
  }

  /* ---- rollup ----------------------------------------------------- */
  const byReason = new Map<SuppressionReason, { count: number; margin: number }>();
  for (const s of suppressed) {
    const e = byReason.get(s.reason) ?? { count: 0, margin: 0 };
    e.count++;
    e.margin += s.marginAtStake;
    byReason.set(s.reason, e);
  }

  const gaps: RecoveryRun["gaps"] = [];
  if (!(opts.gatewayOrigin && opts.siteSecret))
    gaps.push({
      what: "A reachable address for CHAPMAN, so messages can carry a signed link back",
      who: "us",
      unlocks:
        "Asking why. Without it these are reminders, and a reminder recovers a basket at best — an answer " +
        "tells the shop something it can act on across every basket",
    });
  if (!opts.storefrontOrigin)
    gaps.push({
      what: "The storefront origin to link to",
      who: "us",
      unlocks: "A message that points somewhere instead of describing a basket",
    });
  gaps.push({
    what: "A cart-restore URL — one route that rebuilds a basket from its id",
    who: "merchant",
    unlocks:
      "One tap back into the exact basket. Today the link goes to the product page, which is honest but " +
      "makes them add it again.",
  });
  if (settings.outreach.consentBasis === "transactional")
    gaps.push({
      what: "A recorded marketing opt-in at checkout",
      who: "merchant",
      unlocks:
        "More than one message per basket. On a transactional basis exactly one service message is defensible, " +
        "and that is what this sends.",
    });

  return {
    ...base,
    targets,
    suppressed,
    suppressedBy: [...byReason.entries()]
      .map(([reason, v]) => ({ reason, label: SUPPRESSION_LABEL[reason], count: v.count, margin: v.margin }))
      .sort((a, b) => b.count - a.count),
    totals: {
      cartsConsidered: carts.length,
      marginAtStake: targets.reduce((s, t) => s + t.marginAtStake, 0),
      expectedValue: targets.reduce((s, t) => s + t.expectedValue, 0),
      assumedRecovery: ASSUMED_RECOVERY,
    },
    incidents,
    gaps,
    emptyReason: targets.length
      ? undefined
      : settings.outreach.enabled
        ? `All ${carts.length} baskets were suppressed. The reasons are below, and the commonest one is usually the setting to look at.`
        : "Outreach is switched off. This run is a dry run: it shows exactly what would go out, and sends nothing.",
  };
}

/** A target, in the form the outreach layer accepts. Nothing else may build one. */
export function toDraft(shop: string, t: RecoveryTarget): Draft {
  return {
    id: `rcv_${t.cartId}`,
    shop,
    cartId: t.cartId,
    customerId: t.customerId,
    to: t.to,
    channel: t.channel,
    text: t.text,
    link: t.link,
    treatment: t.treatment,
    facts: t.facts,
    marginAtStake: t.marginAtStake,
  };
}

/**
 * The only thing about recovery that may cross into the shop cortex.
 *
 * Counts and rupees. No cart id, no customer id, no phone number, nothing that
 * narrows to a person. The cortex has no type that can hold one, and this is
 * the function that keeps it that way rather than relying on whoever writes the
 * next caller to remember.
 */
export function recoverySummary(run: RecoveryRun) {
  return {
    wouldContact: run.targets.length,
    suppressed: run.suppressed.length,
    marginAtStake: Math.round(run.totals.marginAtStake),
    expectedValue: Math.round(run.totals.expectedValue),
    assumedRecovery: run.totals.assumedRecovery,
    byTreatment: {
      service: run.targets.filter((t) => t.treatment === "service").length,
      offer: run.targets.filter((t) => t.treatment === "offer").length,
      reminder: run.targets.filter((t) => t.treatment === "reminder").length,
    },
    enabled: run.settings.outreach.enabled,
  };
}
