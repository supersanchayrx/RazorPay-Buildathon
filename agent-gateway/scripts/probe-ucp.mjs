/**
 * End-to-end, against the running servers — the journey a real shopper's agent
 * takes, in the order it takes it.
 *
 * `check-ucp.mjs` proves the logic in isolation. This proves the WIRING: that
 * discovery is reachable on the merchant's own origin, that the endpoint it
 * names answers MCP, that an agent which has never heard of CHAPMAN can find
 * its way from a domain name to a payable checkout.
 *
 * It starts a throwaway HTTP server to host its own agent profile, because UCP
 * requires the merchant to FETCH the caller's profile and a file on disk is not
 * fetchable. That is the protocol working as intended: identity is a document
 * you must actually be able to serve.
 *
 *   node scripts/probe-ucp.mjs [--store http://127.0.0.1:4000]
 */
import http from "node:http";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const STORE = arg("store", "http://127.0.0.1:4000");

let failed = 0;
const step = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};
const show = (o) => JSON.stringify(o, null, 2).split("\n").slice(0, 14).join("\n");

/* -- our own agent profile, served for the merchant to fetch ---------- */

const AGENT_PROFILE = {
  ucp: {
    version: "2026-08-25",
    status: "success",
    services: {
      "dev.ucp.shopping": [
        { version: "2026-08-25", transport: "mcp", spec: "https://ucp.dev/2026-08-25/specification/overview" },
      ],
    },
  },
};

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(AGENT_PROFILE));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const profileUrl = `http://127.0.0.1:${server.address().port}/.well-known/ucp`;
console.log(`agent profile hosted at ${profileUrl}\n`);

const meta = { "ucp-agent": { profile: profileUrl }, "idempotency-key": crypto.randomUUID() };

/* -- 1. discovery, on the MERCHANT'S origin --------------------------- */

console.log("=== discovery ===");
let endpoint = null;
try {
  const res = await fetch(`${STORE}/.well-known/ucp`, { headers: { accept: "application/json" } });
  step("the merchant's own origin serves /.well-known/ucp", res.ok, `${res.status} from ${STORE}`);
  const doc = await res.json();
  const svc = doc?.ucp?.services?.["dev.ucp.shopping"]?.find((s) => s.transport === "mcp");
  endpoint = svc?.endpoint ?? null;
  step("it advertises the shopping service over MCP", Boolean(endpoint), endpoint ?? "no endpoint");
  step("it names a protocol version", doc?.ucp?.version === "2026-08-25", doc?.ucp?.version);
  step(
    "payment handlers are declared",
    Object.keys(doc?.ucp?.payment_handlers ?? {}).length > 0,
    Object.keys(doc?.ucp?.payment_handlers ?? {}).join(", ") || "none",
  );
} catch (e) {
  step("the merchant's own origin serves /.well-known/ucp", false, String(e));
}

if (!endpoint) {
  console.log("\nno endpoint — is the demo store running?  go run . -agent http://localhost:3000");
  server.close();
  process.exit(1);
}

/* -- 2. MCP ----------------------------------------------------------- */

let seq = 0;
async function rpc(method, params) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
  });
  return res.json();
}
const call = async (name, args) => {
  const out = await rpc("tools/call", { name, arguments: { meta, ...args } });
  if (out.error) return { __rpcError: out.error };
  return out.result?.structuredContent ?? out.result;
};

console.log("\n=== handshake ===");
const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "chapman-probe", version: "0.1" },
});
step("initialize", Boolean(init.result?.serverInfo), init.result?.serverInfo?.name);

const tools = await rpc("tools/list", {});
const names = (tools.result?.tools ?? []).map((t) => t.name);
step("tools/list returns all thirteen Shopping methods", names.length === 13, names.join(", "));

/* -- 3. browse -------------------------------------------------------- */

console.log("\n=== browse ===");
const search = await call("search_catalog", { catalog: { query: "chai", pagination: { limit: 3 } } });
step("search_catalog", (search.products?.length ?? 0) > 0, `${search.products?.length ?? 0} products`);
if (search.products?.[0]) {
  const p = search.products[0];
  console.log(`      ${p.title} — ${p.price_range.min.amount / 100} ${p.price_range.min.currency}, ${p.variants.length} variant(s)`);
  step(
    "no inventory count is published",
    !JSON.stringify(p).match(/inventor/i),
    "availability only, never an on-hand number",
  );
}

const sku = search.products?.[0]?.variants?.[0]?.sku;
const detail = await call("get_product", { catalog: { id: sku } });
step("get_product resolves a bare SKU", detail.product?.handle === search.products[0].handle, sku);

/* -- 4. cart ---------------------------------------------------------- */

console.log("\n=== cart ===");
const cart = await call("create_cart", {
  cart: { line_items: [{ item: { id: sku }, quantity: 2 }] },
});
const cartTotal = cart.totals?.find((t) => t.type === "total")?.amount;
step("create_cart prices the basket", Boolean(cartTotal), `total ${cartTotal / 100} ${cart.currency}`);

const lied = await call("create_cart", {
  cart: { line_items: [{ item: { id: sku, price: { amount: 1, currency: "INR" } }, quantity: 2 }] },
});
step(
  "a price sent by the agent changes nothing",
  lied.totals?.find((t) => t.type === "total")?.amount === cartTotal,
  "asked for 1 paise; charged the catalogue price",
);

/* -- 5. checkout ------------------------------------------------------ */

console.log("\n=== checkout ===");
const anon = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 999,
    method: "tools/call",
    params: {
      name: "create_checkout",
      arguments: { meta: {}, checkout: { line_items: [{ item: { id: sku }, quantity: 1 }] } },
    },
  }),
}).then((r) => r.json());
const anonBody = anon.result?.structuredContent ?? {};
step(
  "checkout without an agent profile is refused",
  anonBody.messages?.[0]?.code === "identity_required",
  anonBody.messages?.[0]?.content?.slice(0, 60),
);

const checkout = await call("create_checkout", {
  checkout: { cart_id: cart.id },
});
if (checkout.__rpcError) {
  step("create_checkout", false, JSON.stringify(checkout.__rpcError).slice(0, 200));
} else {
  const total = checkout.totals?.find((t) => t.type === "total")?.amount;
  step("create_checkout opens a payable checkout", Boolean(checkout.id), checkout.id);
  step(
    "the checkout total matches the cart it came from",
    total === cartTotal,
    `${total / 100} ${checkout.currency}`,
  );
  step(
    "status is requires_escalation with a continue_url",
    checkout.status === "requires_escalation" && Boolean(checkout.continue_url),
    checkout.continue_url,
  );
  step(
    "the reason is stated in-protocol, not left for the agent to guess",
    checkout.messages?.some((m) => m.severity === "requires_buyer_input"),
    checkout.messages?.[0]?.content?.slice(0, 80),
  );
  step("legal links are present", (checkout.links?.length ?? 0) > 0);

  const fetched = await call("get_checkout", { id: checkout.id });
  step("get_checkout reads it back unchanged", fetched.id === checkout.id && fetched.status === checkout.status);

  const edited = await call("update_checkout", {
    id: checkout.id,
    checkout: { line_items: [{ item: { id: sku }, quantity: 9 }] },
  });
  step(
    "update_checkout refuses to move the basket under a live payment order",
    edited.messages?.some((m) => m.code === "immutable_checkout"),
    "editing it would make a genuine payment fail its own total check",
  );

  const cancelled = await call("cancel_checkout", { id: checkout.id });
  step("cancel_checkout releases the hold", cancelled.status === "canceled");

  console.log("\n      To finish the journey by hand, open:");
  console.log(`      ${checkout.continue_url}`);
}

server.close();
console.log(failed === 0 ? "\nall steps passed" : `\n${failed} step(s) failed`);
process.exit(failed ? 1 : 0);
