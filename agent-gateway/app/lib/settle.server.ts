/**
 * Turning a payment into an order — once, no matter who reports it.
 *
 * Two independent messengers race to tell us the same thing:
 *
 *   the browser   fast, present most of the time, and untrustworthy — the
 *                 success handler is JavaScript on a page anyone can open a
 *                 console on. Absent entirely if the shopper closes the tab.
 *   the webhook   slower, authenticated by Razorpay's own signature, and it
 *                 arrives even when nobody is looking at the page. May be
 *                 delivered more than once, by design.
 *
 * Neither can be relied on alone, so both call this, and it is written to be
 * called any number of times from either. The Razorpay order id is the
 * idempotency key: whichever report lands first creates the order, and every
 * later one is recognised as a duplicate and changes nothing.
 *
 * This is also the only place stock is released. A hold that outlives the
 * payment it was taken for is indistinguishable from stock that has vanished.
 */
import { record } from "./ledger.server";
import { release } from "./reservations.server";
import { findPending, settle, type PlacedOrder } from "./orderstore.server";

export type SettleInput = {
  shop: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  /** Razorpay's own word for it: captured, authorized, failed. */
  gatewayStatus: string;
  method: string | null;
  /** Minor units, as Razorpay reports them. */
  amountMinor: number;
  currency: string;
  by: PlacedOrder["settledBy"];
};

export type SettleOutcome = {
  order: PlacedOrder | null;
  duplicate: boolean;
  /** True when the amount paid did not match the amount we asked for. */
  mismatch: boolean;
};

const STATUS: Record<string, PlacedOrder["status"]> = {
  captured: "paid",
  authorized: "authorized",
  failed: "failed",
};

export function settlePayment(input: SettleInput): SettleOutcome {
  const pending = findPending(input.gatewayOrderId);
  const status = STATUS[input.gatewayStatus] ?? "failed";
  const amount = input.amountMinor / 100;

  // Whatever happened, the hold is over: paid means the units are genuinely
  // gone, failed means they were never taken.
  release(input.gatewayOrderId);

  if (!pending) {
    // A payment for an order we have no basket for. Not fatal — the money is
    // real and Razorpay's record is authoritative — but it must be loud,
    // because it means either a lost pending write or someone else's order id.
    record({
      shop: input.shop,
      kind: "payment_rejected",
      message: `settled a payment with no matching checkout: ${input.gatewayOrderId}`,
      detail: { paymentId: input.gatewayPaymentId, amount, by: input.by },
    });
    return { order: null, duplicate: false, mismatch: false };
  }

  // What we asked for versus what was paid. A signature proves the message is
  // genuine; it says nothing about the amount, and a mismatch here is the shape
  // an amount-tampering attempt would take if one ever got this far.
  const mismatch = Math.round(pending.amount * 100) !== input.amountMinor;

  const result = settle({
    shop: input.shop,
    gatewayOrderId: input.gatewayOrderId,
    gatewayPaymentId: input.gatewayPaymentId,
    status: mismatch ? "failed" : status,
    method: input.method,
    amount,
    currency: input.currency,
    lines: pending.lines,
    customer: pending.customer,
    fingerprint: pending.fingerprint,
    settledBy: input.by,
  });

  if (mismatch) {
    record({
      shop: input.shop,
      kind: "payment_rejected",
      message: `amount mismatch: quoted ${pending.amount}, paid ${amount}`,
      detail: { orderId: input.gatewayOrderId, paymentId: input.gatewayPaymentId, by: input.by },
    });
    return { order: result.order, duplicate: result.duplicate, mismatch: true };
  }

  record({
    shop: input.shop,
    kind: result.duplicate ? "payment_verified" : "payment_verified",
    message: result.duplicate
      ? `duplicate report of ${input.gatewayOrderId} via ${input.by}, ignored`
      : `${result.order.id} ${status} ${input.currency} ${amount} via ${input.by}`,
    detail: {
      orderId: input.gatewayOrderId,
      paymentId: input.gatewayPaymentId,
      amount,
      method: input.method,
      by: input.by,
      duplicate: result.duplicate,
      identified: Boolean(pending.customer),
    },
  });

  return { order: result.order, duplicate: result.duplicate, mismatch: false };
}
