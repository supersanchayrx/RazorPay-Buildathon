import { useState } from "react";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { Block, Cards, Note, Page, PageHead } from "../components/console";
import { CatalogCrawler } from "../components/catalog-crawler";
import { CatalogCsvImport } from "../components/catalog-csv-import";
import { requireMerchant } from "../lib/auth.server";
import {
  createFirstStore,
  firstStoreDefaults,
  updateCatalogFeed,
  type FirstStoreInput,
} from "../lib/onboarding.server";
import { sitesForMerchant } from "../lib/sites.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  const defaults = firstStoreDefaults();
  return {
    defaults,
    site: site
      ? {
          key: site.key,
          name: site.name,
          origin: site.origins[0] ?? "",
          catalogFeedUrl: site.catalogFeedUrl,
        }
      : null,
    dockerDemo: defaults.catalogFeedUrl.startsWith("http://store:"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const existing = sitesForMerchant(merchant.sites)[0] ?? null;
  if (existing) {
    const catalogFeedUrl = String(form.get("catalogFeedUrl") ?? "");
    const result = updateCatalogFeed(merchant, existing.key, catalogFeedUrl);
    if (result.ok) {
      return {
        mode: "catalog" as const,
        saved: true,
        catalogFeedUrl,
        fields: {},
      };
    }
    return {
      mode: "catalog" as const,
      saved: false,
      error: result.error,
      fields: result.fields ?? {},
      catalogFeedUrl,
    };
  }

  const values: FirstStoreInput = {
    name: String(form.get("name") ?? ""),
    key: String(form.get("key") ?? ""),
    origin: String(form.get("origin") ?? ""),
    catalogFeedUrl: String(form.get("catalogFeedUrl") ?? ""),
    productUrlTemplate: String(form.get("productUrlTemplate") ?? ""),
    ordersFeedUrl: String(form.get("ordersFeedUrl") ?? ""),
    greeting: String(form.get("greeting") ?? ""),
    payments: form.get("payments") === "on",
  };
  const result = createFirstStore(merchant, values);
  if (result.ok) throw redirect("/dashboard?setup=complete");
  return {
    mode: "setup" as const,
    error: result.error,
    fields: result.fields ?? {},
    values,
  };
};

export default function FirstStoreSetup() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const initial =
    actionData?.mode === "setup" ? actionData.values : data.defaults;
  const [values, setValues] = useState(initial);
  const [catalogFeedUrl, setCatalogFeedUrl] = useState(
    actionData?.mode === "catalog"
      ? actionData.catalogFeedUrl
      : (data.site?.catalogFeedUrl ?? ""),
  );
  const busy = navigation.state !== "idle";
  const set = (key: keyof FirstStoreInput, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));
  const fieldErrors: Record<string, string> = actionData?.fields ?? {};
  const status = (key: string) =>
    fieldErrors[key]
      ? { type: "error" as const, message: fieldErrors[key] }
      : undefined;

  if (data.site) {
    return (
      <Page>
        <PageHead
          title="Store configuration"
          lede={`Manage the catalogue source Chapman reads for ${data.site.name}.`}
        />

        {actionData?.mode === "catalog" && actionData.saved ? (
          <Banner
            status="success"
            title="Catalogue source saved"
            description="Chapman will use this URL for new product reads. Its in-memory feed cache expires within 60 seconds."
          />
        ) : null}
        {actionData?.mode === "catalog" && actionData.error ? (
          <Banner
            status="error"
            title="The catalogue source was not saved"
            description={actionData.error}
          />
        ) : null}

        <Block
          title="Current catalogue source"
          hint="This must be an absolute public HTTP or HTTPS URL reachable from the Chapman server."
        >
          <Card>
            <Form method="post">
              <VStack gap={5}>
                <TextInput
                  label="Catalogue feed URL"
                  description="Host the generated catalog.json first, then paste its public URL here."
                  htmlName="catalogFeedUrl"
                  value={catalogFeedUrl}
                  onChange={setCatalogFeedUrl}
                  status={status("catalogFeedUrl")}
                  isRequired
                />
                <Button
                  type="submit"
                  variant="primary"
                  label={
                    busy ? "Saving catalogue source…" : "Save catalogue source"
                  }
                  isLoading={busy}
                  isDisabled={busy}
                />
              </VStack>
            </Form>
          </Card>
        </Block>

        <Block
          title="Create a catalogue from your storefront"
          hint="Quick import for stores that publish Schema.org Product and Offer data in their pages."
        >
          <CatalogCrawler defaultUrl={data.site.origin} />
        </Block>

        <Block
          title="Create a catalogue from CSV"
          hint="Download the template, import one row per product variant, and Chapman will validate and generate the JSON feed."
        >
          <CatalogCsvImport />
        </Block>
      </Page>
    );
  }

  return (
    <Page>
      <PageHead
        back={null}
        title="Configure your storefront"
        lede="Chapman starts empty. Register the store you actually own; nothing is fetched and no feature is called live until this form is saved."
      />

      {data.dockerDemo ? (
        <Banner
          status="info"
          title="Bundled Docker demo detected"
          description="The Monsoon Market values are prefilled. Keep localhost:4000 as the browser origin and store:4000 as the catalogue host: the browser and the Chapman container reach the same shop by different names."
        />
      ) : null}

      {actionData?.error ? (
        <Banner
          status="error"
          title="The storefront was not saved"
          description={actionData.error}
        />
      ) : null}

      <Block
        title="Before you connect"
        hint="You are granting Chapman access to one public store and one product feed. This step does not edit the storefront."
      >
        <Cards>
          <Card>
            <VStack gap={2}>
              <Text weight="semibold">1. Identify the public store</Text>
              <Text color="secondary">
                Enter the exact origin shoppers open: scheme and host, with no
                path or trailing slash. The public site key is an identifier,
                not a credential.
              </Text>
            </VStack>
          </Card>
          <Card>
            <VStack gap={2}>
              <Text weight="semibold">2. Provide a catalogue feed</Text>
              <Text color="secondary">
                Use the CSV importer below to generate one, or give Chapman an
                absolute URL returning the store&apos;s product JSON. The final
                URL must be reachable from the gateway.
              </Text>
            </VStack>
          </Card>
          <Card>
            <VStack gap={2}>
              <Text weight="semibold">3. Choose optional access</Text>
              <Text color="secondary">
                Leave the order feed blank until the storefront publishes a
                signed endpoint. Enable Razorpay only when its key ID and secret
                already exist in the Docker environment.
              </Text>
            </VStack>
          </Card>
        </Cards>
      </Block>

      <Block
        title="Create a catalogue from your storefront"
        hint="Enter the public store URL and Chapman will inspect its sitemap and structured product data."
      >
        <CatalogCrawler defaultUrl={values.origin} />
      </Block>

      <Block
        title="Create a catalogue from CSV"
        hint="If your storefront has no catalog.json, download the template, import one row per variant, and host the generated file before saving your store."
      >
        <CatalogCsvImport />
      </Block>

      <Block
        title="Store details"
        hint="The browser origin and the catalogue URL may use different hostnames in Docker. Shoppers use localhost; Chapman uses the Compose service name."
      >
        <Card>
          <Form method="post">
            <VStack gap={5}>
              <FormLayout defaultOptionality="required">
                <TextInput
                  label="Store name"
                  htmlName="name"
                  value={values.name}
                  onChange={(value) => set("name", value)}
                  status={status("name")}
                  isRequired
                />
                <TextInput
                  label="Public site key"
                  description="Shown in the embed tag and UCP URLs. Public, not a secret."
                  htmlName="key"
                  value={values.key}
                  onChange={(value) => set("key", value)}
                  status={status("key")}
                  isRequired
                />
                <TextInput
                  label="Browser-facing storefront origin"
                  description="Exact scheme and host only, with no path or trailing slash."
                  htmlName="origin"
                  value={values.origin}
                  onChange={(value) => set("origin", value)}
                  status={status("origin")}
                  isRequired
                />
                <TextInput
                  label="Catalogue feed URL"
                  description="Must be reachable from the Chapman server or container."
                  htmlName="catalogFeedUrl"
                  value={values.catalogFeedUrl}
                  onChange={(value) => set("catalogFeedUrl", value)}
                  status={status("catalogFeedUrl")}
                  isRequired
                />
                <TextInput
                  label="Product URL template"
                  description="Use {handle} where the product handle belongs."
                  htmlName="productUrlTemplate"
                  value={values.productUrlTemplate}
                  onChange={(value) => set("productUrlTemplate", value)}
                  status={status("productUrlTemplate")}
                  isRequired
                />
                <TextInput
                  label="Signed order feed URL"
                  description="Optional. Leave blank to keep personal order lookup off."
                  htmlName="ordersFeedUrl"
                  value={values.ordersFeedUrl}
                  onChange={(value) => set("ordersFeedUrl", value)}
                  status={status("ordersFeedUrl")}
                  isOptional
                />
                <TextInput
                  label="Assistant greeting"
                  htmlName="greeting"
                  value={values.greeting}
                  onChange={(value) => set("greeting", value)}
                  isRequired
                />
                <CheckboxInput
                  label="Configure Razorpay for this storefront"
                  description="This stores only the environment-variable names. API key values never pass through the browser."
                  htmlName="payments"
                  value={values.payments}
                  onChange={(value) => set("payments", value)}
                />
              </FormLayout>
              <Text color="secondary">
                Saving generates a site-signing secret in the data volume and
                grants this merchant account access to the new storefront.
              </Text>
              <Button
                type="submit"
                variant="primary"
                label={
                  busy
                    ? "Saving storefront configuration…"
                    : "Save storefront configuration"
                }
                isLoading={busy}
                isDisabled={busy}
              />
            </VStack>
          </Form>
        </Card>
      </Block>

      <Block
        title="What happens after saving"
        hint="Registration makes the store visible in Chapman. Installation is a separate, verifiable step."
      >
        <Cards minWidth={380}>
          <Card>
            <VStack gap={2}>
              <Text weight="semibold">Install the storefront assistant</Text>
              <Text color="secondary">
                Open Assistant, copy the generated script tag, and paste it into
                the storefront pages. The overview stays Not installed until
                Chapman detects the matching site key.
              </Text>
            </VStack>
          </Card>
          <Card>
            <VStack gap={2}>
              <Text weight="semibold">Publish agent discovery</Text>
              <Text color="secondary">
                Open Agent front and publish the generated /.well-known/ucp
                route. Chapman verifies the response before it calls the agent
                surface installed.
              </Text>
            </VStack>
          </Card>
        </Cards>
      </Block>

      <Note>
        Saving creates one server-side signing secret and grants this merchant
        account access. It does not upload a catalogue, alter storefront code,
        enable invented orders, or expose any API key to the browser.
      </Note>
    </Page>
  );
}
