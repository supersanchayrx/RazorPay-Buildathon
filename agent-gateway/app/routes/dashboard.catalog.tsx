import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { CatalogCrawler } from "../components/catalog-crawler";
import { CatalogCsvImport } from "../components/catalog-csv-import";
import { Block, Note, Page, PageHead } from "../components/console";
import { requireMerchant } from "../lib/auth.server";
import { inspectCatalog } from "../lib/catalog-health.server";
import { sitesForMerchant } from "../lib/sites.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site) throw redirect("/dashboard/setup");
  return {
    site: {
      name: site.name,
      origin: site.origins[0] ?? "",
      catalogFeedUrl: site.catalogFeedUrl,
    },
    health: await inspectCatalog(site.catalogFeedUrl),
  };
};

export default function DashboardCatalog() {
  const { site, health } = useLoaderData<typeof loader>();
  const [method, setMethod] = useState<"crawl" | "csv">("crawl");

  return (
    <Page>
      <PageHead
        title="Catalogue"
        lede="Create, review and connect the product feed Chapman is allowed to use."
        actions={
          <Button
            href="/dashboard/setup"
            variant="secondary"
            label="Change feed URL"
          />
        }
      />

      <Banner
        status={health.ok ? "success" : "warning"}
        title={health.ok ? "Catalogue is connected" : "Catalogue needs setup"}
        description={health.detail}
      />

      <Block
        title="Current source"
        hint="Chapman reads this public URL at runtime. Generating a replacement does not switch the source automatically."
      >
        <Card>
          <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
            <VStack gap={1}>
              <Text weight="semibold">Hosted catalogue feed</Text>
              <Text type="code" size="2xs" color="secondary">
                {site.catalogFeedUrl}
              </Text>
            </VStack>
            <Button
              href="/dashboard/setup"
              variant="ghost"
              size="sm"
              label="Update URL"
            />
          </HStack>
        </Card>
      </Block>

      <Block
        title="Generate catalog.json"
        hint="Choose one import method. Both produce a preview for review and a file you download and host yourself."
      >
        <VStack gap={5}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <Text weight="semibold">Import method</Text>
            <SegmentedControl
              label="Catalogue import method"
              size="sm"
              value={method}
              onChange={(value) => setMethod(value === "csv" ? "csv" : "crawl")}
            >
              <SegmentedControlItem value="crawl" label="Crawl storefront" />
              <SegmentedControlItem value="csv" label="Upload CSV" />
            </SegmentedControl>
          </HStack>

          {method === "crawl" ? (
            <CatalogCrawler defaultUrl={site.origin} />
          ) : (
            <CatalogCsvImport />
          )}
        </VStack>
      </Block>

      <Note>
        Generated files are drafts until you review and publish them. Checkout
        must still revalidate current price and availability on the merchant
        backend.
      </Note>
    </Page>
  );
}
