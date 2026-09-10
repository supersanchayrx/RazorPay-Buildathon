import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import { Block, Figure, Figures, Note, Page, PageHead, Setup } from "../components/console";
import { IntegrationSetup } from "../components/integration-setup";
import { requireMerchant } from "../lib/auth.server";
import { readStoreDocument } from "../lib/database.server";
import { sitesForMerchant } from "../lib/sites.server";
import {
  CONSOLIDATE_ABOVE,
  MEMORY_TTL_DAYS,
  consolidate,
  forget,
  memoryBySubject,
  memoryStats,
  RECALL_LIMIT,
} from "../lib/memory.server";
import { complete, isConfigured as modelConfigured, MODELS } from "../lib/openrouter.server";
import { openRouterSetup } from "../lib/integration-setup.server";

/**
 * What the shop remembers about people, shown to the merchant in full.
 *
 * This page exists because of the position the feature takes: memory is STATED,
 * not silent. An assistant that quietly knows things about a shopper is
 * unsettling when it is right and invisible when it is wrong — and a merchant
 * who cannot read what their assistant believes has no answer when a customer
 * says "your bot said something odd about me".
 *
 * TWO BOUNDARIES ARE VISIBLE ON THIS PAGE, AND THEY ARE THE POINT.
 *
 * 1. THIS IS NOT THE CORTEX. The shop cortex holds what is true about the
 *    MERCHANT and has no type that can carry a person. This holds people, keyed
 *    per (merchant, shopper), and nothing here is ever pooled into shop
 *    knowledge. Only counts cross — and even those go to the findings document,
 *    not to a shopper.
 *
 * 2. NOTHING HERE CAN EXPIRE INTO A LIE. A memory may not contain a price, a
 *    stock level, an offer, an order state or a delivery date; candidates that
 *    do are refused at write time by `checkMemory`. That is what makes it safe
 *    to render a six-week-old sentence into today's reply.
 *
 * The subject column is the merchant's OWN customer id. This store has never
 * held an email or a phone number, and there is no code path that could put one
 * in it.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site)
    return {
      site: null,
      subjects: [],
      stats: null,
      limits: null,
      summariser: false,
      modelSetup: openRouterSetup("summariser"),
    };

  const seededNames = new Map(
    readStoreDocument<Array<{ id: string; name: string }>>(
      site.key,
      "seed.customer_profiles",
      [],
    ).map((profile) => [profile.id, profile.name]),
  );

  return {
    site: { key: site.key, name: site.name },
    subjects: memoryBySubject(site.key).map((g) => ({
      sub: g.sub,
      name: seededNames.get(g.sub) ?? null,
      memories: g.memories.map((m) => ({
        id: m.id,
        kind: m.kind,
        text: m.text,
        source: m.source,
        createdAt: m.createdAt,
        lastUsedAt: m.lastUsedAt,
        expiresAt: m.expiresAt,
        // What they actually said. Merchant-only, and the thing that lets a
        // wrong memory be traced back to the sentence that produced it.
        evidence: m.evidence ?? null,
      })),
    })),
    stats: memoryStats(site.key),
    /**
     * Constants travel as DATA, not as an import the component makes.
     *
     * A component that imports from a `.server` module keeps that whole module
     * graph alive in the client bundle, and React Router only strips server
     * code from `loader`/`action`/`middleware`/`headers`. `npm run build` fails
     * outright; dev mode is perfectly happy, which is how this ships. Third
     * time this class has been caught here, so: the loader reads the constant,
     * the component reads the loader.
     */
    limits: { ttlDays: MEMORY_TTL_DAYS, recallLimit: RECALL_LIMIT, condenseAbove: CONSOLIDATE_ABOVE },
    summariser: modelConfigured(),
    modelSetup: openRouterSetup("summariser"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  // Scoped at the write, not only at the read.
  if (!merchant.sites.includes(shop)) return { ok: false, error: "not your store" };

  const sub = String(form.get("sub") ?? "");
  if (!sub) return { ok: false, error: "which shopper?" };

  /**
   * Condensing is merchant-triggered, not automatic on the shopper's path.
   *
   * `recall` runs while somebody is waiting for a reply. This reads a person's
   * whole history and calls a model, so it belongs on a button — and having a
   * human press it means the result is looked at, which for a summariser is
   * worth more than the convenience of it happening quietly.
   */
  if (String(form.get("act") ?? "") === "condense") {
    const res = await consolidate({
      shop,
      sub,
      ask: modelConfigured()
        ? async (prompt) =>
            (await complete({
              shop,
              model: MODELS.summariser(),
              messages: [{ role: "user", content: prompt }],
              maxTokens: 300,
              temperature: 0,
              timeoutMs: 20_000,
              keyRole: "summariser",
            })) ?? ""
        : undefined,
    });
    return {
      ok: true,
      message:
        res.before === res.after
          ? `Nothing changed — ${res.because ?? "there was nothing to merge"}.`
          : `${res.before} down to ${res.after}, ${res.by === "model" ? "by the summariser" : "by rule"}.` +
            (res.because ? ` ${res.because}.` : ""),
    };
  }

  // An id deletes one memory; its absence deletes everything about that person.
  const id = String(form.get("id") ?? "") || undefined;
  const ok = forget(shop, sub, id);
  return ok
    ? { ok: true, message: id ? "Forgotten." : "Everything about that shopper is forgotten." }
    : { ok: false, error: "could not write the deletion" };
};

const KIND_BLURB: Record<string, string> = {
  preference: "a durable taste",
  context: "who or what they buy for",
  habit: "how they shop",
  boundary: "something they asked us not to do",
};

/** A boundary is not a taste. Colour says so before the label does. */
const KIND_TONE: Record<string, "green" | "blue" | "gray" | "red"> = {
  preference: "green",
  context: "blue",
  habit: "gray",
  boundary: "red",
};

export default function MemoryPage() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!d.site || !d.stats || !d.limits) {
    return (
      <Page>
        <PageHead title="Shopper memory" />
        <Card>
          <EmptyState
            title="No store is connected to this account yet"
            description="Memory is keyed per shop, so it needs one before it can hold anything."
          />
        </Card>
      </Page>
    );
  }

  const site = d.site;
  const limits = d.limits;

  return (
    <Page>
      <PageHead
        title="Shopper memory"
        lede="What your assistant remembers about individual people, and every word of it. Kept apart from the shop cortex — that one holds your business, this one holds people."
      >
        <Figures>
          <Figure value={d.stats.people} label="people remembered" tone="accent" />
          <Figure value={d.stats.total} label="things remembered" />
          <Figure value={d.stats.bySource.voice ?? 0} label="learned on a call" />
          <Figure value={`${limits.ttlDays}d`} label="before one expires" />
        </Figures>
      </PageHead>

      {a?.error ? <Banner status="error" title="That did not go through" description={a.error} /> : null}
      {a?.ok && a.message ? <Banner status="success" title={a.message} isDismissable /> : null}

      <Block
        title="Who is remembered"
        hint={`${d.stats.people} ${d.stats.people === 1 ? "person" : "people"}, each keyed by your own customer id.`}
      >
        {d.subjects.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing remembered yet"
              description="Memories are written when a signed-in shopper says something durable about themselves, in the widget or on a recovery call. A question about your returns policy is about you, not about them, and is discarded before any model sees it."
            />
          </Card>
        ) : (
          <VStack gap={4}>
            {d.subjects.map((g) => (
              <Card key={g.sub} padding={0}>
                <VStack gap={0}>
                  <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap" padding={4}>
                    <HStack gap={3} vAlign="center">
                      {g.name ? <Text weight="semibold">{g.name}</Text> : null}
                      <Text type="code" size="xsm" weight="semibold">
                        {g.sub}
                      </Text>
                      <Token size="sm" color="gray" label={`${g.memories.length} remembered`} />
                    </HStack>
                    <HStack gap={2}>
                      {g.memories.length > limits.condenseAbove ? (
                        <Form method="post">
                          <input type="hidden" name="shop" value={site.key} />
                          <input type="hidden" name="sub" value={g.sub} />
                          <input type="hidden" name="act" value="condense" />
                          <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            isDisabled={busy}
                            label="Condense these"
                          />
                        </Form>
                      ) : null}
                      <Form method="post">
                        <input type="hidden" name="shop" value={site.key} />
                        <input type="hidden" name="sub" value={g.sub} />
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          isDisabled={busy}
                          label="Forget this shopper"
                        />
                      </Form>
                    </HStack>
                  </HStack>

                  <Table
                    data={g.memories as unknown as Array<Record<string, unknown>>}
                    idKey="id"
                    density="balanced"
                    dividers="rows"
                    columns={[
                      {
                        key: "text",
                        header: "Remembered",
                        width: proportional(1),
                        renderCell: (m) => (
                          <VStack gap={1.5}>
                            <Text>{String(m.text)}</Text>
                            {m.evidence ? (
                              <Collapsible
                                trigger={
                                  <Text type="supporting" color="secondary">
                                    what they said
                                  </Text>
                                }
                              >
                                <Text type="supporting" color="secondary">
                                  &ldquo;{String(m.evidence)}&rdquo;
                                </Text>
                              </Collapsible>
                            ) : null}
                          </VStack>
                        ),
                      },
                      {
                        key: "kind",
                        header: "Kind",
                        width: pixel(180),
                        renderCell: (m) => (
                          <VStack gap={1}>
                            <HStack>
                              <Token
                                size="sm"
                                color={KIND_TONE[String(m.kind)] ?? "gray"}
                                label={String(m.kind)}
                              />
                            </HStack>
                            <Text type="supporting" color="secondary">
                              {KIND_BLURB[String(m.kind)]}
                            </Text>
                          </VStack>
                        ),
                      },
                      {
                        key: "source",
                        header: "From",
                        width: pixel(92),
                        renderCell: (m) => (
                          <Text type="code" size="2xs" color="secondary">
                            {String(m.source)}
                          </Text>
                        ),
                      },
                      {
                        key: "expiresAt",
                        header: "Expires",
                        width: pixel(104),
                        renderCell: (m) => (
                          <Text type="code" size="2xs" color="secondary">
                            {String(m.expiresAt).slice(0, 10)}
                          </Text>
                        ),
                      },
                      {
                        key: "id",
                        header: "",
                        width: pixel(92),
                        align: "end",
                        renderCell: (m) => (
                          <Form method="post">
                            <input type="hidden" name="shop" value={site.key} />
                            <input type="hidden" name="sub" value={g.sub} />
                            <input type="hidden" name="id" value={String(m.id)} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              isDisabled={busy}
                              label="Forget"
                            />
                          </Form>
                        ),
                      },
                    ]}
                  />
                </VStack>
              </Card>
            ))}
          </VStack>
        )}
      </Block>

      <Setup title="What it may and may not remember">
        <VStack gap={3}>
          <MetadataList label={{ position: "start", width: 220 }}>
            <MetadataListItem label="Install">
              <Text>
                Enable Shopper memory in Feature controls, install the assistant on every page, and
                connect signed shopper identity. A site key alone is not identity.
              </Text>
            </MetadataListItem>
          </MetadataList>
          <Card>
            <List listStyle="decimal" density="spacious">
              <ListItem label="Enable Shopper memory in Feature controls" />
              <ListItem
                label="Connect server-signed shopper identity"
                description="For Monsoon Market, enable DEMO_STORE_CHAPMAN and keep the CHAPMAN_SESSION marker immediately before the embed tag. A real store must mint the token from its own authenticated session."
              />
              <ListItem
                label="Sign in on the storefront Account page"
                description="Then tell the assistant a durable first-person preference, for example: I prefer low-caffeine tea."
              />
              <ListItem
                label="Reload this page"
                description="The shopper and the exact stored statement should appear below. Anonymous messages are deliberately not remembered."
              />
            </List>
          </Card>
        </VStack>

        <Divider />

        <IntegrationSetup guide={d.modelSetup} />

        <Divider />

        <VStack gap={0}>
          <MetadataList label={{ position: "start", width: 220 }}>
            <MetadataListItem label="Nobody signed in">
              <Text>
                Nothing is written at all. With no identity there is no way to honour a deletion
                request later, so collecting would be taking something we could never give back.
              </Text>
            </MetadataListItem>
            <MetadataListItem label="A memory may contain">
              <Text>
                Durable things about a person — prefers low caffeine, buys gifts for a colleague,
                brews in a French press.
              </Text>
            </MetadataListItem>
            <MetadataListItem label="A memory may never contain">
              <Text>
                Anything that expires: a price, a stock level, an offer, an order state, a payment
                detail or a delivery date. Candidates carrying one are refused when written, which is
                what makes it safe to put a six-week-old sentence into today&rsquo;s reply.
              </Text>
            </MetadataListItem>
            <MetadataListItem label="How it is used">
              <Text>
                Memory supplies the question; your catalogue supplies the answer. The assistant may
                say &ldquo;last time you were after something low-caffeine — still?&rdquo; and then
                look up what is actually low-caffeine, in stock, at today&rsquo;s price. At most{" "}
                {limits.recallLimit} are used in any one reply.
              </Text>
            </MetadataListItem>
            <MetadataListItem label="When the list gets long">
              <Text>
                Above {limits.condenseAbove} lines about one person you can condense them.
                Near-duplicates merge by rule with no model at all;{" "}
                {d.summariser
                  ? "a summariser then rewrites the rest as fewer, clearer lines"
                  : "a summariser would then rewrite the rest, but no model key is configured, so only the rule pass runs"}
                . Every line it writes is checked against the lines it was given — anything it
                invented, or anything carrying a price or a date, and the whole merge is thrown away
                rather than half-applied. A boundary is never merged into anything and is not even
                shown to the summariser.
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Who else sees it">
              <Text>
                Nobody. It is keyed to this shop, so the same person shopping at another store we
                serve has a separate memory that never meets this one.
              </Text>
            </MetadataListItem>
          </MetadataList>
        </VStack>
      </Setup>

      <Note>
        A memory expires the moment it should, with no sweeper to forget to run. Using one refreshes
        it, so what survives is what the shop actually finds useful.
      </Note>
    </Page>
  );
}
