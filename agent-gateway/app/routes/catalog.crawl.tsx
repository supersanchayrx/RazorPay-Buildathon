import type { ActionFunctionArgs } from "react-router";
import { requireMerchant } from "../lib/auth.server";
import type { CatalogCrawlResponse } from "../lib/catalog-crawl";
import { crawlStorefront } from "../lib/catalog-crawler.server";

const lastCrawl = new Map<string, number>();
const COOLDOWN_MS = 10_000;
const json = (body: CatalogCrawlResponse, init?: ResponseInit) =>
  Response.json(body, init);

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const previous = lastCrawl.get(merchant.id) ?? 0;
  if (Date.now() - previous < COOLDOWN_MS) {
    return json(
      { ok: false, error: "Wait a few seconds before starting another crawl." },
      { status: 429 },
    );
  }

  const form = await request.formData();
  const storefrontUrl = String(form.get("storefrontUrl") ?? "").trim();
  if (!storefrontUrl || storefrontUrl.length > 2_048) {
    return json(
      { ok: false, error: "Enter a valid public storefront URL." },
      { status: 400 },
    );
  }

  lastCrawl.set(merchant.id, Date.now());
  try {
    const result = await crawlStorefront(storefrontUrl);
    return json({ ok: true, ...result });
  } catch (error) {
    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The storefront could not be crawled.",
      },
      { status: 422 },
    );
  }
};
