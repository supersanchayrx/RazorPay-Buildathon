/**
 * The commerce calendar.
 *
 * THE CALENDAR IS DATA, NOT A TRIGGER.
 *
 * The obvious version of this feature is a list of festivals that fires a
 * discount when one is near. That version is wrong three times over:
 *
 *   1. A festival raises demand. Discounting into rising demand pays customers
 *      to do what they were already going to do — the "sure things" mistake,
 *      moved from people to dates. Retail practice is explicit that the deepest
 *      cuts belong at the END of a season, not its peak.
 *   2. A real date is the perfect cover for manufactured urgency. "Diwali is
 *      coming, buy now" is pressure wearing a fact's clothes. The date is true;
 *      the implied deadline is invented.
 *   3. Festivals are regional and religious. Onam is Kerala. Inferring which
 *      festival a customer observes from their name is both wrong and, under
 *      DPDP, a category of processing we have no basis for. Seasonality here is
 *      STORE-WIDE MERCHANDISING and never per-person targeting. There is no API
 *      in this module that takes a customer.
 *
 * So nothing here decides anything. It answers "what is true about this date"
 * and hands that to detectors and floors that already know how to be careful.
 *
 * The first job of this module is defensive, not promotional: without it, a
 * festival demand step looks like a trend change to every detector we have, and
 * the proposer reports Onam as a discovery.
 */

export type Region =
  | "IN"      // observed nationally
  | "IN-KL"   // Kerala
  | "IN-TN"   // Tamil Nadu
  | "IN-WB"   // West Bengal
  | "IN-MH"   // Maharashtra
  | "IN-GJ";  // Gujarat

export type CalendarEvent = {
  key: string;
  name: string;
  /** First day, ISO. */
  date: string;
  /** Last day for multi-day events. Absent means a single day. */
  endDate?: string;
  regions: Region[];
  kind: "festival" | "marketplace_sale";
  /**
   * When purchase behaviour actually shifts. Gifting is bought in the weeks
   * before, not on the morning of — a window centred on the day itself misses
   * the entire commercial event.
   */
  shopping: { leadDays: number; tailDays: number };
  /** Whether the occasion drives gift purchasing, which changes basket shape. */
  gifting: boolean;
  /**
   * False for a date we have inferred rather than read from an announcement.
   * An unconfirmed date may inform planning. It may NEVER back a customer-facing
   * claim, because a promise anchored to a guessed date is a false promise.
   */
  confirmed: boolean;
  source: string;
};

/**
 * Lunisolar dates shift every year and cannot be computed from last year's.
 * This table is maintained by hand and expires on purpose: a stale calendar is
 * a silent failure, and a campaign that fires a week late is worse than one
 * that never fires.
 *
 * Entries we could not verify are OMITTED rather than estimated. A missing
 * festival costs an opportunity; a wrong one costs credibility.
 */
export const CALENDAR_VALID_THROUGH = "2026-12-31";

export const CALENDAR: CalendarEvent[] = [
  {
    key: "holi-2026",
    name: "Holi",
    date: "2026-03-04",
    regions: ["IN"],
    kind: "festival",
    shopping: { leadDays: 10, tailDays: 1 },
    gifting: true,
    confirmed: true,
    source: "https://give.do/indian-festival-calendar",
  },
  {
    key: "onam-2026",
    name: "Onam (Thiruvonam)",
    date: "2026-08-26",
    regions: ["IN-KL"],
    kind: "festival",
    shopping: { leadDays: 12, tailDays: 2 },
    gifting: true,
    confirmed: true,
    source: "https://give.do/indian-festival-calendar",
  },
  {
    key: "raksha-bandhan-2026",
    name: "Raksha Bandhan",
    date: "2026-08-28",
    regions: ["IN"],
    kind: "festival",
    shopping: { leadDays: 14, tailDays: 1 },
    gifting: true,
    confirmed: true,
    source: "https://en.wikipedia.org/wiki/Raksha_Bandhan",
  },
  {
    key: "ganesh-chaturthi-2026",
    name: "Ganesh Chaturthi",
    date: "2026-09-14",
    regions: ["IN-MH", "IN-GJ"],
    kind: "festival",
    shopping: { leadDays: 10, tailDays: 9 },
    gifting: false,
    confirmed: true,
    source: "https://give.do/indian-festival-calendar",
  },
  {
    key: "navratri-2026",
    name: "Sharad Navratri",
    date: "2026-10-11",
    endDate: "2026-10-19",
    regions: ["IN"],
    kind: "festival",
    shopping: { leadDays: 12, tailDays: 0 },
    gifting: false,
    confirmed: true,
    source: "https://samvat.in/festivals/navaratri-2026/",
  },
  {
    key: "dussehra-2026",
    name: "Dussehra (Vijayadashami)",
    date: "2026-10-20",
    regions: ["IN"],
    kind: "festival",
    shopping: { leadDays: 7, tailDays: 1 },
    gifting: true,
    confirmed: true,
    source: "https://samvat.in/festivals/navaratri-2026/",
  },
  {
    key: "dhanteras-2026",
    name: "Dhanteras",
    date: "2026-11-06",
    regions: ["IN"],
    kind: "festival",
    // The traditional day for buying metal goods. For a store selling a copper
    // kettle that is not trivia, it is the single most relevant date of the year.
    shopping: { leadDays: 14, tailDays: 0 },
    gifting: true,
    confirmed: true,
    source: "https://samvat.in/festivals/diwali-2026/",
  },
  {
    key: "diwali-2026",
    name: "Diwali (Lakshmi Puja)",
    date: "2026-11-08",
    regions: ["IN"],
    kind: "festival",
    shopping: { leadDays: 21, tailDays: 2 },
    gifting: true,
    confirmed: true,
    source: "https://samvat.in/festivals/diwali-2026/",
  },
  {
    key: "bhai-dooj-2026",
    name: "Bhai Dooj",
    date: "2026-11-10",
    regions: ["IN"],
    kind: "festival",
    shopping: { leadDays: 5, tailDays: 0 },
    gifting: true,
    confirmed: true,
    source: "https://samvat.in/festivals/diwali-2026/",
  },
  {
    // Flipkart and Amazon both opened on 23 Sep in 2025, roughly four weeks
    // ahead of Diwali, and have converged on the same date as each other. The
    // 2026 window below is INFERRED from that pattern and is not announced.
    key: "marketplace-festive-2026",
    name: "Marketplace festive sales (Big Billion Days / Great Indian Festival)",
    date: "2026-10-09",
    endDate: "2026-10-22",
    regions: ["IN"],
    kind: "marketplace_sale",
    shopping: { leadDays: 0, tailDays: 0 },
    gifting: false,
    confirmed: false,
    source: "https://www.smartprix.com/bytes/flipkart-big-billion-days-amazon-great-indian-festival-days-sale-date-announced-check-details-here/",
  },
];

/* ------------------------------------------------------------------ */

const DAY = 86400000;
const day = (iso: string) => Date.parse(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / DAY);

/** The full commercial window, which is wider than the event itself. */
export function windowOf(e: CalendarEvent): { from: string; to: string } {
  return {
    from: iso(day(e.date) - e.shopping.leadDays * DAY),
    to: iso(day(e.endDate ?? e.date) + e.shopping.tailDays * DAY),
  };
}

export function isStale(asOf: string): boolean {
  return asOf > CALENDAR_VALID_THROUGH;
}

const relevant = (e: CalendarEvent, regions: Region[]) =>
  e.regions.includes("IN") || e.regions.some((r) => regions.includes(r));

/** Windows open on a given date. */
export function activeWindows(asOf: string, regions: Region[] = ["IN"]): CalendarEvent[] {
  return CALENDAR.filter((e) => {
    if (!relevant(e, regions)) return false;
    const w = windowOf(e);
    return asOf >= w.from && asOf <= w.to;
  });
}

export function upcoming(asOf: string, withinDays: number, regions: Region[] = ["IN"]): Array<CalendarEvent & { daysAway: number }> {
  return CALENDAR.filter((e) => relevant(e, regions))
    .map((e) => ({ ...e, daysAway: daysBetween(asOf, e.date) }))
    .filter((e) => e.daysAway >= 0 && e.daysAway <= withinDays)
    .sort((a, b) => a.daysAway - b.daysAway);
}

/**
 * Where a date sits relative to the nearest commercial window.
 *
 * This is a LABEL FOR ANALYSIS, not an instruction. Its most important consumer
 * is the discount floor: `peak` and `pre_peak` are when a discount is least
 * defensible, because the demand arrives regardless.
 */
export type SeasonPhase = "normal" | "pre_peak" | "peak" | "post_peak";

export function seasonPhase(asOf: string, regions: Region[] = ["IN"]): {
  phase: SeasonPhase;
  events: CalendarEvent[];
  because: string;
} {
  const active = activeWindows(asOf, regions);
  if (active.length) {
    const onDay = active.filter((e) => asOf >= e.date && asOf <= (e.endDate ?? e.date));
    if (onDay.length)
      return { phase: "peak", events: onDay, because: `${onDay.map((e) => e.name).join(", ")} is today` };
    const after = active.filter((e) => asOf > (e.endDate ?? e.date));
    if (after.length && after.length === active.length)
      return { phase: "post_peak", events: after, because: `just after ${after.map((e) => e.name).join(", ")}` };
    const before = active.filter((e) => asOf < e.date);
    return {
      phase: "pre_peak",
      events: before,
      because: `${before.map((e) => `${e.name} in ${daysBetween(asOf, e.date)}d`).join(", ")}`,
    };
  }
  return { phase: "normal", events: [], because: "no commercial window open" };
}

/**
 * Days of stock cover at a given velocity, against the next relevant event.
 *
 * This is the honest half of seasonality and the reason the module earns its
 * place. It needs no forecast: the date is certain, the stock is counted, the
 * velocity is measured. "Dhanteras is in 34 days, the copper kettle is out of
 * stock, and 82 people abandoned a cart holding one" is three facts and a
 * question, with nothing predicted and nothing promised.
 */
export function leadTimeGap(opts: {
  asOf: string;
  units: number;
  unitsPerDay: number;
  event: CalendarEvent;
  restockDays: number;
}): { daysToEvent: number; coverDays: number; shortfall: boolean; orderBy: string } {
  const w = windowOf(opts.event);
  const daysToWindow = daysBetween(opts.asOf, w.from);
  const coverDays = opts.unitsPerDay > 0 ? opts.units / opts.unitsPerDay : Infinity;
  return {
    daysToEvent: daysBetween(opts.asOf, opts.event.date),
    coverDays,
    shortfall: coverDays < daysToWindow + opts.event.shopping.leadDays,
    orderBy: iso(day(w.from) - opts.restockDays * DAY),
  };
}
