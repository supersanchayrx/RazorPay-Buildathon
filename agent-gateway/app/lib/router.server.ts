/**
 * Intent routing — route first, reason second.
 *
 * The largest efficiency lever in a storefront assistant is not which model you
 * pick, it is how often you invoke one. A large share of shopper messages are
 * deterministic: a price filter, a stock check, a policy question, "do you have
 * X". Those need retrieval, not reasoning.
 *
 * This module turns a message into structured arguments. Two consumers:
 *
 *   - the deterministic path answers directly from the catalogue, no model
 *   - the reasoning path uses the same extraction as a pre-fetch, so the model
 *     arrives with products already in hand instead of spending a round trip
 *     asking for them
 *
 * It is pattern matching, and it is meant to be. Anything it is unsure about
 * becomes `open` and goes to the reasoner. A router that guesses is worse than
 * one that abstains.
 */
import type { SearchArgs } from "./catalog.server";

export type RouteKind =
  | "policy_returns"
  | "policy_shipping"
  | "policy_cod"
  | "discount_request"
  | "payment_trouble"
  | "order_status"
  | "order_history"
  | "catalog_query"
  | "open";

export type Route = {
  kind: RouteKind;
  /** Structured search arguments extracted from the message. */
  search: SearchArgs;
  /** Why this route was chosen — goes in the ledger, so routing is auditable. */
  because: string;
};

const CUR = String.raw`(?:rs\.?|inr|₹|\$)?\s*`;
const NUM = String.raw`(\d[\d,]*)`;

const CEIL_WORDS = String.raw`under|below|less than|cheaper than|upto|up to|max|maximum|within`;
const FLOOR_WORDS = String.raw`above|over|more than|at least|starting from|starting at|min|minimum`;
const SORT_WORDS = String.raw`cheapest|lowest|least expensive|most expensive|priciest`;
const STOCK_WORDS = String.raw`in stock|available|ready to ship|do you have|got any|show me|tell me about`;

const RE_BAND = new RegExp(
  String.raw`(?:between\s*)?` + CUR + NUM + String.raw`\s*(?:-|–|to|and)\s*` + CUR + NUM,
  "i",
);
const RE_CEIL = new RegExp(String.raw`(?:` + CEIL_WORDS + String.raw`)\s*` + CUR + NUM, "i");
const RE_FLOOR = new RegExp(String.raw`(?:` + FLOOR_WORDS + String.raw`)\s*` + CUR + NUM, "i");

const num = (s: string) => Number(s.replace(/,/g, ""));

/** "between 3000 and 5000", "3000-5000", "₹3000 to ₹5000" */
function band(m: string): [number, number] | null {
  const hit = m.match(RE_BAND);
  if (!hit) return null;
  const a = num(hit[1]);
  const b = num(hit[2]);
  return a <= b ? [a, b] : [b, a];
}

/**
 * Remove the phrasing the router has already turned into structured arguments.
 *
 * Leaving it in is a silent killer: "things above 1000" extracts priceMin=1000
 * and then keyword-searches for "1000", matches nothing, and tells the shopper
 * the store has no products over a thousand rupees when it has two. Extracting
 * a value and also searching for it is double-counting.
 */
function cleanQuery(m: string): string {
  return m
    .replace(new RegExp(RE_BAND.source, "gi"), " ")
    .replace(new RegExp(RE_CEIL.source, "gi"), " ")
    .replace(new RegExp(RE_FLOOR.source, "gi"), " ")
    .replace(new RegExp(String.raw`\b(?:` + SORT_WORDS + String.raw`)\b`, "gi"), " ")
    .replace(new RegExp(String.raw`\b(?:` + STOCK_WORDS + String.raw`)\b`, "gi"), " ")
    .replace(/(?:rs\.?|inr|₹|\$)\s*\d[\d,]*/gi, " ")
    .replace(/\b\d[\d,]*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function route(message: string): Route {
  const m = message.trim();

  // Policy questions are answered verbatim from the merchant's own text. Never
  // paraphrase a policy — a reworded return window is a new promise.
  //
  // Order matters, most specific first: "cash on delivery" contains "delivery",
  // so a shipping rule tested earlier swallows every COD question. That bug was
  // live until a test asked about COD and got the shipping policy back.
  // Personal questions come first, before the policy rules, because "where is
  // my order" contains "order" and — fatally — "my order shipped yet" contains
  // "ship". Left later in the chain, every order question would be answered
  // with the generic shipping policy, which is both wrong and the kind of wrong
  // that looks fine in a demo.
  //
  // Routing here does NOT mean the question gets answered. It means the request
  // is recognised as personal, so the assistant knows to check for a verified
  // identity rather than guessing from the catalogue.
  if (/\b(?:where(?:'s| is)?|track|status of|what happened to)\b[^?]{0,24}\b(?:my|the)\s+(?:order|parcel|package|delivery|shipment)\b/i.test(m) ||
      /\bmy\s+order\b.*\b(?:status|arrived|shipped|dispatched|coming|yet)\b/i.test(m) ||
      /\b(?:order|tracking)\s+(?:number|id)\b/i.test(m)) {
    return { kind: "order_status", search: {}, because: "asked about their own order" };
  }
  if (/\b(?:my|last|previous|past|earlier)\s+(?:orders?|purchases?|buys?)\b/i.test(m) ||
      /\bwhat\s+(?:did|have)\s+i\s+(?:buy|bought|order|ordered)\b/i.test(m) ||
      /\b(?:re-?order|buy\s+again|same\s+as\s+last\s+time)\b/i.test(m)) {
    return { kind: "order_history", search: {}, because: "asked about their own purchase history" };
  }

  if (/\b(cod|cash on delivery|pay on delivery)\b/i.test(m)) {
    return { kind: "policy_cod", search: {}, because: "asked about COD" };
  }
  if (/\b(return|refund|exchange|send it back)\b/i.test(m)) {
    return { kind: "policy_returns", search: {}, because: "asked about returns" };
  }

  /**
   * A payment that did not go through.
   *
   * Routed deterministically, and placed after COD so that "pay on delivery"
   * cannot be mistaken for a failure. This exists because of what the storefront
   * assistant did when the shop had a live netbanking outage and the notice
   * about it was sitting in the FACTS block: it deflected to "our support team
   * handles payment troubleshooting" and never mentioned it.
   *
   * That is the whole argument for routing. A notice that a small model may or
   * may not choose to relay is not a notice. The shopper in front of you is the
   * one person it was written for, and whether they hear it should not depend
   * on which free model was up this morning.
   */
  if (
    /\b(?:payment|card|upi|netbanking|net banking|transaction|checkout)\b[^?]{0,48}\b(?:fail|failed|failing|declin\w*|bounced|error|not (?:work|go)\w*|didn'?t (?:work|go)\w*|won'?t go)\b/i.test(m) ||
    /\b(?:fail\w*|declin\w*|error|problem|trouble|issue)\b[^?]{0,48}\b(?:payment|paying|card|upi|netbanking|net banking|transaction|checkout)\b/i.test(m) ||
    /\b(?:can'?t|cannot|unable to)\s+(?:pay|check\s?out|complete\s+(?:my\s+)?(?:order|payment))\b/i.test(m)
  ) {
    return { kind: "payment_trouble", search: {}, because: "reported a payment that did not go through" };
  }
  if (/\b(ship|shipping|deliver|delivery|dispatch|how long|when will)\b/i.test(m)) {
    return { kind: "policy_shipping", search: {}, because: "asked about shipping" };
  }

  const priceBand = band(m);
  const ceil = m.match(RE_CEIL);
  const flr = m.match(RE_FLOOR);
  const priceMax = priceBand ? priceBand[1] : ceil ? num(ceil[1]) : null;
  const priceMin = priceBand ? priceBand[0] : flr ? num(flr[1]) : null;
  const hasPrice = priceMin !== null || priceMax !== null;

  // A discount request is only a discount request when no budget is stated.
  // "anything cheaper than 700" is a filter; "can I get it cheaper" is a haggle.
  if (/\b(discount|coupon|promo|offer|deal|bargain|negotiate)\b/i.test(m) && !hasPrice) {
    return { kind: "discount_request", search: {}, because: "asked for a discount" };
  }

  const inStockOnly = /\b(in stock|available|do you have|got any|ready to ship)\b/i.test(m);
  const sort: SearchArgs["sort"] = /\b(cheapest|lowest|least expensive)\b/i.test(m)
    ? "price_asc"
    : /\b(most expensive|priciest)\b/i.test(m)
      ? "price_desc"
      : "relevance";

  const cleaned = cleanQuery(m);

  const search: SearchArgs = {
    query: cleaned || undefined,
    ...(priceMin !== null ? { priceMin } : {}),
    ...(priceMax !== null ? { priceMax } : {}),
    ...(inStockOnly ? { inStockOnly: true } : {}),
    ...(sort !== "relevance" ? { sort } : {}),
    limit: 10,
  };

  if (hasPrice || inStockOnly || sort !== "relevance") {
    const parts = [
      priceMin !== null ? `min ${priceMin}` : null,
      priceMax !== null ? `max ${priceMax}` : null,
      inStockOnly ? "in stock" : null,
      sort !== "relevance" ? sort : null,
    ].filter(Boolean);
    return { kind: "catalog_query", search, because: `structured filter: ${parts.join(", ")}` };
  }

  // Nothing recognisable. Still hand over the extracted search so a reasoner
  // starts with products rather than a blank page.
  return { kind: "open", search, because: "no deterministic intent matched" };
}
