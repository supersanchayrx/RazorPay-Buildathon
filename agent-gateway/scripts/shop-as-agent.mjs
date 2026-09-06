/**
 * Be the shopper's agent. Buy something. Watch every step.
 *
 * This is the end-to-end test you run yourself. It is not a mock and it is not
 * a unit suite: it speaks UCP over HTTP to a running gateway, exactly as a
 * shopper's AI would, and it takes the same path — discover, search, read the
 * offers, build a cart, open a checkout, get handed a payment link, and poll
 * until the money lands.
 *
 * IT STOPS WHERE A HUMAN IS SUPPOSED TO STOP IT. `create_checkout` comes back
 * `requires_escalation` with a `continue_url`, because Razorpay authenticates
 * the payer directly and there is no token an agent can hold that substitutes.
 * So the script prints the link, waits, and keeps polling. You open the link,
 * pay with a test card, and watch the checkout flip to `completed` with an
 * order id — in this window, without touching it.
 *
 * That pause is the product working, not the product failing. UCP has a status
 * for it. Anything that skipped it would be a simulation of a purchase, and a
 * simulated purchase proves nothing about a real one.
 *
 * Usage:
 *   node scripts/shop-as-agent.mjs
 *   node scripts/shop-as-agent.mjs --gateway http://localhost:3000 --site pk_nilgiripost_dev
 *   node scripts/shop-as-agent.mjs --store http://127.0.0.1:4000      # discover the way an agent does
 *   node scripts/shop-as-agent.mjs --query "green tea" --qty 2
 *   node scripts/shop-as-agent.mjs --code grn_XXXX                    # redeem a recovery grant
 *   node scripts/shop-as-agent.mjs --no-checkout                      # browse only, hold nothing
 */
import http from "node:http";

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const STORE = arg("store");
let GATEWAY = arg("gateway", "http://localhost:3000");
let SITE = arg("site", "pk_nilgiripost_dev");
const QUERY = arg("query", "tea");
const QTY = Number(arg("qty", "1"));
const CODE = arg("code");
const NO_CHECKOUT = flag("no-checkout");
const POLL_SECONDS = Number(arg("wait", "300"));

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  cy: (s) => `\x1b[36m${s}\x1b[0m`,
};

const step = (n, what) => console.log(`\n${c.b(`${n}.`)} ${c.b(what)}`);
const say = (s) => console.log(`   ${s}`);
const rupees = (minor) => `₹${(minor / 100).toLocaleString("en-IN")}`;

const die = (msg) => {
  console.error(`\n${c.r("stopped:")} ${msg}\n`);
  process.exit(1);
};

/* ------------------------------------------------------------------ *
 * An agent profile, served from this process
 * ------------------------------------------------------------------ */
//
// The gateway refuses to hold stock for a caller it cannot look up, so this
// script has to BE somebody. It serves its own profile on a loopback port and
// names it — which is the honest version of passing the identity check rather
// than a way around it. Stop the script and the identity stops resolving, which
// is precisely the property the gate is for.

const profileServer = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      ucp: {
        version: "2026-08-25",
        status: "success",
        capabilities: {
          "dev.ucp.shopping.cart": [{ version: "2026-08-25" }],
          "dev.ucp.shopping.checkout": [{ version: "2026-08-25" }],
        },
      },
      name: "shop-as-agent (local test harness)",
      description: "A developer driving this store's agent surface from a terminal.",
    }),
  );
});
await new Promise((r) => profileServer.listen(0, "127.0.0.1", r));
// Unreferenced so it never holds the process open. Closing it explicitly on the
// way out raced `process.exit` and tripped a libuv assertion — an alarming wall
// of text at the end of a run that had worked perfectly.
profileServer.unref();
const PROFILE = `http://127.0.0.1:${profileServer.address().port}/profile`;

/* ------------------------------------------------------------------ *
 * MCP
 * ------------------------------------------------------------------ */

let ENDPOINT = null;
let rpcId = 1;

async function rpc(method, params) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  // Streamable HTTP may frame the reply as SSE, so the JSON is located rather
  // than assumed to begin at byte zero.
  const start = text.indexOf("{");
  if (start < 0) die(`${method}: no JSON in reply (HTTP ${res.status})\n${text.slice(0, 300)}`);
  let env;
  try {
    env = JSON.parse(text.slice(start));
  } catch {
    die(`${method}: reply did not parse\n${text.slice(0, 300)}`);
  }
  if (env.error) die(`${method}: ${env.error.message ?? JSON.stringify(env.error)}`);
  return env.result;
}

/** A tool call, unwrapped to the payload the tool actually returned. */
async function tool(name, args) {
  const r = await rpc("tools/call", {
    name,
    arguments: { meta: { "ucp-agent": { profile: PROFILE } }, ...args },
  });
  const text = r?.content?.[0]?.text;
  if (typeof text !== "string") die(`${name}: unexpected envelope ${JSON.stringify(r).slice(0, 200)}`);
  return JSON.parse(text);
}

/** UCP puts problems in `messages`; print them rather than discovering them later. */
function showMessages(payload, indent = "   ") {
  for (const m of payload.messages ?? []) {
    const paint = m.severity === "unrecoverable" ? c.r : m.severity === "recoverable" ? c.y : c.dim;
    // `content` is a plain string on this wire, not { plain }. Written the wrong
    // way first, which printed a severity and an empty line — the message that
    // explains WHY a checkout escalated is the one thing an agent most needs.
    const body = typeof m.content === "string" ? m.content : (m.content?.plain ?? m.message ?? "");
    console.log(`${indent}${paint(`[${m.severity}] ${m.code}`)} ${body}`);
  }
}

/* ================================================================== *
 * 1. Discovery
 * ================================================================== */

console.log(c.dim(`\nagent profile: ${PROFILE}`));

step(1, "Discovery");

if (STORE) {
  // The path a real agent takes: it is given a STORE, not a gateway. Everything
  // else is read out of the merchant's own well-known document.
  say(`fetching ${STORE}/.well-known/ucp ${c.dim("(what an agent is actually given)")}`);
  let doc;
  try {
    const res = await fetch(`${STORE}/.well-known/ucp`, {
      redirect: "follow",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) die(`the store returned ${res.status}. An agent concludes it does not sell online.`);
    doc = await res.json();
  } catch (e) {
    die(`could not reach the store: ${e.message}`);
  }
  ENDPOINT = doc?.ucp?.services?.["dev.ucp.shopping"]?.[0]?.endpoint;
  if (!ENDPOINT) die("the profile names no dev.ucp.shopping endpoint — discovery led nowhere");
  say(`version    ${doc.ucp.version}`);
  say(`capabilities ${Object.keys(doc.ucp.capabilities ?? {}).length}: ${Object.keys(doc.ucp.capabilities ?? {}).map((k) => k.replace("dev.ucp.shopping.", "")).join(", ")}`);
  const handlers = Object.entries(doc.ucp.payment_handlers ?? {});
  if (handlers.length === 0) {
    say(c.y("no payment handler — this store cannot take an agent checkout"));
  } else {
    for (const [id, [h]] of handlers) {
      say(`payment    ${id} — ${(h?.config?.payment_methods ?? []).join(", ")}`);
    }
  }
  say(`endpoint   ${ENDPOINT}`);
} else {
  ENDPOINT = `${GATEWAY}/ucp/${SITE}/mcp`;
  say(`skipping the well-known and going straight to ${ENDPOINT}`);
  say(c.dim("pass --store http://your-store to exercise discovery the way an agent does"));
}

const tools = await rpc("tools/list", {});
say(`${tools.tools.length} operations available`);

/* ================================================================== *
 * 2. What is on offer
 * ================================================================== */

step(2, "Offers");
const promos = await tool("get_promotions", {});
if ((promos.promotions ?? []).length === 0) {
  say(c.dim(promos.notice ?? "no offers"));
  say(c.dim("approve one in the console (Offers) to see a discount flow through to the total"));
} else {
  for (const p of promos.promotions) {
    say(c.g(`${p.value}% off ${p.applies_to?.title ?? p.title}`) + c.dim(`  until ${p.ends_at.slice(0, 10)}`));
  }
  say(c.dim(promos.notice));
}

/* ================================================================== *
 * 3. Search
 * ================================================================== */

step(3, `Search for "${QUERY}"`);
const found = await tool("search_catalog", { catalog: { query: QUERY } });
showMessages(found);
const products = found.products ?? [];
if (products.length === 0) die(`nothing matched "${QUERY}". Try --query with something in the catalogue.`);

for (const p of products.slice(0, 6)) {
  const promo = p["dev.ucp.shopping.discount"]?.promotions?.[0];
  say(
    `${p.title.padEnd(32)} ${rupees(p.price_range.min.amount).padStart(9)}` +
      (promo ? `  ${c.g(`${promo.value}% off`)}` : "") +
      (p.variants.some((v) => v.availability?.available) ? "" : `  ${c.dim("(out of stock)")}`),
  );
}

// Prefer something on offer, so the discount is visible in the total below.
const pick =
  products.find((p) => p["dev.ucp.shopping.discount"] && p.variants.some((v) => v.availability?.available)) ??
  products.find((p) => p.variants.some((v) => v.availability?.available));
if (!pick) die("everything matching is out of stock");
const variant = pick.variants.find((v) => v.availability?.available);
say("");
say(`chose ${c.b(pick.title)} — ${variant.sku} × ${QTY}`);

/* ================================================================== *
 * 4. Cart
 * ================================================================== */

step(4, "Cart");
const cart = await tool("create_cart", {
  cart: {
    line_items: [{ item: { id: variant.id }, quantity: QTY }],
    ...(CODE ? { discount_codes: [CODE] } : {}),
  },
});
showMessages(cart);

const line = (t) => (cart.totals ?? []).find((x) => x.type === t);
for (const t of cart.totals ?? []) {
  const amt = t.amount < 0 ? c.g(rupees(t.amount)) : rupees(t.amount);
  say(`${(t.display_text ?? t.type).padEnd(28)} ${amt.padStart(12)}`);
}
if (line("items_discount")) {
  say(c.g(`   the discount is applied by the merchant, not computed here`));
}
say(c.dim(`cart ${cart.id} — holds no stock`));

if (NO_CHECKOUT) {
  // Ends by falling off the end rather than by `process.exit`. Exiting here
  // while fetch timers were still pending tripped a libuv assertion on Windows
  // and printed a wall of red after a run that had gone perfectly — which is
  // exactly the sort of thing that makes someone distrust a passing result.
  console.log(`
${c.dim("--no-checkout: stopping before anything is held. Nothing was reserved.")}
`);
} else {

  /* ================================================================== *
   * 5. Checkout
   * ================================================================== */

  step(5, "Checkout");
  say(c.dim("this holds stock for fifteen minutes and opens a payment order"));
  const checkout = await tool("create_checkout", { checkout: { cart_id: cart.id } });
  showMessages(checkout);

  if (!checkout.id) {
    die("the checkout was refused. The messages above say why.");
  }

  const total = (checkout.totals ?? []).find((t) => t.type === "total");
  say(`checkout ${checkout.id}`);
  say(`status   ${checkout.status === "completed" ? c.g(checkout.status) : c.y(checkout.status)}`);
  say(`total    ${c.b(rupees(total.amount))}`);

  if (checkout.status !== "completed") {
    console.log(`
  ${c.b("   Now you are the buyer.")}

     ${c.cy(checkout.continue_url)}

     ${c.dim("Open it and pay. Razorpay test cards:")}
     ${c.dim("  card 4111 1111 1111 1111 · any future expiry · any CVV · OTP 1234")}

     ${c.dim("This pause is the point. The agent cannot pay for you — Razorpay")}
     ${c.dim("authenticates the payer directly, so it hands you the link instead.")}
     ${c.dim("UCP has a status for exactly this: requires_escalation.")}
  `);
  }

  /* ================================================================== *
   * 6. Poll, exactly as an agent would
   * ================================================================== */

  step(6, "Waiting for the payment to settle");
  say(c.dim(`polling get_checkout every 3s for up to ${POLL_SECONDS}s — ctrl-C to stop`));

  const deadline = Date.now() + POLL_SECONDS * 1000;
  let final = checkout;
  let spins = 0;
  while (final.status !== "completed" && final.status !== "canceled" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    final = await tool("get_checkout", { id: checkout.id });
    process.stdout.write(`\r   ${["⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][spins++ % 8]} ${final.status}   `);
  }
  process.stdout.write("\r" + " ".repeat(40) + "\r");

  if (final.status === "completed") {
    say(c.g("paid"));
    step(7, "The order");
    const order = await tool("get_order", { id: final.order.id });
    say(`order    ${c.b(order.id)}`);
    for (const li of order.line_items ?? []) {
      say(`  ${li.quantity.total} × ${li.item.title} — ${rupees(li.totals[0].amount)}`);
    }
    const t = (order.totals ?? []).find((x) => x.type === "total");
    say(`total    ${c.b(rupees(t.amount))}`);
    say(`receipt  ${order.permalink_url}`);
    console.log(`
  ${c.g("   Done.")} An agent found this store from its domain, read the merchant's own
     offers, priced a basket the merchant priced, and placed a real Razorpay
     order — and the only thing a human did was authorise the payment.
  `);
  } else if (final.status === "canceled") {
    say(c.r("the checkout was cancelled"));
    showMessages(final);
  } else {
    say(c.y("still unpaid when the timer ran out."));
    say(c.dim(`the hold expires on its own. Re-run get_checkout later with id ${checkout.id},`));
    say(c.dim("or run with --wait 900 to wait longer."));
    say("");
    say(c.dim("If you DID pay and it still says this, the settlement did not land:"));
    say(c.dim("  · the browser confirm fires on the success page — did you close the tab early?"));
    say(c.dim("  · the webhook is the backstop, and it needs RAZORPAY_WEBHOOK_SECRET1 set"));
  }


}
