import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { findSite } from "../lib/sites.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { resolveAgent } from "../lib/ucp.server";
import { METHODS, type MethodContext } from "../lib/ucpmethods.server";
import { TOOLS } from "../lib/ucptools";
import { record } from "../lib/ledger.server";

/**
 * The MCP endpoint a shopper's agent talks to.
 *
 * Transport was not guessed. `tools/list` was called against a live Shopify
 * store — `https://weareallbirds.myshopify.com/api/ucp/mcp` — and it answered
 * with MCP Streamable HTTP: JSON-RPC 2.0 over POST, `initialize` / `tools/list`
 * / `tools/call`, and the OpenRPC params flattened into one arguments object.
 * That is what this implements, so an agent written against any UCP merchant
 * works here unchanged.
 *
 * WHERE WE DELIBERATELY DIFFER FROM SHOPIFY:
 *
 * Allbirds refuses `search_catalog` outright with JSON-RPC error -32001 when
 * the caller's agent profile cannot be fetched. We allow anonymous READS. A
 * catalogue is public — it is on their website — and refusing to answer
 * protects nothing while making the store invisible to any agent whose profile
 * host happens to be down.
 *
 * Anything that HOLDS STOCK OR MOVES MONEY does require a reachable profile,
 * and refuses in-protocol rather than at the transport, so the agent gets a
 * `messages[]` explaining what to fix instead of an opaque error code.
 */

const CORS: HeadersInit = {
  // A public protocol endpoint. Origin is not the access control here — agent
  // identity is, on the operations where it matters — and an Origin allowlist
  // would only lock out browser-based agents while stopping no server at all.
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-max-age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });

/** JSON-RPC error, for transport-level faults only. */
const rpcError = (id: unknown, code: number, message: string, data?: unknown) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

/**
 * Our own origin, as an agent would reach it.
 *
 * Behind a tunnel or proxy the request URL is the internal address, so
 * `continue_url` built from it would send the buyer somewhere only we can
 * reach — a payment link that 404s for the person holding the money.
 */
function baseUrlOf(request: Request): string {
  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? u.host;
  return `${proto}://${host}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // MCP Streamable HTTP allows a GET to open a server-initiated SSE stream. We
  // have nothing to push — every response is the answer to a request — so we
  // decline explicitly rather than holding a connection open forever.
  return json({ error: "This endpoint accepts POST (JSON-RPC 2.0). No server-initiated stream." }, 405);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const site = findSite(params.site ?? null);
  if (!site) return rpcError(null, -32001, "Unknown store.");

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return rpcError(null, -32700, "Parse error: body was not JSON.");
  }

  const id = body.id ?? null;
  const method = String(body.method ?? "");
  const p = body.params ?? {};

  /* ---------------- MCP lifecycle ---------------- */

  if (method === "initialize") {
    return json({
      jsonrpc: "2.0",
      id,
      result: {
        // Echo the client's protocol version when we can speak it, which for
        // this handshake we always can — there is no state to negotiate.
        protocolVersion: String((p as { protocolVersion?: string }).protocolVersion ?? "2025-06-18"),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `chapman-ucp:${site.key}`, version: "0.1.0" },
      },
    });
  }

  // Notifications carry no id and MUST NOT be answered with a result.
  if (method.startsWith("notifications/")) return new Response(null, { status: 202, headers: CORS });

  if (method === "ping") return json({ jsonrpc: "2.0", id, result: {} });

  if (method === "tools/list") {
    return json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  }

  /* ---------------- tools/call ---------------- */

  if (method !== "tools/call") {
    return rpcError(id, -32601, `Method not found: ${method}`);
  }

  const call = p as { name?: string; arguments?: Record<string, unknown> };
  const name = String(call.name ?? "");
  const fn = METHODS[name];
  if (!fn) {
    return rpcError(id, -32601, `Unknown tool: ${name}. Call tools/list for what this store supports.`);
  }

  const args = call.arguments ?? {};
  const agent = await resolveAgent(args.meta);

  const ctx: MethodContext = {
    site,
    catalog: jsonFeedCatalog(site.catalogFeedUrl),
    agent,
    baseUrl: baseUrlOf(request),
  };

  try {
    const result = await fn(ctx, args);

    // Every agent action against a merchant is attributable and logged, the
    // same way every assistant reply is. An agent-readable front that leaves no
    // record is a hole in the ledger, not a feature.
    record({
      shop: site.key,
      kind: "reply",
      message: `ucp ${name}`,
      detail: {
        agent: agent?.host ?? null,
        verified: agent?.verified ?? false,
        status: (result as { status?: string }).status ?? "ok",
      },
    });

    return json({
      jsonrpc: "2.0",
      id,
      result: {
        // Both forms. `structuredContent` is what a modern MCP client reads;
        // `content` is the text fallback older ones require, and omitting it
        // makes the response unreadable to them rather than merely plainer.
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      },
    });
  } catch (e) {
    record({
      shop: site.key,
      kind: "tool_error",
      message: `ucp ${name} threw`,
      detail: { agent: agent?.host ?? null, error: e instanceof Error ? e.message : String(e) },
    });
    return rpcError(id, -32603, "Internal error", {
      code: "internal_error",
      content: e instanceof Error ? e.message : String(e),
    });
  }
};
