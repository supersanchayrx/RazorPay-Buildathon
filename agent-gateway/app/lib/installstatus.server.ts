/**
 * What is actually installed on the merchant's storefront.
 *
 * A registered site and an enabled feature flag only describe CHAPMAN's side
 * of the boundary. Neither proves that the merchant pasted the embed tag or
 * published the UCP discovery route.
 *
 * The catalogue feed is the server-reachable URL we already require. Its
 * origin is therefore the honest probe target in Docker too, where the
 * browser-facing origin is localhost but the gateway reaches `store:4000`.
 */
import type { Site } from "./sites.server";
export { closeDatabase as _closeDatabase } from "./database.server";

export type SurfaceInstall = {
  installed: boolean;
  detail: string;
};

export type StorefrontInstallStatus = {
  browserOrigin: string;
  probeOrigin: string;
  assistant: SurfaceInstall;
  agentFront: SurfaceInstall;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const notInstalled = (detail: string): SurfaceInstall => ({
  installed: false,
  detail,
});

export async function inspectStorefrontInstall(
  site: Site,
  fetcher: FetchLike = fetch,
  timeoutMs = 2500,
): Promise<StorefrontInstallStatus> {
  const browserOrigin = site.origins[0] ?? "";
  let probeOrigin = "";
  try {
    probeOrigin = new URL(site.catalogFeedUrl).origin;
  } catch {
    return {
      browserOrigin,
      probeOrigin,
      assistant: notInstalled(
        "The catalogue URL is invalid, so the storefront could not be checked.",
      ),
      agentFront: notInstalled(
        "The catalogue URL is invalid, so the storefront could not be checked.",
      ),
    };
  }

  const [home, discovery] = await Promise.allSettled([
    fetcher(`${probeOrigin}/`, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(timeoutMs),
    }),
    fetcher(`${probeOrigin}/.well-known/ucp`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    }),
  ]);

  let assistant = notInstalled(
    "No Chapman embed tag was found on the storefront home page.",
  );
  if (home.status === "fulfilled") {
    if (home.value.ok) {
      const html = await home.value.text();
      const namesThisSite =
        html.includes(`data-site="${site.key}"`) ||
        html.includes(`data-site='${site.key}'`);
      if (html.includes("/embed.js") && namesThisSite) {
        assistant = { installed: true, detail: `Embed found for ${site.key}.` };
      }
    } else {
      assistant = notInstalled(
        `The storefront home page returned ${home.value.status}.`,
      );
    }
  } else {
    assistant = notInstalled(
      "The storefront home page could not be reached from Chapman.",
    );
  }

  let agentFront = notInstalled(
    "The storefront does not publish /.well-known/ucp yet.",
  );
  if (discovery.status === "fulfilled") {
    if (discovery.value.ok) {
      try {
        const body = (await discovery.value.json()) as Record<string, unknown>;
        agentFront =
          body && typeof body === "object" && "ucp" in body
            ? {
                installed: true,
                detail: "UCP discovery is published on the storefront.",
              }
            : notInstalled(
                "/.well-known/ucp answered, but it was not a UCP discovery document.",
              );
      } catch {
        agentFront = notInstalled(
          "/.well-known/ucp answered, but it did not return JSON.",
        );
      }
    } else {
      agentFront = notInstalled(
        `/.well-known/ucp returned ${discovery.value.status}.`,
      );
    }
  } else {
    agentFront = notInstalled(
      "/.well-known/ucp could not be reached from Chapman.",
    );
  }

  return { browserOrigin, probeOrigin, assistant, agentFront };
}
