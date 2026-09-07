import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import {
  Block,
  Eyebrow,
  Note,
  Page,
  PageHead,
  Setup,
} from "../components/console";
import { IntegrationSetup } from "../components/integration-setup";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { runHarness } from "../lib/harness.server";
import { MERCHANT_TOOLS } from "../lib/merchanttools.server";
import { describeRegistry } from "../lib/tools.server";
import { MODELS, isConfigured } from "../lib/openrouter.server";
import { openRouterSetup } from "../lib/integration-setup.server";

/**
 * Ask your own data a question.
 *
 * The merchant half of the harness. Same loop as the shopper's, different
 * registry — and the difference IS the security model, not a setting. These
 * tools return unit costs, margins, rejected proposals and the ledger, none of
 * which a storefront surface can reach, because there is no code path from one
 * registry to the other.
 *
 * The numbers are never the model's. It chooses which question to ask;
 * `stats.server.ts` answers it. A model asked "what is the attach rate between
 * chai and assam" would reply fluently and wrongly and you could not tell
 * which time — asked to CALL `association_rules`, it gets 158 of 258 with a
 * Wilson bound because a real function counted them.
 *
 * The transcript is shown in full, every time. A merchant about to act on an
 * answer is entitled to see which tools produced it and what they returned.
 */

const SYSTEM = `You are an analyst working for {SHOP}. You answer the merchant's questions about their own shop using the tools below, and only the tools.

Rules:
- NEVER compute a statistic yourself. If you catch yourself dividing two numbers, call rate_with_confidence instead. Arithmetic in your head is where a confident wrong answer comes from.
- Never state a rate without its sample size. "67%" on three orders is three orders, not a rate.
- Never predict what a price change will do. This shop has never changed a price, so there is nothing to estimate it from. State the break-even and let the merchant judge.
- If a tool says a sample is too small or a measurement is unavailable, say so plainly. "I cannot tell you that yet" is a real answer.
- Be brief and concrete. The merchant is busy and can read numbers.`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  return {
    site: site ? { key: site.key, name: site.name } : null,
    tools: describeRegistry(MERCHANT_TOOLS),
    model: isConfigured() ? MODELS.analyst()[0] : null,
    modelSetup: openRouterSetup("analyst"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const site = sitesForMerchant(merchant.sites).find(
    (s) => s.key === String(form.get("shop") ?? ""),
  );
  if (!site) return { error: "not your store" };

  const question = String(form.get("question") ?? "")
    .trim()
    .slice(0, 500);
  if (!question) return { error: "ask something" };
  if (!isConfigured()) {
    return {
      error:
        "No reasoning model is configured, so the analyst cannot run. Every tool it would call still works — the offers page uses them directly.",
    };
  }

  const out = await runHarness({
    shop: site.key,
    tools: MERCHANT_TOOLS,
    toolContext: {
      shop: site.key,
      shopName: site.name,
      catalog: jsonFeedCatalog(site.catalogFeedUrl),
      // Shared across the whole loop: the proposal pipeline is expensive, and
      // a model that calls list_proposals then explain_proposal should not pay
      // for it twice.
      cache: {},
    },
    system: SYSTEM.replaceAll("{SHOP}", site.name),
    message: question,
    // The analyst is unwatched and its answers are acted on, so it gets a
    // bigger budget than the shopper-facing loop, which a human is waiting on.
    model: MODELS.analyst(),
    maxSteps: 6,
    maxMs: 90_000,
  });

  return { question, ...out, error: null };
};

const SUGGESTIONS = [
  "Which two products are most worth cross-selling, and how much is it worth a month?",
  "Is anything wrong with my payments right now?",
  "What would 10% off the ceramic cupping set actually cost me?",
  "Which products are a big share of revenue but slow in units?",
  "Do people reorder the masala chai on a regular cycle?",
  "What has the assistant been stopped from saying this week?",
];

export default function Analyst() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const busy = nav.state !== "idle";
  const [question, setQuestion] = useState(
    a && "question" in a ? a.question : "",
  );

  if (!d.site) {
    return (
      <Page>
        <PageHead title="Analyst" />
        <Card>
          <EmptyState
            title="No store is connected to this account yet"
            description="The analyst reads one shop's orders, so it needs a storefront to read."
          />
        </Card>
      </Page>
    );
  }

  const shop = d.site.key;

  /**
   * A suggestion submits its own text rather than a form field.
   *
   * The obvious version — a submit button named `question` — loses to the text
   * input above it, because a form sends the first field of that name and the
   * submitter's value only takes effect at its own position.
   */
  const ask = (q: string) => submit({ shop, question: q }, { method: "post" });

  const toolRows: Array<Record<string, unknown>> = d.tools.map((t) => ({
    id: t.name,
    name: t.name,
    description: t.description,
  }));

  return (
    <Page>
      <PageHead
        title="Ask your data"
        lede="Questions about your own shop, answered by real statistics rather than by a model doing arithmetic. It picks the question; the code answers it."
      >
        <Card>
          <VStack gap={4}>
            <Form method="post">
              <input type="hidden" name="shop" value={shop} />
              <HStack gap={3} vAlign="end" wrap="wrap">
                <TextInput
                  label="Your question"
                  isLabelHidden
                  htmlName="question"
                  value={question}
                  onChange={setQuestion}
                  placeholder="e.g. which pairing is worth the most a month?"
                  width="min(560px, 100%)"
                />
                <Button
                  type="submit"
                  variant="primary"
                  isDisabled={busy || question.trim().length === 0}
                  label={busy ? "Thinking…" : "Ask"}
                />
              </HStack>
            </Form>

            <VStack gap={2}>
              <Eyebrow>Or start from one of these</Eyebrow>
              <HStack gap={2} wrap="wrap">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant="secondary"
                    size="sm"
                    isDisabled={busy}
                    onClick={() => {
                      setQuestion(s);
                      ask(s);
                    }}
                    label={s}
                  />
                ))}
              </HStack>
            </VStack>
          </VStack>
        </Card>
      </PageHead>

      {a?.error ? (
        <Banner
          status="warning"
          title="The analyst did not run"
          description={a.error}
        />
      ) : null}

      {a && "reply" in a ? (
        <Block title="Answer">
          <Card>
            <VStack gap={3}>
              {a.reply ? (
                <Text style={{ whiteSpace: "pre-wrap" }}>{a.reply}</Text>
              ) : (
                <Text color="disabled">
                  The model did not produce an answer. The transcript below
                  shows how far it got.
                </Text>
              )}
              {a.stoppedBy ? (
                <Text type="supporting" color="secondary">
                  Stopped by the {a.stoppedBy} budget — answered from what it
                  had rather than continuing.
                </Text>
              ) : null}
            </VStack>
          </Card>
        </Block>
      ) : null}

      <Setup title="Connect the analyst model">
        <IntegrationSetup guide={d.modelSetup} />
      </Setup>

      {a && "reply" in a ? (
        <Block
          title="How it got there"
          hint="Every tool call, and what it returned."
        >
          {a.steps.length === 0 ? (
            <Banner
              status="warning"
              container="card"
              title="It answered without calling anything"
              description="For a question about your data that is usually a sign the answer is not grounded. Treat it with suspicion."
            />
          ) : (
            <VStack gap={3}>
              {a.steps.map((s, i) => (
                <Card key={i}>
                  <VStack gap={3}>
                    <HStack
                      gap={4}
                      hAlign="between"
                      vAlign="center"
                      wrap="wrap"
                    >
                      <HStack gap={3} vAlign="center">
                        <Text type="code" size="xsm" weight="semibold">
                          {s.tool}(
                          {Object.keys(s.args).length
                            ? JSON.stringify(s.args)
                            : ""}
                          )
                        </Text>
                        {s.error ? (
                          <Token size="sm" color="red" label={s.error} />
                        ) : null}
                      </HStack>
                      <Text type="code" size="2xs" color="secondary">
                        {s.ms}ms
                      </Text>
                    </HStack>
                    <CodeBlock
                      code={s.result}
                      language="json"
                      maxHeight={260}
                      isWrapped
                      hasCopyButton
                      size="sm"
                    />
                  </VStack>
                </Card>
              ))}
            </VStack>
          )}
        </Block>
      ) : null}

      <Block
        title="What the analyst can call"
        hint={`All ${d.tools.length} of them, and every one is a read. Nothing here can approve an offer or change a price.`}
        actions={
          d.model ? (
            <Token size="sm" color="gray" label={d.model} />
          ) : (
            <Token size="sm" color="yellow" label="no model configured" />
          )
        }
      >
        <Card padding={0}>
          <Table
            data={toolRows}
            idKey="id"
            density="compact"
            dividers="rows"
            columns={[
              {
                key: "name",
                header: "Tool",
                width: pixel(240),
                renderCell: (r) => (
                  <Text type="code" size="2xs">
                    {String(r.name)}
                  </Text>
                ),
              },
              {
                key: "description",
                header: "What it does",
                width: proportional(1),
                renderCell: (r) => (
                  <Text color="secondary">{String(r.description)}</Text>
                ),
              },
            ]}
          />
        </Card>
      </Block>

      <Note>
        The analyst sees your costs, margins and rejected proposals. No
        storefront surface can reach any of it.
      </Note>
    </Page>
  );
}
