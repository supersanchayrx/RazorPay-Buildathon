import type { LoaderFunctionArgs } from "react-router";
import { findSite } from "../lib/sites.server";
import { featureOn } from "../lib/featureflags.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { llmsTxt } from "../lib/agentview.server";
import { selfOrigin } from "../lib/origin.server";

/**
 * `/llms.txt` for one store, generated.
 *
 * It has to end up on the MERCHANT'S origin — a model handed nilgiripost.example
 * guesses `nilgiripost.example/llms.txt` and nowhere else, exactly as a protocol
 * agent looks only at their well-known path. So the merchant proxies or redirects
 * one more path, and the content is computed here where the offers and the
 * catalogue actually live.
 *
 * Served as `text/plain` rather than `text/markdown`: it is fetched by tools that
 * render whatever comes back, and a content type a browser offers to download is
 * a worse failure than an unrendered heading.
 */

/**
 * The shop's one-line description, if the feed has one.
 *
 * Not on `CatalogSource`, which is deliberately narrow — it exists so the
 * assistant does not care where products come from, and a tagline is not part of
 * that job. Read directly, and omitted on any failure rather than substituted.
 */
async function taglineOf(feedUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return undefined;
    const feed = (await res.json()) as { shop?: { tagline?: string } };
    return feed.shop?.tagline;
  } catch {
    return undefined;
  }
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const site = findSite(params.site ?? null);
  // Switched off is indistinguishable from absent, on purpose. A merchant who
  // turned the agent surface off has no agent surface, and an agent told "404"
  // stops asking rather than retrying with better credentials.
  if (!site || !featureOn(site.key, "agent_front")) return new Response("unknown store\n", { status: 404 });

  const u = new URL(request.url);

  const body = await llmsTxt({
    site,
    catalog: jsonFeedCatalog(site.catalogFeedUrl),
    askedOrigin: u.searchParams.get("origin"),
    gatewayBaseUrl: selfOrigin(request),
    tagline: await taglineOf(site.catalogFeedUrl),
  });

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Longer than discovery. This is a description of the store, not a
      // statement about what it will charge, so a ten-minute-old copy is
      // harmless in a way a ten-minute-old payment handler is not.
      "cache-control": "public, max-age=600",
      "access-control-allow-origin": "*",
    },
  });
};
