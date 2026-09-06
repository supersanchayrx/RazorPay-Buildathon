import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Code } from "@astryxdesign/core/Code";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";
import { EmptyState } from "@astryxdesign/core/EmptyState";

import { Block, Eyebrow, Figure, Figures, Note, Page, PageHead } from "../components/console";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { jsonFeedOrders, seededOrders } from "../lib/orders.server";
import { placedOrders, mergeSources } from "../lib/orderstore.server";
import { runAssistant } from "../lib/assistant.server";
import { checkReply } from "../lib/bounds.server";
import { announceable } from "../lib/approvals.server";
import { readiness, SCENARIOS, CONTROLS, LEAK_PATTERNS } from "../lib/testbench.server";
import { pickReasoner } from "../lib/reasoner.server";

/**
 * Prove it.
 *
 * Runs against the LIVE assistant on the merchant's live catalogue — the same
 * code path a shopper hits. A bench against a mock is a demonstration of the
 * mock.
 *
 * Each attack is checked twice, because there are two different claims:
 *
 *   SAID    what the assistant actually replied, and whether anything in it was
 *           unverifiable. This is the claim that matters to a shopper.
 *
 *   CAUGHT  what the gate does when the dangerous sentence IS produced,
 *           injected directly. This is the claim that matters when a model is
 *           wired, or swapped, or jailbroken.
 *
 * The first version of this page only tested the first, and scored 3 of 11 —
 * not because anything was unsafe, but because a deterministic reasoner never
 * produces the bad sentence, so no gate ever fires and "did a gate fire" was
 * the wrong question.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site) return { site: null, checks: [], scenarios: SCENARIOS, controls: CONTROLS, reasoner: "", offers: 0 };
  return {
    site: { key: site.key, name: site.name },
    checks: await readiness(site),
    scenarios: SCENARIOS,
    controls: CONTROLS,
    reasoner: pickReasoner().name,
    offers: announceable(site.key).length,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const site = sitesForMerchant(merchant.sites).find((s) => s.key === String(form.get("shop") ?? ""));
  if (!site) return null;

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
  const catalog = jsonFeedCatalog(site.catalogFeedUrl);
  const offers = announceable(site.key);

  const ask = (message: string) =>
    runAssistant({
      catalog,
      shop: site.key,
      shopName: site.name,
      message,
      history: [],
      // Signed out, on purpose. Every personal-data scenario must fail from the
      // position an attacker is actually in.
      identity: null,
      orderSource,
    });

  const attacks = [];
  for (const s of SCENARIOS) {
    let said = "";
    let saidGates: string[] = [];
    let error = "";
    try {
      const out = await ask(s.message);
      said = out.reply;
      saidGates = [...new Set(out.violations.map((v) => v.gate as string))];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const leaked = LEAK_PATTERNS.some((re) => re.test(said));
    // Clean means nothing unverifiable reached the shopper — whether because
    // the reasoner behaved or because the net caught it. Both are fine, and
    // which one happened is not the shopper's problem.
    const clean = !error && !leaked;

    // The same gate the live pipeline uses, on the sentence a careless model
    // would have produced. This is the only way to prove the net works when our
    // own reasoner never swings at it.
    // De-duplicated: several patterns can match one sentence, and listing the
    // same gate twice reads as a bug in the gate rather than as thoroughness.
    const injected: string[] = [
      ...new Set(
        checkReply(s.unsafeReply, { groundedStockClaims: [], approvedOffers: offers }).map(
          (v) => v.gate as string,
        ),
      ),
    ];

    attacks.push({
      ...s,
      said,
      saidGates,
      leaked,
      clean,
      error,
      injected,
      caught: injected.includes(s.gate),
    });
  }

  const controls = [];
  for (const c of CONTROLS) {
    try {
      const out = await ask(c.message);
      controls.push({
        ...c,
        reply: out.reply,
        gates: out.violations.map((v) => v.gate),
        answered: out.violations.length === 0 && out.reply.trim().length > 0,
      });
    } catch (e) {
      controls.push({ ...c, reply: "", gates: [], answered: false, error: String(e) });
    }
  }

  return { attacks, controls };
};

/** Readiness is three states, not a boolean. "Off" is a choice; "missing" is a gap. */
const READY: Record<string, { label: string; color: "green" | "yellow" | "gray" }> = {
  ok: { label: "Ready", color: "green" },
  missing: { label: "Missing", color: "yellow" },
  off: { label: "Not on", color: "gray" },
};

export default function TestBench() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!d.site) {
    return (
      <Page>
        <PageHead title="Test bench" />
        <Card>
          <EmptyState
            title="No store is connected to this account yet"
            description="The bench runs against a live catalogue, so it needs one to run against."
          />
        </Card>
      </Page>
    );
  }

  const attacks = a?.attacks ?? [];
  const controls = a?.controls ?? [];
  const clean = attacks.filter((r) => r.clean).length;
  const caught = attacks.filter((r) => r.caught).length;
  const answered = controls.filter((r) => r.answered).length;

  const checkRows: Array<Record<string, unknown>> = d.checks.map((c, i) => ({
    id: String(i),
    feature: c.feature,
    what: c.what,
    status: c.status,
    detail: c.detail,
    remedy: c.remedy ?? "—",
  }));

  const plannedRows: Array<Record<string, unknown>> = [
    ...d.scenarios.map((s) => ({ id: s.id, group: s.group, message: s.message, gate: s.gate })),
    ...d.controls.map((c) => ({
      id: c.id,
      group: "Ordinary questions",
      message: c.message,
      gate: "must be answered",
    })),
  ];

  return (
    <Page>
      <PageHead
        title="Test bench"
        lede="Fires the hard questions at your live assistant, on your live catalogue, and shows you exactly what came back."
        actions={
          <Form method="post">
            <input type="hidden" name="shop" value={d.site.key} />
            <Button
              type="submit"
              variant="primary"
              isDisabled={busy}
              label={
                busy
                  ? "Running…"
                  : `Run ${d.scenarios.length} attacks and ${d.controls.length} controls`
              }
            />
          </Form>
        }
      >
        {attacks.length > 0 ? (
          <Figures>
            <Figure value={`${clean}/${attacks.length}`} label="replies clean" tone="accent" />
            <Figure value={`${caught}/${attacks.length}`} label="gate catches the bad version" />
            <Figure value={`${answered}/${controls.length}`} label="ordinary questions answered" />
          </Figures>
        ) : null}
      </PageHead>

      <Block
        title="What your site supports"
        hint="Checked by fetching your endpoints, not by reading a setting."
      >
        <Card padding={0}>
          <Table
            data={checkRows}
            idKey="id"
            density="balanced"
            dividers="rows"
            columns={[
              { key: "feature", header: "Feature", width: pixel(190) },
              {
                key: "what",
                header: "Needs",
                width: proportional(1),
                renderCell: (r) => <Text color="secondary">{String(r.what)}</Text>,
              },
              {
                key: "status",
                header: "Status",
                width: pixel(220),
                renderCell: (r) => {
                  const s = READY[String(r.status)] ?? READY.missing;
                  return (
                    <VStack gap={1}>
                      <HStack>
                        <Token size="sm" color={s.color} label={s.label} />
                      </HStack>
                      <Text type="supporting" color="secondary">
                        {String(r.detail)}
                      </Text>
                    </VStack>
                  );
                },
              },
              {
                key: "remedy",
                header: "What to do",
                width: proportional(1),
                renderCell: (r) => <Text color="secondary">{String(r.remedy)}</Text>,
              },
            ]}
          />
        </Card>
      </Block>

      <Block
        title="Guardrails, under attack"
        hint="Checked twice. Said is what your assistant actually replied; Caught injects the bad sentence a careless model would have written, to prove the gate stops it."
      >
        <VStack gap={4}>
          <Note>
            Reasoner <Code>{d.reasoner}</Code>.{" "}
            {d.offers > 0
              ? `${d.offers} approved offer${d.offers === 1 ? "" : "s"} live, so that percentage is sayable and no other one is.`
              : "No approved offers, so every price claim is refused."}
          </Note>

          {attacks.length === 0 ? (
            <Card padding={0}>
              <Table
                data={plannedRows}
                idKey="id"
                density="compact"
                dividers="rows"
                columns={[
                  { key: "group", header: "Group", width: pixel(220) },
                  {
                    key: "message",
                    header: "Shopper says",
                    width: proportional(1),
                    renderCell: (r) => (
                      <Text color="secondary">&ldquo;{String(r.message)}&rdquo;</Text>
                    ),
                  },
                  {
                    key: "gate",
                    header: "Gate that must catch the bad reply",
                    width: pixel(260),
                    renderCell: (r) =>
                      r.gate === "must be answered" ? (
                        <Token size="sm" color="green" label="must be answered" />
                      ) : (
                        <Text type="code" size="2xs">
                          {String(r.gate)}
                        </Text>
                      ),
                  },
                ]}
              />
            </Card>
          ) : (
            <VStack gap={3}>
              {attacks.map((r) => (
                <Card key={r.id}>
                  <VStack gap={4}>
                    <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
                      <Heading level={3}>{r.group}</Heading>
                      <HStack gap={2}>
                        <Token
                          size="sm"
                          color={r.clean ? "green" : "red"}
                          label={r.clean ? "reply clean" : "reply leaked"}
                        />
                        <Token
                          size="sm"
                          color={r.caught ? "green" : "red"}
                          label={r.caught ? "gate caught it" : "gate missed it"}
                        />
                      </HStack>
                    </HStack>

                    <Text color="secondary">
                      Shopper: &ldquo;{r.message}&rdquo;
                    </Text>

                    <Divider />

                    <Grid columns={{ minWidth: 300 }} gap={5}>
                      <VStack gap={2}>
                        <Eyebrow>Said</Eyebrow>
                        {r.said ? (
                          <Text>{r.said}</Text>
                        ) : (
                          <Text color="disabled">{r.error || "nothing"}</Text>
                        )}
                        <HStack gap={2} wrap="wrap">
                          {r.saidGates.map((g) => (
                            <Token key={g} size="sm" color="yellow" label={g} />
                          ))}
                          {r.leaked ? (
                            <Token size="sm" color="red" label="contained an identifier" />
                          ) : null}
                        </HStack>
                      </VStack>

                      <VStack gap={2}>
                        <Eyebrow>Caught</Eyebrow>
                        <Text color="secondary">&ldquo;{r.unsafeReply}&rdquo;</Text>
                        <HStack gap={2} wrap="wrap">
                          {r.injected.length ? (
                            r.injected.map((g) => (
                              <Token key={g} size="sm" color="green" label={g} />
                            ))
                          ) : (
                            <Token size="sm" color="red" label="nothing fired" />
                          )}
                        </HStack>
                      </VStack>
                    </Grid>

                    <Text type="supporting" color="secondary">
                      {r.why}
                    </Text>
                  </VStack>
                </Card>
              ))}
            </VStack>
          )}
        </VStack>
      </Block>

      {controls.length > 0 ? (
        <Block
          title="Ordinary questions"
          hint="These must be answered. An assistant that refuses everything is useless, not safe."
        >
          <VStack gap={3}>
            {controls.map((c) => (
              <Card key={c.id}>
                <VStack gap={3}>
                  <HStack gap={4} hAlign="between" vAlign="start" wrap="wrap">
                    <Text color="secondary">Shopper: &ldquo;{c.message}&rdquo;</Text>
                    <Token
                      size="sm"
                      color={c.answered ? "green" : "red"}
                      label={c.answered ? "answered" : "refused"}
                    />
                  </HStack>
                  {c.reply ? <Text>{c.reply}</Text> : <Text color="disabled">nothing</Text>}
                  <Text type="supporting" color="secondary">
                    {c.why}
                  </Text>
                </VStack>
              </Card>
            ))}
          </VStack>
        </Block>
      ) : null}
    </Page>
  );
}
