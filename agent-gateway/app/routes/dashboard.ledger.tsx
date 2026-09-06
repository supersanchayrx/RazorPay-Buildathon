import { useState } from "react";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import { Block, Figure, Figures, MONO, Note, Page, PageHead } from "../components/console";
import { readLedger } from "../lib/ledger.server";
import { requireMerchant } from "../lib/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireMerchant(request);
  return { rows: readLedger(120).reverse() };
};

/**
 * The ledger, plainly.
 *
 * The point of showing a merchant the blocked replies is that a refusal is only
 * trustworthy if it is visible. A guardrail nobody can inspect is a claim about
 * a guardrail.
 */

type Kind = "reply" | "refusal" | "tool_error" | string;

/** One colour per kind, decided once. A refusal must not read green anywhere. */
const KIND: Record<string, { label: string; color: "green" | "yellow" | "red" | "blue" | "gray" }> = {
  reply: { label: "reply", color: "green" },
  refusal: { label: "blocked", color: "yellow" },
  tool_error: { label: "error", color: "red" },
  quote: { label: "quote", color: "blue" },
  payment_started: { label: "pay started", color: "blue" },
  payment_verified: { label: "pay ok", color: "green" },
  payment_rejected: { label: "pay rejected", color: "red" },
};

type Row = {
  id: string;
  when: string;
  kind: Kind;
  gate: string;
  message: string;
  suppressed: string;
} & Record<string, unknown>;

export default function Ledger() {
  const { rows } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<"all" | "reply" | "refusal" | "money">("all");

  const counts = {
    replies: rows.filter((e) => e.kind === "reply").length,
    refusals: rows.filter((e) => e.kind === "refusal").length,
    errors: rows.filter((e) => e.kind === "tool_error").length,
    money: rows.filter((e) => e.kind.startsWith("payment") || e.kind === "quote").length,
  };

  const shown = rows.filter((e) => {
    if (filter === "all") return true;
    if (filter === "money") return e.kind.startsWith("payment") || e.kind === "quote";
    return e.kind === filter;
  });

  /**
   * Rows carry strings only.
   *
   * Table renders a cell as `String(item[key])` unless the column supplies
   * `renderCell`, so an element handed over as row data is silently dropped.
   * Rich content belongs to the column.
   */
  const data: Row[] = shown.map((e, i) => ({
    id: `${e.ts}-${i}`,
    when: e.ts.slice(5, 16).replace("T", " "),
    kind: e.kind,
    gate: e.gate ?? "",
    message: e.message,
    suppressed: String((e.detail as { suppressedReply?: string } | undefined)?.suppressedReply ?? ""),
  }));

  return (
    <Page>
      <PageHead
        title="Decision ledger"
        lede="Everything said on your behalf, and everything stopped before it was. Newest first, last 120 entries."
      >
        <Figures>
          <Figure value={counts.replies} label="replies" tone="accent" />
          <Figure value={counts.refusals} label="blocked" />
          <Figure value={counts.errors} label="tool errors" />
          <Figure value={counts.money} label="money events" />
        </Figures>
      </PageHead>

      <Block
        title="The record"
        hint="A blocked reply keeps the text it would have sent, so you can judge the gate rather than trust it."
        actions={
          <SegmentedControl
            label="Filter entries"
            size="sm"
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
          >
            <SegmentedControlItem value="all" label="All" />
            <SegmentedControlItem value="reply" label="Replies" />
            <SegmentedControlItem value="refusal" label="Blocked" />
            <SegmentedControlItem value="money" label="Money" />
          </SegmentedControl>
        }
      >
        {data.length === 0 ? (
          <Card>
            <EmptyState
              title={rows.length === 0 ? "Nothing has been said yet" : "Nothing of that kind yet"}
              description={
                rows.length === 0
                  ? "The ledger fills the first time your assistant answers a shopper."
                  : "Every entry is there, just not under this filter."
              }
            />
          </Card>
        ) : (
          <Card padding={0}>
            <Table<Row>
              data={data}
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
                      {r.when}
                    </Text>
                  ),
                },
                {
                  key: "kind",
                  header: "Kind",
                  width: pixel(124),
                  renderCell: (r) => {
                    const k = KIND[r.kind] ?? { label: r.kind, color: "gray" as const };
                    return <Token size="sm" color={k.color} label={r.gate || k.label} />;
                  },
                },
                {
                  key: "message",
                  header: "Detail",
                  width: proportional(1),
                  renderCell: (r) => (
                    <VStack gap={1}>
                      <Text>{r.message}</Text>
                      {r.suppressed ? (
                        <HStack gap={2} vAlign="start">
                          <Text type="code" size="3xs" color="disabled" style={{ whiteSpace: "nowrap" }}>
                            SUPPRESSED
                          </Text>
                          <Text type="supporting" color="secondary" style={{ fontFamily: MONO }}>
                            “{r.suppressed.slice(0, 160)}
                            {r.suppressed.length > 160 ? "…" : ""}”
                          </Text>
                        </HStack>
                      ) : null}
                    </VStack>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </Block>

      <Note>
        A gate name in the Kind column is the rule that fired, not a category we invented after the
        fact. The set is closed, which is what lets the same refusal be counted, compared and argued
        with rather than merely described.
      </Note>
    </Page>
  );
}
