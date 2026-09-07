import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { DateInput } from "@astryxdesign/core/DateInput";
import type { DateInputProps } from "@astryxdesign/core/DateInput";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { List, ListItem } from "@astryxdesign/core/List";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import { Block, Eyebrow, Figure, Figures, Note, Page, PageHead, Setup } from "../components/console";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { runProposals } from "../lib/proposals.server";
import { decide, activeOffers, history } from "../lib/approvals.server";
import { publishFindings } from "../lib/findings.server";
import { recoverySummary, runRecovery } from "../lib/recovery.server";
import { reasonHistogram } from "../lib/conversations.server";

/**
 * The offer proposer, as a merchant sees it.
 *
 * Three things this page does that most "AI suggestions" screens do not:
 *
 * 1. IT SHOWS WHAT IT STOPPED. Every rejected candidate is listed with the gate
 *    that caught it and why. A proposer that silently discards is
 *    indistinguishable from one that never looked, and a merchant who sees
 *    "this would have ranked first and sells at a loss" trusts the rest more.
 *
 * 2. IT SEPARATES INCIDENTS FROM OFFERS. A payment outage is not a suggestion
 *    to weigh against a cross-sell; it is a thing that is broken and is costing
 *    money today.
 *
 * 3. IT NEVER FORECASTS. Every markdown states what volume it would need to
 *    break even and then stops. This store has never changed a price, so there
 *    is no variation to estimate elasticity from — the arithmetic is ours and
 *    the judgment stays with the merchant.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site) return { site: null, run: null, offers: [], decisions: [] };

  const run = await runProposals({
    shop: site.key,
    catalog: jsonFeedCatalog(site.catalogFeedUrl),
  });

  /**
   * The analysis just ran; record what it concluded.
   *
   * A loader that writes is not free of sin, but the alternative is worse in
   * every direction: a scheduler we do not have, or a cortex that re-runs the
   * whole pipeline on the shopper's path. What crosses is aggregates and
   * server-written sentences — see `findings.server.ts` for why a shopper may
   * hear "netbanking has been failing; UPI is fine" and may not hear the rate
   * behind it.
   */
  publishFindings({
    shop: site.key,
    incidents: run.incidents,
    actions: run.actions,
    stopped: run.rejected.length,
    recovery: recoverySummary(
      runRecovery({
        shop: site.key,
        shopName: site.name,
        storefrontOrigin: site.origins[0],
        productUrlTemplate: site.productUrlTemplate,
      }),
    ),
    reasons: reasonHistogram(site.key),
  });

  return {
    site: { key: site.key, name: site.name },
    run,
    offers: activeOffers(site.key),
    decisions: history(site.key, 20),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  if (!merchant.sites.includes(shop)) {
    // Scoped at the write, not only at the read. A page that filters what it
    // shows but not what it accepts is one crafted POST away from a merchant
    // approving an offer on somebody else's store.
    return { ok: false, error: "not your store" };
  }

  const action = String(form.get("act") ?? "") as "approve" | "reject" | "revoke";
  const candidateId = String(form.get("candidateId") ?? "");

  if (action === "approve") {
    const depth = Number(form.get("depth"));
    const result = decide({
      shop,
      candidateId,
      action: "approve",
      by: merchant.email,
      offer: {
        handle: String(form.get("handle") ?? ""),
        title: String(form.get("title") ?? ""),
        depth,
        endsAt: String(form.get("endsAt") ?? ""),
        maxUnits: Number(form.get("maxUnits")),
      },
    });
    return result;
  }

  return decide({ shop, candidateId, action, by: merchant.email, note: String(form.get("note") ?? "") || undefined });
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const GATE_LABEL: Record<string, string> = {
  sample_floor: "Too little evidence",
  margin_floor: "Below your margin floor",
  depth_cap: "Deeper than your cap",
  never_discount: "On your never-discount list",
  false_discovery: "Probably noise",
  no_effect: "No measurable effect",
};

type Fact = { label: string; value: string };

/**
 * DateInput narrows its value to a literal YYYY-MM-DD template type, so the
 * date this page computes has to be told it is one.
 */
type ISODate = NonNullable<DateInputProps["value"]>;

/**
 * The arithmetic behind a suggestion, laid out as a row of measurements.
 *
 * Kept visually quiet on purpose: the reasoning is the argument, and an
 * argument that shouts reads like a sales pitch rather than a calculation.
 */
function Facts({ facts }: { facts: readonly Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <HStack gap={5} wrap="wrap">
      {facts.map((f) => (
        <VStack key={f.label} gap={0.5}>
          <Eyebrow>{f.label}</Eyebrow>
          <Text weight="semibold" hasTabularNumbers>
            {f.value}
          </Text>
        </VStack>
      ))}
    </HStack>
  );
}

/**
 * A price experiment, with its approval attached.
 *
 * State is per-card rather than per-page because two experiments must never
 * share an end date by accident — and the hidden inputs exist because the
 * Astryx fields are controlled, so a native form POST would otherwise carry
 * nothing.
 */
function ExperimentCard({
  id,
  title,
  rationale,
  facts,
  handle,
  shop,
  defaultEnd,
  busy,
}: {
  id: string;
  title: string;
  rationale: string;
  facts: readonly Fact[];
  handle: string;
  shop: string;
  defaultEnd: ISODate;
  busy: boolean;
}) {
  const depth = Number(/@(\d+(?:\.\d+)?)%/.exec(id)?.[1] ?? 10) / 100;
  const [endsAt, setEndsAt] = useState<ISODate | "">(defaultEnd);
  const [maxUnits, setMaxUnits] = useState<number | null>(40);

  return (
    <Card>
      <VStack gap={4}>
        <VStack gap={2}>
          <Heading level={3}>{title}</Heading>
          <Text color="secondary">{rationale}</Text>
        </VStack>
        <Facts facts={facts} />
        <Divider />
        <Form method="post">
          <input type="hidden" name="shop" value={shop} />
          <input type="hidden" name="candidateId" value={id} />
          <input type="hidden" name="handle" value={handle} />
          <input type="hidden" name="title" value={title.replace(/^Consider \d+% off /, "")} />
          <input type="hidden" name="depth" value={depth} />
          <input type="hidden" name="endsAt" value={endsAt} />
          <input type="hidden" name="maxUnits" value={maxUnits ?? ""} />
          <HStack gap={3} vAlign="end" wrap="wrap">
            <DateInput
              label="Ends"
              size="sm"
              value={endsAt || undefined}
              onChange={(v) => setEndsAt(v ?? "")}
              width={190}
            />
            <NumberInput
              label="Max units"
              size="sm"
              min={1}
              value={maxUnits}
              onChange={setMaxUnits}
              width={130}
            />
            <Button
              type="submit"
              name="act"
              value="approve"
              variant="primary"
              size="sm"
              isDisabled={busy}
              label="Approve this offer"
            />
            <Button
              type="submit"
              name="act"
              value="reject"
              variant="ghost"
              size="sm"
              isDisabled={busy}
              label="No"
            />
          </HStack>
        </Form>
      </VStack>
    </Card>
  );
}

export default function Offers() {
  const d = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!d.site || !d.run) {
    return (
      <Page>
        <PageHead title="Offer proposals" />
        <Card>
          <EmptyState
            title="No store is connected to this account yet"
            description="Connect a storefront and the proposer runs against its own order history."
          />
        </Card>
      </Page>
    );
  }

  const { run } = d;
  const shop = d.site.key;
  // A month out, as a sensible default the merchant can change. Long enough to
  // measure something at this store's volume, short enough to be a real end.
  const defaultEnd = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) as ISODate;

  const stoppedRows: Array<Record<string, unknown>> = run.rejected.map((r) => ({
    id: r.candidate.id,
    idea: r.candidate.title,
    gate: GATE_LABEL[r.rejected!.gate] ?? r.rejected!.gate,
    why: r.rejected!.why,
  }));

  const classRows: Array<Record<string, unknown>> = run.classification.map((c) => ({
    id: c.handle,
    title: c.title,
    grade: `${c.abc}${c.xyz}`,
    share: `${(c.revenueShare * 100).toFixed(1)}%`,
    units: c.unitsPerMonth.toFixed(1),
    cover: c.monthsOfCover === null ? "—" : `${c.monthsOfCover.toFixed(1)} mo`,
  }));

  const decisionRows: Array<Record<string, unknown>> = d.decisions.map((x, i) => ({
    id: `${x.ts}-${i}`,
    when: x.ts.slice(0, 16).replace("T", " "),
    what: x.action,
    proposal: x.candidateId,
  }));

  return (
    <Page>
      <PageHead
        title="Offer proposals"
        lede="Worked out from your own orders. Every number was counted, not guessed, and nothing goes live until you approve it."
      >
        <Figures>
          <Figure value={run.scale.monthlyOrders.toFixed(0)} label="orders a month" />
          <Figure value={inr(run.scale.monthlyGrossMargin)} label="monthly gross margin" tone="accent" />
          <Figure value={run.incidents.length} label="needs attention" />
          <Figure value={run.actions.length} label="ideas ranked" />
          <Figure value={run.rejected.length} label="stopped" />
        </Figures>
      </PageHead>

      {run.emptyReason ? (
        <Banner status="info" title="Nothing to propose this run" description={run.emptyReason} />
      ) : null}

      <Setup title="Give proposals enough evidence">
        <Card>
          <List listStyle="decimal" density="spacious">
            <ListItem
              label="Enable Offers in Feature controls"
              description="This permits proposals and approved promotions; it does not manufacture evidence."
            />
            <ListItem
              label="Provide unit cost for each SKU and merchant floors"
              description="The current Docker build reads these from /data/merchant-inputs.json. Without cost and margin limits, it refuses to propose a discount."
            />
            <ListItem
              label="Accumulate at least 30 settled orders"
              description="Chapman checkout orders enter this history automatically. A new real store should correctly show too little evidence until enough orders exist."
            />
            <ListItem
              label="Open this page again and review every stopped idea"
              description="Nothing becomes a live offer until you approve a price experiment here."
            />
          </List>
        </Card>
        <Text color="secondary">
          For a presentation only, the bundled deterministic fixture supplies synthetic orders,
          carts, costs and floors. Set the following value in the root .env, then recreate the
          gateway. Keep it off for real merchant evaluation.
        </Text>
        <CodeBlock
          code={"CHAPMAN_SEED=true\n\ndocker compose up -d --force-recreate gateway"}
          language="bash"
          title="Synthetic demo history only"
          hasCopyButton
          container="card"
          size="sm"
        />
      </Setup>

      {d.offers.length > 0 ? (
        <Block
          title="Live now"
          hint="The assistant can mention these. It cannot invent one or change a percentage."
        >
          <VStack gap={3}>
            {d.offers.map((o) => (
              <Card key={o.candidateId}>
                <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
                  <VStack gap={1}>
                    <HStack gap={3} vAlign="center">
                      <Token size="md" color="green" label={`${Math.round(o.depth * 100)}% off`} />
                      <Heading level={3}>{o.title}</Heading>
                    </HStack>
                    <Text type="supporting" color="secondary">
                      Until {o.endsAt}, capped at {o.maxUnits} units. Approved by {o.approvedBy} on{" "}
                      {o.approvedAt.slice(0, 10)}.
                    </Text>
                  </VStack>
                  <Form method="post">
                    <input type="hidden" name="shop" value={shop} />
                    <input type="hidden" name="candidateId" value={o.candidateId} />
                    <input type="hidden" name="act" value="revoke" />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      isDisabled={busy}
                      label="Stop this offer"
                    />
                  </Form>
                </HStack>
              </Card>
            ))}
          </VStack>
        </Block>
      ) : null}

      {run.incidents.length > 0 ? (
        <Block
          title="Needs attention"
          hint="Broken, not suggested. Kept out of the ranked list on purpose."
        >
          <VStack gap={3}>
            {run.incidents.map((c) => (
              <Banner
                key={c.id}
                status="warning"
                container="card"
                title={c.title}
                description={c.rationale}
              >
                <Facts facts={c.facts} />
              </Banner>
            ))}
          </VStack>
        </Block>
      ) : null}

      <Block
        title="This week"
        hint={`${run.digest.length} of ${run.actions.length} ranked ideas, chosen to cover different products rather than to be the three highest scores. None of these costs you any margin.`}
      >
        <VStack gap={3}>
          {run.digest.map((c) => (
            <Card key={c.id}>
              <VStack gap={4}>
                <HStack gap={4} hAlign="between" vAlign="start">
                  <VStack gap={2}>
                    <Heading level={3}>{c.title}</Heading>
                    <Text color="secondary">{c.rationale}</Text>
                  </VStack>
                  <Token size="sm" color="gray" label={`priority ${c.priority.toFixed(0)}`} />
                </HStack>
                <Facts facts={c.facts} />
                <Form method="post">
                  <input type="hidden" name="shop" value={shop} />
                  <input type="hidden" name="candidateId" value={c.id} />
                  <input type="hidden" name="act" value="reject" />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    label="Not interested"
                  />
                </Form>
              </VStack>
            </Card>
          ))}
        </VStack>
      </Block>

      {run.experiments.length > 0 ? (
        <Block
          title="Price experiments"
          hint="These give up margin, so run one at a time. Each shows what it costs and the volume it needs to break even — not whether it will get there."
        >
          <VStack gap={3}>
            {run.experiments.map((c) => (
              <ExperimentCard
                key={c.id}
                id={c.id}
                title={c.title}
                rationale={c.rationale}
                facts={c.facts}
                handle={c.products[0]}
                shop={shop}
                defaultEnd={defaultEnd}
                busy={busy}
              />
            ))}
          </VStack>
        </Block>
      ) : null}

      <Block
        title="Considered and stopped"
        hint="Shown rather than hidden, so you can judge the floors."
      >
        {stoppedRows.length === 0 ? (
          <Card>
            <EmptyState
              isCompact
              title="Nothing was stopped this run"
              description="Every candidate the detectors raised cleared all three floors."
            />
          </Card>
        ) : (
          <Card padding={0}>
            <Table
              data={stoppedRows}
              idKey="id"
              density="balanced"
              dividers="rows"
              columns={[
                {
                  key: "idea",
                  header: "Idea",
                  width: proportional(1),
                  renderCell: (r) => (
                    <VStack gap={1.5}>
                      <Text>{String(r.idea)}</Text>
                      <HStack>
                        <Token size="sm" color="gray" label={String(r.gate)} />
                      </HStack>
                    </VStack>
                  ),
                },
                {
                  key: "why",
                  header: "Why it was stopped",
                  width: proportional(1.2),
                  renderCell: (r) => <Text color="secondary">{String(r.why)}</Text>,
                },
              ]}
            />
          </Card>
        )}
      </Block>

      <Block
        title="Your catalogue, classified"
        hint="A, B, C by share of revenue. X, Y, Z by how steady demand is; ? means too few months to say."
      >
        <Card padding={0}>
          <Table
            data={classRows}
            idKey="id"
            density="compact"
            dividers="rows"
            columns={[
              { key: "title", header: "Product", width: proportional(1) },
              {
                key: "grade",
                header: "Class",
                width: pixel(80),
                renderCell: (r) => (
                  <Text type="code" size="2xs">
                    {String(r.grade)}
                  </Text>
                ),
              },
              { key: "share", header: "Share of revenue", width: pixel(140), align: "end" },
              { key: "units", header: "Units/mo", width: pixel(100), align: "end" },
              { key: "cover", header: "Cover", width: pixel(96), align: "end" },
            ]}
          />
        </Card>
      </Block>

      {decisionRows.length > 0 ? (
        <Block title="Your decisions">
          <Card padding={0}>
            <Table
              data={decisionRows}
              idKey="id"
              density="compact"
              dividers="rows"
              columns={[
                {
                  key: "when",
                  header: "When",
                  width: pixel(150),
                  renderCell: (r) => (
                    <Text type="code" size="2xs" color="secondary">
                      {String(r.when)}
                    </Text>
                  ),
                },
                {
                  key: "what",
                  header: "What",
                  width: pixel(120),
                  renderCell: (r) => (
                    <Token
                      size="sm"
                      color={r.what === "approve" ? "green" : "gray"}
                      label={String(r.what)}
                    />
                  ),
                },
                {
                  key: "proposal",
                  header: "Proposal",
                  width: proportional(1),
                  renderCell: (r) => (
                    <Text type="code" size="2xs" color="secondary">
                      {String(r.proposal)}
                    </Text>
                  ),
                },
              ]}
            />
          </Card>
        </Block>
      ) : null}

      <Note>
        Nothing here forecasts. You get the break-even; the judgment stays with you.
      </Note>
    </Page>
  );
}
