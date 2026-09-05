/**
 * Assertions for the commerce calendar and the seasonal bounds.
 *
 * Two things are being checked, and the second matters more:
 *   - the calendar answers date questions correctly
 *   - an approved event licenses a DEADLINE and nothing else. It must not
 *     become a back door through which discounts, scarcity claims or assumed
 *     religious observance reach a shopper.
 *
 * Run:  node scripts/check-seasonal.mjs
 */
// Node strips the types itself from v23 on, so these import directly. Both
// modules are deliberately dependency-free, which is what makes that possible
// and is a reason to keep them that way.
const cal = await import("../app/lib/calendar.server.ts");
const bounds = await import("../app/lib/bounds.server.ts");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/* ---- the calendar as a fact table ---------------------------------- */
const diwali = cal.CALENDAR.find((e) => e.key === "diwali-2026");
check("Diwali 2026 is 8 November", diwali.date === "2026-11-08", diwali.date);
check(
  "every confirmed entry cites a source",
  cal.CALENDAR.every((e) => e.source.startsWith("http")),
  `${cal.CALENDAR.length} entries`,
);
check(
  "the marketplace window is marked unconfirmed",
  cal.CALENDAR.find((e) => e.kind === "marketplace_sale").confirmed === false,
  "2026 dates are inferred from 2025, not announced",
);
check(
  "the calendar declares an expiry",
  cal.isStale("2027-01-01") && !cal.isStale("2026-09-05"),
  `valid through ${cal.CALENDAR_VALID_THROUGH}`,
);

/* ---- regional correctness ------------------------------------------ */
const nationally = cal.upcoming("2026-08-01", 40, ["IN"]).map((e) => e.key);
const inKerala = cal.upcoming("2026-08-01", 40, ["IN-KL"]).map((e) => e.key);
check(
  "Onam reaches Kerala and not the whole country",
  !nationally.includes("onam-2026") && inKerala.includes("onam-2026"),
  `national: ${nationally.join(", ")}`,
);

/* ---- windows open before the day, not on it ------------------------ */
const w = cal.windowOf(diwali);
check(
  "the Diwali shopping window opens three weeks early",
  w.from === "2026-10-18" && w.to === "2026-11-10",
  `${w.from} .. ${w.to}`,
);
check(
  "phase is pre_peak two weeks out, peak on the day",
  cal.seasonPhase("2026-10-25").phase === "pre_peak" && cal.seasonPhase("2026-11-08").phase === "peak",
  `${cal.seasonPhase("2026-10-25").because}`,
);

/* ---- lead time: the honest half ------------------------------------ */
// The kettle: 0 in stock, 2 sold a month, Dhanteras is the metal-buying day.
const dhanteras = cal.CALENDAR.find((e) => e.key === "dhanteras-2026");
const gap = cal.leadTimeGap({
  asOf: "2026-09-05",
  units: 0,
  unitsPerDay: 2 / 30,
  event: dhanteras,
  restockDays: 21,
});
check(
  "a stock shortfall before Dhanteras is detected with no forecast",
  gap.shortfall && gap.daysToEvent === 62,
  `${gap.daysToEvent}d away, ${gap.coverDays.toFixed(0)}d cover, order by ${gap.orderBy}`,
);

/* ---- bounds: what an event does NOT license ------------------------ */
const live = { name: "Diwali week", endsAt: "2026-11-10" };
const at = "2026-11-04";
const g = (r, o = {}) => bounds.checkReply(r, { groundedStockClaims: [], asOf: at, ...o });

check(
  "without an event, a deadline is blocked",
  g("Our festive week ends soon, don't miss out.").length > 0,
  g("Our festive week ends soon, don't miss out.").map((v) => v.gate).join(", "),
);
check(
  "with a live approved event, a deadline is allowed",
  g("Our Diwali week ends this Sunday.", { approvedEvent: live }).length === 0,
  "the gate got something true to check, it did not get weaker",
);
check(
  "an EXPIRED event licenses nothing",
  g("Our Diwali week ends this Sunday.", { approvedEvent: { name: "x", endsAt: "2026-10-01" } }).length > 0,
);
check(
  "an event does not license a discount",
  g("Diwali week — take 15% off today.", { approvedEvent: live }).some((v) => v.gate === "unverifiable_discount"),
);
check(
  "an event does not license invented scarcity",
  g("Festive stock is limited, order now.", { approvedEvent: live }).some((v) => v.gate === "unapproved_event"),
);
check(
  "an event does not license claims about other shoppers",
  g("Everyone's buying this for Diwali.", { approvedEvent: live }).some((v) => v.gate === "unapproved_event"),
);
check(
  "an event does not license a price threat",
  g("Buy before the prices go up after Diwali.", { approvedEvent: live }).some((v) => v.gate === "unapproved_event"),
);
check(
  "assuming a shopper's observance is blocked",
  g("Since you're celebrating, here's a gift set.", { approvedEvent: live }).some((v) => v.gate === "assumed_observance") &&
    g("As a Hindu you'll want the brass set.", { approvedEvent: live }).some((v) => v.gate === "assumed_observance"),
);
check(
  "a real grounded stock number still passes",
  bounds.checkReply("Only 3 left of the cold brew.", { groundedStockClaims: [3], asOf: at }).length === 0,
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
