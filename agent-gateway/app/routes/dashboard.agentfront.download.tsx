import type { LoaderFunctionArgs } from "react-router";
import { staticProfileDownload } from "../lib/agentfront.server";
import { requireMerchant } from "../lib/auth.server";
import { selfOrigin } from "../lib/origin.server";
import { sitesForMerchant } from "../lib/sites.server";

/** Download one public, extensionless UCP manifest for a merchant-owned site. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await requireMerchant(request);
  const key = new URL(request.url).searchParams.get("site");
  const site = sitesForMerchant(merchant.sites).find(
    (candidate) => candidate.key === key,
  );

  if (!site) {
    return new Response("Store not found.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return staticProfileDownload(site, selfOrigin(request));
};
