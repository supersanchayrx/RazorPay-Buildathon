/**
 * Can an agent finish a purchase without a human? Ask Razorpay, do not assume.
 *
 * THE QUESTION, EXACTLY: `create_checkout` returns `requires_escalation` and a
 * `continue_url`, because UPI authenticates the payer inside their own banking
 * app and no token an agent holds can substitute for that. That is honest on
 * Indian rails and it is the right default. But it means the demo has a human
 * step in the middle, and the ask was for an agent that completes the purchase
 * end to end.
 *
 * The only way that is possible is Razorpay's Server-to-Server API, where the
 * merchant's server creates the payment directly rather than handing the buyer
 * to Checkout. S2S is not on by default: it is enabled per account, after
 * review, usually with PCI scope attached for cards. So the question is not
 * "how do we build it" but "is it open on this account at all", and the answer
 * decides whether headless completion is a feature or a fabrication.
 *
 * WHAT THIS SCRIPT WILL NOT DO: conclude anything from a plausible-looking
 * error message. It prints the HTTP status, the Razorpay error code and the
 * description, verbatim, for each route it tries. A probe that summarises a
 * refusal into "not supported" has thrown away the one detail that tells you
 * whether it is a permission you can request or a route that no longer exists.
 *
 * TEST MODE ONLY. It refuses to run against a live key, and every amount is
 * one rupee. Secrets are read from the environment by NAME and never printed.
 *
 * Run:  node scripts/probe-s2s.mjs
 */
import fs from "node:fs";
import path from "node:path";

/* ---- environment, without a dependency ---- */
const envPath = path.join(process.cwd(), "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KEY_ID = process.env.RAZORPAY_TEST_API_KEY_ID1;
const KEY_SECRET = process.env.RAZORPAY_TEST_API_KEY_SECRET1;

if (!KEY_ID || !KEY_SECRET) {
  console.error("RAZORPAY_TEST_API_KEY_ID1 / _SECRET1 not set. Nothing to probe.");
  process.exit(1);
}
// A live key here would be creating real payments on a real account to answer a
// question about a demo. The refusal is the point.
if (!KEY_ID.startsWith("rzp_test_")) {
  console.error(`Refusing to probe with a non-test key (${KEY_ID.slice(0, 9)}…).`);
  process.exit(1);
}

const API = "https://api.razorpay.com/v1";
const AUTH = "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");

console.log(`key: ${KEY_ID}  (test mode)\n`);

async function call(label, route, body, form = false) {
  const url = `${API}${route}`;
  let res, text;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: AUTH,
        "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
      },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    text = await res.text();
  } catch (e) {
    console.log(`${label}\n  NETWORK  ${e instanceof Error ? e.message : e}\n`);
    return { ok: false, status: 0, body: null };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* HTML error pages happen; the raw prefix is printed below. */
  }

  const err = parsed?.error;
  console.log(`${label}`);
  console.log(`  POST ${route}`);
  console.log(`  HTTP ${res.status}`);
  if (err) {
    console.log(`  code        ${err.code ?? "—"}`);
    console.log(`  description ${err.description ?? "—"}`);
    if (err.reason) console.log(`  reason      ${err.reason}`);
    if (err.field) console.log(`  field       ${err.field}`);
  } else if (parsed) {
    console.log(`  keys        ${Object.keys(parsed).join(", ")}`);
    if (parsed.id) console.log(`  id          ${parsed.id}`);
    if (parsed.status) console.log(`  status      ${parsed.status}`);
    if (parsed.next) console.log(`  next        ${JSON.stringify(parsed.next)}`);
  } else {
    console.log(`  body        ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  }
  console.log("");
  return { ok: res.ok, status: res.status, body: parsed };
}

/* ---- 1. an order, which also proves the keys work at all ---- */

const order = await call("1. Create an order (baseline — this must work)", "/orders", {
  amount: 100,
  currency: "INR",
  receipt: `s2s_probe_${Date.now().toString(36)}`,
  notes: { purpose: "s2s capability probe" },
});

if (!order.ok) {
  console.log("The baseline failed, so nothing below would mean anything. Stopping.");
  process.exit(1);
}
const orderId = order.body.id;

/* ---- 2. S2S UPI collect, the route headless completion would use ---- */
//
// `success@razorpay` is Razorpay's documented test VPA: in test mode a collect
// request to it is auto-approved, which is the whole reason headless completion
// could be possible here and nowhere near a live account.

await call("2. S2S UPI collect (the headless route)", "/payments/create/upi", {
  amount: 100,
  currency: "INR",
  order_id: orderId,
  email: "probe@nilgiripost.example",
  contact: "+919812345678",
  method: "upi",
  upi: { flow: "collect", vpa: "success@razorpay", expiry_time: 5 },
});

/* ---- 3. the older S2S JSON route, in case only that one is open ---- */

await call("3. S2S ajax route (older S2S surface)", "/payments/create/ajax", {
  amount: 100,
  currency: "INR",
  order_id: orderId,
  email: "probe@nilgiripost.example",
  contact: "+919812345678",
  method: "upi",
  vpa: "success@razorpay",
});

/* ---- 3b. the same two routes form-encoded ---- */
//
// Razorpays older S2S surface is form-encoded and expects the key id in the
// body. Retried that way so that a refusal cannot be blamed on a content type,
// which is exactly the kind of detail that turns a real answer into a guess.

await call("3b. S2S upi, form-encoded", "/payments/create/upi", {
  amount: "100",
  currency: "INR",
  order_id: orderId,
  email: "probe@nilgiripost.example",
  contact: "+919812345678",
  method: "upi",
  "upi[flow]": "collect",
  "upi[vpa]": "success@razorpay",
  key_id: KEY_ID,
}, true);

await call("3c. S2S ajax, form-encoded with key_id", "/payments/create/ajax", {
  amount: "100",
  currency: "INR",
  order_id: orderId,
  email: "probe@nilgiripost.example",
  contact: "+919812345678",
  method: "upi",
  vpa: "success@razorpay",
  key_id: KEY_ID,
}, true);

/* ---- 4. what IS open: a payment link, which still needs a payer ---- */
//
// Included so the result is a comparison rather than a bare refusal. If this
// succeeds and the two above do not, the account is healthy and S2S is simply
// not enabled — which is a different conclusion from "the keys are wrong".

await call("4. Payment link (control — proves the account is healthy)", "/payment_links", {
  amount: 100,
  currency: "INR",
  accept_partial: false,
  description: "S2S capability probe",
  customer: { email: "probe@nilgiripost.example", contact: "+919812345678" },
  notify: { sms: false, email: false },
  reminder_enable: false,
});

console.log("─".repeat(72));
console.log(`
Read it like this:

  2 or 3 returned a payment id      headless completion is REAL in test mode.
                                    Build complete_checkout to drive it.

  2 and 3 refused, 4 succeeded      the account is fine and S2S is not enabled.
                                    Headless completion cannot be promised. The
                                    agent hands the buyer continue_url, which is
                                    a defined UCP outcome and the honest one on
                                    UPI rails — say so on camera rather than
                                    implying the limitation is ours.

  everything refused                a credentials or account problem, not an
                                    answer to the question that was asked.
`);
