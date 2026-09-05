import type { LoaderFunctionArgs } from "react-router";
import { findSite } from "../lib/sites.server";
import { discoveryDocument } from "../lib/ucp.server";

/**
 * The UCP discovery document for one store.
 *
 * This is the whole integration. A merchant makes `/.well-known/ucp` on THEIR
 * origin return this — a proxy handler of about fifteen lines in any language —
 * and their store is agent-transactable. Everything after discovery is a call
 * to the `endpoint` named inside, which is us.
 *
 * It has to be their origin, not ours: an agent told to shop at
 * nilgiripost.example looks at `nilgiripost.example/.well-known/ucp` and
 * nowhere else. There is no registry to be listed in and no directory to join.
 * That is a feature of the protocol, not an inconvenience — it means the
 * merchant's own domain remains the authority on who may transact on their
 * behalf, and they can revoke us by deleting one route.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const site = findSite(params.site ?? null);
  if (!site) {
    return new Response(JSON.stringify({ error: "unknown store" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? u.host;

  return new Response(JSON.stringify(discoveryDocument(site, `${proto}://${host}`), null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Public, and cheap to recompute. Five minutes is long enough to spare us
      // a request per agent call and short enough that enabling payments shows
      // up in discovery while the merchant is still looking at the screen.
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
};
