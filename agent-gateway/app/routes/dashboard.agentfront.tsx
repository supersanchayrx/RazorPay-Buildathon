import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Code } from "@astryxdesign/core/Code";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import {
  Block,
  Eyebrow,
  Figure,
  Figures,
  Note,
  Page,
  PageHead,
  Setup,
} from "../components/console";
import { IntegrationSetup } from "../components/integration-setup";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import {
  agentDiscoverySetup,
  razorpaySetup,
} from "../lib/integration-setup.server";
import {
  discoveryDocument,
  UCP_VERSION,
  capabilities,
  paymentHandlers,
} from "../lib/ucp.server";
import {
  installSnippets,
  tierCSnippets,
  guessHost,
  staticProfile,
  verifyInstall,
  agentActivity,
  type VerifyResult,
} from "../lib/agentfront.server";
import { announceable } from "../lib/approvals.server";
import { DEFAULT_PAYMENT_METHODS } from "../lib/razorpay.server";
import { TOOLS } from "../lib/ucptools";
import { selfOrigin } from "../lib/origin.server";

/**
 * The agent-readable storefront, explained to the merchant who has to enable it.
 *
 * THE PAGE HAS ONE JOB BEYOND INSTRUCTIONS, and it is the last step, not the
 * first: Verify. Everything above it is a snippet a merchant might have pasted
 * in the wrong file, into the wrong branch, or into a config that never
 * deployed. An install nobody checked is an install that is hoped for, and this
 * one fails silently — a missing redirect rule looks exactly like nobody
 * shopping. So the button does what a shopper's agent does, in order, and says
 * which step broke.
 *
 * It also says plainly that a Shopify merchant does not need any of this.
 * Shopify already serves UCP on every store, and selling a merchant a thing
 * they were given for free is the sort of quiet dishonesty this product is
 * otherwise built to avoid. The gap is custom storefronts.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await requireMerchant(request);
  const sites = sitesForMerchant(merchant.sites);

  const base = selfOrigin(request);

  return {
    base,
    version: UCP_VERSION,
    toolCount: TOOLS.length,
    capabilityNames: Object.keys(capabilities()),
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    sites: await Promise.all(
      sites.map(async (s) => {
        const origin = s.origins[0] ?? "";
        const reachableOrigin = new URL(s.catalogFeedUrl).origin;
        const profileUrl = `${base}/ucp/${s.key}/profile`;

        // One cheap HEAD-ish probe on page load, for the status pill and to
        // guess their stack from what their server says about itself. The full
        // stepwise check is the Verify button — this one must not make the
        // dashboard slow to open.
        let serving = false;
        let guessed: string | null = null;
        if (reachableOrigin) {
          try {
            const res = await fetch(`${reachableOrigin}/.well-known/ucp`, {
              headers: { accept: "application/json" },
              signal: AbortSignal.timeout(2500),
            });
            serving = res.ok;
            guessed = guessHost(res.headers);
          } catch {
            // Unreachable is a legitimate answer and the pill says so. The
            // detail belongs to Verify, which the merchant asked for.
          }
        }

        const paymentSetup = razorpaySetup(s);

        return {
          key: s.key,
          name: s.name,
          origin,
          serving,
          guessed,
          // A reference to environment-variable names is not a configured
          // checkout. The status must follow the values those names resolve to.
          payable: paymentSetup.status === "ready",
          discoverySetup: agentDiscoverySetup(serving),
          paymentSetup,
          handlers: Object.keys(paymentHandlers(s)),
          // What agents are TOLD this store takes. Shown as the methods rather
          // than as the handler id, because "in.razorpay.checkout" tells a
          // merchant nothing about whether UPI is on.
          methods: s.razorpay
            ? (s.razorpay.methods ?? DEFAULT_PAYMENT_METHODS)
            : [],
          // The same `activeOffers` record the assistant reads and the quote
          // prices from. One source, so the page cannot show an offer that is
          // not really live.
          offers: announceable(s.key),
          activity: agentActivity(s.key),
          profileUrl,
          snippets: installSnippets(profileUrl),
          tierC: tierCSnippets(base, s.key),
          llmsUrl: `${base}/ucp/${s.key}/llms.txt`,
          staticDoc: staticProfile(s, base),
          endpoint: discoveryDocument(s, base).ucp.services[
            "dev.ucp.shopping"
          ][0].endpoint,
        };
      }),
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await requireMerchant(request);
  const form = await request.formData();
  const key = String(form.get("site") ?? "");

  // Scoped at the write, not only at the read. Verify makes this server fetch a
  // URL, so the set of URLs it will fetch has to be the merchant's OWN
  // registered origins and nothing else — a probe that took a URL from a form
  // is a request forger with a login page in front of it.
  const site = sitesForMerchant(merchant.sites).find((s) => s.key === key);
  if (!site) return { error: "not your store" as const, result: null };

  const reachableOrigin = new URL(site.catalogFeedUrl).origin;
  return {
    error: null,
    result: await verifyInstall(site, selfOrigin(request), reachableOrigin),
  };
};

/** Four verification states, coloured once. A skip is not a failure. */
const STEP: Record<string, "green" | "yellow" | "blue" | "gray"> = {
  pass: "green",
  fail: "yellow",
  warn: "blue",
  skip: "gray",
};

function Steps({ result }: { result: VerifyResult }) {
  const rows: Array<Record<string, unknown>> = result.steps.map((s, i) => ({
    id: String(i),
    state: s.state,
    label: s.label,
    detail: s.detail,
    why: s.why && s.state !== "pass" ? s.why : "",
  }));

  return (
    <Card padding={0}>
      <VStack gap={0}>
        <HStack gap={3} vAlign="center" padding={4} wrap="wrap">
          <Token
            size="md"
            color={result.ok ? "green" : "yellow"}
            label={result.ok ? "Working" : "Not working yet"}
          />
          <Text type="code" size="2xs" color="secondary">
            {result.origin}
          </Text>
        </HStack>
        <Table
          data={rows}
          idKey="id"
          density="balanced"
          dividers="rows"
          columns={[
            {
              key: "state",
              header: "",
              width: pixel(84),
              renderCell: (s) => (
                <Token
                  size="sm"
                  color={STEP[String(s.state)] ?? "gray"}
                  label={String(s.state)}
                />
              ),
            },
            {
              key: "label",
              header: "Step",
              width: proportional(1),
              renderCell: (s) => (
                <VStack gap={1}>
                  <Text weight="medium">{String(s.label)}</Text>
                  <Text type="code" size="2xs" color="secondary">
                    {String(s.detail)}
                  </Text>
                  {s.why ? (
                    <Text type="supporting" color="secondary">
                      {String(s.why)}
                    </Text>
                  ) : null}
                </VStack>
              ),
            },
          ]}
        />
        <VStack padding={4}>
          <Text type="supporting" color="secondary">
            Checked {new Date(result.checkedAt).toLocaleString()}. Worth
            re-running after any deploy: this is the kind of thing that
            disappears in a redirect config and gives no error when it does.
          </Text>
        </VStack>
      </VStack>
    </Card>
  );
}

/**
 * Tier C, with the no-code half separated from the code half.
 *
 * The split is the point of this component. A merchant on a static host is not
 * locked out of this tier — two config lines get them `/llms.txt` and the
 * header — and one who can deploy gets the other two behaviours. Presenting it
 * as a single "install middleware" button would make the first merchant think
 * the answer is no.
 *
 * Every card says what it covers AND what it does not. A partial install
 * described as an install is how somebody concludes the feature is broken when
 * it is doing exactly what they configured.
 */
function TierC({
  snippets,
  llmsUrl,
}: {
  snippets: Array<{
    host: string;
    where: string;
    lang: string;
    body: string;
    covers: string[];
    missing?: string[];
    measured?: boolean;
  }>;
  llmsUrl: string;
}) {
  const [pick, setPick] = useState(0);
  const chosen = snippets[pick];
  if (!chosen) return null;

  return (
    <VStack gap={4}>
      <SegmentedControl
        label="Your host"
        size="sm"
        value={String(pick)}
        onChange={(v) => setPick(Number(v))}
      >
        {snippets.map((sn, i) => (
          <SegmentedControlItem
            key={sn.host}
            value={String(i)}
            label={sn.host}
          />
        ))}
      </SegmentedControl>

      <Text type="supporting" color="secondary">
        {chosen.where}
        {chosen.measured
          ? " — this is the one we run and test; the others are written from the same contract but we have not watched them work"
          : ""}
      </Text>

      <CodeBlock
        code={chosen.body}
        language={chosen.lang}
        title={chosen.host}
        hasCopyButton
        isWrapped
        container="card"
        size="sm"
      />

      <Card variant="transparent" padding={0}>
        <VStack gap={2}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Eyebrow>Gives you</Eyebrow>
            {chosen.covers.map((c) => (
              <Token key={c} size="sm" color="green" label={c} />
            ))}
          </HStack>
          {chosen.missing?.length ? (
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Eyebrow>Does not</Eyebrow>
              {chosen.missing.map((m) => (
                <Token key={m} size="sm" color="gray" label={m} />
              ))}
            </HStack>
          ) : null}
        </VStack>
      </Card>

      <Note>
        Nothing here computes a price. Your middleware sends us a path and
        injects what comes back, so the offers and totals a browsing model reads
        are produced by the same server that would charge for them — there is no
        second copy to drift. It also cannot take your shop down: if we are
        unreachable the page is served exactly as it would have been, just
        without the extra.
      </Note>

      <Text type="supporting" color="secondary">
        You can read what a model will be told, right now:{" "}
        <Link href={llmsUrl} target="_blank" isExternalLink>
          {llmsUrl}
        </Link>
      </Text>
    </VStack>
  );
}

/**
 * The snippet picker.
 *
 * Their stack is preselected when the guess is confident, and the guess is
 * labelled as one. Header sniffing is right often enough to save a merchant a
 * scroll and wrong often enough that stating it as fact would have someone
 * paste an nginx block into a Netlify config and conclude we are broken.
 */
function Snippets({
  snippets,
  guessed,
}: {
  snippets: Array<{
    host: string;
    where: string;
    lang: string;
    body: string;
    proxies?: boolean;
  }>;
  guessed: string | null;
}) {
  const redirects = snippets.filter((s) => !s.proxies);
  const proxies = snippets.filter((s) => s.proxies);
  const initial = redirects.findIndex((s) => s.host === guessed);
  const [pick, setPick] = useState(initial >= 0 ? initial : 0);
  const chosen = redirects[pick];

  return (
    <VStack gap={4}>
      <SegmentedControl
        label="Your host"
        size="sm"
        value={String(pick)}
        onChange={(v) => setPick(Number(v))}
      >
        {redirects.map((s, i) => (
          <SegmentedControlItem key={s.host} value={String(i)} label={s.host} />
        ))}
      </SegmentedControl>

      {guessed ? (
        <Text type="supporting" color="secondary">
          Your server&rsquo;s headers look like <Code>{guessed}</Code> — a
          guess, so check it against what you actually run.
        </Text>
      ) : null}

      <Text type="supporting" color="secondary">
        {chosen.where}
      </Text>

      <CodeBlock
        code={chosen.body}
        language={chosen.lang}
        title={chosen.host}
        hasCopyButton
        isWrapped
        container="card"
        size="sm"
      />

      <Collapsible
        trigger={
          <Text color="secondary">I would rather proxy it than redirect</Text>
        }
      >
        <VStack gap={3} paddingBlockStart={3}>
          <Note>
            Also fine, and slightly better in one way: the request finishes on
            your origin, so your domain stays the only host an agent talks to
            for discovery. It costs you a deploy and a little code. Cache it for
            a minute and serve the last good copy if we are unreachable — an
            agent that gets a 502 here concludes your store does not speak the
            protocol at all, which is far worse than a document sixty seconds
            stale.
          </Note>
          {proxies.map((s) => (
            <CodeBlock
              key={s.host}
              code={s.body}
              language={s.lang}
              title={`${s.host} — ${s.where}`}
              hasCopyButton
              isWrapped
              container="card"
              size="sm"
            />
          ))}
        </VStack>
      </Collapsible>
    </VStack>
  );
}

export default function AgentFront() {
  const d = useLoaderData<typeof loader>();
  const verified = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const toolRows: Array<Record<string, unknown>> = d.tools.map((t) => ({
    id: t.name,
    name: t.name,
    description: `${t.description.split(".")[0]}.`,
  }));

  return (
    <Page>
      <PageHead
        title="Agent-readable storefront"
        lede="When a shopper asks their AI assistant to buy from you, it needs a machine surface to talk to. This gives your store one, in the same protocol the largest stores already speak."
      />

      <Banner
        status="info"
        title="If you are on Shopify, you already have this"
        description="Shopify serves UCP on every store already. What follows is for custom storefronts, which get nothing by default."
      />

      {d.sites.map((s) => (
        <Block key={s.key} title={s.name}>
          <VStack gap={6}>
            <Figures>
              <Figure
                value={
                  <Token
                    size="md"
                    color={s.serving ? "green" : "yellow"}
                    label={s.serving ? "Serving" : "Not serving"}
                  />
                }
                label={s.origin || "no origin registered"}
              />
              <Figure
                value={
                  <Token
                    size="md"
                    color={s.payable ? "green" : "gray"}
                    label={s.payable ? "Payments on" : "Payments off"}
                  />
                }
                label={
                  s.payable ? s.methods.join(", ") : "browse and cart only"
                }
              />
              <Figure
                value={
                  <Token
                    size="md"
                    color={s.offers.length ? "green" : "gray"}
                    label={
                      s.offers.length
                        ? `${s.offers.length} offer${s.offers.length > 1 ? "s" : ""}`
                        : "No offers"
                    }
                  />
                }
                label={
                  s.offers.length
                    ? "agents see these automatically"
                    : "agents see full price"
                }
              />
            </Figures>

            {s.payable && !s.methods.includes("upi") ? (
              <Banner
                status="warning"
                container="card"
                title="UPI is not advertised to agents"
                description={`This account cannot take it yet — Razorpay refuses it until KYC completes. We tell agents ${s.methods.join(", ")} and nothing more. Naming a method your checkout page will not offer sends buyers looking for a button that is not there. When KYC clears, add methods: ["upi", …] to this store in sites.server.ts and discovery, the escalation message and the payment page all follow from that one edit.`}
              />
            ) : null}

            {s.offers.length > 0 ? (
              <VStack gap={3}>
                <Heading level={3}>Offers an agent can see right now</Heading>
                <Text color="secondary">
                  An agent gets the terms — which product, what percentage,
                  until when — never a price it worked out. There is no field it
                  could send a discount in.
                </Text>
                <Card padding={0}>
                  <Table
                    data={s.offers as unknown as Array<Record<string, unknown>>}
                    idKey="handle"
                    density="compact"
                    dividers="rows"
                    columns={[
                      {
                        key: "title",
                        header: "Product",
                        width: proportional(1),
                      },
                      {
                        key: "percent",
                        header: "Off",
                        width: pixel(90),
                        align: "end",
                        renderCell: (o) => (
                          <Text hasTabularNumbers weight="semibold">
                            {String(o.percent)}%
                          </Text>
                        ),
                      },
                      {
                        key: "endsAt",
                        header: "Until",
                        width: pixel(120),
                        renderCell: (o) => (
                          <Text type="code" size="2xs" color="secondary">
                            {String(o.endsAt).slice(0, 10)}
                          </Text>
                        ),
                      },
                    ]}
                  />
                </Card>
              </VStack>
            ) : null}

            <Divider />

            <VStack gap={3}>
              <Heading level={3}>What agents have done here</Heading>
              {s.activity.calls === 0 ? (
                <Note>
                  Nothing yet. Expected until an agent finds you — and also
                  exactly what a broken install looks like, so run Verify in the
                  setup panel below.
                </Note>
              ) : (
                <VStack gap={4}>
                  <Figures>
                    <Figure value={s.activity.calls} label="calls" />
                    <Figure
                      value={s.activity.checkouts}
                      label="checkouts opened"
                    />
                    <Figure
                      value={s.activity.orders}
                      label="orders paid"
                      tone="accent"
                    />
                    <Figure
                      value={`₹${s.activity.revenue.toLocaleString("en-IN")}`}
                      label="settled"
                    />
                  </Figures>
                  <Text type="supporting" color="secondary">
                    From{" "}
                    {s.activity.hosts.length === 1
                      ? "one agent"
                      : `${s.activity.hosts.length} agents`}
                    : {s.activity.hosts.slice(0, 3).join(", ")}
                    {s.activity.hosts.length > 3
                      ? ` and ${s.activity.hosts.length - 3} more`
                      : ""}
                    . An agent that will not say who it is does not get to
                    reserve your inventory. Orders count only once the payment
                    settled — an opened checkout is intent, not revenue.
                  </Text>
                  <Card padding={0}>
                    <Table
                      data={s.activity.recent.map((r, i) => ({
                        id: String(i),
                        when: new Date(r.ts).toLocaleTimeString(),
                        what:
                          r.amount != null
                            ? `${r.message} · ₹${r.amount.toLocaleString("en-IN")}`
                            : r.message,
                        agent: r.agent,
                      }))}
                      idKey="id"
                      density="compact"
                      dividers="rows"
                      columns={[
                        {
                          key: "when",
                          header: "When",
                          width: pixel(110),
                          renderCell: (r) => (
                            <Text type="code" size="2xs" color="secondary">
                              {String(r.when)}
                            </Text>
                          ),
                        },
                        { key: "what", header: "What", width: proportional(1) },
                        {
                          key: "agent",
                          header: "Agent",
                          width: pixel(220),
                          renderCell: (r) => (
                            <Text type="code" size="2xs" color="secondary">
                              {String(r.agent)}
                            </Text>
                          ),
                        },
                      ]}
                    />
                  </Card>
                  <Text type="supporting" color="secondary">
                    The full record, including everything the assistant was
                    stopped from saying, is in the{" "}
                    <Link href="/dashboard/ledger">ledger</Link>.
                  </Text>
                </VStack>
              )}
            </VStack>

            <Setup>
              <IntegrationSetup guide={s.discoverySetup} />

              <Divider />

              <VStack gap={3}>
                <Heading level={3}>Bundled Monsoon Market demo</Heading>
                <Text color="secondary">
                  The demo server already contains the proxy implementation, but it starts switched
                  off so the initial 404 is real. Enable it only after registering this store.
                </Text>
                <Card>
                  <List listStyle="decimal" density="spacious">
                    <ListItem
                      label="Set DEMO_STORE_CHAPMAN=true in the repository-root .env"
                      description="This enables the demo's discovery, signed order-feed, recovery and identity routes. It does not apply to a real merchant website."
                    />
                    <ListItem
                      label="Recreate only the store service"
                      description="Run the command below from the repository root. The Chapman data volume is kept."
                    />
                    <ListItem
                      label="Choose Verify install below"
                      description="Serving is not trusted until the live /.well-known/ucp route answers."
                    />
                  </List>
                </Card>
                <CodeBlock
                  code="docker compose --profile demo up -d --force-recreate store"
                  language="bash"
                  title="Repository root terminal"
                  hasCopyButton
                  container="card"
                  size="sm"
                />
                <Note>
                  For the full demo, register the signed order feed as <Code>http://store:4000/api/orders</Code>.
                  Leave it blank when demonstrating catalogue-only access.
                </Note>
              </VStack>

              <Divider />

              <VStack gap={3}>
                <Heading level={3}>Real custom website</Heading>
                <Text color="secondary">
                  Point <Code>/.well-known/ucp</Code> on your own domain at the
                  Chapman profile URL shown in the generated rule below. Put the rule in the host
                  configuration named by the selected tab, deploy it, then request the well-known
                  URL on your own domain. That is the only place an agent looks, and deleting the
                  rule revokes access.
                </Text>
                <Note>
                  A redirect is enough — no file to host and nothing to keep up
                  to date.
                </Note>
                <Snippets snippets={s.snippets} guessed={s.guessed} />
              </VStack>

              <VStack gap={3}>
                <Heading level={3}>Check it</Heading>
                <Text color="secondary">
                  Does what a shopper&rsquo;s agent does, against your live
                  domain, and reports each step separately.
                </Text>
                <Form method="post">
                  <input type="hidden" name="site" value={s.key} />
                  <HStack>
                    <Button
                      type="submit"
                      variant="primary"
                      isDisabled={busy}
                      label={busy ? "Checking…" : "Verify install"}
                    />
                  </HStack>
                </Form>
                {verified?.error ? (
                  <Banner
                    status="error"
                    title="That store is not yours"
                    description={verified.error}
                  />
                ) : null}
                {verified?.result && verified.result.origin === s.origin ? (
                  <Steps result={verified.result} />
                ) : null}
              </VStack>

              <Divider />

              <IntegrationSetup guide={s.paymentSetup} />

              <Divider />

              <VStack gap={3}>
                <Heading level={3}>
                  Optional: be readable to AIs that only browse
                </Heading>
                <Text color="secondary">
                  For the other kind of caller: someone pastes your product URL
                  into ChatGPT and it fetches the page like a browser. After
                  this it reads your real prices, stock and offers instead of
                  guessing at your markup.
                </Text>
                <TierC snippets={s.tierC} llmsUrl={s.llmsUrl} />
              </VStack>

              <Divider />

              <Collapsible
                trigger={
                  <Text color="secondary">
                    Try it yourself — point a real AI at this store
                  </Text>
                }
              >
                <VStack gap={3} paddingBlockStart={3}>
                  <Text color="secondary">
                    The endpoint speaks MCP, so an assistant can shop here with
                    no adapter. In Claude Code or Claude Desktop, add this
                    server:
                  </Text>
                  <CodeBlock
                    code={s.endpoint}
                    hasCopyButton
                    container="card"
                    size="sm"
                  />
                  <Text color="secondary">
                    Then ask it to find something, check the offers, and buy.
                    One thing it needs from you, because a model asked to invent
                    an agent profile invents one that does not resolve — and
                    holding your stock requires a caller we can look up:
                  </Text>
                  <CodeBlock
                    code={`Use ${d.base}/agent/testing/profile as your ucp-agent profile.`}
                    hasCopyButton
                    isWrapped
                    container="card"
                    size="sm"
                  />
                  <Text color="secondary">
                    For a safe local test, open PowerShell in the{" "}
                    <Code>agent-gateway</Code> directory and run:
                  </Text>
                  <CodeBlock
                    code="npm.cmd run shop-as-agent -- --store http://localhost:4000 --query chai --no-checkout"
                    language="powershell"
                    hasCopyButton
                    isWrapped
                    container="card"
                    size="sm"
                  />
                  <Note>
                    This discovers the MCP endpoint, lists its tools, searches,
                    and creates a cart without holding stock or opening a
                    payment. Remove <Code>--no-checkout</Code> only after Agent
                    front reports a Razorpay payment handler ready.
                  </Note>
                </VStack>
              </Collapsible>

              <Collapsible
                trigger={
                  <Text color="secondary">
                    My host cannot redirect — give me a file to upload
                  </Text>
                }
              >
                <VStack gap={3} paddingBlockStart={3}>
                  <Note>
                    Worth avoiding: a file is a copy, and it goes stale
                    silently. Turn on payments later and this one keeps telling
                    agents you take none.
                  </Note>
                  <Text type="supporting" color="secondary">
                    Save as <Code>ucp</Code> (no extension) at{" "}
                    <Code>/.well-known/ucp</Code>, served as{" "}
                    <Code>application/json</Code>:
                  </Text>
                  <CodeBlock
                    code={s.staticDoc}
                    language="json"
                    hasCopyButton
                    maxHeight={320}
                    container="card"
                    size="sm"
                  />
                </VStack>
              </Collapsible>
            </Setup>
          </VStack>
        </Block>
      ))}

      <Block
        title="What an agent can then do"
        hint={`${d.toolCount} operations, version ${d.version}. Reads are open to anyone; holding stock or opening a payment requires an agent that will say who it is.`}
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
                header: "Operation",
                width: pixel(240),
                renderCell: (t) => (
                  <Text type="code" size="2xs">
                    {String(t.name)}
                  </Text>
                ),
              },
              {
                key: "description",
                header: "What it does",
                width: proportional(1),
                renderCell: (t) => (
                  <Text color="secondary">{String(t.description)}</Text>
                ),
              },
            ]}
          />
        </Card>
      </Block>

      <Block
        title="What it cannot do"
        hint="Enforced by where the code runs, not by an instruction to a model."
      >
        <Card>
          <List density="spacious" hasDividers>
            <ListItem
              label="Set a price"
              description="Every basket is re-priced from your catalogue at the moment of checkout. An agent may send a price; it is read past and discarded."
            />
            <ListItem
              label="Invent an offer"
              description="Agents see the discounts you approved, as terms, never as a number they worked out. The rupees are computed here, by the same server that charges them, and there is no field an agent could send a discount in."
            />
            <ListItem
              label="Hold stock by browsing"
              description="Carts reserve nothing. Only a checkout holds units, for fifteen minutes, and cancelling releases them at once."
            />
            <ListItem
              label="Read your customers"
              description="An agent can read back an order it placed itself. Your own order history needs the shopper's verified sign-in — an order number is printed on a receipt and is not proof of who is asking."
            />
            <ListItem
              label="Complete a UPI payment"
              description="UPI authenticates the payer inside their own banking app. The agent gets a link and hands it to the buyer. That is a defined outcome in the protocol, not a shortfall, and it is the only honest one on Indian rails."
            />
          </List>
        </Card>
      </Block>
    </Page>
  );
}
