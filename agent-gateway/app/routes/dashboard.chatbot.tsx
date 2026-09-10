import { useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { ChatToolCalls } from "@astryxdesign/core/Chat";
import { Code } from "@astryxdesign/core/Code";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import { Block, Figure, Figures, Note, Page, PageHead, Setup } from "../components/console";
import { IntegrationSetup } from "../components/integration-setup";
import { readLedger } from "../lib/ledger.server";
import { sitesForMerchant } from "../lib/sites.server";
import { requireMerchant } from "../lib/auth.server";
import { openRouterSetup } from "../lib/integration-setup.server";
import { runAssistant } from "../lib/assistant.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { featureOn } from "../lib/featureflags.server";
import { jsonFeedOrders, seededOrders } from "../lib/orders.server";
import { mergeSources, placedOrders } from "../lib/orderstore.server";
import { selfOrigin } from "../lib/origin.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  if (form.get("act") !== "test_assistant") {
    return { ok: false as const, error: "Unknown assistant action." };
  }

  const site = sitesForMerchant(merchant.sites).find(
    (entry) => entry.key === String(form.get("shop") ?? ""),
  );
  if (!site) return { ok: false as const, error: "That store is not yours." };
  if (!featureOn(site.key, "assistant")) {
    return {
      ok: false as const,
      error: "The storefront assistant is switched off in Feature controls.",
    };
  }

  const message = String(form.get("message") ?? "").trim().slice(0, 2000);
  if (!message) return { ok: false as const, error: "Enter a shopper message to test." };

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

  try {
    const result = await runAssistant({
      catalog: jsonFeedCatalog(site.catalogFeedUrl),
      shop: site.key,
      shopName: site.name,
      message,
      history: [],
      // A dashboard preview may not impersonate a customer. This matches a
      // signed-out storefront visitor; personal order and memory tools remain
      // correctly unavailable.
      identity: null,
      orderSource,
    });
    return {
      ok: true as const,
      message,
      reply: result.reply,
      cards: result.cards,
      gates: result.violations.map((entry) => entry.gate),
      toolCalls: result.toolCalls,
      route: result.route,
      reasoner: result.reasoner,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: `The assistant preview did not finish: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // The snippet must carry the origin the merchant will actually call. Printing
  // the dashboard request's localhost origin here is how a copy-paste install
  // silently fails even when the deployment pinned its public tunnel URL.
  const base = selfOrigin(request);
  const registered = sitesForMerchant(requireMerchant(request).sites)[0] ?? null;
  const ledger = readLedger(2000);
  const siteLedger = registered
    ? ledger.filter((entry) => entry.shop === registered.key)
    : [];

  const gates: Record<string, number> = {};
  for (const e of siteLedger) if (e.kind === "refusal" && e.gate) gates[e.gate] = (gates[e.gate] ?? 0) + 1;

  return {
    base,
    // The signing secret must never be serialised into loader data. This page
    // needs only the public install fields.
    site: registered
      ? {
          key: registered.key,
          greeting: registered.greeting,
          accent: registered.accent,
          catalogFeedUrl: registered.catalogFeedUrl,
          origins: registered.origins,
        }
      : null,
    modelSetup: openRouterSetup("assistant"),
    counts: {
      replies: siteLedger.filter((e) => e.kind === "reply").length,
      refusals: siteLedger.filter((e) => e.kind === "refusal").length,
      errors: siteLedger.filter((e) => e.kind === "tool_error").length,
    },
    gates,
    recent: siteLedger.slice(-8).reverse(),
  };
};

const GATE_LABEL: Record<string, string> = {
  unverifiable_discount: "invented a discount",
  unverifiable_urgency: "invented a deadline",
  unapproved_event: "invented festive scarcity",
  assumed_observance: "assumed what someone celebrates",
  ungrounded_claim: "unsupported claim",
  insufficient_data: "too little data",
};

const KIND: Record<string, { label: string; color: "green" | "yellow" | "red" }> = {
  reply: { label: "reply", color: "green" },
  refusal: { label: "blocked", color: "yellow" },
  tool_error: { label: "error", color: "red" },
};

/** Turn safe provider status bodies into something a merchant can act on. */
const activityMessage = (entry: { message: string; detail?: unknown }): string => {
  const detail =
    entry.detail && typeof entry.detail === "object" && "error" in entry.detail
      ? String((entry.detail as { error?: unknown }).error ?? "")
      : "";
  if (!entry.message.startsWith("openrouter ")) return entry.message;
  if (detail.includes("429") && detail.includes("free-models-per-day")) {
    return `${entry.message} — free daily quota reached (429)`;
  }
  if (detail.includes("429")) {
    return `${entry.message} — provider rate limit reached (429)`;
  }
  if (detail.includes("404") && detail.toLowerCase().includes("unavailable for free")) {
    return `${entry.message} — model is no longer available for free (404)`;
  }
  if (detail.includes("401") || detail.includes("403")) {
    return `${entry.message} — API key or model access was rejected`;
  }
  return entry.message;
};

export default function Chatbot() {
  const { base, site, modelSetup, counts, gates, recent } = useLoaderData<typeof loader>();
  const preview = useActionData<typeof action>();
  const navigation = useNavigation();
  const testing = navigation.state !== "idle";
  const [testMessage, setTestMessage] = useState("");
  /**
   * Local state, not a search param.
   *
   * A `?platform=` toggle navigates, which remounts the route and closes the
   * panel this control lives inside — you would pick Shopify and watch the
   * instructions disappear.
   */
  const [platform, setPlatform] = useState<"custom" | "shopify">("custom");

  const snippet = `<script src="${base}/embed.js"
        data-site="${site?.key ?? "YOUR_SITE_KEY"}"
        data-greeting="${site?.greeting ?? "Ask me anything about our products."}"
        data-accent="${site?.accent ?? "#1f4037"}"
        defer></script>`;

  const gateRows: Array<Record<string, unknown>> = Object.entries(gates)
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => ({ id: g, count: n, what: GATE_LABEL[g] ?? g, gate: g }));

  const recentRows: Array<Record<string, unknown>> = recent.map((e, i) => {
    const message = activityMessage(e);
    return {
      id: `${e.ts}-${i}`,
      when: e.ts.slice(5, 16).replace("T", " "),
      kind: e.kind,
      message: message.length > 160 ? message.slice(0, 160) + "…" : message,
    };
  });

  return (
    <Page>
      <PageHead
        title="Storefront assistant"
        lede="Answers from your live catalogue and your own policy text. It cannot offer a discount you have not approved and it cannot invent a deadline: those are blocked in code, outside the model, where the model cannot argue with them."
      >
        <Figures>
          <Figure value={counts.replies.toLocaleString("en-IN")} label="replies sent" tone="accent" />
          <Figure value={counts.refusals.toLocaleString("en-IN")} label="claims blocked" />
          <Figure value={counts.errors} label="errors" />
        </Figures>
      </PageHead>

      <Block
        title="Test the assistant"
        hint="Runs the same catalogue, tools, reasoner and speech bounds as the storefront widget. The preview is a signed-out shopper, so it cannot read personal orders or memory."
      >
        <VStack gap={3}>
          <Card>
            <Form method="post">
              <input type="hidden" name="act" value="test_assistant" />
              <input type="hidden" name="shop" value={site?.key ?? ""} />
              <VStack gap={3}>
                <TextInput
                  label="Shopper message"
                  htmlName="message"
                  value={testMessage}
                  onChange={setTestMessage}
                  placeholder="Which tea would you recommend for a cold brew?"
                  width="100%"
                />
                <HStack>
                  <Button
                    type="submit"
                    variant="primary"
                    isDisabled={testing || !site || testMessage.trim().length === 0}
                    isLoading={testing}
                    label={testing ? "Generating response…" : "Test chat assistant"}
                  />
                </HStack>
              </VStack>
            </Form>
          </Card>

          {preview && !preview.ok ? (
            <Banner
              status="warning"
              container="card"
              title="The preview did not run"
              description={preview.error}
            />
          ) : null}

          {preview?.ok ? (
            <Card>
              <VStack gap={4}>
                <VStack gap={1}>
                  <Text type="label" color="secondary">
                    Shopper
                  </Text>
                  <Text>{preview.message}</Text>
                </VStack>
                <Divider />
                <VStack gap={2}>
                  <Text type="label" color="accent">
                    Assistant preview
                  </Text>
                  <Text style={{ whiteSpace: "pre-wrap" }}>{preview.reply}</Text>
                </VStack>
                {preview.cards.length > 0 ? (
                  <HStack gap={2} wrap="wrap">
                    {preview.cards.map((card) => (
                      <Token
                        key={card.handle}
                        size="sm"
                        color="gray"
                        label={`${card.title} · ₹${card.price}`}
                      />
                    ))}
                  </HStack>
                ) : null}
                {preview.toolCalls.length > 0 ? (
                  <ChatToolCalls
                    label="Catalogue and policy lookups"
                    calls={preview.toolCalls.map((call, index) => {
                      const split = call.indexOf("(");
                      return {
                        key: `${index}-${call}`,
                        name: split > 0 ? call.slice(0, split) : call,
                        target: split > 0 ? call.slice(split) : "storefront data",
                        status: "complete" as const,
                      };
                    })}
                  />
                ) : null}
                <HStack gap={2} wrap="wrap">
                  <Token size="sm" color="gray" label={`route: ${preview.route}`} />
                  <Token size="sm" color="gray" label={preview.reasoner} />
                  {preview.gates.map((gate) => (
                    <Token key={gate} size="sm" color="yellow" label={`blocked: ${gate}`} />
                  ))}
                </HStack>
              </VStack>
            </Card>
          ) : null}
        </VStack>
      </Block>

      <Block title="Recent activity">
        {recentRows.length === 0 ? (
          <Card>
            <EmptyState
              isCompact
              title="Nothing yet"
              description="Send a message through the widget and it will appear here."
            />
          </Card>
        ) : (
          <Card padding={0}>
            <Table
              data={recentRows}
              idKey="id"
              density="balanced"
              dividers="rows"
              hasHover
              columns={[
                {
                  key: "when",
                  header: "When",
                  width: pixel(116),
                  renderCell: (r) => (
                    <Text type="code" size="2xs" color="secondary" style={{ whiteSpace: "nowrap" }}>
                      {String(r.when)}
                    </Text>
                  ),
                },
                {
                  key: "kind",
                  header: "Kind",
                  width: pixel(104),
                  renderCell: (r) => {
                    const k = KIND[String(r.kind)] ?? { label: String(r.kind), color: "green" as const };
                    return <Token size="sm" color={k.color} label={k.label} />;
                  },
                },
                { key: "message", header: "Message", width: proportional(1) },
              ]}
            />
          </Card>
        )}
      </Block>

      {gateRows.length > 0 ? (
        <Block
          title="What was blocked"
          hint="The rules that fired, most-used first."
        >
          <Card padding={0}>
            <Table
              data={gateRows}
              idKey="id"
              density="compact"
              dividers="rows"
              columns={[
                {
                  key: "count",
                  header: "Times",
                  width: pixel(80),
                  align: "end",
                  renderCell: (r) => (
                    <Text weight="semibold" hasTabularNumbers>
                      {String(r.count)}
                    </Text>
                  ),
                },
                { key: "what", header: "What it stopped", width: proportional(1) },
                {
                  key: "gate",
                  header: "Gate",
                  width: pixel(230),
                  renderCell: (r) => (
                    <Text type="code" size="2xs" color="secondary">
                      {String(r.gate)}
                    </Text>
                  ),
                },
              ]}
            />
          </Card>
        </Block>
      ) : null}

      <Setup title="Install the assistant and connect its model">
        <IntegrationSetup guide={modelSetup} />

        <Divider />

        <HStack gap={3} vAlign="center" wrap="wrap">
          <Text weight="semibold">Where is it going?</Text>

          <SegmentedControl
            label="Platform"
            size="sm"
            value={platform}
            onChange={(v) => setPlatform(v === "shopify" ? "shopify" : "custom")}
          >
            <SegmentedControlItem value="custom" label="Custom website" />
            <SegmentedControlItem value="shopify" label="Shopify" />
          </SegmentedControl>
        </HStack>
        {platform === "custom" ? (
          <VStack gap={4}>
            <Card>
              <List listStyle="decimal" density="spacious">
                <ListItem
                  label="Paste one tag before the closing body tag"
                  description="Put it in the shared layout on a real site. For the static Docker demo, paste the same tag into index.html, product.html and account.html; adding it only to index.html leaves product-page cart and checkout offline."
                />
                <ListItem
                  label="Publish a catalogue feed at a URL we can read"
                  description={`Prices, stock and your policy text as JSON. Currently reading ${site?.catalogFeedUrl ?? "nothing — not set"}.`}
                />
                <ListItem
                  label="Tell us which origins may embed it"
                  description={`Registered: ${(site?.origins ?? []).join(", ") || "none yet"}.`}
                />
              </List>
            </Card>

            <CodeBlock
              code={snippet}
              language="html"
              title="Paste before </body>"
              hasCopyButton
              hasLineNumbers
              container="card"
            />

            <Note>
              The site key is an identifier, not a secret. What gates the widget is the origin list
              above, which a page script cannot forge.
            </Note>

            <Note>
              Bundled demo only: place <Code>&lt;!--CHAPMAN_SESSION--&gt;</Code> immediately before
              the tag on each page if you want signed-in order lookup, shopper memory, or recoverable
              carts. The demo server replaces that marker with a short-lived signed identity. A real
              merchant site should mint the equivalent token from its own login session; it should
              never expose the site signing secret to browser JavaScript.
            </Note>
          </VStack>
        ) : (
          <VStack gap={4}>
            <Card>
              <List listStyle="decimal" density="spacious">
                <ListItem label="Install the CHAPMAN app on your store" />
                <ListItem
                  label="Online Store → Themes → Customise → App embeds, turn on CHAPMAN assistant"
                  description="Shopify requires you to flip this one yourself."
                />
                <ListItem
                  label="Nothing else"
                  description="Catalogue, prices, stock and policies come through the Shopify Admin API."
                />
              </List>
            </Card>
            <Note>No theme code is edited. Removing the app removes the assistant.</Note>
          </VStack>
        )}
      </Setup>

      <Block title="Where conversations are stored">
        <Card>
          <VStack gap={3}>
            <Text>
              In an append-only file on this server for now, moving to a database next. Every reply,
              every blocked claim, and the message that prompted it.
            </Text>
            <Text color="secondary">
              We never ask for credentials to your database. Export the conversations whenever you
              like, or have them pushed to a webhook or bucket you own.
            </Text>
          </VStack>
        </Card>
      </Block>

      <HStack gap={2} wrap="wrap">
        <Token size="sm" color="gray" label={site?.key ?? "no site"} />
        <Token size="sm" color="gray" label={base} />
      </HStack>
    </Page>
  );
}
