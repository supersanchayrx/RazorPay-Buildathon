/**
 * Persuasion bounds — enforced in code, not in the prompt.
 *
 * The system prompt asks the model to behave; this checks whether it did. A
 * prompt is a request, and a request is not a bound. Anything the model says
 * that claims a discount or an expiry it cannot source is replaced, and the
 * attempt is written to the ledger.
 *
 * Right now there is no approved-offer store, so the correct number of
 * offerable discounts is zero and any discount claim is a violation. When
 * merchant-approved offers exist, this is where they get consulted.
 */

export type Violation = {
  gate:
    | "unverifiable_discount"
    | "unverifiable_urgency"
    | "unapproved_event"
    | "assumed_observance";
  matched: string;
};

/**
 * A merchant-approved, dated event. Its only power is over DEADLINES.
 *
 * This is the first legitimate urgency the system has ever had, and it arrives
 * without weakening anything: the gate did not get more permissive, it got
 * something true to check against. "Our Diwali week ends Sunday" is a fact when
 * a merchant approved a window that ends on Sunday, and a fabrication otherwise.
 *
 * An event is NOT an offer. It unlocks a date, never a price — every discount
 * pattern below still requires an approved offer, of which there are currently
 * none.
 */
export type ApprovedEvent = {
  name: string;
  /** ISO date the event genuinely ends. */
  endsAt: string;
};

const DISCOUNT_PATTERNS: RegExp[] = [
  /\b\d{1,2}\s?%\s?(?:off|discount)\b/i,
  /\b(?:discount|coupon|promo)\s+code\b/i,
  /\bI(?:'| a)?m able to offer you\b/i,
  /\bspecial (?:price|deal|offer) (?:for you|just for you)\b/i,
  /\bknock off\b/i,
];

/**
 * Seasonal claims that stay blocked even during an approved event, because an
 * event licenses a date and nothing else. Each of these asserts something about
 * the world — other shoppers, future prices, scarcity — that no tool of ours
 * can source.
 */
const SEASONAL_PATTERNS: RegExp[] = [
  /\b(?:festive|festival|diwali|holi|onam|dussehra|navratri|rakhi|raksha bandhan)\s+(?:stock|stocks|quantity|quantities)\s+(?:is|are)\s+(?:limited|running out|low)\b/i,
  /\bbefore\s+(?:the\s+)?(?:festive\s+)?(?:prices?|rates?)\s+go\s+up\b/i,
  /\bprices?\s+will\s+(?:go up|rise|increase)\s+after\b/i,
  /\beveryone(?:'s| is)\s+buying\b/i,
  /\b(?:selling|going)\s+fast\s+this\s+(?:festive|season)\b/i,
  /\bstock\s+up\s+before\s+(?:diwali|the festival|the rush)\b/i,
];

/**
 * Assuming what a shopper observes. Festivals in India are regional and
 * religious; a name is not a religion and a pincode is not a faith. Seasonality
 * in CHAPMAN is store-wide merchandising, never per-person targeting — the
 * calendar module exposes no function that takes a customer. This catches the
 * text-level version of the same mistake.
 */
const OBSERVANCE_PATTERNS: RegExp[] = [
  /\b(?:since|because|as)\s+you(?:'re| are)?\s+(?:celebrating|observing)\b/i,
  /\byour\s+(?:diwali|eid|christmas|onam|pongal)\s+(?:shopping|purchase|celebration)\b/i,
  /\bas\s+a\s+(?:hindu|muslim|christian|sikh|jain)\b/i,
  /\byou\s+must\s+be\s+(?:preparing|shopping)\s+for\s+(?:diwali|eid|christmas)\b/i,
];

const URGENCY_PATTERNS: RegExp[] = [
  /\b(?:only|just)\s+\d+\s+(?:left|remaining|in stock)\b/i,
  /\bexpires?\s+(?:in|within|today|tomorrow|soon)\b/i,
  /\b(?:hurry|act fast|don'?t miss out|last chance|limited time)\b/i,
  /\bfor the next \d+\s*(?:hours?|minutes?|days?)\b/i,
  // Dated deadlines. These were missing, and their absence made the first
  // version of the approved-event test pass without testing anything: "ends
  // this Sunday" was never blocked, so allowing it proved nothing. A gate you
  // cannot see fail is a gate you have not verified.
  /\b(?:ends?|closes?|finishes|runs? (?:until|till|through))\s+(?:on\s+)?(?:today|tonight|tomorrow|this\s+\w+|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)\w*\b/i,
  /\b(?:last|final)\s+(?:day|days|hours?|chance)\b/i,
  /\b(?:while|until)\s+stocks?\s+last\b/i,
];

/**
 * `groundedStockClaims` lets a genuine, tool-sourced stock statement through:
 * if inventory really is 3 and the model says "only 3 left", that is a fact,
 * not manufactured urgency. Everything else is manufactured.
 */
/**
 * A merchant-approved offer, in the only form this file needs.
 *
 * Narrow on purpose: a product, a percentage, a date. A bound that receives
 * more than it checks is a bound that will eventually be asked to check
 * something it was not designed for.
 *
 * WHAT AN APPROVED OFFER LICENSES, EXACTLY:
 *
 *   The assistant may SAY that this offer exists. It may not apply one, and
 *   nothing here gives it the power to. The discount is applied by the server
 *   at quote time and charged at the payment page — so the model still never
 *   produces a price, which is the rule the whole system rests on.
 *
 * An assistant that could grant a discount is an assistant that can be argued
 * into one. An assistant that can only announce one the merchant already
 * approved cannot be argued into anything.
 */
export type ApprovedOffer = {
  handle: string;
  title: string;
  /** Whole percent off, e.g. 10. */
  percent: number;
  /** ISO date. */
  endsAt: string;
};

export function checkReply(
  reply: string,
  opts: {
    groundedStockClaims: number[];
    /** A live, merchant-approved event. Null means no deadline is sayable. */
    approvedEvent?: ApprovedEvent | null;
    /**
     * Offers the merchant has approved and that have not expired.
     *
     * Absent or empty means every discount claim is refused, which was the
     * state of this system until an approval store existed to fill it.
     */
    approvedOffers?: ApprovedOffer[];
    /** Today, ISO. An event that has ended licenses nothing. */
    asOf?: string;
  } = { groundedStockClaims: [] },
): Violation[] {
  const violations: Violation[] = [];
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const event = opts.approvedEvent && opts.approvedEvent.endsAt >= asOf ? opts.approvedEvent : null;
  const offers = (opts.approvedOffers ?? []).filter((o) => o.endsAt >= asOf);

  for (const re of DISCOUNT_PATTERNS) {
    const m = reply.match(re);
    if (!m) continue;

    /**
     * A percentage is sayable only if a live approval carries that EXACT
     * figure.
     *
     * Exact, not "at least" — an assistant that rounds 10% up to 15% because it
     * sounds better has invented an offer, and one that quotes 5% when 10% was
     * approved has cost the merchant a sale for no reason. Both are the same
     * failure: a number that came from the model rather than from the approval.
     *
     * Patterns with no percentage at all ("special price just for you", "I can
     * knock something off") are never licensed. There is no approval that could
     * make an unquantified concession checkable, so it stays refused.
     */
    const claimed = Number(m[0].match(/(\d{1,2})\s?%/)?.[1] ?? NaN);
    const licensed =
      Number.isFinite(claimed) && offers.some((o) => o.percent === claimed);
    if (licensed) continue;

    violations.push({ gate: "unverifiable_discount", matched: m[0] });
  }

  for (const re of SEASONAL_PATTERNS) {
    const m = reply.match(re);
    if (m) violations.push({ gate: "unapproved_event", matched: m[0] });
  }

  for (const re of OBSERVANCE_PATTERNS) {
    const m = reply.match(re);
    if (m) violations.push({ gate: "assumed_observance", matched: m[0] });
  }

  for (const re of URGENCY_PATTERNS) {
    const m = reply.match(re);
    if (!m) continue;
    const numbers = (m[0].match(/\d+/g) ?? []).map(Number);
    const grounded =
      numbers.length > 0 && numbers.every((n) => opts.groundedStockClaims.includes(n));
    if (grounded) continue;
    // A real, unexpired, merchant-approved window makes a deadline a fact. This
    // is the only thing in the system that can license urgency, and it licenses
    // exactly urgency.
    if (event && !/\d/.test(m[0])) continue;
    violations.push({ gate: "unverifiable_urgency", matched: m[0] });
  }

  return violations;
}

/* ------------------------------------------------------------------ *
 * Streaming
 * ------------------------------------------------------------------ */

export type GuardStep = {
  /** Text that has passed a bounds check and may be shown. */
  release: string;
  /** Non-empty means stop the stream and replace everything already shown. */
  violations: Violation[];
};

/**
 * Bounds for a reply that arrives a piece at a time.
 *
 * The naive way to stream is to forward tokens as they arrive and check the
 * result at the end. That inverts the entire design: by the time the check
 * fails, the shopper has already read "15% off". A guarantee you enforce after
 * the fact is not a guarantee.
 *
 * So nothing is released until it has been checked. Text accumulates, and at
 * each SENTENCE BOUNDARY the whole accumulation so far is run through the same
 * `checkReply` the non-streaming path uses. Only if that passes does the new
 * span go out. The shopper sees text appear a sentence at a time — still alive,
 * still far better than three seconds of nothing — and never sees a sentence
 * that has not been through the gate.
 *
 * Sentence granularity is chosen because every pattern in this file matches
 * within one sentence. A claim that somehow spanned a released boundary would
 * be caught only by the final check, which replaces the whole message; that is
 * the one residual gap and it is stated here rather than papered over.
 */
export function createStreamGuard(opts: {
  groundedStockClaims: number[];
  approvedEvent?: ApprovedEvent | null;
  /**
   * Forwarded verbatim to `checkReply`. If this were omitted here, streaming
   * would refuse sentences the blocking path allows — two different products
   * depending on a transport flag, which is how a guarantee quietly stops
   * being one.
   */
  approvedOffers?: ApprovedOffer[];
  asOf?: string;
}) {
  let accumulated = "";
  let released = 0;
  let stopped = false;

  const check = (text: string) => checkReply(text, opts);

  /** End of the last complete sentence, or -1. */
  const lastBoundary = (text: string, from: number): number => {
    const tail = text.slice(from);
    let best = -1;
    const re = /[.!?…”"’')\]]*[.!?…]["'”’)\]]*(\s|$)|\n+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tail)) !== null) best = m.index + m[0].length;
    return best < 0 ? -1 : from + best;
  };

  return {
    push(chunk: string): GuardStep {
      if (stopped) return { release: "", violations: [] };
      accumulated += chunk;

      const boundary = lastBoundary(accumulated, released);
      if (boundary <= released) return { release: "", violations: [] };

      // The check runs over EVERYTHING so far, not just the new span: a claim
      // is a property of the message, not of the fragment carrying it.
      const violations = check(accumulated.slice(0, boundary));
      if (violations.length) {
        stopped = true;
        return { release: "", violations };
      }

      const out = accumulated.slice(released, boundary);
      released = boundary;
      return { release: out, violations: [] };
    },

    /** Flush whatever is left, after a final check of the complete reply. */
    end(): GuardStep {
      if (stopped) return { release: "", violations: [] };
      const violations = check(accumulated);
      if (violations.length) {
        stopped = true;
        return { release: "", violations };
      }
      const out = accumulated.slice(released);
      released = accumulated.length;
      return { release: out, violations: [] };
    },

    get text() {
      return accumulated;
    },
  };
}

export const REFUSAL_TEXT =
  "I can't offer a discount or a deadline I can't verify — the store hasn't approved one. " +
  "Here's what I can tell you from the catalogue instead: ask me about price, availability or specs and I'll quote what's actually listed.";

const FALLBACK =
  " Ask me about price, availability or specs and I'll quote what's actually listed.";

/**
 * The replacement text, matched to what actually went wrong.
 *
 * A single refusal string was answering an assumption about someone's religion
 * with a paragraph about discounts, which reads as a non-sequitur and tells the
 * shopper the system did not understand them. The gate that fired is known at
 * this point; saying the right thing costs nothing.
 *
 * Order matters: the most personal failure is the one to apologise for.
 */
export function refusalFor(violations: Violation[]): string {
  const gates = new Set(violations.map((v) => v.gate));
  if (gates.has("assumed_observance"))
    return (
      "Sorry — I shouldn't have assumed anything about what you celebrate. " +
      "I only know what's in this store's catalogue." + FALLBACK
    );
  if (gates.has("unapproved_event"))
    return (
      "I can't claim festive stock is running out, or that prices are about to change — " +
      "I have no way to check either." + FALLBACK
    );
  if (gates.has("unverifiable_discount"))
    return (
      "I can't offer a discount or a code — the store hasn't approved one." + FALLBACK
    );
  if (gates.has("unverifiable_urgency"))
    return (
      "I can't give you a deadline I can't verify — there's no offer running that ends." +
      FALLBACK
    );
  return REFUSAL_TEXT;
}
