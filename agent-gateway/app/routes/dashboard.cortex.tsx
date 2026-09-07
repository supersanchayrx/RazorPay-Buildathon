import { useState } from "react";
import type { ReactNode } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack } from "@astryxdesign/core/HStack";
import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import {
  Block,
  Figure,
  Figures,
  Note,
  Page,
  PageHead,
} from "../components/console";

import { jsonFeedCatalog } from "../lib/catalog.server";
import { buildCortex, isStale, shopperView } from "../lib/cortex.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { sitesForMerchant } from "../lib/sites.server";
import { requireMerchant } from "../lib/auth.server";
import { writeSettings } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const site = sitesForMerchant(requireMerchant(request).sites)[0];
  if (!site)
    throw new Response("no storefront on this account", { status: 404 });
  const cortex = await buildCortex({
    site,
    catalog: jsonFeedCatalog(site.catalogFeedUrl),
  });
  return {
    cortex,
    shopper: shopperView(cortex),
    stale: {
      policies: isStale(cortex.policies),
      catalogue: isStale(cortex.catalogue),
      commerce: cortex.commerce ? isStale(cortex.commerce) : false,
      findings: cortex.findings ? isStale(cortex.findings) : false,
      notices: isStale(cortex.serviceNotices),
    },
  };
};

/**
 * The one thing on this page a merchant can write.
 *
 * Everything else in the cortex is derived, and deliberately so — a typed
 * number goes stale silently while looking authoritative. The voice is the
 * exception because there is no data anywhere that could tell us how a shop
 * wants to sound.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  if (!merchant.sites.includes(shop))
    return { ok: false, error: "not your store" };
  const res = writeSettings(
    shop,
    { voice: String(form.get("voice") ?? "") },
    merchant.email,
  );
  return { ok: res.ok, error: res.error };
};

const age = (at: string) => {
  const m = Math.round((Date.now() - Date.parse(at)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/** Where a fact came from, and how old it is. Every fact carries one. */
function Src({
  from,
  at,
  stale,
}: {
  from: string;
  at: string;
  stale?: boolean;
}) {
  return (
    <HStack gap={2} vAlign="center">
      <Text type="code" size="2xs" color="secondary">
        {from} · {age(at)}
      </Text>
      {stale ? <Token size="sm" color="yellow" label="stale" /> : null}
    </HStack>
  );
}

/* ------------------------------------------------------------------ *
 * The derivation map
 *
 * Not decoration. Every node is a real field on `ShopCortex` and every
 * edge is a real derivation, so the picture cannot drift from the code
 * without someone editing this table. The vertical line is
 * `shopperView()` — the function that picks six fields and drops the
 * rest — and the four red stops are the four facts it does not carry.
 * That boundary is the whole argument of the page, and it is easier to
 * see than to read.
 *
 * Highlight state is driven from React as inline opacity rather than a
 * stylesheet, so the page ships no hand-written CSS. Geometry stays in
 * raw units because an SVG coordinate is structure, not design spacing.
 * ------------------------------------------------------------------ */

const WALL = 668;

const SOURCES = [
  { id: "feed", y: 105, label: "Catalogue feed" },
  { id: "typed", y: 225, label: "You typed it" },
  { id: "analysis", y: 345, label: "Analysis run" },
  { id: "orders", y: 440, label: "Order history" },
  { id: "ledger", y: 520, label: "Decision ledger" },
];

type MapFact = {
  id: string;
  y: number;
  label: string;
  sub: string;
  src: string;
  crosses: boolean;
};

const MAP_FACTS: MapFact[] = [
  {
    id: "catalogue",
    y: 74,
    label: "What you sell",
    sub: "shape only",
    src: "feed",
    crosses: true,
  },
  {
    id: "policies",
    y: 136,
    label: "Policies",
    sub: "returns · shipping · cod",
    src: "feed",
    crosses: true,
  },
  {
    id: "voice",
    y: 198,
    label: "Voice",
    sub: "the one typed field",
    src: "typed",
    crosses: true,
  },
  {
    id: "notices",
    y: 260,
    label: "Service notices",
    sub: "whole sentences",
    src: "analysis",
    crosses: true,
  },
  {
    id: "constraints",
    y: 358,
    label: "Your limits",
    sub: "margin · discount",
    src: "typed",
    crosses: false,
  },
  {
    id: "commerce",
    y: 420,
    label: "Trade",
    sub: "volume · average",
    src: "orders",
    crosses: false,
  },
  {
    id: "decisions",
    y: 482,
    label: "Said & stopped",
    sub: "replies · refusals",
    src: "ledger",
    crosses: false,
  },
  {
    id: "findings",
    y: 544,
    label: "Last analysis",
    sub: "incidents · ideas",
    src: "analysis",
    crosses: false,
  },
];

const MONO = "var(--font-family-code, ui-monospace, monospace)";

function DerivationMap({
  state,
}: {
  state: Record<string, { present: boolean; stale: boolean }>;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const focused = focus ? MAP_FACTS.find((f) => f.id === focus) : null;

  /** Dim anything not on the hovered fact's own derivation chain. */
  const factOpacity = (id: string) => (!focus || focus === id ? 1 : 0.22);
  const srcOpacity = (id: string) => (!focus || focused?.src === id ? 1 : 0.22);
  const edgeOpacity = (id: string) => (!focus || focus === id ? 1 : 0.07);

  return (
    <svg
      viewBox="0 0 940 600"
      width="100%"
      role="img"
      aria-label="How the cortex is assembled, and what crosses the shopper boundary"
      style={{ display: "block", height: "auto" }}
    >
      <title>
        How the cortex is assembled, and what crosses the shopper boundary
      </title>

      {/* Column headings */}
      {[
        { x: 94, t: "source" },
        { x: 432, t: "what it holds" },
        { x: 828, t: "who may read it" },
      ].map((h) => (
        <text
          key={h.t}
          x={h.x}
          y={20}
          textAnchor="middle"
          fill="var(--color-text-secondary)"
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {h.t}
        </text>
      ))}

      {/* The boundary itself. */}
      <line
        x1={WALL}
        y1={36}
        x2={WALL}
        y2={580}
        stroke="var(--color-border-emphasized)"
        strokeWidth={1}
        strokeDasharray="2 5"
      />
      <text
        transform={`translate(${WALL - 9} 300) rotate(-90)`}
        textAnchor="middle"
        fill="var(--color-text-secondary)"
        style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em" }}
      >
        shopperView( )
      </text>

      {/* Edges, drawn first so nodes sit on top. */}
      {MAP_FACTS.map((f) => {
        const s = SOURCES.find((x) => x.id === f.src)!;
        return (
          <path
            key={`s-${f.id}`}
            d={`M 160 ${s.y} C 240 ${s.y} 236 ${f.y} 316 ${f.y}`}
            fill="none"
            stroke="var(--color-border-emphasized)"
            strokeWidth={focus === f.id ? 2 : 1.25}
            opacity={edgeOpacity(f.id)}
          />
        );
      })}

      {MAP_FACTS.filter((f) => f.crosses).map((f) => (
        <path
          key={`x-${f.id}`}
          d={`M 548 ${f.y} C 640 ${f.y} 652 167 744 167`}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={focus === f.id ? 2.25 : 1.4}
          opacity={edgeOpacity(f.id)}
        />
      ))}

      {MAP_FACTS.filter((f) => !f.crosses).map((f) => (
        <g key={`b-${f.id}`} opacity={edgeOpacity(f.id)}>
          <path
            d={`M 548 ${f.y} L ${WALL - 14} ${f.y}`}
            fill="none"
            stroke="var(--color-error)"
            strokeWidth={focus === f.id ? 2.25 : 1.4}
          />
          {/* It stops here. */}
          <rect
            x={WALL - 16}
            y={f.y - 9}
            width={3.5}
            height={18}
            fill="var(--color-error)"
          />
        </g>
      ))}

      {/* Sources */}
      {SOURCES.map((s) => (
        <g key={s.id} opacity={srcOpacity(s.id)}>
          <rect
            x={28}
            y={s.y - 16}
            width={132}
            height={32}
            rx={6}
            fill="var(--color-background-muted)"
            stroke="var(--color-border)"
          />
          <text
            x={94}
            y={s.y + 4}
            textAnchor="middle"
            fill="var(--color-text-secondary)"
            style={{ fontSize: 11.5 }}
          >
            {s.label}
          </text>
        </g>
      ))}

      {/* Facts. Hovering one isolates its derivation chain. */}
      {MAP_FACTS.map((f) => {
        const st = state[f.id] ?? { present: true, stale: false };
        return (
          <g
            key={f.id}
            opacity={factOpacity(f.id)}
            onMouseEnter={() => setFocus(f.id)}
            onMouseLeave={() => setFocus(null)}
            onFocus={() => setFocus(f.id)}
            onBlur={() => setFocus(null)}
            tabIndex={0}
            style={{ cursor: "default" }}
          >
            <rect
              x={316}
              y={f.y - 23}
              width={232}
              height={46}
              rx={7}
              fill="var(--color-background-surface)"
              stroke={
                st.stale
                  ? "var(--color-warning)"
                  : f.crosses
                    ? "var(--color-accent)"
                    : "var(--color-border-emphasized)"
              }
              strokeDasharray={st.present ? undefined : "4 3"}
              opacity={st.present ? 1 : 0.6}
            />
            <text
              x={336}
              y={f.y - 2}
              fill="var(--color-text-primary)"
              style={{ fontSize: 12, fontWeight: 600 }}
            >
              {f.label}
            </text>
            <text
              x={336}
              y={f.y + 13}
              fill="var(--color-text-secondary)"
              style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.05em" }}
            >
              {st.present ? f.sub : "not set"}
            </text>
          </g>
        );
      })}

      {/* What is on the far side. */}
      <rect
        x={744}
        y={137}
        width={168}
        height={60}
        rx={8}
        fill="var(--color-accent)"
      />
      <text
        x={828}
        y={162}
        textAnchor="middle"
        fill="var(--color-on-accent)"
        style={{ fontSize: 13, fontWeight: 700 }}
      >
        The assistant
      </text>
      <text
        x={828}
        y={180}
        textAnchor="middle"
        fill="var(--color-on-accent)"
        opacity={0.75}
        style={{ fontFamily: MONO, fontSize: 9.5 }}
      >
        and the shopper
      </text>

      <text
        x={744}
        y={444}
        fill="var(--color-error)"
        style={{ fontSize: 13, fontWeight: 700 }}
      >
        Nothing arrives.
      </text>
      <text
        x={744}
        y={464}
        fill="var(--color-text-secondary)"
        style={{ fontSize: 11.5 }}
      >
        Not withheld by instruction —
      </text>
      <text
        x={744}
        y={480}
        fill="var(--color-text-secondary)"
        style={{ fontSize: 11.5 }}
      >
        never handed over at all.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */

/**
 * `who` stays a plain string, not an element.
 *
 * Table renders cells as `String(item[key])` unless the column supplies
 * `renderCell`, so a React element passed as data is silently dropped — the
 * column came out blank. Rich content belongs in the column, not the row.
 */
type GapRow = { who: "you" | "us"; what: string; unlocks: string } & Record<
  string,
  unknown
>;

export default function Cortex() {
  const { cortex: c, shopper, stale } = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";
  const [voice, setVoice] = useState(c.voice?.value ?? "");

  const mapState: Record<string, { present: boolean; stale: boolean }> = {
    catalogue: { present: true, stale: stale.catalogue },
    policies: { present: true, stale: stale.policies },
    voice: { present: Boolean(c.voice), stale: false },
    notices: {
      present: shopper.serviceNotices.length > 0,
      stale: stale.notices,
    },
    constraints: { present: Boolean(c.constraints), stale: false },
    commerce: { present: Boolean(c.commerce), stale: stale.commerce },
    decisions: { present: true, stale: false },
    findings: { present: Boolean(c.findings), stale: stale.findings },
  };

  const gapRows: GapRow[] = c.gaps.map((g) => ({
    who: g.who === "merchant" ? "you" : "us",
    what: g.what,
    unlocks: g.unlocks,
  }));

  return (
    <Page>
      <PageHead
        title={`What CHAPMAN knows about ${c.name}`}
        lede="One shared memory of the shop that every tool reads from. Almost all of it is worked out from your own data; you type only what we cannot compute."
      >
        <Figures>
          <Figure value={c.catalogue.value.products} label="products" />
          <Figure
            value={c.catalogue.value.categories.length}
            label="categories"
          />
          <Figure
            value={c.decisions.value.replies.toLocaleString("en-IN")}
            label="replies sent"
            tone="accent"
          />
          <Figure
            value={c.decisions.value.refusals.toLocaleString("en-IN")}
            label="claims blocked"
          />
        </Figures>
      </PageHead>

      {/* The map */}
      <Block title="How it is assembled">
        <Card padding={3}>
          <VStack gap={3}>
            <DerivationMap state={mapState} />
            <Divider />
            <HStack gap={5} vAlign="center">
              <HStack gap={2} vAlign="center">
                <StatusDot variant="accent" label="Crosses to the shopper" />
                <Text type="supporting">crosses to the shopper</Text>
              </HStack>
              <HStack gap={2} vAlign="center">
                <StatusDot variant="error" label="Stops at the boundary" />
                <Text type="supporting">stops at the boundary</Text>
              </HStack>
              <HStack gap={2} vAlign="center">
                <StatusDot
                  variant="warning"
                  label="Past its freshness window"
                />
                <Text type="supporting">past its freshness window</Text>
              </HStack>
            </HStack>
          </VStack>
        </Card>
        <Note>
          The dashed line is not a diagram convention — it is a function.
          shopperView() takes the cortex and returns six fields. The four stops
          on the right are the four it does not return, so the assistant cannot
          leak them the way it cannot leak a file it was never opened.
        </Note>
      </Block>

      {/* Shopper-visible */}
      <Block
        title="The assistant can see this"
        hint="Everything a shopper-facing reply could possibly be built from."
      >
        <Card>
          <MetadataList label={{ position: "start", width: 180 }}>
            <MetadataListItem label="What you sell">
              <VStack gap={1}>
                <Text>
                  {shopper.name} · {shopper.currency} · sells{" "}
                  {shopper.sells.categories.join(", ") || "—"} (
                  {shopper.sells.products} products)
                </Text>
                <Src
                  from={c.catalogue.from}
                  at={c.catalogue.at}
                  stale={stale.catalogue}
                />
              </VStack>
            </MetadataListItem>

            <MetadataListItem label="Policies">
              <VStack gap={1}>
                {/* Nested rather than hand-aligned: MetadataList owns the
                      label column, so the three policies share one line. */}
                <MetadataList label={{ position: "start", width: 92 }}>
                  {(["returns", "shipping", "cod"] as const).map((k) => (
                    <MetadataListItem key={k} label={k}>
                      <Text>{shopper.policies[k] ?? "—"}</Text>
                    </MetadataListItem>
                  ))}
                </MetadataList>
                <Src
                  from={c.policies.from}
                  at={c.policies.at}
                  stale={stale.policies}
                />
              </VStack>
            </MetadataListItem>

            <MetadataListItem label="Voice">
              {shopper.voice ? (
                <VStack gap={1}>
                  <Text type="large">“{shopper.voice}”</Text>
                  {c.voice ? <Src from={c.voice.from} at={c.voice.at} /> : null}
                </VStack>
              ) : (
                <Text color="disabled">
                  not set — the assistant sounds generic without it
                </Text>
              )}
            </MetadataListItem>

            <MetadataListItem label="Service notices">
              {shopper.serviceNotices.length > 0 ? (
                <VStack gap={2}>
                  {shopper.serviceNotices.map((n) => (
                    <Text key={n.text}>“{n.text}”</Text>
                  ))}
                  <Text type="supporting">
                    Written here, not by the model. The assistant may repeat one
                    word for word when it is relevant, and cannot reach the
                    finding underneath it — not the failure rate, not the date.
                  </Text>
                  <Src
                    from={c.serviceNotices.from}
                    at={c.serviceNotices.at}
                    stale={stale.notices}
                  />
                </VStack>
              ) : (
                <Text color="disabled">none written</Text>
              )}
            </MetadataListItem>
          </MetadataList>
        </Card>
      </Block>

      {/* Voice — the only writable field */}
      <Block
        title="How should this shop sound?"
        hint="The one thing we cannot work out from your data. It changes the tone of a reply and nothing else — every limit still applies, whatever you write."
      >
        <Card>
          <Form method="post">
            <VStack gap={3}>
              <input type="hidden" name="shop" value={c.key} />
              <input type="hidden" name="voice" value={voice} />
              <TextArea
                label="Shop voice"
                isLabelHidden
                rows={3}
                value={voice}
                onChange={setVoice}
                placeholder="Plain and unhurried. We are a small estate, not a supermarket — no exclamation marks, no pressure."
              />
              <HStack>
                <Button
                  type="submit"
                  variant="primary"
                  isDisabled={busy}
                  label={busy ? "Saving…" : "Save voice"}
                />
              </HStack>
            </VStack>
          </Form>
        </Card>
      </Block>

      {/* Merchant-only */}
      <Block
        title="Only you can see this"
        hint="Your negotiating position. None of it has a route to a shopper-facing reply."
      >
        <Card>
          <MetadataList label={{ position: "start", width: 180 }}>
            <MetadataListItem label="Your limits">
              {c.constraints ? (
                <VStack gap={1}>
                  <Text>
                    never below {c.constraints.value.minMarginPct}% margin ·
                    never more than {c.constraints.value.maxDiscountPct}% off ·
                    never discount{" "}
                    {c.constraints.value.neverDiscount.join(", ") || "—"} ·
                    never advise on fewer than{" "}
                    {c.constraints.value.minSampleSize} data points
                  </Text>
                  <Src from={c.constraints.from} at={c.constraints.at} />
                </VStack>
              ) : (
                <Text color="disabled">not set</Text>
              )}
            </MetadataListItem>

            <MetadataListItem label="Trade">
              {c.commerce ? (
                <VStack gap={1}>
                  <Text>
                    ~{c.commerce.value.ordersPerMonth} orders/month · average{" "}
                    {shopper.currency} {c.commerce.value.avgOrderValue} · best
                    sellers: {c.commerce.value.bestsellers.join(", ")}
                  </Text>
                  <Src
                    from={c.commerce.from}
                    at={c.commerce.at}
                    stale={stale.commerce}
                  />
                </VStack>
              ) : (
                <Text color="disabled">no order history connected</Text>
              )}
            </MetadataListItem>

            <MetadataListItem label="Said & stopped">
              <VStack gap={1}>
                <Text>
                  {c.decisions.value.replies} replies ·{" "}
                  {c.decisions.value.refusals} claims blocked
                </Text>
                {Object.keys(c.decisions.value.byGate).length ? (
                  <Text type="code" size="2xs" color="secondary">
                    {Object.entries(c.decisions.value.byGate)
                      .map(([g, n]) => `${g} ×${n}`)
                      .join("   ")}
                  </Text>
                ) : null}
              </VStack>
            </MetadataListItem>

            <MetadataListItem label="Recovery outcomes">
              <VStack gap={1}>
                <Text>
                  {c.recoveryOutcomes.value.grantsIssued} grants issued ·{" "}
                  {c.recoveryOutcomes.value.paidOrders} paid orders ·{" "}
                  {Math.round(c.recoveryOutcomes.value.conversionRate * 100)}%
                  observed conversion
                </Text>
                <Text type="supporting" color="secondary">
                  Shop-wide totals only. No shopper identity enters the cortex.
                </Text>
                <Src
                  from={c.recoveryOutcomes.from}
                  at={c.recoveryOutcomes.at}
                />
              </VStack>
            </MetadataListItem>

            <MetadataListItem label="Last analysis">
              {c.findings ? (
                <VStack gap={1}>
                  <Text>
                    {c.findings.value.incidents.length} incident
                    {c.findings.value.incidents.length === 1 ? "" : "s"} ·{" "}
                    {c.findings.value.topActions.length} ideas ranked ·{" "}
                    {c.findings.value.stopped} stopped
                  </Text>
                  {c.findings.value.recovery ? (
                    <Text type="supporting">
                      basket recovery: {c.findings.value.recovery.wouldContact}{" "}
                      to write to, {c.findings.value.recovery.suppressed} left
                      alone, ₹
                      {c.findings.value.recovery.marginAtStake.toLocaleString(
                        "en-IN",
                      )}{" "}
                      of margin at stake
                    </Text>
                  ) : null}
                  {c.findings.value.recoveryOutcomes ? (
                    <Text type="supporting">
                      recovery grants:{" "}
                      {c.findings.value.recoveryOutcomes.grantsIssued} issued,{" "}
                      {c.findings.value.recoveryOutcomes.paidOrders} paid (
                      {Math.round(
                        c.findings.value.recoveryOutcomes.conversionRate * 100,
                      )}
                      % observed conversion)
                    </Text>
                  ) : null}
                  {c.findings.value.incidents.map((i) => (
                    <Text key={i.id} type="supporting">
                      {i.title} · began around {i.onsetAt}, confirmed{" "}
                      {i.detectedAt}
                    </Text>
                  ))}
                  <Src
                    from={c.findings.from}
                    at={c.findings.at}
                    stale={stale.findings}
                  />
                </VStack>
              ) : (
                <Text color="disabled">
                  never run — open Offers once and the proposer publishes what
                  it finds back to here
                </Text>
              )}
            </MetadataListItem>
          </MetadataList>
        </Card>
      </Block>

      {/* Gaps */}
      <Block
        title="What is still missing"
        hint="The gaps the agent keeps about itself, and who has to close each one."
      >
        <Card>
          <Table<GapRow>
            data={gapRows}
            density="balanced"
            columns={[
              {
                key: "who",
                header: "Who",
                width: pixel(84),
                renderCell: (row) => (
                  <Token
                    size="sm"
                    color={row.who === "you" ? "yellow" : "gray"}
                    label={row.who}
                  />
                ),
              },
              { key: "what", header: "What", width: proportional(1) },
              { key: "unlocks", header: "Unlocks", width: proportional(1.3) },
            ]}
          />
        </Card>
      </Block>

      <Note>
        This cortex belongs to {c.key} and nothing else reads it. Run two shops
        and you get two, with no path between them — even if the same person
        owns both.
      </Note>
    </Page>
  );
}
