import type { LoaderFunctionArgs } from "react-router";
import { findSite } from "../lib/sites.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { agentView } from "../lib/agentview.server";

/**
 * One call, everything the merchant's Tier C middleware needs for one page.
 *
 * WHY ONE CALL AND NOT THREE. The middleware runs inside the merchant's request
 * path, in front of a page a human is waiting for. Three fetches — one for the
 * JSON-LD, one for the `Link:` header, one for the machine view — would be three
 * chances to add latency to a page load in exchange for tidiness nobody sees. So
 * the response carries the head fragment, the header value and the machine view
 * together, and `max_age` tells the middleware how long it may keep them.
 *
 * WHY THE MERCHANT'S ORIGIN IS NOT TAKEN FROM THE REQUEST. `origin` is honoured
 * only when it matches an origin already in the site registry; anything else
 * falls back to the registered one. The same rule `verifyInstall` runs under,
 * for the same reason: this endpoint mints absolute URLs and a JSON-LD document
 * that will be injected into a page, and an endpoint that will stamp any domain
 * you name into a merchant's markup is a phishing kit with a cache header.
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

  // A path is required rather than defaulted to "/". A middleware that forgot to
  // send one would otherwise get the homepage view injected into every product
  // page, which looks like it is working.
  const path = u.searchParams.get("path");
  if (!path) {
    return new Response(
      JSON.stringify({ error: "path is required, e.g. ?path=/product.html%3Fhandle%3Dgreen-tea" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const view = await agentView({
    site,
    catalog: jsonFeedCatalog(site.catalogFeedUrl),
    path,
    askedOrigin: u.searchParams.get("origin"),
    gatewayBaseUrl: `${proto}://${host}`,
  });

  return new Response(
    JSON.stringify(
      {
        page: view.page,
        head: view.head,
        jsonld: view.jsonld,
        link: view.link,
        json: view.json,
        max_age: view.maxAge,
      },
      null,
      2,
    ),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${view.maxAge}`,
        "access-control-allow-origin": "*",
      },
    },
  );
};
