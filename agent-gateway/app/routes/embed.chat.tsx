import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { runAssistant, runAssistantStream } from "../lib/assistant.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { findSite, allowedOrigin } from "../lib/sites.server";
import { featureOn } from "../lib/featureflags.server";
import { verifySessionToken } from "../lib/identity.server";
import { jsonFeedOrders, seededOrders } from "../lib/orders.server";
import { placedOrders, mergeSources } from "../lib/orderstore.server";
import { publicBodyFailure, readPublicJson } from "../lib/http-security.server";

/**
 * Chat endpoint for custom (non-Shopify) sites.
 *
 * The Shopify twin of this route gets same-origin delivery and a Shopify-signed
 * request for free. Here we replace both by hand: CORS so the browser is
 * allowed to call us at all, and an Origin check against the site's registered
 * origins so not just anyone can.
 */

function cors(origin: string | null): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    ...(origin
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-max-age": "86400",
          vary: "Origin",
        }
      : {}),
  };
}

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: cors(origin) });

/**
 * CORS preflight.
 *
 * A preflight carries no body, so it cannot name a site — the site key travels
 * in the POST body. Answering it must therefore not depend on knowing the site.
 * That is how CORS is designed: the preflight asks "may I send this shape of
 * request at all", and enforcement happens on the real request below.
 *
 * Getting this wrong is invisible from curl and fatal in a browser: a preflight
 * answered without CORS headers surfaces as "NetworkError", not as the status
 * code you actually returned.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(origin) });
  }

  const site = findSite(new URL(request.url).searchParams.get("site"));
  if (!site) return json({ error: "unknown site key" }, 404, origin);
  const ok = allowedOrigin(site, origin);
  if (!ok) return json({ error: "origin not allowed for this site", origin }, 403, origin);
  // `enabled` is what the widget reads before it shows itself. Reported here
  // rather than inferred from a failed POST, so the bubble never appears for a
  // shop that has switched the assistant off.
  return json(
    { ok: true, site: site.name, endpoint: "chat", method: "POST", enabled: featureOn(site.key, "assistant") },
    200,
    ok,
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get("Origin");

  let body: { site?: string; message?: string; history?: unknown; session?: string; stream?: boolean };
  try {
    body = await readPublicJson<typeof body>(request, "chat");
  } catch (error) {
    const failure = publicBodyFailure(error);
    return json({ error: failure.message, error_code: failure.code }, failure.status, origin);
  }

  const site = findSite(body.site ?? new URL(request.url).searchParams.get("site"));
  if (!site) return json({ error: "unknown site key" }, 404, origin);

  const ok = allowedOrigin(site, origin);
  if (!ok) {
    return json(
      { error: "origin not allowed for this site", origin: origin ?? null },
      403,
      origin,
    );
  }

  // Placed above the stream/non-stream fork so one check covers both.
  //
  // A decline rather than an error status: the widget is embedded in the
  // merchant's page, and a 4xx there reads to a shopper as the shop being
  // broken. The reply shape is the ordinary one, so nothing in the widget
  // needs to know this state exists.
  if (!featureOn(site.key, "assistant")) {
    return json(
      {
        reply: "Chat isn't available on this store at the moment.",
        cards: [],
        bounded: false,
        gates: [],
        reasoner: "disabled",
        route: "disabled",
        toolCalls: [],
      },
      200,
      ok,
    );
  }

  const message = String(body.message ?? "").trim().slice(0, 2000);
  if (!message) return json({ error: "message is required" }, 400, ok);
  const history = Array.isArray(body.history) ? (body.history as never) : [];

  // Identity, if the merchant's own site vouched for one. A failed check is
  // never an error to the shopper: it just means the assistant stays on the
  // catalogue, which is exactly what it does for everyone not signed in.
  const verified = verifySessionToken(body.session, { site: site.key, secret: site.secret });
  const identity = verified.ok ? verified.identity : null;

  // The merchant's own history, plus the orders we placed ourselves — so
  // "where's my order?" finds something bought two minutes ago, not only what
  // their system has caught up with. Both are already scoped to the same
  // verified shopper before they get here, so merging cannot widen access.
  const merchantOrders = !site.orders
    ? null
    : site.orders.useSeedFixture
      ? seededOrders()
      : site.orders.feedUrl
        ? jsonFeedOrders(site.orders.feedUrl, site.secret)
        : null;
  const orderSource = merchantOrders
    ? mergeSources([placedOrders(site.key), merchantOrders])
    : placedOrders(site.key);

  // Streaming is opt-in per request, so the JSON contract stays intact for the
  // Shopify overlay and for any agent that would rather have one object.
  if (body.stream) {
    const events = runAssistantStream({
      catalog: jsonFeedCatalog(site.catalogFeedUrl),
      shop: site.key,
      shopName: site.name,
      message,
      history,
      identity,
      orderSource,
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const ev of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
          }
        } catch (e) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: String(e) })}\n\n`),
          );
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        ...cors(ok),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Nginx buffers proxied responses by default, which turns a stream back
        // into one slow blocking response and looks like our bug, not theirs.
        "x-accel-buffering": "no",
      },
    });
  }

  try {
    const result = await runAssistant({
      catalog: jsonFeedCatalog(site.catalogFeedUrl),
      shop: site.key,
      shopName: site.name,
      message,
      history,
      identity,
      orderSource,
    });
    return json(
      {
        reply: result.reply,
        cards: result.cards,
        // Surfaced so a demo can show the gate firing rather than assert it.
        bounded: result.violations.length > 0,
        gates: result.violations.map((v) => v.gate),
        reasoner: result.reasoner,
        route: result.route,
        toolCalls: result.toolCalls,
      },
      200,
      ok,
    );
  } catch (e) {
    return json(
      { error: "assistant failed", detail: e instanceof Error ? e.message : String(e) },
      500,
      ok,
    );
  }
};
