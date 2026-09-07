/**
 * Why they didn't buy — a closed set, and how a sentence becomes one of them.
 *
 * THE REASON IS THE PRODUCT, NOT THE DISCOUNT.
 *
 * Everything a shop can measure tells it WHAT happened: 226 baskets abandoned,
 * 82 of them holding a kettle, most dying at the address step. No amount of
 * analytics recovers WHY, because the why never touched the server. Asking is
 * the only way to get it, and one answer — "the delivery estimate was too slow
 * for a gift" — is worth more than the basket it came from, because it is
 * actionable at the shop level and the basket is worth ₹400 once.
 *
 * So this runs even when there is no remedy to offer, and `unknown` is a
 * first-class outcome rather than a failure. A shop that learns 31% of its
 * abandonments cite shipping cost has learned something no dashboard was going
 * to tell it.
 *
 * WHY THE SET IS CLOSED.
 *
 * Because a remedy is keyed off it. An open-ended reason means an open-ended
 * remedy, which means a model deciding what a shopper deserves — which is the
 * thing this codebase exists not to do. The model's entire job here is to pick
 * one of eleven labels. It cannot invent a twelfth, and it never sees the
 * policy table, the shopper's standing, or the words "discount" and "offer".
 *
 * DETERMINISTIC FIRST, MODEL SECOND, UNKNOWN BY DEFAULT.
 *
 * Most answers are three words and match a phrase list. Those never reach a
 * model: they are free, instant, auditable, and a merchant can read the rule
 * that fired. The model is asked only when the phrase list abstains, and if it
 * is down, disagrees with itself, or answers with anything outside the set, the
 * result is `unknown` — which is honest, and which costs the shop a remedy
 * rather than costing a shopper a wrong one.
 */

export type Reason =
  /** The price of the goods. */
  | "price_too_high"
  /** The delivery charge, specifically — a different problem with a different fix. */
  | "shipping_cost"
  /** How long it would take. */
  | "shipping_speed"
  /** The payment did not go through. Our problem, not theirs. */
  | "payment_failed"
  /** The thing they wanted was not available in the size, weight or variant. */
  | "out_of_stock"
  /** Checkout itself was confusing or broken. */
  | "checkout_friction"
  /** They wanted a payment method the shop does not take. */
  | "payment_method"
  /** They decided against it. The honest response is to go away. */
  | "changed_mind"
  /** Never intended to buy today. */
  | "just_browsing"
  /** Looking at somebody else's price. */
  | "comparing"
  /** Did not trust the shop enough to pay. Worth knowing and hard to hear. */
  | "trust"
  /** Said something, and we are not confident enough to act on it. */
  | "unknown";

export const REASONS: Reason[] = [
  "price_too_high",
  "shipping_cost",
  "shipping_speed",
  "payment_failed",
  "out_of_stock",
  "checkout_friction",
  "payment_method",
  "changed_mind",
  "just_browsing",
  "comparing",
  "trust",
  "unknown",
];

export const REASON_LABEL: Record<Reason, string> = {
  price_too_high: "The price was too high",
  shipping_cost: "Delivery cost too much",
  shipping_speed: "Delivery was too slow",
  payment_failed: "The payment didn't go through",
  out_of_stock: "What they wanted wasn't available",
  checkout_friction: "Checkout got in the way",
  payment_method: "We don't take how they wanted to pay",
  changed_mind: "They changed their mind",
  just_browsing: "They were only looking",
  comparing: "They were comparing with somewhere else",
  trust: "They weren't sure about us",
  unknown: "Not clear enough to act on",
};

/**
 * The three we offer as buttons, plus a free-text box.
 *
 * Only three, and these three, because a list of eleven radio buttons is a
 * survey and nobody fills in a survey. These are the ones a shop can usually do
 * something about; everything else arrives as prose and gets classified.
 */
export const OFFERED_CHOICES: Reason[] = ["price_too_high", "shipping_cost", "payment_failed"];

/* ------------------------------------------------------------------ *
 * The phrase list
 * ------------------------------------------------------------------ */

/**
 * Ordered, and the order is load-bearing.
 *
 * "shipping was too expensive" contains both a delivery word and a price word.
 * Read price-first it becomes `price_too_high` and the shop responds to the
 * wrong complaint — offering money off a kettle to somebody who objected to a
 * ₹60 delivery charge. The delivery patterns are therefore checked first and
 * are written to require BOTH a delivery word and a cost word.
 */
const PATTERNS: Array<{ reason: Reason; re: RegExp }> = [
  {
    reason: "shipping_cost",
    re: /\b(?:shipping|delivery|postage|courier)\b[^.!?]{0,40}\b(?:costs?|charges?|fees?|expensive|too much|extra|pricey)\b|\b(?:costs?|charges?|fees?)\s+(?:of|for)\s+(?:shipping|delivery)\b|\bfree\s+(?:shipping|delivery)\b/i,
  },
  {
    reason: "shipping_speed",
    re: /\b(?:shipping|delivery|dispatch|arrive|arrives|arriving|takes?|took)\b[^.!?]{0,40}\b(?:slow|long|late|days|weeks?|not in time|too late)\b|\bneed(?:ed)? it (?:by|before|sooner|faster)\b/i,
  },
  {
    reason: "payment_failed",
    re: /\b(?:payment|card|upi|netbanking|net banking|transaction)\b[^.!?]{0,40}\b(?:fail\w*|declin\w*|bounced|error|not (?:work|go)\w*|didn'?t (?:work|go)\w*)\b|\b(?:fail\w*|declin\w*)\b[^.!?]{0,40}\b(?:payment|card|upi|netbanking)\b/i,
  },
  {
    reason: "payment_method",
    re: /\b(?:no|don'?t (?:have|take|accept)|not available|wanted|prefer(?:red)?)\b[^.!?]{0,30}\b(?:cod|cash on delivery|emi|paypal|amex|wallet)\b|\b(?:cod|cash on delivery|emi)\b[^.!?]{0,20}\b(?:not|isn'?t|wasn'?t)\b/i,
  },
  {
    reason: "out_of_stock",
    re: /\b(?:out of stock|sold out|unavailable|not available|no stock)\b|\b(?:size|weight|variant|pack|tin)\b[^.!?]{0,30}\b(?:not|wasn'?t|isn'?t)\s+(?:there|available|in stock)\b/i,
  },
  {
    reason: "checkout_friction",
    re: /\b(?:checkout|form|page|site|website|app)\b[^.!?]{0,40}\b(?:broke|broken|error|stuck|confusing|complicated|wouldn'?t|didn'?t work|crashed|loop)\b|\b(?:had to|forced to)\s+(?:sign ?up|create an account|register)\b/i,
  },
  {
    reason: "price_too_high",
    re: /\b(?:too (?:expensive|costly|pricey|much)|price(?:y|d)? (?:too )?high|can'?t afford|out of (?:my )?budget|over (?:my )?budget|bit steep|beyond my budget)\b|\bcheaper\b/i,
  },
  {
    reason: "comparing",
    re: /\b(?:amazon|flipkart|elsewhere|another (?:site|shop|store)|somewhere else|competitor)\b|\bcomparing\b/i,
  },
  {
    reason: "trust",
    re: /\b(?:never heard of|not sure (?:about|if)|don'?t trust|seemed? (?:dodgy|sketchy|fake)|is this (?:real|legit)|reviews?)\b/i,
  },
  {
    reason: "changed_mind",
    re: /\b(?:changed my mind|don'?t want it|no longer|decided (?:not|against)|not interested|bought it elsewhere already|already bought)\b/i,
  },
  {
    reason: "just_browsing",
    re: /\b(?:just (?:looking|browsing)|window shopping|saving (?:it )?for later|maybe later|not (?:right )?now|wish ?list)\b/i,
  },
];

export type Classification = {
  reason: Reason;
  /** `phrases` is auditable and free; `model` was asked; `default` means neither could say. */
  by: "choice" | "phrases" | "model" | "default";
  /** The rule or label that decided it, for the merchant's audit. */
  evidence: string;
};

/**
 * Classify without a model.
 *
 * Returns null rather than `unknown` when nothing matches, so the caller can
 * tell "no rule fired" from "we decided it is unclear" — the first is worth
 * asking a model about and the second is not.
 */
export function classifyByPhrases(text: string): Classification | null {
  const t = String(text ?? "").slice(0, 600);
  if (!t.trim()) return null;
  for (const { reason, re } of PATTERNS) {
    const m = t.match(re);
    if (m) return { reason, by: "phrases", evidence: `matched “${m[0]}”` };
  }
  return null;
}

/**
 * The prompt used when the phrase list abstains.
 *
 * Note what is absent from it: any mention of a discount, an offer, the
 * shopper's history, or what happens next. The model is labelling a sentence.
 * It has no idea that one of these labels can lead to money, which is the only
 * safe state for it to be in — a classifier that knows which answer pays out is
 * a classifier with an incentive.
 */
export function classifierPrompt(text: string): string {
  return [
    "A shopper abandoned their basket. Asked why, they wrote the message below.",
    "Reply with EXACTLY ONE of these labels and nothing else:",
    "",
    ...REASONS.filter((r) => r !== "unknown").map((r) => `${r} — ${REASON_LABEL[r]}`),
    "unknown — the message does not clearly say any of the above",
    "",
    "Prefer `unknown` over a guess. A wrong label is worse than no label.",
    "",
    `Message: ${JSON.stringify(String(text ?? "").slice(0, 600))}`,
  ].join("\n");
}

/**
 * Read a model's answer back into the set.
 *
 * Deliberately strict about SHAPE and forgiving about noise: a small model asked
 * for one word often returns "Label: price_too_high." Stripping punctuation and
 * a prefix is fine. Accepting a label that is not in the set is not, and
 * accepting two labels is not — an answer naming several is an answer that has
 * not decided, and `unknown` is the correct reading of it.
 */
export function parseClassification(raw: string): Classification {
  const cleaned = String(raw ?? "").toLowerCase().replace(/[^a-z_\s]/g, " ");
  const hits = REASONS.filter((r) => new RegExp(`\\b${r}\\b`).test(cleaned));
  if (hits.length === 1 && hits[0] !== "unknown") {
    return { reason: hits[0], by: "model", evidence: `model answered ${hits[0]}` };
  }
  return {
    reason: "unknown",
    by: "default",
    evidence:
      hits.length > 1
        ? `model named ${hits.length} labels, so it had not decided`
        : "no label the classifier was allowed to return",
  };
}

/**
 * The whole path: an explicit choice beats prose, prose beats a model, and a
 * model that will not answer cleanly leaves it unknown.
 *
 * `chosen` is a button the shopper pressed. It is not classified at all,
 * because re-interpreting an answer somebody gave explicitly is the one form of
 * this that is indefensible.
 */
export async function classify(opts: {
  chosen?: Reason | null;
  text?: string | null;
  /** Optional. Absent, unreachable or slow means `unknown`, never a guess. */
  ask?: (prompt: string) => Promise<string>;
}): Promise<Classification> {
  if (opts.chosen && REASONS.includes(opts.chosen) && opts.chosen !== "unknown") {
    return { reason: opts.chosen, by: "choice", evidence: "the shopper picked it themselves" };
  }
  const byPhrase = classifyByPhrases(opts.text ?? "");
  if (byPhrase) return byPhrase;
  if (!opts.text?.trim()) {
    return { reason: "unknown", by: "default", evidence: "no answer given" };
  }
  if (!opts.ask) {
    return { reason: "unknown", by: "default", evidence: "no phrase matched and no classifier is configured" };
  }
  const raw = await opts.ask(classifierPrompt(opts.text)).catch(() => "");
  return parseClassification(raw);
}
