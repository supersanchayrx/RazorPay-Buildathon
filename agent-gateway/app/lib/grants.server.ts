/**
 * Recovery grants — a discount for one shopper, on one basket, once.
 *
 * This is the sharpest thing in CHAPMAN, so it is worth being exact about what
 * it is and what it is not.
 *
 * IT IS NOT AN OFFER THE AGENT INVENTED. The merchant approved a policy with an
 * exposure cap — a maximum depth, a standing requirement, a monthly count and a
 * monthly margin budget. A grant is a withdrawal against that, and the agent's
 * entire discretion is *whether the conditions are met*, never *how much*. The
 * depth is read out of the policy. There is no argument that produces a larger
 * one, and no code path that could.
 *
 * IT IS NOT A COUPON. A coupon is a string that works for anybody who has it.
 * A grant is bound to a cart, bound to a customer, capped at the units that
 * were actually in that basket, single-use, and dead in hours. Screenshot it,
 * post it, and it does nothing for the person who reads it.
 *
 * THE ONE GUARANTEE WORTH MORE THAN THE MONEY: `grantFor` returns what already
 * exists.
 *
 *   Shopper: "too expensive"          -> 8% off, capped at 2 units, 48 hours
 *   Shopper: "still too expensive"    -> the same 8%, the same grant
 *   Shopper: "come on, 20%?"          -> the same 8%, the same grant
 *
 * An agent that improves its offer under pressure has taught the customer base
 * to push, and that lesson spreads faster than any campaign. Idempotency here
 * is not a database nicety; it is the negotiating position, expressed as code
 * so that no prompt, no model and no future caller can give it away.
 *
 * Append-only JSONL, like the ledger and the approval store, so a redemption
 * never destroys the record of the issuance it consumed.
 */

import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths.server";
import crypto from "node:crypto";
import { record } from "./ledger.server";
import type { Reason } from "./reasons";
import type { Tier } from "./loyalty.server";

export type RecoveryGrant = {
  id: string;
  shop: string;
  /** The basket this answers. One grant per basket, forever. */
  cartId: string;
  customerId: string;
  /** One product, deliberately — the same rule as an approved offer. */
  handle: string;
  title: string;
  /** Fraction off, from the POLICY. Never from a caller, a model or a shopper. */
  depth: number;
  /** Units, capped at what was actually in the abandoned basket. */
  qtyCap: number;
  /** Gross margin the shop gives up if this is redeemed in full. Budgeted against. */
  marginCost: number;
  /** Why it was issued, in the terms the policy is written in. */
  reason: Reason;
  tier: Tier;
  issuedAt: string;
  expiresAt: string;
  /**
   * What the policy said at the moment of issue.
   *
   * Snapshotted rather than looked up later, because a merchant who tightens
   * their ceiling on Tuesday has not retroactively un-promised what went out on
   * Monday — and an audit that cannot tell those apart is not an audit.
   */
  under: { maxDepthPct: number; requiresTier: Tier };
};

type Row =
  | ({ kind: "issue" } & RecoveryGrant)
  | { kind: "redeem"; id: string; shop: string; at: string; gatewayOrderId: string };

const FILE = dataPath("recovery-grants.jsonl");

function readAll(): Row[] {
  try {
    return fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row);
  } catch {
    return [];
  }
}

function append(r: Row): boolean {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(r) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export type GrantState = "live" | "redeemed" | "expired";

export function allGrants(
  shop: string,
): Array<RecoveryGrant & { state: GrantState; redeemedAt?: string; redeemedOrderId?: string }> {
  const rows = readAll().filter((r) => r.shop === shop);
  const redeemed = new Map<string, { at: string; gatewayOrderId: string }>();
  for (const r of rows) if (r.kind === "redeem") redeemed.set(r.id, { at: r.at, gatewayOrderId: r.gatewayOrderId });

  const now = Date.now();
  return rows
    .filter((r): r is { kind: "issue" } & RecoveryGrant => r.kind === "issue")
    .map((g) => ({
      ...g,
      state: redeemed.has(g.id) ? "redeemed" : Date.parse(g.expiresAt) <= now ? "expired" : "live",
      redeemedAt: redeemed.get(g.id)?.at,
      // Kept so a shopper who created a discounted order and wandered off can
      // be sent back to the same payment page rather than told their discount
      // is gone. A one-use grant should not punish a closed tab.
      redeemedOrderId: redeemed.get(g.id)?.gatewayOrderId,
    }));
}

/**
 * The grant already standing for this basket, whatever state it is in.
 *
 * Deliberately returns expired and redeemed ones too. A shopper coming back to
 * an expired grant should be told it expired, not silently handed a fresh one —
 * "ask again tomorrow and you get another 8%" is the same failure as
 * negotiation, spread over two days.
 */
export function grantFor(
  shop: string,
  cartId: string,
): (RecoveryGrant & { state: GrantState; redeemedOrderId?: string }) | null {
  return allGrants(shop).find((g) => g.cartId === cartId) ?? null;
}

export function findGrant(
  shop: string,
  id: string,
): (RecoveryGrant & { state: GrantState; redeemedOrderId?: string }) | null {
  return allGrants(shop).find((g) => g.id === id) ?? null;
}

/**
 * What has been spent against the policy this rolling month.
 *
 * Counts EVERY grant issued in the window, redeemed or not. Budgeting only
 * redemptions would let a bad afternoon issue five hundred live grants against
 * a cap of twenty, because none of them had been spent yet — the exposure is
 * created at issue, not at redemption.
 */
export function monthlySpend(shop: string, asOf = new Date()): { count: number; margin: number } {
  const since = asOf.getTime() - 30 * 86_400_000;
  const rows = allGrants(shop).filter((g) => Date.parse(g.issuedAt) >= since);
  return {
    count: rows.length,
    margin: rows.reduce((s, g) => s + g.marginCost, 0),
  };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export type IssueInput = Omit<RecoveryGrant, "id" | "issuedAt">;

/**
 * Issue, or hand back what is already there.
 *
 * The idempotency is checked HERE rather than by the caller, so that a caller
 * written next year — a retry, a second channel, a merchant clicking twice —
 * cannot produce a second grant on the same basket by not knowing the rule.
 */
export function issue(input: IssueInput): { grant: RecoveryGrant & { state: GrantState }; created: boolean } {
  const existing = grantFor(input.shop, input.cartId);
  if (existing) return { grant: existing, created: false };

  const grant: RecoveryGrant = {
    ...input,
    id: `grn_${crypto.randomBytes(9).toString("base64url")}`,
    issuedAt: new Date().toISOString(),
  };
  append({ kind: "issue", ...grant });

  // Into the decision ledger too. A merchant reviewing what was done in their
  // name should find money leaving in the same place as everything else.
  record({
    shop: input.shop,
    kind: "reply",
    message: `recovery grant: ${Math.round(input.depth * 100)}% off ${input.title} for ${input.customerId}`,
    detail: {
      cartId: input.cartId,
      reason: input.reason,
      tier: input.tier,
      marginCost: input.marginCost,
      expiresAt: input.expiresAt,
    },
  });

  return { grant: { ...grant, state: "live" }, created: true };
}

export type RedeemResult = { ok: true } | { ok: false; reason: "unknown" | "expired" | "already_redeemed" | "not_written" };

/**
 * Spend a grant, at the moment a payment order is created against it.
 *
 * Recorded before the money moves, and checked again by `buildQuote` reading
 * the grant fresh — so a grant redeemed in one tab is already gone in the
 * other. The failure we are refusing is a single-use discount that is
 * single-use only if nobody clicks twice.
 */
export function redeem(shop: string, id: string, gatewayOrderId: string): RedeemResult {
  const g = findGrant(shop, id);
  if (!g) return { ok: false, reason: "unknown" };
  if (g.state === "redeemed") return { ok: false, reason: "already_redeemed" };
  if (g.state === "expired") return { ok: false, reason: "expired" };
  if (!append({ kind: "redeem", id, shop, at: new Date().toISOString(), gatewayOrderId })) {
    return { ok: false, reason: "not_written" };
  }
  return { ok: true };
}

/**
 * The form `buildQuote` needs, and nothing more.
 *
 * A grant reaches the pricing path as a handle, a percentage and a unit cap.
 * The customer id, the reason and the tier stay out of it — the quote does not
 * need to know who this is, and a pricing function that could see standing is
 * one that could eventually price on it.
 */
export function priceable(g: RecoveryGrant & { state: GrantState }, asOf = new Date()) {
  if (g.state !== "live") return null;
  return {
    handle: g.handle,
    title: g.title,
    depth: g.depth,
    qtyCap: g.qtyCap,
    endsAt: g.expiresAt,
    asOf: asOf.toISOString(),
  };
}

/** Test seam. */
export function _file(): string {
  return FILE;
}
