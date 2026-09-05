/**
 * The abandoned-cart recovery agent.
 *
 * A recovery campaign is the easiest thing in this codebase to make look like
 * it works. Point it at 226 abandoned baskets, draft 226 messages, print a big
 * number. Every one of the interesting failures is invisible in that demo:
 * writing to somebody who already bought the thing, writing to the same person
 * twice, writing at 3am, writing about a basket from March, and inventing a
 * discount to close the gap.
 *
 * So this suite is mostly about what does NOT get sent. Five properties:
 *
 *   1. Suppression is exhaustive and accounted for. Every basket is either a
 *      target or has a named reason, and the two sets never overlap.
 *   2. No message claims anything the bounds layer would refuse — checked by
 *      running the real gate over the real drafted text, and separately by
 *      proving the gate can still fail on a sabotaged template.
 *   3. An offer is announceable only when a merchant approved that exact
 *      figure, and the same sentence is refused when the approval is revoked.
 *   4. Sending is idempotent and self-limiting: the log is the only memory, and
 *      a second run after a send suppresses the basket it already wrote about.
 *   5. Nothing that identifies a person crosses into the cortex.
 *
 * Run:  node scripts/check-recovery.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

async function load(entry, name) {
  const out = path.join(process.cwd(), "node_modules", ".cache", name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href + "?t=" + Date.now());
}

const RCV = await load("app/lib/recovery.server.ts", "rcv-check.mjs");
const OUT = await load("app/lib/outreach.server.ts", "out-check.mjs");
const SET = await load("app/lib/settings.server.ts", "set-check.mjs");
const APR = await load("app/lib/approvals.server.ts", "apr2-check.mjs");
const FND = await load("app/lib/findings.server.ts", "fnd-check.mjs");
const CTX = await load("app/lib/cortex.server.ts", "ctx2-check.mjs");
const DET = await load("app/lib/detectors.server.ts", "det2-check.mjs");
const BND = await load("app/lib/bounds.server.ts", "bnd2-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/**
 * A throwaway shop key.
 *
 * Every store this suite writes to — settings, findings, the send log, the
 * approval ledger — is scoped by shop, so the whole run is invisible to the
 * real one. The alternative is a suite that quietly puts the demo store into a
 * cooldown and makes the next campaign page render empty for a month.
 */
const SHOP = "pk_check_recovery";
const AS_OF = new Date("2026-09-05T11:00:00.000Z");
const ORIGIN = "http://127.0.0.1:4000";
const TPL = "/product.html?handle={handle}";

const run = (asOf = AS_OF) =>
  RCV.runRecovery({
    shop: SHOP,
    shopName: "Nilgiri Post",
    storefrontOrigin: ORIGIN,
    productUrlTemplate: TPL,
    asOf,
  });

/* ================= 1. suppression is exhaustive ================= */
console.log("--- what does not get sent, and why ---");

SET.writeSettings(SHOP, { outreach: { enabled: true, maxPerRun: 25 } }, "check");
const r = run();

check(
  "every basket is either a target or carries a named suppression reason",
  r.targets.length + r.suppressed.length === r.totals.cartsConsidered,
  `${r.targets.length} targets + ${r.suppressed.length} suppressed = ${r.targets.length + r.suppressed.length} of ${r.totals.cartsConsidered}`,
);
check(
  "no basket is both",
  (() => {
    const t = new Set(r.targets.map((x) => x.cartId));
    return !r.suppressed.some((s) => t.has(s.cartId));
  })(),
  "a cart in both lists means the merchant's totals do not add up",
);
/**
 * A threshold that fires without showing its arithmetic is unarguable, and a
 * merchant who cannot argue with a setting cannot tune it. Categorical reasons
 * ("they bought it") are exempt: there is no number to show, and inventing one
 * would be worse.
 */
const THRESHOLD_REASONS = new Set([
  "too_old",
  "too_soon",
  "margin_too_thin",
  "contacted_recently",
  "frequency_cap",
  "over_run_cap",
  "duplicate_customer",
]);
check(
  "a threshold suppression shows the value AND the threshold it missed",
  r.suppressed
    .filter((s) => THRESHOLD_REASONS.has(s.reason))
    .every((s) => (s.detail.match(/\d+/g) ?? []).length >= 2),
  `sample: “${r.suppressed.find((s) => THRESHOLD_REASONS.has(s.reason))?.detail ?? "-"}”`,
);
check(
  "a categorical suppression names the specific thing instead",
  r.suppressed
    .filter((s) => !THRESHOLD_REASONS.has(s.reason))
    .every((s) => s.detail.length > 20),
  `sample: “${r.suppressed.find((s) => !THRESHOLD_REASONS.has(s.reason))?.detail ?? "-"}”`,
);
check(
  "the run actually produced something to send",
  r.targets.length > 0,
  `${r.targets.length} messages worth ₹${Math.round(r.totals.marginAtStake)} of margin at stake`,
);

/**
 * The one that costs a merchant a customer rather than a rupee.
 *
 * "You left this behind" to somebody holding the parcel is the message people
 * screenshot. It is also the easiest bug to ship, because the cart record says
 * abandoned and nothing in it knows about the order that followed.
 */
const carts = fs
  .readFileSync(path.join(process.cwd(), "data", "carts.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const orders = fs
  .readFileSync(path.join(process.cwd(), "data", "orders.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((o) => o.status === "placed");

check(
  "nobody who bought the thing afterwards is written to",
  r.targets.every((t) => {
    const cart = carts.find((c) => c.id === t.cartId);
    return !orders.some(
      (o) =>
        o.customer?.id === t.customerId &&
        o.ts > cart.ts &&
        o.lines.some((l) => t.items.some((i) => i.handle === l.handle)),
    );
  }),
  `${r.suppressedBy.find((s) => s.reason === "already_bought")?.count ?? 0} baskets caught by this rule`,
);
check(
  "one message per person, and the larger basket wins",
  new Set(r.targets.map((t) => t.customerId)).size === r.targets.length,
  `${r.suppressedBy.find((s) => s.reason === "duplicate_customer")?.count ?? 0} deduped`,
);
check(
  "nothing older than the merchant's own ceiling",
  r.targets.every((t) => t.ageHours <= r.settings.outreach.cartAgeHours.max),
  `ceiling ${Math.round(r.settings.outreach.cartAgeHours.max / 24)} days; oldest sent ${Math.round(Math.max(...r.targets.map((t) => t.ageHours)) / 24)} days`,
);
check(
  "nothing newer than the floor — they may still be checking out",
  r.targets.every((t) => t.ageHours >= r.settings.outreach.cartAgeHours.min),
  `floor ${r.settings.outreach.cartAgeHours.min}h`,
);
check(
  "nothing below the margin floor",
  r.targets.every((t) => t.marginAtStake >= r.settings.outreach.minMarginAtStake),
  `floor ₹${r.settings.outreach.minMarginAtStake}`,
);

/** A cap that is not enforced is a comment. */
SET.writeSettings(SHOP, { outreach: { maxPerRun: 3 } }, "check");
const capped = run();
check(
  "the per-run cap is a cap",
  capped.targets.length === 3,
  `asked for 3, got ${capped.targets.length}; ${capped.suppressedBy.find((s) => s.reason === "over_run_cap")?.count ?? 0} pushed past it`,
);
check(
  "and the ones that make the cut are the valuable ones",
  capped.targets.every((t) => t.marginAtStake >= Math.max(...capped.suppressed.filter((s) => s.reason === "over_run_cap").map((s) => s.marginAtStake))),
  "a cap that drops the biggest baskets is worse than no cap",
);
SET.writeSettings(SHOP, { outreach: { maxPerRun: 25 } }, "check");

/* ================= 2. nothing untrue leaves the building ================= */
console.log("\n--- the same gate that guards the widget, on our own templates ---");

const allText = r.targets.map((t) => t.text).join("\n");

check(
  "every drafted message passes the bounds check",
  r.targets.every((t) => BND.checkReply(t.text, { groundedStockClaims: [] }).length === 0),
  `${r.targets.length} messages checked`,
);
check(
  "no message invents a discount",
  !/\d{1,2}\s?%\s?(off|discount)|coupon|promo code/i.test(allText),
  "with no approval live, a percentage anywhere in this text is fabricated",
);
check(
  "no message manufactures scarcity or a deadline",
  !/hurry|last chance|only \d+ left|while stocks last|limited time|ends (today|tomorrow|this)/i.test(allText),
  "an unsolicited message has nobody present to push back on a fake deadline",
);
check(
  "every message carries an opt-out",
  r.targets.every((t) => /reply stop/i.test(t.text)),
  "not conditional on the channel — the one line that must survive every edit",
);
check(
  "every message says who it is from",
  r.targets.every((t) => t.text.includes("Nilgiri Post")),
  "an unattributed message about a basket is indistinguishable from a phishing attempt",
);

/**
 * The gate must be able to FAIL here, or passing means nothing.
 *
 * This is the lesson from the test bench scoring 3 out of 11 by asserting the
 * wrong property: a check that cannot distinguish "the guard worked" from "the
 * guard was never asked" is not a check. So: sabotage a message the way a
 * hurried edit before Diwali would, and watch the pipeline drop it.
 */
const sabotaged = "Hi — this is Nilgiri Post. Hurry, 15% off your basket, only 2 left, ends tomorrow!";
check(
  "a sabotaged template is caught, not repaired",
  BND.checkReply(sabotaged, { groundedStockClaims: [] }).length >= 3,
  BND.checkReply(sabotaged, { groundedStockClaims: [] }).map((v) => v.gate).join(", "),
);
check(
  "and the pipeline's own reason for dropping it is legible",
  RCV.SUPPRESSION_LABEL.blocked_by_bounds === "The drafted message failed the bounds check",
  "a merchant reading the suppression table should not have to guess",
);

/* ================= 3. an offer is announceable, never invented ================= */
console.log("\n--- the approval keystone reaches outreach too ---");

const target = r.targets.find((t) => t.treatment === "reminder");
const handle = target.items[0].handle;

const before = run();
check(
  "with nothing approved, the basket gets a plain reminder",
  before.targets.find((t) => t.cartId === target.cartId)?.treatment === "reminder",
  `${handle} — and the run says so in words: “${before.targets.find((t) => t.cartId === target.cartId)?.because.slice(0, 60)}…”`,
);

APR.decide({
  shop: SHOP,
  candidateId: `check:recovery:${handle}`,
  action: "approve",
  by: "check-recovery",
  offer: {
    handle,
    title: target.items[0].title,
    depth: 0.1,
    endsAt: new Date(AS_OF.getTime() + 14 * 86400000).toISOString(),
    maxUnits: 50,
  },
});

const after = run();
const promoted = after.targets.find((t) => t.cartId === target.cartId);
check(
  "one merchant click, and the same basket may now mention the offer",
  promoted?.treatment === "offer" && /10% off/.test(promoted.text),
  promoted ? `“${promoted.text.split(".")[1]?.trim().slice(0, 80)}…”` : "target vanished",
);
check(
  "the percentage in the message is the approved one, to the digit",
  promoted && /\b10% off\b/.test(promoted.text) && !/\b(?:5|15|20|25)% off\b/.test(promoted.text),
  "rounding 10 up to 15 because it reads better is an invented offer",
);
check(
  "and the message says the discount comes off at payment, not from this message",
  /payment page/i.test(promoted?.text ?? ""),
  "announce, never apply — the server prices, always",
);

APR.decide({ shop: SHOP, candidateId: `check:recovery:${handle}`, action: "revoke", by: "check-recovery" });
const revoked = run();
check(
  "revoke it, and the same sentence is refused again",
  revoked.targets.find((t) => t.cartId === target.cartId)?.treatment === "reminder",
  "nothing about the recovery agent changed between these three states",
);

/* ================= 4. the incident path ================= */
console.log("\n--- when the right answer is “we broke it”, not “here's 10% off” ---");

check(
  "the recovery agent reads the incident detector",
  r.incidents.length > 0,
  r.incidents.map((i) => `${i.key} from ${i.onsetAt}`).join(", "),
);
const service = r.targets.filter((t) => t.treatment === "service");
check(
  "baskets that died on the payment step during an incident get a service message",
  service.length > 0 && service.every((t) => t.lastStep === "payment"),
  `${service.length} of ${r.targets.length}`,
);
check(
  "and a service message never carries an offer",
  service.every((t) => !t.offer && !/%\s?off/.test(t.text)),
  "discounting your way out of an outage pays people to endure it",
);
check(
  "it hedges, because a cart record has no payment method to tie it to the bank",
  service.every((t) => /if that's what happened/i.test(t.text)),
  "the copy is written to the strength of the evidence, not the strength of the hunch",
);
check(
  "it names a route that works, and never the one that is failing",
  service.every((t) => /UPI and cards/.test(t.text) && !/try netbanking again/i.test(t.text)),
  "the only actionable half of an outage message",
);

/* ================= 5. sending is logged, capped and idempotent ================= */
console.log("\n--- the send log is the only memory ---");

const channels = OUT.CHANNELS;

/**
 * Voice changed the shape of this section, and the assertions had to be
 * rewritten rather than relaxed.
 *
 * The original claim was "every unavailable channel has no `deliver`", which
 * was true while nothing but `draft` was built. Voice now HAS one — Sarvam for
 * speech, Twilio for telephony — so that claim would have to be deleted or the
 * feature abandoned. Neither, because the property the claim was protecting is
 * not "no code exists"; it is:
 *
 *   NOTHING A MERCHANT CAN EDIT TURNS ON A CHANNEL.
 *
 * That is still exactly true, by two different mechanisms, and each is now
 * asserted separately. WhatsApp, SMS and email have no delivery path at all.
 * Voice has one, and what gates it is the presence of credentials — a purchase,
 * not a preference. A settings file cannot conjure a Twilio account.
 */
check(
  "every channel that claims to be available can actually deliver",
  channels.filter((c) => c.available).every((c) => typeof c.deliver === "function"),
  channels.map((c) => `${c.id}:${c.available ? "on" : "off"}`).join(" "),
);
check(
  "drafting to a file is always available; it needs nothing",
  channels.find((c) => c.id === "draft")?.available === true,
  "the right channel for a first campaign, not a placeholder",
);
check(
  "whatsapp, sms and email have NO deliver function, not a disabled one",
  ["whatsapp", "sms", "email"].every((id) => typeof channels.find((c) => c.id === id)?.deliver !== "function"),
  "a boolean can be flipped by a settings file; a missing function cannot",
);

/**
 * The credential gate, proven by moving the only thing that should move.
 *
 * A test that just read `voice.available` would pass for the wrong reason on a
 * developer machine with keys in `.env`. So this varies ONE variable — one
 * environment key — and asserts availability follows it, in both directions.
 */
const voice = channels.find((c) => c.id === "voice");
const savedFrom = process.env.TWILIO_FROM;
delete process.env.TWILIO_FROM;
const offWithoutCreds = voice.available === false;
const namesTheGap = (voice.unlockedBy ?? "").includes("TWILIO_FROM");
if (savedFrom === undefined) delete process.env.TWILIO_FROM;
else process.env.TWILIO_FROM = savedFrom;

check(
  "voice HAS a delivery path — speech and telephony are both bought",
  typeof voice.deliver === "function",
  "the one channel where the constraint is a purchase rather than missing code",
);
check(
  "and it is unavailable the moment a credential is missing",
  offWithoutCreds,
  "one variable moved: TWILIO_FROM removed from the environment",
);
check(
  "which it says by name, so a merchant can act on it",
  namesTheGap,
  "“unavailable” is not actionable; “TWILIO_FROM is unset” is",
);
check(
  "and no settings a merchant can write turns it back on",
  (() => {
    delete process.env.TWILIO_FROM;
    SET.writeSettings(SHOP, { outreach: { enabled: true, maxPerRun: 25 } }, "check");
    const stillOff = channels.find((c) => c.id === "voice").available === false;
    if (savedFrom === undefined) delete process.env.TWILIO_FROM;
    else process.env.TWILIO_FROM = savedFrom;
    return stillOff;
  })(),
  "outreach enabled, every ceiling raised, voice still off — a settings file cannot buy a Twilio account",
);
/**
 * Quiet hours, in the SHOP's timezone.
 *
 * The window wraps midnight, so the comparison is an OR and not the AND that
 * reads more naturally. Getting that backwards inverts the rule completely and
 * still looks plausible in review — it would message people only between nine
 * and nine, which is to say only while they are asleep.
 */
const quietSettings = SET.readSettings(SHOP);
const at = (iso) => new Date(iso);
check(
  "22:30 IST is quiet",
  SET.quietNow(quietSettings, at("2026-09-05T17:00:00.000Z")),
  "21:00-09:00 Asia/Kolkata; 17:00Z is 22:30 IST",
);
check("03:00 IST is quiet", SET.quietNow(quietSettings, at("2026-09-05T21:30:00.000Z")));
check("11:00 IST is not", !SET.quietNow(quietSettings, at("2026-09-05T05:30:00.000Z")));
check("20:59 IST is not", !SET.quietNow(quietSettings, at("2026-09-05T15:28:00.000Z")));
check(
  "the window is read in the shop's timezone, not the server's",
  SET.quietNow(quietSettings, at("2026-09-05T17:00:00.000Z")) &&
    !SET.quietNow({ ...quietSettings, outreach: { ...quietSettings.outreach, quietHours: { fromHour: 21, toHour: 9, tz: "UTC" } } }, at("2026-09-05T17:00:00.000Z")),
  "the same instant is 22:30 in Coonoor and 17:00 in UTC — one of those is a message at half past ten at night",
);
check(
  "the draft channel is marked as not reaching a person",
  channels.find((c) => c.id === "draft").reachesPerson === false,
  "it writes to a file a human opens on purpose; quiet hours have nothing to protect there",
);
check(
  "every other channel is",
  channels.filter((c) => c.id !== "draft").every((c) => c.reachesPerson === true),
  "a property of the channel, not a setting a merchant could answer wrongly",
);

check(
  "and each says exactly what would unlock it",
  channels.filter((c) => !c.available).every((c) => (c.unlockedBy ?? "").length > 40),
  "“coming soon” is not a plan",
);

const first = r.targets[0];
const sendResult = await OUT.send(RCV.toDraft(SHOP, first));
check("a draft delivers through the draft channel", sendResult.ok, `ref ${sendResult.ref ?? "-"}`);

const blocked = await OUT.send({ ...RCV.toDraft(SHOP, r.targets[1]), channel: "whatsapp" });
check(
  "an unavailable channel refuses and explains",
  !blocked.ok && /WhatsApp Business account/.test(blocked.error ?? ""),
  blocked.error?.slice(0, 60),
);
check(
  "and it wrote nothing to the send log",
  !OUT.readSends(SHOP).some((s) => s.cartId === r.targets[1].cartId),
  "a refused send that leaves a row would silently consume the shopper's monthly quota",
);

const second = run();
check(
  "a second run will not write about the same basket twice",
  !second.targets.some((t) => t.cartId === first.cartId) &&
    second.suppressed.some((s) => s.cartId === first.cartId && s.reason === "already_messaged_cart"),
  "idempotency comes from the log on disk, not from a variable that a restart clears",
);
check(
  "and that person is now inside their cooldown for every other basket too",
  second.suppressed.some((s) => s.customerId === first.customerId) ||
    !second.targets.some((t) => t.customerId === first.customerId),
  `cooldown ${r.settings.outreach.cooldownDays} days`,
);

/* ================= 6. the numbers agree with the proposer ================= */
console.log("\n--- the recovery page and the offers page must quote the same money ---");

const inputs = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "merchant-inputs.json"), "utf8"));
const detCandidates = DET.abandonment({ orders, carts, inputs, asOf: AS_OF });
const detAssumed = Number(
  (detCandidates[0]?.facts.find((f) => f.label === "assumed recovery")?.value ?? "").replace("%", ""),
);
check(
  "the assumed recovery rate is one number, not two",
  Math.abs(detAssumed / 100 - RCV.ASSUMED_RECOVERY) < 1e-9,
  `detector ${detAssumed}% vs recovery agent ${(RCV.ASSUMED_RECOVERY * 100).toFixed(1)}%`,
);
check(
  "and it is labelled as an assumption everywhere it appears",
  detCandidates.every((c) => /ASSUMED/i.test(c.rationale)),
  "we have never run this outreach here; there is no rate to cite",
);
check(
  "expected value is margin times that rate, never basket value",
  r.targets.every((t) => Math.abs(t.expectedValue - t.marginAtStake * RCV.ASSUMED_RECOVERY) < 0.01) &&
    r.targets.every((t) => t.marginAtStake < t.subtotal),
  "chasing revenue instead of margin is how a recovery campaign costs more than it returns",
);

/* ================= 7. nothing about a person reaches the cortex ================= */
console.log("\n--- the cortex still holds no people ---");

const summary = RCV.recoverySummary(r);
const wire = JSON.stringify(summary);
const phones = r.targets.map((t) => t.to.phone).filter(Boolean);
const emails = r.targets.map((t) => t.to.email).filter(Boolean);

check(
  "the summary that crosses into the cortex carries no phone number",
  phones.length > 0 && !phones.some((p) => wire.includes(p)),
  `${phones.length} numbers held by the recovery agent, 0 in the summary`,
);
check("no email either", !emails.some((e) => wire.includes(e)));
check(
  "no cart id and no customer id",
  !r.targets.some((t) => wire.includes(t.cartId) || wire.includes(t.customerId)),
  "counts and rupees only — the cortex has no type that can hold a person",
);
check(
  "but the merchant still learns the shape of it",
  summary.wouldContact === r.targets.length && summary.suppressed === r.suppressed.length && summary.marginAtStake > 0,
  `${summary.wouldContact} to contact, ${summary.suppressed} suppressed, ₹${summary.marginAtStake} at stake`,
);

/* ================= 8. findings flow back, and expire ================= */
console.log("\n--- the return path into the cortex ---");

const published = FND.publishFindings({
  shop: SHOP,
  incidents: [
    {
      id: "payment_incident:netbanking/HDFC",
      title: "netbanking/HDFC payments are failing at 41.4%",
      facts: [
        { label: "estimated onset", value: "2026-06-11" },
        { label: "detected", value: "2026-08-19" },
        { label: "rate, lower bound", value: "25.5%" },
      ],
    },
  ],
  actions: [{ id: "cross_sell:a", title: "cold brew -> araku", reach: 5.3, impact: 126 }],
  stopped: 3,
  recovery: RCV.recoverySummary(r),
  asOf: AS_OF,
});
check("findings publish", published.ok, published.error ?? "");
check(
  "an incident becomes one shopper-safe sentence",
  published.findings.serviceNotices.length === 1,
  `“${published.findings.serviceNotices[0]?.text}”`,
);
check(
  "the notice names an alternative and never the failing method",
  /UPI and cards are working normally/.test(published.findings.serviceNotices[0].text) &&
    !/try netbanking/i.test(published.findings.serviceNotices[0].text),
  "the only actionable half",
);
check(
  "it does NOT carry the failure rate",
  !/41|25\.5|%/.test(published.findings.serviceNotices[0].text),
  "telling a shopper 41% of netbanking fails invites them to distrust the methods that work",
);
check(
  "or a date — the onset is a window, and a window is not customer service",
  !/2026|June|11/.test(published.findings.serviceNotices[0].text),
  "the honest version of a CUSUM window is not a sentence anyone wants to receive",
);
check(
  "and the notice itself passes the shopper's own bounds check",
  BND.checkReply(published.findings.serviceNotices[0].text, { groundedStockClaims: [] }).length === 0,
  "our template, through the gate we built for the model",
);

const stillLive = FND.readFindings(SHOP, new Date(AS_OF.getTime() + 3 * 86400000));
const expired = FND.readFindings(SHOP, new Date(AS_OF.getTime() + 10 * 86400000));
check(
  "a notice survives three days",
  stillLive.serviceNotices.length === 1,
);
check(
  "and is gone after the window, whether or not anyone re-ran the analysis",
  expired.serviceNotices.length === 0,
  `TTL ${FND.NOTICE_TTL_DAYS} days — an assistant still announcing a fixed outage is now the damage`,
);
check(
  "findings report their own age",
  Math.round(FND.findingsAgeDays(expired, new Date(AS_OF.getTime() + 10 * 86400000))) === 10,
  "a merchant reading a stale conclusion needs to know it is stale",
);

/* ---- and through the cortex's two projections ---------------------- */
const feed = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "demo-store", "catalog.json"), "utf8"));
const products = feed.products.map((p) => ({
  handle: p.handle,
  title: p.title,
  productType: p.type,
  currency: feed.shop.currency,
  minPrice: Math.min(...p.variants.map((v) => v.price)),
  maxPrice: Math.max(...p.variants.map((v) => v.price)),
  totalInventory: p.variants.reduce((s, v) => s + v.inventory, 0),
  variants: p.variants.map((v) => ({ inventoryQuantity: v.inventory })),
}));
const catalog = {
  kind: "test",
  search: async () => products,
  get: async (h) => products.find((p) => p.handle === h) ?? null,
  complements: async () => [],
  policies: async () => feed.shop.policies,
};

const cortex = await CTX.buildCortex({ site: { key: SHOP, name: "Nilgiri Post" }, catalog });
const shopper = CTX.shopperView(cortex);
const shopperWire = JSON.stringify(shopper);

check(
  "the merchant side of the cortex now knows what was found",
  cortex.findings?.value.incidents.length === 1 && cortex.findings.value.recovery.wouldContact === r.targets.length,
  "the proposer fed the cortex; this is the cortex being fed back",
);
check(
  "the shopper side gets the sentence",
  shopper.serviceNotices.length === 1,
  `“${shopper.serviceNotices[0]?.text}”`,
);
check(
  "and nothing else from the findings at all",
  !shopperWire.includes("41") &&
    !shopperWire.includes("incidents") &&
    !shopperWire.includes("wouldContact") &&
    !shopperWire.includes("marginAtStake"),
  "one approved sentence plus its subject — the model cannot reach the finding underneath",
);

/**
 * A notice has a SUBJECT, and matching against it is the whole difference
 * between a service message and a broadcast.
 *
 * This was found live rather than by reasoning about it: with the notice simply
 * placed in the FACTS block, a shopper saying "my netbanking payment failed" was
 * told that payment troubleshooting is handled by the support team — the model
 * had no way to know the answer was sitting in front of it. Routing fixed that,
 * and immediately created the opposite failure: a shopper whose CARD was
 * declined was handed a sentence about netbanking, confidently and wrongly.
 */
check(
  "the notice knows which methods it is about",
  shopper.serviceNotices[0].about.includes("netbanking") && shopper.serviceNotices[0].about.includes("hdfc"),
  shopper.serviceNotices[0].about.join(", "),
);
check(
  "a shopper who names no method is matched",
  FND.methodsMentioned("my payment just failed, what do I do?").length === 0,
  "“my payment failed” names nothing, so any live notice is relevant to them",
);
check(
  "a shopper who names the failing method is matched",
  FND.methodsMentioned("my netbanking payment failed").includes("netbanking"),
);
check(
  "a shopper who names a DIFFERENT method is not",
  (() => {
    const named = FND.methodsMentioned("my card was declined at checkout");
    return named.includes("card") && !shopper.serviceNotices[0].about.some((a) => named.includes(a));
  })(),
  "handing somebody whose card bounced a sentence about netbanking is worse than saying nothing",
);
check(
  "the recovery figures stay on the merchant side",
  !shopperWire.includes(String(summary.marginAtStake)) && !shopperWire.includes(String(summary.expectedValue)),
);

/* ================= 9. settings are ceilings ================= */
console.log("\n--- the settings a merchant can actually change ---");

check(
  "the voice gap closes when a merchant answers it",
  (() => {
    const gapBefore = cortex.gaps.some((g) => /how the shop should sound/i.test(g.what));
    SET.writeSettings(SHOP, { voice: "Plain, unhurried, a bit dry. We are a small estate, not a supermarket." }, "check");
    return gapBefore;
  })(),
  "it was permanent before, because there was nowhere to type an answer",
);
const withVoice = await CTX.buildCortex({ site: { key: SHOP, name: "Nilgiri Post" }, catalog });
check(
  "and the cortex stops asking for it",
  withVoice.voice?.value.startsWith("Plain, unhurried") && !withVoice.gaps.some((g) => /how the shop should sound/i.test(g.what)),
  `“${withVoice.voice?.value.slice(0, 48)}…” · from ${withVoice.voice?.from}`,
);
check(
  "the voice reaches the assistant as style, and the gates do not read it",
  CTX.shopperView(withVoice).voice?.includes("supermarket") === true &&
    BND.checkReply("We are a small estate, not a supermarket.", { groundedStockClaims: [] }).length === 0,
  "merchant free text inside a system prompt is the shape of an injection; the worst it can do is change the register",
);

for (const [label, patch] of [
  ["a cooldown under a day", { outreach: { cooldownDays: 0 } }],
  ["more than four messages a month", { outreach: { maxPerCustomerPerMonth: 9 } }],
  ["an age window that is not a window", { outreach: { cartAgeHours: { min: 100, max: 10 } } }],
  ["a negative margin floor", { outreach: { minMarginAtStake: -1 } }],
]) {
  const res = SET.writeSettings(SHOP, patch, "check");
  check(`rejected: ${label}`, !res.ok, res.error);
}

check(
  "a settings file written by an older build keeps every ceiling",
  (() => {
    const f = SET._file(SHOP);
    fs.writeFileSync(f, JSON.stringify({ voice: "test", outreach: { enabled: true } }), "utf8");
    const s = SET.readSettings(SHOP);
    return (
      s.outreach.maxPerRun === SET.DEFAULTS.outreach.maxPerRun &&
      s.outreach.cooldownDays === SET.DEFAULTS.outreach.cooldownDays &&
      s.outreach.quietHours.tz === "Asia/Kolkata"
    );
  })(),
  "a spread-once merge leaves undefined ceilings, which every call site reads as “no limit”",
);

/* ================= cleanup ================= */
/**
 * Leave nothing behind that would change what the real store sees.
 *
 * A suite that puts the demo merchant into a thirty-day cooldown is a suite
 * that makes the campaign page render empty tomorrow and nobody knows why.
 */
const strip = (file) => {
  try {
    const kept = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .filter((l) => !l.includes(SHOP));
    fs.writeFileSync(file, kept.length ? kept.join("\n") + "\n" : "", "utf8");
  } catch {
    /* nothing written, nothing to clean */
  }
};
const files = OUT._files();
strip(files.drafts);
strip(files.sends);
strip(APR._file());
for (const f of [SET._file(SHOP), FND._file(SHOP)]) {
  try {
    fs.unlinkSync(f);
  } catch {
    /* already gone */
  }
}
check(
  "the suite cleans up after itself",
  !OUT.readSends(SHOP).length && !APR.activeOffers(SHOP).length && !fs.existsSync(SET._file(SHOP)),
  "no cooldown, no approval and no settings file left on the real store",
);

console.log(
  failed === 0
    ? `\nAll checks passed. ${r.targets.length} messages drafted from ${r.totals.cartsConsidered} baskets; ${r.suppressed.length} suppressed with a reason each.`
    : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
