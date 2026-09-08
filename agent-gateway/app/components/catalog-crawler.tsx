import { useState } from "react";
import { useFetcher } from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";

import type { CatalogCrawlResponse } from "../lib/catalog-crawl";
import { catalogJson } from "../lib/catalog-csv";

function downloadCatalog(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "catalog.json";
  link.click();
  URL.revokeObjectURL(url);
}

export function CatalogCrawler({ defaultUrl }: { defaultUrl: string }) {
  const fetcher = useFetcher<CatalogCrawlResponse>();
  const [storefrontUrl, setStorefrontUrl] = useState(defaultUrl);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  return (
    <VStack gap={5}>
      <Text color="secondary">
        Chapman reads the storefront sitemap and structured Schema.org product
        data. The quick crawler scans at most 30 public pages and does not run
        storefront JavaScript.
      </Text>

      <Card>
        <fetcher.Form method="post" action="/catalog/crawl">
          <VStack gap={4}>
            <FormLayout defaultOptionality="required">
              <TextInput
                label="Public storefront URL"
                description="Use the canonical homepage URL. Private network addresses and cross-domain redirects are refused."
                htmlName="storefrontUrl"
                value={storefrontUrl}
                onChange={setStorefrontUrl}
                placeholder="https://store.example"
                isRequired
                isDisabled={busy}
              />
            </FormLayout>
            <Button
              type="submit"
              variant="primary"
              label={busy ? "Scanning storefront…" : "Scan storefront"}
              isLoading={busy}
              isDisabled={busy || !storefrontUrl.trim()}
            />
          </VStack>
        </fetcher.Form>
      </Card>

      {result && !result.ok ? (
        <Banner
          status="error"
          title="A catalogue could not be generated"
          description={result.error}
        />
      ) : null}

      {result?.ok ? (
        <Card>
          <VStack gap={5}>
            <VStack gap={2}>
              <Text weight="semibold">Crawl complete</Text>
              <Text color="secondary">
                Scanned {result.pagesScanned} pages and found{" "}
                {result.productsFound} products with {result.variantsFound}{" "}
                variants in {result.catalog.shop.currency}.
              </Text>
            </VStack>

            {result.warnings.length ? (
              <Banner
                status="warning"
                title="Review the generated catalogue"
                description={result.warnings.join(" ")}
              />
            ) : (
              <Banner
                status="success"
                title="Structured product data was extracted"
                description="Review the preview before publishing it; checkout should still revalidate current price and stock."
                isDismissable
              />
            )}

            <CodeBlock
              code={catalogJson(result.catalog)}
              language="json"
              title="catalog.json preview"
              hasCopyButton
              hasLineNumbers
              maxHeight="24rem"
              container="card"
            />
            <Button
              type="button"
              variant="primary"
              label="Download catalog.json"
              onClick={() => downloadCatalog(catalogJson(result.catalog))}
            />
          </VStack>
        </Card>
      ) : null}

      <List listStyle="decimal" density="spacious">
        <ListItem
          label="Review every generated product and variant"
          description="The crawler omits products without a structured price, currency, and availability rather than filling gaps."
        />
        <ListItem
          label="Host catalog.json on the storefront"
          description="For Vercel, place it in the public directory and deploy it at https://your-store.com/catalog.json."
        />
        <ListItem
          label="Save the public URL in Store Configuration"
          description="Chapman then reads the hosted file as the product source of truth."
        />
      </List>
    </VStack>
  );
}
