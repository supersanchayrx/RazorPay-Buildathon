import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { findSite } from "../lib/sites.server";
import { findPending, findByGatewayOrder } from "../lib/orderstore.server";
import { publicKeyId, verifyPaymentSignature, fetchPayment } from "../lib/razorpay.server";
import { settlePayment } from "../lib/settle.server";
import { record } from "../lib/ledger.server";
import { publicBodyFailure, readPublicJson } from "../lib/http-security.server";

/**
 * The escalation page — where `continue_url` lands.
 *
 * An agent cannot complete a UPI payment. UPI authenticates the payer inside
 * their own banking app, by design; there is no token an agent can hold that
 * substitutes for that, and there should not be. So the agent's job ends with
 * handing the buyer a link, and this page is the other end of it.
 *
 * UCP anticipates this exactly: `status: "requires_escalation"` with a
 * `continue_url` is a defined outcome, not a failure. Which is worth stating
 * plainly, because the reflex is to treat handoff as the lesser path. On Indian
 * rails it is the ONLY honest path for the dominant payment method, and a
 * system that pretended otherwise would be fabricating a capability in exactly
 * the way the rest of this codebase refuses to.
 *
 * The page holds no basket of its own. Everything shown is read back from the
 * pending record written when the checkout opened, so what the buyer sees is
 * what the agent was quoted and what Razorpay will charge — three views of one
 * number, none of them recomputed here.
 */

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const site = findSite(params.site ?? null);
  const gatewayOrderId = String(params.orderId ?? "");
  if (!site || !site.razorpay) throw new Response("Unknown store", { status: 404 });

  const pending = findPending(gatewayOrderId);
  if (!pending || pending.shop !== site.key) throw new Response("Unknown checkout", { status: 404 });

  const placed = findByGatewayOrder(gatewayOrderId);

  return {
    shopName: site.name,
    accent: site.accent,
    gatewayOrderId,
    // Public by design: Razorpay Checkout needs it in the browser. The secret
    // is not in this payload and has no path to one.
    keyId: publicKeyId(site.razorpay),
    amount: pending.amount,
    currency: pending.currency,
    lines: pending.lines.map((l) => ({ title: l.title, qty: l.qty, lineTotal: l.lineTotal })),
    settled: placed ? { id: placed.id, status: placed.status } : null,
  };
};

/**
 * Confirm, same-origin.
 *
 * Identical in substance to `embed.checkout`'s confirm branch, and identical in
 * what it refuses to trust: the browser is not a trustworthy narrator of its
 * own payment. The signature proves the message came from Razorpay; the payment
 * is then read back from Razorpay because a valid signature says nothing about
 * whether the money was captured.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const site = findSite(params.site ?? null);
  const gatewayOrderId = String(params.orderId ?? "");
  if (!site?.razorpay) return Response.json({ ok: false, error: "unknown store" }, { status: 404 });

  let body: { razorpay_payment_id?: string; razorpay_signature?: string };
  try {
    body = await readPublicJson<typeof body>(request, "identity");
  } catch (error) {
    const failure = publicBodyFailure(error);
    return Response.json({ ok: false, error: failure.message, error_code: failure.code }, { status: failure.status });
  }
  const paymentId = String(body.razorpay_payment_id ?? "");
  const signature = String(body.razorpay_signature ?? "");

  if (!verifyPaymentSignature(site.razorpay, { orderId: gatewayOrderId, paymentId, signature })) {
    record({
      shop: site.key,
      kind: "payment_rejected",
      message: "escalation page: signature did not verify",
      detail: { gatewayOrderId, paymentId },
    });
    return Response.json({ ok: false, error: "That payment could not be verified." }, { status: 400 });
  }

  const p = await fetchPayment(site.razorpay, paymentId);
  if (!p.ok) return Response.json({ ok: false, error: p.message }, { status: 502 });
  if (p.payment.order_id !== gatewayOrderId) {
    return Response.json({ ok: false, error: "That payment is for a different order." }, { status: 400 });
  }

  const outcome = settlePayment({
    shop: site.key,
    gatewayOrderId,
    gatewayPaymentId: paymentId,
    gatewayStatus: p.payment.status,
    method: p.payment.method ?? null,
    amountMinor: p.payment.amount,
    currency: p.payment.currency,
    by: "browser",
  });
  if (outcome.mismatch) {
    return Response.json({ ok: false, error: "That payment did not match the order total." }, { status: 400 });
  }

  // The agent is polling `get_checkout` and will see `completed` on its next
  // call, because status is derived from this same order record rather than
  // pushed anywhere. One source of truth, three readers.
  return Response.json({ ok: true, orderRef: outcome.order?.id ?? null });
};

const money = (n: number, cur: string) =>
  (cur === "INR" ? "₹" : cur + " ") + Number(n).toLocaleString("en-IN");

export default function PayPage() {
  const d = useLoaderData<typeof loader>();

  if (d.settled) {
    return (
      <Shell accent={d.accent} shopName={d.shopName}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Paid</h1>
        <p style={{ color: "#555", margin: "0 0 16px" }}>
          Order <strong>{d.settled.id}</strong> is recorded. You can close this page — the assistant
          that sent you here will see it on its next check.
        </p>
      </Shell>
    );
  }

  return (
    <Shell accent={d.accent} shopName={d.shopName}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Complete your payment</h1>
      <p style={{ color: "#666", margin: "0 0 16px", fontSize: 13 }}>
        An assistant prepared this order. Check it, then pay.
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 12 }}>
        <tbody>
          {d.lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "8px 0" }}>
                {l.qty}× {l.title}
              </td>
              <td style={{ padding: "8px 0", textAlign: "right" }}>{money(l.lineTotal, d.currency)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ padding: "10px 0", fontWeight: 600 }}>Total</td>
            <td style={{ padding: "10px 0", textAlign: "right", fontWeight: 600 }}>
              {money(d.amount, d.currency)}
            </td>
          </tr>
        </tbody>
      </table>

      <button
        id="pay"
        style={{
          width: "100%",
          padding: "12px 16px",
          background: d.accent,
          color: "#fff",
          border: 0,
          borderRadius: 8,
          fontSize: 15,
          cursor: "pointer",
        }}
      >
        Pay {money(d.amount, d.currency)}
      </button>
      <p id="msg" style={{ fontSize: 13, color: "#a33", minHeight: 18, marginTop: 10 }} />

      <script src="https://checkout.razorpay.com/v1/checkout.js" defer />
      <script
        // The amount passed to Razorpay is the one the server registered when
        // the order was created. Nothing here can change it: an altered figure
        // simply fails the gateway's own order check.
        dangerouslySetInnerHTML={{
          __html: `
window.addEventListener('load', function () {
  var btn = document.getElementById('pay');
  var msg = document.getElementById('msg');
  btn.addEventListener('click', function () {
    if (!window.Razorpay) { msg.textContent = 'Payment library did not load. Check your connection and reload.'; return; }
    var rz = new window.Razorpay({
      key: ${JSON.stringify(d.keyId)},
      order_id: ${JSON.stringify(d.gatewayOrderId)},
      name: ${JSON.stringify(d.shopName)},
      description: 'Order prepared by an assistant',
      theme: { color: ${JSON.stringify(d.accent)} },
      handler: function (res) {
        msg.style.color = '#555';
        msg.textContent = 'Verifying...';
        fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(res)
        }).then(function (r) { return r.json(); }).then(function (out) {
          if (out.ok) { window.location.reload(); }
          else { msg.style.color = '#a33'; msg.textContent = out.error || 'That payment could not be verified.'; }
        }).catch(function () {
          // The money may well have moved. Never tell the buyer it failed when
          // we only failed to hear about it.
          msg.style.color = '#a33';
          msg.textContent = 'We could not confirm the payment from here. Do not pay again — reload this page in a moment.';
        });
      }
    });
    rz.on('payment.failed', function (e) {
      msg.style.color = '#a33';
      msg.textContent = (e && e.error && e.error.description) || 'That payment did not go through.';
    });
    rz.open();
  });
});`,
        }}
      />
    </Shell>
  );
}

function Shell({
  accent,
  shopName,
  children,
}: {
  accent: string;
  shopName: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        maxWidth: 420,
        margin: "48px auto",
        padding: 24,
        border: "1px solid #e5e5e5",
        borderRadius: 12,
      }}
    >
      <div style={{ fontSize: 13, color: accent, fontWeight: 600, marginBottom: 12 }}>{shopName}</div>
      {children}
    </div>
  );
}
