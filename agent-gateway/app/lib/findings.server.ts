/**
 * Findings — the return path from the proposer into the cortex.
 *
 * The cortex has fed the proposer since the day both existed: floors, costs,
 * catalogue shape, what was refused. Nothing ever came back. So the system
 * could work out on Tuesday that netbanking was failing at 41%, and the
 * assistant talking to a shopper on Wednesday still knew nothing about it — and
 * would cheerfully suggest they try again.
 *
 * WHY THIS IS A FILE AND NOT A FUNCTION CALL.
 *
 * The obvious fix is for `buildCortex` to call `runProposals`. That is wrong in
 * a way worth writing down: the cortex is assembled on the shopper's path,
 * cached for sixty seconds, and asked several times per conversation. The
 * proposer reads eight hundred orders, runs seven detectors, a false-discovery
 * correction and a ranker. Putting one inside the other makes every shopper's
 * first message wait on a weekly analytics job, and the first thing anyone does
 * about that is cache it somewhere — at which point you have this file, built
 * accidentally and without a timestamp.
 *
 * So: the proposer PUBLISHES, the cortex READS, and the read is a small JSON
 * document with a `ranAt` on it. Findings go stale, they say when they were
 * made, and a merchant looking at the cortex can see that the last analysis ran
 * nine days ago — which is itself a fact worth surfacing.
 *
 * WHAT MAY CROSS, AND WHAT MAY NOT.
 *
 * Only aggregates. The recovery agent knows phone numbers; what it publishes
 * here is a count and a rupee figure. The cortex's first rule is that it holds
 * no shopper data and has no type that could carry a person, and that rule is
 * enforced at this boundary rather than trusted downstream.
 *
 * THE SERVICE NOTICE IS THE ONE THING SHOPPERS SEE.
 *
 * Everything else here is merchant-only. A service notice is a sentence,
 * WRITTEN BY THIS FILE and bounds-checked before it is stored, that the
 * assistant may relay verbatim to a shopper. It is the narrowest possible
 * channel from analytics to a customer's screen: not a fact the model may
 * paraphrase, not a data structure it may reason over — one approved sentence,
 * or nothing. "Some netbanking payments have been failing; UPI is going through
 * normally" is worth a great deal to someone whose card just bounced, and there
 * is no safe way to let a model derive it from a CUSUM alarm.
 */

import fs from "node:fs";
import path from "node:path";
import { checkReply } from "./bounds.server";

export type ServiceNotice = {
  id: string;
  /** Server-written. The assistant may repeat this and may not rewrite it. */
  text: string;
  /**
   * The payment methods this notice is ABOUT, lowercased.
   *
   * Not for the model — for the router. Without it, a shopper who says their
   * CARD was declined during a netbanking outage is handed a sentence about
   * netbanking, which is unhelpful in a way that reads as automated. A notice
   * has a subject, and matching against it is the difference between a service
   * message and a broadcast.
   */
  about: string[];
  /** After this, the notice is dropped whether or not anyone re-ran the analysis. */
  until: string;
};

/**
 * The payment vocabulary a shopper actually uses.
 *
 * Deliberately short. Its only job is to answer "did they name a method, and
 * which" — if none of these appears in the message, the shopper said something
 * like "my payment failed" and any live notice is relevant to them.
 */
export const PAYMENT_WORDS: Array<{ token: string; re: RegExp }> = [
  { token: "upi", re: /\bupi\b|\bgpay\b|\bphonepe\b|\bpaytm\b/i },
  { token: "card", re: /\bcards?\b|\bcredit card\b|\bdebit card\b|\bvisa\b|\bmastercard\b|\brupay\b/i },
  { token: "netbanking", re: /\bnet\s?banking\b/i },
  { token: "wallet", re: /\bwallet\b/i },
  { token: "emi", re: /\bemi\b/i },
];

/** Which methods a shopper's message names, if any. */
export function methodsMentioned(message: string): string[] {
  return PAYMENT_WORDS.filter((w) => w.re.test(message)).map((w) => w.token);
}

export type ShopFindings = {
  shop: string;
  ranAt: string;
  incidents: Array<{ id: string; title: string; onsetAt: string; detectedAt: string }>;
  topActions: Array<{ id: string; title: string; monthlyValue: number }>;
  stopped: number;
  /** Aggregates only. Never a cart, never a customer. */
  recovery: {
    wouldContact: number;
    suppressed: number;
    marginAtStake: number;
    expectedValue: number;
    enabled: boolean;
  } | null;
  /**
   * What shoppers SAID, counted. Merchant-only, and the most valuable thing in
   * this document.
   *
   * Everything else here was derived from orders — what happened. This is the
   * only field that answers why, and it exists because somebody asked. It never
   * reaches a shopper projection: telling a customer "31% of people say we're
   * too expensive" is a sentence with no upside.
   *
   * `enough` carries the sample floor with the data, so a consumer cannot read
   * four answers as a finding by forgetting to check.
   */
  reasons: { total: number; enough: boolean; counts: Array<{ reason: string; count: number; share: number }> } | null;

  /**
   * When the reason counts were last refreshed, which is NOT when the analysis
   * ran.
   *
   * One timestamp for a document with two writers would be a lie in whichever
   * direction it was last written. A phone call refreshes the reasons and
   * touches nothing else; if it moved `ranAt`, the console would report that
   * the weekly analysis ran when in fact somebody answered the phone, and
   * "detected four weeks ago" would quietly become "detected just now".
   */
  conversationsAt?: string | null;
  serviceNotices: ServiceNotice[];
};

/** A trailing newline, so the file ends the way every other one here does. */
const NL = String.fromCharCode(10);

const file = (shop: string) =>
  path.join(process.cwd(), "data", `findings-${shop.replace(/[^a-z0-9_]/gi, "_")}.json`);

/**
 * How long a finding is allowed to speak for itself.
 *
 * A payment incident that was true nine days ago may have been fixed eight days
 * ago, and an assistant still telling shoppers netbanking is broken is now the
 * thing causing the damage. Nothing here outlives the window, whether or not
 * anyone remembers to re-run the analysis — the failure mode we are refusing is
 * a stale notice that survives because a cron job stopped.
 */
export const NOTICE_TTL_DAYS = 7;

export function readFindings(shop: string, asOf = new Date()): ShopFindings | null {
  let f: ShopFindings;
  try {
    f = JSON.parse(fs.readFileSync(file(shop), "utf8")) as ShopFindings;
  } catch {
    return null;
  }
  return { ...f, serviceNotices: (f.serviceNotices ?? []).filter((n) => Date.parse(n.until) > asOf.getTime()) };
}

/** Age of the last analysis, in days. Null when there has never been one. */
export function findingsAgeDays(f: ShopFindings | null, asOf = new Date()): number | null {
  if (!f) return null;
  return (asOf.getTime() - Date.parse(f.ranAt)) / 86_400_000;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

type IncidentLike = { id: string; title: string; facts: Array<{ label: string; value: string }> };
type ActionLike = { id: string; title: string; reach: number; impact: number };

/**
 * Turn one payment incident into a sentence a shopper may be told.
 *
 * Written by template from the detector's own facts, and then put through the
 * same bounds check as everything else the shopper hears. Three deliberate
 * absences: no failure rate (a shopper does not need to know 41% of netbanking
 * is failing, and telling them invites them to distrust the working methods
 * too), no date (the onset is a window, and the honest version of that window
 * is not a customer-service sentence), and no apology for something we have not
 * confirmed is ours.
 *
 * What it does carry is the only actionable part: another way to pay.
 */
function noticeFor(incident: IncidentLike, until: string): ServiceNotice | null {
  const key = incident.id.replace(/^payment_incident:/, "");
  const [method] = key.split("/");
  const bank = key.includes("/") ? key.split("/")[1] : null;

  // The alternative must not name the method that is broken.
  const alternatives = ["UPI", "cards", "netbanking"].filter(
    (a) => a.toLowerCase() !== method.toLowerCase(),
  );

  const text =
    `Some ${bank ? `${bank} ${method}` : method} payments have not been going through recently. ` +
    `If one fails, ${alternatives.slice(0, 2).join(" and ")} are working normally.`;

  // Our own sentence, through the shopper's gate. A template edited in a hurry
  // is exactly the case this catches, and it costs nothing to check.
  if (checkReply(text, { groundedStockClaims: [] }).length) return null;

  return {
    id: incident.id,
    text,
    // The failing method, plus the bank when there is one, so a shopper who
    // names their bank is matched as precisely as one who names the method.
    about: [method.toLowerCase(), ...(bank ? [bank.toLowerCase()] : [])],
    until,
  };
}

export function publishFindings(input: {
  shop: string;
  incidents: IncidentLike[];
  actions: ActionLike[];
  stopped: number;
  recovery: ShopFindings["recovery"];
  reasons?: ShopFindings["reasons"];
  asOf?: Date;
}): { ok: boolean; findings: ShopFindings; error?: string } {
  const asOf = input.asOf ?? new Date();
  const until = new Date(asOf.getTime() + NOTICE_TTL_DAYS * 86_400_000).toISOString();

  const findings: ShopFindings = {
    shop: input.shop,
    ranAt: asOf.toISOString(),
    incidents: input.incidents.map((i) => ({
      id: i.id,
      title: i.title,
      onsetAt: i.facts.find((f) => f.label === "estimated onset")?.value ?? "",
      detectedAt: i.facts.find((f) => f.label === "detected")?.value ?? "",
    })),
    topActions: input.actions.slice(0, 5).map((a) => ({
      id: a.id,
      title: a.title,
      monthlyValue: Math.round(a.reach * a.impact),
    })),
    stopped: input.stopped,
    recovery: input.recovery,
    reasons: input.reasons ?? null,
    conversationsAt: input.reasons ? asOf.toISOString() : (readFindings(input.shop, asOf)?.conversationsAt ?? null),
    serviceNotices: input.incidents
      .filter((i) => i.id.startsWith("payment_incident:"))
      .map((i) => noticeFor(i, until))
      .filter((n): n is ServiceNotice => n !== null),
  };

  try {
    fs.mkdirSync(path.dirname(file(input.shop)), { recursive: true });
    fs.writeFileSync(file(input.shop), JSON.stringify(findings, null, 2) + "\n", "utf8");
  } catch (e) {
    return { ok: false, findings, error: (e as Error).message };
  }
  return { ok: true, findings };
}

/** Test seam. */
export function _file(shop: string): string {
  return file(shop);
}

/**
 * Refresh ONE part of the findings document, leaving the rest alone.
 *
 * `publishFindings` is what an analysis run calls: it writes the whole document
 * because it computed the whole document. This is for the other writers — a
 * phone call that just captured a reason, a recovery run that just recomputed
 * who it would contact — and the distinction is load-bearing.
 *
 * THE BUG THIS EXISTS TO PREVENT. Calling `publishFindings` from a voice call
 * with no incidents would write `incidents: []` and `serviceNotices: []`, and
 * the assistant would stop telling shoppers that netbanking is failing —
 * silently, in the middle of the outage, because somebody answered the phone.
 * A partial writer that uses a whole-document API blanks everything it does not
 * know about.
 *
 * `ranAt` is left exactly where the last analysis put it. A patch is not an
 * analysis, and a document that claims to be fresher than its findings are is
 * worse than an honestly stale one.
 *
 * Returns null when there is nothing to patch: with no analysis ever run there
 * is no document, and inventing an empty one would make "never analysed" and
 * "analysed and found nothing" look identical.
 */
export function updateFindings(
  shop: string,
  patch: Partial<Pick<ShopFindings, "reasons" | "recovery">>,
  asOf = new Date(),
): ShopFindings | null {
  const current = readFindings(shop, asOf);
  if (!current) return null;

  const next: ShopFindings = {
    ...current,
    ...(patch.reasons !== undefined
      ? { reasons: patch.reasons, conversationsAt: asOf.toISOString() }
      : {}),
    ...(patch.recovery !== undefined ? { recovery: patch.recovery } : {}),
  };

  try {
    fs.writeFileSync(file(shop), JSON.stringify(next, null, 2) + NL, "utf8");
  } catch {
    return null;
  }
  return next;
}
