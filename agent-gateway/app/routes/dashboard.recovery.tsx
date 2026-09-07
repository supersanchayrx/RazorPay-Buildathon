import { useState } from "react";
import type { ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Code } from "@astryxdesign/core/Code";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { List, ListItem } from "@astryxdesign/core/List";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
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
  runRecovery,
  toDraft,
  recoverySummary,
  type RecoveryTarget,
} from "../lib/recovery.server";
import { CHANNELS, readDrafts, readSends, send } from "../lib/outreach.server";
import { callTranscript, calls } from "../lib/voicetalk.server";
import { readSettings, writeSettings } from "../lib/settings.server";
import {
  addTurn,
  answerRate,
  conversations,
  reasonHistogram,
} from "../lib/conversations.server";
import { REASON_LABEL, REASONS } from "../lib/reasons";
import { allGrants, monthlySpend } from "../lib/grants.server";
import { liveCarts } from "../lib/carts.server";
import { updateFindings } from "../lib/findings.server";
import { messagingSetup, voiceSetup } from "../lib/integration-setup.server";
import { placeVoiceTestCall } from "../lib/voice-test.server";
import type { TestCallResult } from "../lib/voice-test.server";
import {
  readMessageHandoffs,
  sendTestMessage,
  type MessageResult,
} from "../lib/recovery-message.server";

/**
 * The recovery campaign, as a merchant sees it before anything goes out.
 *
 * The layout is the argument. A conventional campaign screen leads with reach —
 * "82 shoppers, ₹1.2 lakh in abandoned baskets!" — and buries the exclusions in
 * a settings tab. This one puts what would be SENT and what was SUPPRESSED at
 * the same size, because the second list is the one that decides whether this
 * feature is safe to leave running: 214 of 226 baskets are not written to, and
 * a merchant who cannot see why has no way to tell a careful system from a
 * broken one.
 *
 * Two other deliberate choices:
 *
 * - The full text of every message is on the page. Not a template with
 *   placeholders — the actual sentence that would reach that person, already
 *   through the bounds check. If a merchant would not send it themselves, they
 *   should find that out here rather than from a screenshot.
 *
 * - Sending is a separate, explicit act from drafting, and the default channel
 *   writes to a file and delivers nothing. Turning outreach "on" does not mean
 *   messages start moving; it means the run stops being labelled a dry run.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site)
    return {
      site: null,
      run: null,
      drafts: [],
      sent: 0,
      channels: CHANNELS,
      voiceSetup: voiceSetup(),
      messagingSetup: messagingSetup(),
      messageHandoffs: [],
    };

  const run = runRecovery({
    shop: site.key,
    shopName: site.name,
    storefrontOrigin: site.origins[0],
    productUrlTemplate: site.productUrlTemplate,
    // Taken from the request rather than configured, so a tunnel, a preview
    // deploy and localhost all produce links that actually resolve.
    gatewayOrigin: new URL(request.url).origin,
    siteSecret: site.secret,
    // When the merchant proxies the ask page, the link lives on THEIR domain.
    recoverPath: site.recoverPath,
  });

  const convs = conversations(site.key);

  /**
   * Refresh the parts of the findings document this page just recomputed.
   *
   * `updateFindings` MERGES. The whole-document writer lives on the Offers page,
   * because that is where the analysis actually runs; calling it from here with
   * no incidents would blank the service notices and silently stop the
   * assistant telling shoppers that netbanking is failing. A page that does not
   * compute incidents must not be able to erase them.
   *
   * Why write from a loader at all: the alternative is a scheduler we do not
   * have, or a cortex that re-runs recovery on the shopper's path. What crosses
   * is counts and rupees — no cart, no customer, no phone number.
   */
  updateFindings(site.key, {
    recovery: recoverySummary(run),
    reasons: reasonHistogram(site.key),
  });

  /**
   * Real baskets, from the storefront, alongside the seeded ones.
   *
   * Shown separately and counted honestly, because "12 messages from 226
   * baskets" reads very differently when 226 of them came out of `npm run
   * seed`. `recoverable` is the number that matters: a basket nobody signed in
   * for has no contact on file and will be suppressed as `no_channel`, which is
   * the correct behaviour and looks like a bug if the page does not say so.
   */
  const live = liveCarts(site.key);

  return {
    live: {
      total: live.length,
      recoverable: live.filter((c) => c.customer?.phone || c.customer?.email)
        .length,
      newestAt:
        live
          .map((c) => c.ts)
          .sort()
          .pop() ?? null,
      captureConfigured: Boolean(site.orders?.feedUrl),
    },
    conversations: convs
      .slice()
      .sort((a, b) => (b.answeredAt ?? "").localeCompare(a.answeredAt ?? ""))
      .slice(0, 20)
      .map((c) => ({
        cartId: c.cartId,
        state: c.state,
        reason: c.reason,
        reasonLabel: c.reason ? REASON_LABEL[c.reason] : null,
        answeredAt: c.answeredAt,
        // The shopper's own words, merchant-only. Kept so a merchant reading
        // "unknown x7" can see whether the classifier is failing or the answers
        // are genuinely vague.
        text:
          (
            c.turns.find((t) => t.kind === "answered") as
              { text?: string | null } | undefined
          )?.text ?? null,
        by:
          (
            c.turns.find((t) => t.kind === "answered") as
              { by?: string } | undefined
          )?.by ?? null,
        remedy:
          (
            c.turns.filter((t) => t.kind === "remedied").pop() as
              { remedy?: string } | undefined
          )?.remedy ?? null,
        blocked:
          (
            c.turns.filter((t) => t.kind === "remedied").pop() as
              { blocked?: string[] } | undefined
          )?.blocked ?? [],
        grantId: c.grantId,
        /**
         * Every turn, not just the interesting ones.
         *
         * A merchant looking at "unknown x7" needs to see the shape of the
         * exchange to tell a failing classifier from genuinely vague answers,
         * and a spoken conversation is the only record there is of a channel
         * with no screenshot.
         */
        turns: c.turns.map((t) => ({
          kind: t.kind,
          ts: t.ts,
          detail:
            t.kind === "asked"
              ? `asked over ${t.channel}`
              : t.kind === "answered"
                ? `${REASON_LABEL[t.reason]} — classified ${t.by}`
                : t.kind === "remedied"
                  ? t.remedy
                  : t.kind === "recovered"
                    ? `bought — ${t.gatewayOrderId}`
                    : t.why,
        })),
      })),
    histogram: reasonHistogram(site.key),
    answered: answerRate(site.key),
    grants: allGrants(site.key).slice(-10).reverse(),
    spend: monthlySpend(site.key),
    policy: readSettings(site.key).recovery,
    site: { key: site.key, name: site.name },
    run,
    summary: recoverySummary(run),
    drafts: readDrafts(site.key, 10),
    /**
     * Recent calls, newest first, with their transcripts.
     *
     * This is the only place a merchant can read what their shop actually said
     * on the telephone. On every other channel the message is the draft; on this
     * one a model wrote half the words, so the draft is not the record and the
     * transcript is.
     */
    calls: calls(site.key)
      .slice(0, 8)
      .map((c) => ({ ...c, lines: callTranscript(site.key, c.callSid) })),
    sent: readSends(site.key).filter((s) => s.ok).length,
    channels: CHANNELS.map((c) => ({
      id: c.id,
      label: c.label,
      available: c.available,
      unlockedBy: c.unlockedBy,
      note: c.note,
    })),
    voiceSetup: voiceSetup(),
    messagingSetup: messagingSetup(),
    messageHandoffs: readMessageHandoffs(site.key),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  // Scoped at the write, not only at the read.
  if (!merchant.sites.includes(shop))
    return { ok: false, error: "not your store" };

  const act = String(form.get("act") ?? "");

  if (act === "test_call") {
    if (form.get("confirmExpected") !== "on") {
      const error =
        "Confirm that the person who owns this number is expecting the test call.";
      return {
        ok: false,
        error,
        logs: [{ level: "error" as const, message: error }],
      };
    }
    const site = sitesForMerchant(merchant.sites).find(
      (entry) => entry.key === shop,
    );
    if (!site) {
      return {
        ok: false,
        error: "not your store",
        logs: [
          {
            level: "error" as const,
            message: "The selected store is not available.",
          },
        ],
      };
    }
    return placeVoiceTestCall(site, String(form.get("phone") ?? ""));
  }

  if (act === "test_message") {
    if (form.get("confirmExpected") !== "on") {
      const error =
        "Confirm that this number belongs to you or expects the test message.";
      return {
        ok: false,
        error,
        logs: [{ level: "error" as const, message: error }],
      };
    }
    const site = sitesForMerchant(merchant.sites).find(
      (entry) => entry.key === shop,
    );
    if (!site) {
      const error = "The selected store is not available.";
      return {
        ok: false,
        error,
        logs: [{ level: "error" as const, message: error }],
      };
    }
    return sendTestMessage(site, String(form.get("phone") ?? ""));
  }

  if (act === "settings") {
    const res = writeSettings(
      shop,
      {
        outreach: {
          enabled: form.get("enabled") === "on",
          cooldownDays: Number(form.get("cooldownDays")),
          maxPerRun: Number(form.get("maxPerRun")),
          minMarginAtStake: Number(form.get("minMarginAtStake")),
          cartAgeHours: {
            min: Number(form.get("ageMin")),
            max: Number(form.get("ageMax")) * 24,
          },
        },
      },
      merchant.email,
    );
    return { ok: res.ok, error: res.error };
  }

  if (act === "policy") {
    const res = writeSettings(
      shop,
      {
        recovery: {
          enabled: form.get("rec_enabled") === "on",
          maxDepthPct: Number(form.get("maxDepthPct")),
          requiresTier: String(form.get("requiresTier")) as
            "returning" | "regular",
          monthlyGrantCap: Number(form.get("monthlyGrantCap")),
          monthlyMarginCap: Number(form.get("monthlyMarginCap")),
          grantTtlHours: Number(form.get("grantTtlHours")),
          discountFor: form.getAll("discountFor").map(String) as never,
        },
      },
      merchant.email,
    );
    return { ok: res.ok, error: res.error };
  }

  /**
   * How a phone call behaves.
   *
   * Split from the general outreach settings because it is the only control in
   * this console that changes what KIND of thing goes out rather than how much
   * of it — and because a merchant should have to arrive at this box on purpose
   * before their shop starts holding conversations on the telephone.
   */
  if (act === "call") {
    const res = writeSettings(
      shop,
      {
        outreach: {
          call: {
            mode:
              form.get("callMode") === "conversation"
                ? "conversation"
                : "notice",
            maxTurns: Number(form.get("maxTurns")),
            speaker: String(form.get("speaker") ?? "priya"),
            language: String(form.get("language") ?? "en-IN"),
            discountHandoff:
              form.get("discountHandoff") === "on" ? "sms" : "off",
          },
        },
      },
      merchant.email,
    );
    return { ok: res.ok, error: res.error };
  }

  if (act === "send") {
    const site = sitesForMerchant(merchant.sites).find((s) => s.key === shop)!;

    /**
     * The channel is chosen at send time, and validated against what the code
     * can actually do rather than against what the form posted.
     *
     * A form field is a caller, and a caller that could name any channel could
     * name one with no delivery path — or one the merchant never enabled. So an
     * unrecognised or unavailable channel falls back to `draft`, which writes to
     * a file and reaches nobody. The safe direction.
     */
    const asked = String(form.get("channel") ?? "");
    const ch = CHANNELS.find((c) => c.id === asked);
    const channel = ch && ch.available ? (ch.id as never) : ("draft" as never);

    const run = runRecovery({
      shop,
      shopName: site.name,
      storefrontOrigin: site.origins[0],
      productUrlTemplate: site.productUrlTemplate,
      gatewayOrigin: new URL(request.url).origin,
      siteSecret: site.secret,
      recoverPath: site.recoverPath,
      channel,
    });
    if (!run.settings.outreach.enabled) {
      return {
        ok: false,
        error: "outreach is switched off — this run drafts and sends nothing",
      };
    }
    // Re-run rather than trusting ids posted from the page. A target list is a
    // snapshot of a moment; between rendering and clicking, somebody may have
    // bought the thing.
    const results = [];
    for (const t of run.targets) results.push(await send(toDraft(shop, t)));
    return {
      ok: true,
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  }

  /**
   * Send to ONE person, on a channel chosen for them.
   *
   * The whole run is recomputed rather than trusting anything the page posted.
   * A target list is a snapshot of a moment, and between rendering and clicking
   * somebody may have bought the thing, answered on another channel, or asked
   * to be left alone. The cart id is used to FIND a target in a fresh run, never
   * to construct one — so a cart that is no longer eligible cannot be messaged
   * by posting its id, and the reason it dropped out is reported back.
   */
  if (act === "send_one" || act === "skip_one") {
    const site = sitesForMerchant(merchant.sites).find((s) => s.key === shop)!;
    const cartId = String(form.get("cartId") ?? "");

    if (act === "skip_one") {
      /**
       * Leaving somebody alone is a `closed` turn, not a new kind of flag.
       *
       * `silenced()` already reads exactly this, and every future run on every
       * channel already consults it — the same record a shopper writes by
       * pressing 9 on a call, or by saying they changed their mind on the web
       * page. A second mechanism meaning the same thing is how one of them ends
       * up being the one nobody checks.
       */
      const res = addTurn({
        shop,
        cartId,
        customerId: String(form.get("customerId") ?? ""),
        turn: {
          kind: "closed",
          ts: new Date().toISOString(),
          why: "the merchant chose to leave them alone",
        },
      });
      return res.ok
        ? {
            ok: true,
            message:
              "Left alone. They will not be written to about this basket again.",
          }
        : { ok: false, error: res.error };
    }

    const asked = String(form.get("channel") ?? "");
    const ch = CHANNELS.find((c) => c.id === asked);
    const channel = ch && ch.available ? (ch.id as never) : ("draft" as never);

    const run = runRecovery({
      shop,
      shopName: site.name,
      storefrontOrigin: site.origins[0],
      productUrlTemplate: site.productUrlTemplate,
      gatewayOrigin: new URL(request.url).origin,
      siteSecret: site.secret,
      recoverPath: site.recoverPath,
      channel,
    });
    if (!run.settings.outreach.enabled) {
      return {
        ok: false,
        error: "outreach is switched off — nothing was sent",
      };
    }
    const target = run.targets.find((t) => t.cartId === cartId);
    if (!target) {
      const why = run.suppressed.find((x) => x.cartId === cartId);
      return {
        ok: false,
        error: why
          ? `That basket is no longer eligible: ${why.detail}`
          : "That basket is no longer in this run.",
      };
    }
    const res = await send(toDraft(shop, target));
    return res.ok
      ? { ok: true, sent: 1, failed: 0 }
      : { ok: false, error: res.error ?? "that message could not be sent" };
  }

  return { ok: false, error: "unknown action" };
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Three reasons to write to somebody, coloured once.
 *
 * Service is a problem you are fixing, an approved offer is money, and a
 * reminder is neither — they read differently and should look different.
 */
const TREATMENT: Record<
  RecoveryTarget["treatment"],
  { label: string; tone: "yellow" | "green" | "gray" }
> = {
  service: { label: "Service", tone: "yellow" },
  offer: { label: "Approved offer", tone: "green" },
  reminder: { label: "Reminder", tone: "gray" },
};

/** A settings row: what the limit is, what it means, and the control. */
function Limit({
  label,
  hint,
  children,
}: {
  label: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <HStack gap={5} hAlign="between" vAlign="center" wrap="wrap">
      <VStack gap={0.5} maxWidth={440}>
        <Text weight="semibold">{label}</Text>
        <Text type="supporting" color="secondary">
          {hint}
        </Text>
      </VStack>
      {children}
    </HStack>
  );
}

/**
 * The outreach limits, as one controlled form.
 *
 * Astryx inputs are controlled, so the values live in state and reach the
 * action through `htmlName` — the same field names the native form posted, so
 * the server half did not have to change.
 */
function LimitsForm({
  shop,
  o,
  busy,
}: {
  shop: string;
  o: {
    enabled: boolean;
    cooldownDays: number;
    maxPerRun: number;
    minMarginAtStake: number;
    cartAgeHours: { min: number; max: number };
    quietHours: { fromHour: number; toHour: number; tz: string };
    consentBasis: string;
  };
  busy: boolean;
}) {
  const [enabled, setEnabled] = useState(o.enabled);
  const [cooldown, setCooldown] = useState<number | null>(o.cooldownDays);
  const [maxPerRun, setMaxPerRun] = useState<number | null>(o.maxPerRun);
  const [minMargin, setMinMargin] = useState<number | null>(o.minMarginAtStake);
  const [ageMin, setAgeMin] = useState<number | null>(o.cartAgeHours.min);
  const [ageMax, setAgeMax] = useState<number | null>(
    Math.round(o.cartAgeHours.max / 24),
  );

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="shop" value={shop} />
        <input type="hidden" name="act" value="settings" />
        <VStack gap={5}>
          <Limit
            label="Outreach"
            hint="Off means this page is a dry run: it drafts everything and sends nothing."
          >
            <Switch
              label="On"
              htmlName="enabled"
              value={enabled}
              onChange={setEnabled}
            />
          </Limit>
          <Divider />
          <Limit
            label="Cooldown"
            hint="Days before the same person hears from you again."
          >
            <NumberInput
              label="Days"
              isLabelHidden
              htmlName="cooldownDays"
              size="sm"
              width={110}
              min={1}
              max={365}
              value={cooldown}
              onChange={setCooldown}
            />
          </Limit>
          <Divider />
          <Limit
            label="Messages per run"
            hint="A ceiling, so a data problem cannot become a broadcast."
          >
            <NumberInput
              label="Messages"
              isLabelHidden
              htmlName="maxPerRun"
              size="sm"
              width={110}
              min={1}
              max={500}
              value={maxPerRun}
              onChange={setMaxPerRun}
            />
          </Limit>
          <Divider />
          <Limit
            label="Margin floor"
            hint="Below this, a basket is not worth a message."
          >
            <NumberInput
              label="Rupees"
              isLabelHidden
              htmlName="minMarginAtStake"
              size="sm"
              width={130}
              min={0}
              value={minMargin}
              onChange={setMinMargin}
            />
          </Limit>
          <Divider />
          <Limit
            label="Age window"
            hint="Wait at least this many hours — they may still be checking out — and give up after this many days."
          >
            <HStack gap={2} vAlign="center">
              <NumberInput
                label="Hours"
                isLabelHidden
                htmlName="ageMin"
                size="sm"
                width={92}
                min={1}
                value={ageMin}
                onChange={setAgeMin}
              />
              <Text type="supporting" color="secondary">
                h to
              </Text>
              <NumberInput
                label="Days"
                isLabelHidden
                htmlName="ageMax"
                size="sm"
                width={92}
                min={1}
                value={ageMax}
                onChange={setAgeMax}
              />
              <Text type="supporting" color="secondary">
                d
              </Text>
            </HStack>
          </Limit>
          <Divider />
          <Limit
            label="Quiet hours"
            hint={`Fixed. Nothing unsolicited between ${o.quietHours.fromHour}:00 and ${o.quietHours.toHour}:00, ${o.quietHours.tz}.`}
          >
            <Token size="sm" color="gray" label="not editable" />
          </Limit>
          <Divider />
          <Limit
            label="Consent basis"
            hint={`${o.consentBasis} — they handed you this number during a checkout they started themselves. That justifies one message about that checkout, and nothing else.`}
          >
            <Token size="sm" color="gray" label="needs an opt-in to change" />
          </Limit>
          <Divider />
          <HStack>
            <Button
              type="submit"
              variant="primary"
              isDisabled={busy}
              label="Save limits"
            />
          </HStack>
        </VStack>
      </Form>
    </Card>
  );
}

/**
 * The discount policy.
 *
 * Kept as its own form because it is the one approval in CHAPMAN that spends
 * money without a per-case decision, and saving it should be a separate act
 * from saving a send ceiling.
 */
function PolicyForm({
  shop,
  policy,
  busy,
}: {
  shop: string;
  policy: {
    enabled: boolean;
    maxDepthPct: number;
    requiresTier: string;
    discountFor: string[];
    monthlyGrantCap: number;
    monthlyMarginCap: number;
    grantTtlHours: number;
  };
  busy: boolean;
}) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [depth, setDepth] = useState<number | null>(policy.maxDepthPct);
  const [tier, setTier] = useState(policy.requiresTier);
  const [reasons, setReasons] = useState<string[]>(policy.discountFor);
  const [grantCap, setGrantCap] = useState<number | null>(
    policy.monthlyGrantCap,
  );
  const [marginCap, setMarginCap] = useState<number | null>(
    policy.monthlyMarginCap,
  );
  const [ttl, setTtl] = useState<number | null>(policy.grantTtlHours);

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="shop" value={shop} />
        <input type="hidden" name="act" value="policy" />
        {/* The reason set is a multi-select, and `getAll` reads repeated
            fields — so each chosen reason travels as its own hidden input. */}
        {reasons.map((r) => (
          <input key={r} type="hidden" name="discountFor" value={r} />
        ))}
        <VStack gap={5}>
          <Limit
            label="Recovery discounts"
            hint="Off means the agent answers with facts and alternatives only."
          >
            <Switch
              label="On"
              htmlName="rec_enabled"
              value={enabled}
              onChange={setEnabled}
            />
          </Limit>
          <Divider />
          <Limit
            label="Most it may take off"
            hint="Capped again by your own discount ceiling, and refused outright if the discounted basket would fall through your margin floor."
          >
            <HStack gap={2} vAlign="center">
              <NumberInput
                label="Percent"
                isLabelHidden
                htmlName="maxDepthPct"
                size="sm"
                width={100}
                min={1}
                max={50}
                value={depth}
                onChange={setDepth}
              />
              <Text type="supporting" color="secondary">
                %
              </Text>
            </HStack>
          </Limit>
          <Divider />
          <Limit
            label="Only for"
            hint="First-time shoppers can never qualify — that is refused when you save, not defaulted. Money for whoever complains teaches everybody to complain."
          >
            <Selector
              label="Tier"
              isLabelHidden
              htmlName="requiresTier"
              size="sm"
              width={230}
              value={tier}
              onChange={setTier}
              options={[
                { value: "returning", label: "shoppers with 2+ orders" },
                { value: "regular", label: "shoppers with 4+ orders" },
              ]}
            />
          </Limit>
          <Divider />
          <VStack gap={3}>
            <VStack gap={0.5}>
              <Text weight="semibold">Only in answer to</Text>
              <Text type="supporting" color="secondary">
                Discounting someone who said delivery was too slow does not
                answer what they told you.
              </Text>
            </VStack>
            <HStack gap={4} wrap="wrap">
              {REASONS.filter((r) => r !== "unknown").map((r) => (
                <CheckboxInput
                  key={r}
                  label={REASON_LABEL[r]}
                  value={reasons.includes(r)}
                  onChange={(on) =>
                    setReasons((prev) =>
                      on ? [...prev, r] : prev.filter((x) => x !== r),
                    )
                  }
                />
              ))}
            </HStack>
          </VStack>
          <Divider />
          <Limit
            label="Monthly caps"
            hint="Counted at issue, not at redemption — the exposure exists the moment a grant does."
          >
            <HStack gap={2} vAlign="center">
              <NumberInput
                label="Grants"
                isLabelHidden
                htmlName="monthlyGrantCap"
                size="sm"
                width={100}
                min={1}
                max={500}
                value={grantCap}
                onChange={setGrantCap}
              />
              <Text type="supporting" color="secondary">
                grants, ₹
              </Text>
              <NumberInput
                label="Margin"
                isLabelHidden
                htmlName="monthlyMarginCap"
                size="sm"
                width={130}
                min={1}
                value={marginCap}
                onChange={setMarginCap}
              />
            </HStack>
          </Limit>
          <Divider />
          <Limit
            label="Each one lasts"
            hint="It answers a conversation. It is not a coupon."
          >
            <HStack gap={2} vAlign="center">
              <NumberInput
                label="Hours"
                isLabelHidden
                htmlName="grantTtlHours"
                size="sm"
                width={100}
                min={1}
                max={168}
                value={ttl}
                onChange={setTtl}
              />
              <Text type="supporting" color="secondary">
                hours
              </Text>
            </HStack>
          </Limit>
          <Divider />
          <HStack>
            <Button
              type="submit"
              variant="primary"
              isDisabled={busy}
              label="Save discount policy"
            />
          </HStack>
        </VStack>
      </Form>
    </Card>
  );
}

/** How a call behaves. Its own form, because it changes the kind of thing that goes out. */
function CallForm({
  shop,
  call,
  busy,
}: {
  shop: string;
  call: {
    mode: string;
    discountHandoff: string;
    maxTurns: number;
    speaker: string;
    language: string;
  };
  busy: boolean;
}) {
  const [mode, setMode] = useState(
    call.mode === "conversation" ? "conversation" : "notice",
  );
  const [maxTurns, setMaxTurns] = useState<number | null>(call.maxTurns);
  const [speaker, setSpeaker] = useState(call.speaker);
  const [language, setLanguage] = useState(call.language);
  const [discountHandoff, setDiscountHandoff] = useState(
    call.discountHandoff === "sms",
  );

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="shop" value={shop} />
        <input type="hidden" name="act" value="call" />
        <VStack gap={5}>
          <RadioList
            label="How the call behaves"
            htmlName="callMode"
            value={mode}
            onChange={setMode}
          >
            <RadioListItem
              value="notice"
              label="Read a notice"
              description="Speaks the message below, then hangs up. No model anywhere near the call — the shopper hears the exact sentence you can read on this page."
            />
            <RadioListItem
              value="conversation"
              label="Hold a conversation"
              description="Asks what put them off and records the answer. A model may converse, but only the deterministic recovery policy can approve a discount; the model never chooses or negotiates one."
            />
          </RadioList>
          <Divider />
          <Switch
            label="Send an approved discounted-payment link by SMS"
            description="Only to the number on this call, only after a real grant and Razorpay order exist, and at most once per grant. This does not enable generic SMS campaigns."
            htmlName="discountHandoff"
            value={discountHandoff}
            onChange={setDiscountHandoff}
            isDisabled={mode !== "conversation"}
            disabledMessage="Choose Hold a conversation first."
          />
          <Divider />
          <HStack gap={4} vAlign="end" wrap="wrap">
            <NumberInput
              label="Exchanges at most"
              htmlName="maxTurns"
              size="sm"
              width={150}
              min={1}
              max={8}
              value={maxTurns}
              onChange={setMaxTurns}
            />
            <TextInput
              label="Voice"
              htmlName="speaker"
              size="sm"
              width={140}
              value={speaker}
              onChange={setSpeaker}
            />
            <TextInput
              label="Language"
              htmlName="language"
              size="sm"
              width={140}
              value={language}
              onChange={setLanguage}
            />
            <Button
              type="submit"
              variant="primary"
              isDisabled={busy}
              label="Save"
            />
          </HStack>
          <Text type="supporting" color="secondary">
            Callers can press 9 at any point to stop these calls for good. That
            is recorded against them the moment they press it, and every future
            run reads it.
          </Text>
        </VStack>
      </Form>
    </Card>
  );
}

/** One basket, its message, and the two decisions available on it. */
function TargetCard({
  t,
  shop,
  channels,
  busy,
}: {
  t: RecoveryTarget;
  shop: string;
  channels: Array<{ id: string; label: string; available: boolean }>;
  busy: boolean;
}) {
  const [channel, setChannel] = useState("draft");
  const treat = TREATMENT[t.treatment];

  return (
    <Card>
      <VStack gap={4}>
        <HStack gap={3} hAlign="between" vAlign="start" wrap="wrap">
          <VStack gap={1.5}>
            <Heading level={3}>
              {t.items.map((i) => i.title).join(", ")}
            </Heading>
            <Text type="supporting" color="secondary">
              {inr(t.marginAtStake)} margin · abandoned{" "}
              {Math.round(t.ageHours / 24)}d ago at the {t.lastStep} step ·{" "}
              {t.to.phone ? "phone" : "email"} on file
            </Text>
          </VStack>
          <Token size="sm" color={treat.tone} label={treat.label} />
        </HStack>

        <Text color="secondary">{t.because}</Text>

        {/* The exact sentence, not a template. If a merchant would not send it
            themselves they should find that out here. */}
        <Card variant="muted">
          <Text style={{ whiteSpace: "pre-wrap" }}>{t.text}</Text>
        </Card>

        <Divider />

        <HStack gap={3} vAlign="end" wrap="wrap">
          <Form method="post">
            <input type="hidden" name="shop" value={shop} />
            <input type="hidden" name="act" value="send_one" />
            <input type="hidden" name="cartId" value={t.cartId} />
            <input type="hidden" name="channel" value={channel} />
            <HStack gap={3} vAlign="end" wrap="wrap">
              <Selector
                label="Channel"
                isLabelHidden
                size="sm"
                width={210}
                value={channel}
                onChange={setChannel}
                options={channels.map((c) => ({
                  value: c.id,
                  label: c.available ? c.label : `${c.label} — not available`,
                  disabled: !c.available,
                }))}
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isDisabled={busy}
                label="Send to this one"
              />
            </HStack>
          </Form>
          <Form method="post">
            <input type="hidden" name="shop" value={shop} />
            <input type="hidden" name="act" value="skip_one" />
            <input type="hidden" name="cartId" value={t.cartId} />
            <input type="hidden" name="customerId" value={t.customerId} />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              isDisabled={busy}
              label="Leave this one alone"
            />
          </Form>
        </HStack>

        <Text type="supporting" color="secondary">
          Leaving them alone closes this basket for good — the same record a
          shopper writes by pressing 9, so every future run on every channel
          reads it.
        </Text>
      </VStack>
    </Card>
  );
}

function TestCallForm({
  shop,
  busy: pageBusy,
  available,
}: {
  shop: string;
  busy: boolean;
  available: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const [phone, setPhone] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const testBusy = fetcher.state !== "idle";
  const busy = pageBusy || testBusy;
  const result =
    fetcher.data && typeof fetcher.data === "object" && "logs" in fetcher.data
      ? (fetcher.data as TestCallResult)
      : null;
  const consoleLogs = testBusy
    ? [
        { level: "working" as const, message: "Request sent to Chapman." },
        {
          level: "working" as const,
          message:
            "Validating the test, rendering its fixed audio, and contacting Twilio…",
        },
      ]
    : (result?.logs ?? []);
  const showConsole = testBusy || result !== null;

  return (
    <Block
      title="Test the voice connection"
      hint="Pre-renders one fixed identification with Sarvam, then asks Twilio to call the number you enter. It does not select a basket or contact a shopper from your records."
    >
      <Card>
        <fetcher.Form method="post">
          <input type="hidden" name="shop" value={shop} />
          <input type="hidden" name="act" value="test_call" />
          <VStack gap={4}>
            <TextInput
              label="Number to call"
              description="Use international E.164 format, including the country code."
              htmlName="phone"
              value={phone}
              onChange={setPhone}
              placeholder="+919876543210"
              width="min(420px, 100%)"
            />
            <CheckboxInput
              label="This number belongs to me or to someone who is expecting this test call"
              htmlName="confirmExpected"
              value={confirmed}
              onChange={setConfirmed}
            />
            <HStack gap={3} vAlign="center" wrap="wrap">
              <Button
                type="submit"
                variant="primary"
                label={busy ? "Queueing test call…" : "Place test call"}
                isLoading={busy}
                isDisabled={
                  busy || !available || !confirmed || phone.trim().length === 0
                }
              />
              {!available ? (
                <Text type="supporting" color="secondary">
                  Add every required voice variable above before testing.
                </Text>
              ) : null}
            </HStack>
            <Text type="supporting" color="secondary">
              The test says it is a Chapman integration test and then hangs up.
              One call is allowed every 30 seconds. Ordinary quiet-hour
              protection still applies.
            </Text>
            {showConsole ? (
              <div
                role="log"
                aria-live="polite"
                aria-label="Test call log"
                style={{
                  background: "#111814",
                  border: "1px solid #30433a",
                  borderRadius: 10,
                  color: "#d8e5dd",
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                  fontSize: 13,
                  lineHeight: 1.6,
                  maxWidth: 720,
                  padding: "14px 16px",
                  whiteSpace: "pre-wrap",
                }}
              >
                <div style={{ color: "#8ba99a", marginBottom: 6 }}>
                  $ chapman voice:test
                </div>
                {consoleLogs.map((entry, index) => (
                  <div
                    key={`${entry.level}-${index}-${entry.message}`}
                    style={{
                      color: entry.level === "error" ? "#ff9b9b" : undefined,
                    }}
                  >
                    [{entry.level}] {entry.message}
                  </div>
                ))}
                {!testBusy && result?.ok ? (
                  <div style={{ color: "#83d6a2", marginTop: 6 }}>
                    [done] Call queued.
                  </div>
                ) : null}
                {!testBusy &&
                result &&
                !result.ok &&
                result.error.includes("quiet hours") ? (
                  <div style={{ color: "#e9ce84", marginTop: 6 }}>
                    [hint] To test during quiet hours, set
                    VOICE_QUIET_HOURS_TEST_NUMBER to this exact E.164 number in
                    .env, then recreate the gateway.
                  </div>
                ) : null}
              </div>
            ) : null}
          </VStack>
        </fetcher.Form>
      </Card>
    </Block>
  );
}

function TestMessageForm({
  shop,
  available,
}: {
  shop: string;
  available: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const [phone, setPhone] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const busy = fetcher.state !== "idle";
  const result =
    fetcher.data && typeof fetcher.data === "object" && "logs" in fetcher.data
      ? (fetcher.data as MessageResult)
      : null;
  const logs = busy
    ? [
        { level: "working", message: "Request sent to Chapman." },
        {
          level: "working",
          message:
            "Checking the Twilio account type and selecting an allowed test body…",
        },
      ]
    : (result?.logs ?? []);

  return (
    <Block
      title="Test the SMS connection"
      hint="Full accounts receive Chapman's fixed integration text. Trial accounts receive Twilio's predefined customer-support test template. Neither path creates a basket, discount or payment order."
    >
      <Card>
        <fetcher.Form method="post">
          <input type="hidden" name="shop" value={shop} />
          <input type="hidden" name="act" value="test_message" />
          <VStack gap={4}>
            <TextInput
              label="Number to message"
              description="Use international E.164 format. Twilio trial accounts require a verified destination and permit only Twilio's predefined message templates."
              htmlName="phone"
              value={phone}
              onChange={setPhone}
              placeholder="+919876543210"
              width="min(420px, 100%)"
            />
            <CheckboxInput
              label="This number belongs to me or to someone expecting this test message"
              htmlName="confirmExpected"
              value={confirmed}
              onChange={setConfirmed}
            />
            <HStack gap={3} vAlign="center" wrap="wrap">
              <Button
                type="submit"
                variant="primary"
                label={busy ? "Queueing test message…" : "Send test message"}
                isLoading={busy}
                isDisabled={
                  busy || !available || !confirmed || phone.trim().length === 0
                }
              />
              {!available ? (
                <Text type="supporting" color="secondary">
                  Add the required messaging variables above before testing.
                </Text>
              ) : null}
            </HStack>
            {(busy || result) && (
              <div
                role="log"
                aria-live="polite"
                aria-label="Test message log"
                style={{
                  background: "#111814",
                  border: "1px solid #30433a",
                  borderRadius: 10,
                  color: "#d8e5dd",
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                  fontSize: 13,
                  lineHeight: 1.6,
                  maxWidth: 720,
                  padding: "14px 16px",
                  whiteSpace: "pre-wrap",
                }}
              >
                <div style={{ color: "#8ba99a", marginBottom: 6 }}>
                  $ chapman message:test
                </div>
                {logs.map((entry, index) => (
                  <div
                    key={`${entry.level}-${index}-${entry.message}`}
                    style={{
                      color: entry.level === "error" ? "#ff9b9b" : undefined,
                    }}
                  >
                    [{entry.level}] {entry.message}
                  </div>
                ))}
                {!busy && result?.ok ? (
                  <div style={{ color: "#83d6a2", marginTop: 6 }}>
                    [done] Message queued.
                  </div>
                ) : null}
              </div>
            )}
          </VStack>
        </fetcher.Form>
      </Card>
    </Block>
  );
}

export default function Recovery() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [sendChannel, setSendChannel] = useState("draft");

  if (!d.site || !d.run) {
    return (
      <Page>
        <PageHead title="Basket recovery" />
        <Card>
          <EmptyState
            title="No store is connected to this account yet"
            description="Recovery reads one shop's baskets, so it needs a storefront to read."
          />
        </Card>
      </Page>
    );
  }

  const { run } = d;
  const o = run.settings.outreach;
  const shop = d.site.key;

  return (
    <Page>
      <PageHead
        title="Basket recovery"
        lede="Baskets that were never completed, and what — if anything — is worth saying about them. Every message below is the exact text that would go out. Nothing is sent by opening this page."
      >
        <Figures>
          <Figure
            value={run.totals.cartsConsidered}
            label="baskets considered"
          />
          <Figure
            value={run.targets.length}
            label="would be written to"
            tone="accent"
          />
          <Figure value={run.suppressed.length} label="left alone" />
          <Figure
            value={inr(run.totals.marginAtStake)}
            label="margin at stake"
          />
          <Figure
            value={inr(run.totals.expectedValue)}
            label={`at an assumed ${(run.totals.assumedRecovery * 100).toFixed(0)}%`}
          />
        </Figures>
      </PageHead>

      {a && "error" in a && a.error ? (
        <Banner
          status="warning"
          title="Nothing was sent"
          description={String(a.error)}
        />
      ) : null}
      {a && "message" in a && a.message ? (
        <Banner status="success" title={String(a.message)} isDismissable />
      ) : null}
      {a && "sent" in a && typeof a.sent === "number" ? (
        <Banner
          status="success"
          title={`${a.sent} sent, ${a.failed ?? 0} failed`}
          isDismissable
        />
      ) : null}

      <Block
        title="What would go out"
        hint="One person at a time. Each button re-checks the basket is still eligible before anything is sent."
      >
        {run.targets.length === 0 ? (
          <Card>
            <EmptyState
              isCompact
              title="Nothing would go out"
              description="The table below says why, basket by basket."
            />
          </Card>
        ) : (
          <VStack gap={3}>
            {run.targets.map((t) => (
              <TargetCard
                key={t.cartId}
                t={t}
                shop={shop}
                channels={d.channels}
                busy={busy}
              />
            ))}
          </VStack>
        )}
      </Block>

      <Block
        title="Run it"
        hint={`The campaign is re-computed when you click, not taken from what is on this screen — between rendering and clicking, somebody may have bought the thing.${d.sent > 0 ? ` ${d.sent} messages have gone out from this store so far.` : ""}`}
      >
        <Card>
          <Form method="post">
            <input type="hidden" name="shop" value={shop} />
            <input type="hidden" name="act" value="send" />
            <input type="hidden" name="channel" value={sendChannel} />
            <HStack gap={3} vAlign="end" wrap="wrap">
              <Selector
                label="Send by"
                size="sm"
                width={220}
                value={sendChannel}
                onChange={setSendChannel}
                options={d.channels
                  .filter((c) => c.available)
                  .map((c) => ({ value: c.id, label: c.label }))}
              />
              <Button
                type="submit"
                variant="primary"
                isDisabled={busy || !o.enabled}
                label={
                  o.enabled
                    ? `Send ${run.targets.length} messages`
                    : "Outreach is off"
                }
              />
            </HStack>
          </Form>
        </Card>
      </Block>

      <Block
        title="What was left alone, and why"
        hint="The more interesting half."
      >
        <Card padding={0}>
          <Table
            data={run.suppressedBy.map((s) => ({
              id: s.reason,
              label: s.label,
              detail:
                run.suppressed.find((x) => x.reason === s.reason)?.detail ?? "",
              count: s.count,
              margin: inr(s.margin),
            }))}
            idKey="id"
            density="balanced"
            dividers="rows"
            columns={[
              {
                key: "label",
                header: "Reason",
                width: proportional(1),
                renderCell: (s) => (
                  <VStack gap={1}>
                    <Text>{String(s.label)}</Text>
                    <Text type="supporting" color="secondary">
                      {String(s.detail)}
                    </Text>
                  </VStack>
                ),
              },
              {
                key: "count",
                header: "Baskets",
                width: pixel(100),
                align: "end",
              },
              {
                key: "margin",
                header: "Margin not chased",
                width: pixel(170),
                align: "end",
              },
            ]}
          />
        </Card>
      </Block>

      <Block
        title="Why they didn’t buy"
        hint="The only thing in your data that answers why rather than what — because it was asked for."
      >
        {d.histogram.total === 0 ? (
          <Card>
            <EmptyState
              isCompact
              title="Nobody has answered yet"
              description={`${d.answered.asked} basket${d.answered.asked === 1 ? " has" : "s have"} been asked about. This is the number worth waiting for.`}
            />
          </Card>
        ) : (
          <VStack gap={3}>
            {!d.histogram.enough ? (
              <Banner
                status="info"
                container="card"
                title={`Only ${d.histogram.total} answers so far`}
                description="Shown as counts, not shares, and deliberately not as a finding — four people are not a pattern, and the temptation to act on the first three replies is the whole reason this floor exists."
              />
            ) : null}
            <Card padding={0}>
              <Table
                data={d.histogram.counts.map((c) => ({
                  id: c.reason,
                  reason: REASON_LABEL[c.reason],
                  count: c.count,
                  share: `${(c.share * 100).toFixed(0)}%`,
                }))}
                idKey="id"
                density="compact"
                dividers="rows"
                columns={
                  d.histogram.enough
                    ? [
                        {
                          key: "reason",
                          header: "Reason",
                          width: proportional(1),
                        },
                        {
                          key: "count",
                          header: "Answers",
                          width: pixel(100),
                          align: "end",
                        },
                        {
                          key: "share",
                          header: "Share",
                          width: pixel(100),
                          align: "end",
                        },
                      ]
                    : [
                        {
                          key: "reason",
                          header: "Reason",
                          width: proportional(1),
                        },
                        {
                          key: "count",
                          header: "Answers",
                          width: pixel(100),
                          align: "end",
                        },
                      ]
                }
              />
            </Card>
            <Text type="supporting" color="secondary">
              {d.answered.answered} of {d.answered.asked} asked replied
              {d.answered.asked
                ? ` (${Math.round(d.answered.rate * 100)}%)`
                : ""}
              .
            </Text>
          </VStack>
        )}
      </Block>

      {d.conversations.length > 0 ? (
        <Block title="In their own words" hint="Only you see this.">
          <VStack gap={3}>
            {d.conversations.map((c) => (
              <Card key={c.cartId}>
                <VStack gap={3}>
                  <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
                    <Text weight="semibold">
                      {c.reasonLabel ?? "no answer yet"}
                    </Text>
                    <HStack gap={2}>
                      <Token size="sm" color="gray" label={c.state} />
                      {c.by ? (
                        <Token size="sm" color="gray" label={c.by} />
                      ) : null}
                    </HStack>
                  </HStack>
                  {c.text ? <Text>&ldquo;{c.text}&rdquo;</Text> : null}
                  {c.remedy ? (
                    <Text type="supporting" color="secondary">
                      → {c.remedy}
                    </Text>
                  ) : null}
                  {/* Merchant-only, always. A shopper told what they nearly got
                      has been handed a strategy for next time. */}
                  {c.blocked.length ? (
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <Eyebrow>No discount</Eyebrow>
                      {c.blocked.map((b) => (
                        <Token key={b} size="sm" color="yellow" label={b} />
                      ))}
                    </HStack>
                  ) : null}
                  {/*
                    The whole exchange, folded away. Collapsed because the
                    summary above answers the usual question and this answers
                    the one that follows it — "why did it decide that?" — which
                    is exactly when a merchant wants the sequence.
                  */}
                  {c.turns.length > 1 ? (
                    <Collapsible
                      trigger={
                        <Text type="supporting" color="secondary">
                          {c.turns.length} steps
                        </Text>
                      }
                    >
                      <List listStyle="decimal" density="compact">
                        {c.turns.map((t, i) => (
                          <ListItem
                            key={i}
                            label={`${t.kind} — ${t.detail}`}
                            description={new Date(t.ts).toLocaleString("en-IN")}
                          />
                        ))}
                      </List>
                    </Collapsible>
                  ) : null}
                </VStack>
              </Card>
            ))}
          </VStack>
        </Block>
      ) : null}

      <Block
        title="From your live storefront"
        actions={
          <Token
            size="sm"
            color={d.live.total ? "green" : "gray"}
            label={`${d.live.total} of ${run.totals.cartsConsidered} baskets are real`}
          />
        }
      >
        <Card>
          <VStack gap={3}>
            {d.live.total === 0 ? (
              <Text color="secondary">
                Everything below came from <Code>npm run seed</Code>. Real
                baskets appear here as soon as somebody puts something in a cart
                on your shop — the widget script already posts them; there is
                nothing else to install.
              </Text>
            ) : (
              <Text color="secondary">
                <Text as="span" weight="semibold">
                  {d.live.recoverable}
                </Text>{" "}
                of them can actually be recovered. The rest were built by
                somebody who was not signed in, so there is no way to reach them
                and no message will be sent — you will find them below under
                &ldquo;no way to reach them&rdquo;. That is the honest number,
                and it is the one most abandoned-cart tools do not show you.
                {d.live.newestAt
                  ? ` Most recent: ${new Date(d.live.newestAt).toLocaleString("en-IN")}.`
                  : ""}
              </Text>
            )}
            {!d.live.captureConfigured ? (
              <Text type="supporting" color="secondary">
                This shop has not connected an order source, so even a signed-in
                shopper has no contact details on file. Contact is looked up
                from your own records, server to server — it is never taken from
                the page, because a page that could name a phone number could
                name anybody&rsquo;s.
              </Text>
            ) : null}
          </VStack>
        </Card>
      </Block>

      <Note>
        {run.emptyReason ??
          `Margin, not basket value — chasing revenue you do not keep is how a recovery campaign costs more than it returns. The ${(run.totals.assumedRecovery * 100).toFixed(0)}% is an assumption, not a measurement: this outreach has never run here, so there is no rate to cite. Treat ${inr(run.totals.expectedValue)} as an order of magnitude.`}
      </Note>

      <Setup title="Limits, discounts and channels">
        <VStack gap={3}>
          <Heading level={3}>Capture a recoverable basket first</Heading>
          <Card>
            <List listStyle="decimal" density="spacious">
              <ListItem
                label="Enable Recovery in Feature controls"
                description="This grants permission; it does not create a cart or contact record."
              />
              <ListItem
                label="Install the embed on every cart and product page"
                description="The bundled cart.js posts line items only when it can find the Chapman tag on that page."
              />
              <ListItem
                label="Connect a signed order/contact source"
                description="For the demo, register http://store:4000/api/orders as the signed order feed and enable DEMO_STORE_CHAPMAN. The browser is never allowed to submit an arbitrary phone number as customer identity."
              />
              <ListItem
                label="Sign in, add an item, and leave without checkout"
                description="Reload Recovery and confirm the live-cart section reports a recoverable basket before configuring a send channel."
              />
            </List>
          </Card>
        </VStack>

        <Divider />

        <IntegrationSetup guide={d.voiceSetup} />

        <TestCallForm
          shop={shop}
          busy={busy}
          available={d.voiceSetup.status === "ready"}
        />

        <Divider />

        <IntegrationSetup guide={d.messagingSetup} />

        <TestMessageForm
          shop={shop}
          available={d.messagingSetup.status === "ready"}
        />

        <Divider />

        <Block
          title="Your limits"
          hint="Every one of these can only reduce what goes out."
        >
          <LimitsForm shop={shop} o={o} busy={busy} />
        </Block>

        <Block
          title="Recovery discounts"
          hint="The one place an agent can give money away without a per-case approval. Read it as an approval with a cap. It never chooses a depth — it reads the number below, or offers nothing."
        >
          <VStack gap={4}>
            <Figures>
              <Figure
                value={d.spend.count}
                label={`of ${d.policy.monthlyGrantCap} this month`}
              />
              <Figure
                value={inr(d.spend.margin)}
                label={`of ${inr(d.policy.monthlyMarginCap)} margin given`}
              />
              <Figure
                value={d.grants.filter((g) => g.state === "redeemed").length}
                label="actually used"
                tone="accent"
              />
            </Figures>

            <PolicyForm shop={shop} policy={d.policy} busy={busy} />

            {d.grants.length > 0 ? (
              <Card padding={0}>
                <Table
                  data={d.grants.map((g) => ({
                    id: g.id,
                    state: g.state,
                    grant: `${Math.round(g.depth * 100)}% off ${g.title}, up to ${g.qtyCap}`,
                    detail: `${g.tier} shopper, said “${g.reason}”, expires ${g.expiresAt.slice(0, 16).replace("T", " ")}`,
                    cost: inr(g.marginCost),
                  }))}
                  idKey="id"
                  density="balanced"
                  dividers="rows"
                  columns={[
                    {
                      key: "state",
                      header: "State",
                      width: pixel(110),
                      renderCell: (g) => (
                        <Token
                          size="sm"
                          color={g.state === "redeemed" ? "green" : "gray"}
                          label={String(g.state)}
                        />
                      ),
                    },
                    {
                      key: "grant",
                      header: "Grant",
                      width: proportional(1),
                      renderCell: (g) => (
                        <VStack gap={1}>
                          <Text>{String(g.grant)}</Text>
                          <Text type="supporting" color="secondary">
                            {String(g.detail)}
                          </Text>
                        </VStack>
                      ),
                    },
                    {
                      key: "cost",
                      header: "Costs you",
                      width: pixel(120),
                      align: "end",
                    },
                  ]}
                />
              </Card>
            ) : null}
          </VStack>
        </Block>

        <Block title="Channels">
          <Card padding={0}>
            <Table
              data={d.channels.map((c) => ({
                id: c.id,
                label: c.label,
                available: c.available,
                note: [c.unlockedBy, c.note].filter(Boolean).join(" "),
              }))}
              idKey="id"
              density="balanced"
              dividers="rows"
              columns={[
                { key: "label", header: "Channel", width: pixel(190) },
                {
                  key: "available",
                  header: "Status",
                  width: pixel(110),
                  renderCell: (c) => (
                    <Token
                      size="sm"
                      color={c.available ? "green" : "gray"}
                      label={c.available ? "Live" : "Locked"}
                    />
                  ),
                },
                {
                  key: "note",
                  header: "",
                  width: proportional(1),
                  renderCell: (c) => (
                    <Text color="secondary">{String(c.note)}</Text>
                  ),
                },
              ]}
            />
          </Card>
        </Block>

        <Block
          title="On the telephone"
          hint="A call leaves nothing behind to re-read, so it starts as a one-way notice and becomes a conversation only if you say so."
        >
          <CallForm shop={shop} call={o.call} busy={busy} />
        </Block>
      </Setup>

      {d.messageHandoffs.length > 0 ? (
        <Block
          title="Recent SMS handoffs"
          hint="Delivery state without storing the phone number or message body in this log."
        >
          <Card padding={0}>
            <Table
              data={d.messageHandoffs.map((entry) => ({
                id: `${entry.id}-${entry.ts}-${entry.status}`,
                at: entry.ts.slice(0, 16).replace("T", " "),
                kind:
                  entry.kind === "integration_test"
                    ? "Integration test"
                    : "Discounted payment link",
                status: entry.status,
                detail: entry.error ?? entry.ref ?? "",
              }))}
              idKey="id"
              density="balanced"
              dividers="rows"
              columns={[
                { key: "at", header: "When", width: pixel(160) },
                { key: "kind", header: "Message", width: proportional(1) },
                {
                  key: "status",
                  header: "Status",
                  width: pixel(120),
                  renderCell: (entry) => (
                    <Token
                      size="sm"
                      color={entry.status === "queued" ? "green" : "gray"}
                      label={String(entry.status)}
                    />
                  ),
                },
                {
                  key: "detail",
                  header: "Provider",
                  width: proportional(1),
                  renderCell: (entry) => (
                    <Text type="supporting" color="secondary">
                      {String(entry.detail)}
                    </Text>
                  ),
                },
              ]}
            />
          </Card>
        </Block>
      ) : null}

      {d.calls.length > 0 ? (
        <Block
          title="What was actually said"
          hint="Written down before it was spoken, not after."
        >
          <VStack gap={3}>
            {d.calls.map((c) => (
              <Card key={c.callSid}>
                <VStack gap={3}>
                  <Text type="code" size="2xs" color="secondary">
                    {c.at.slice(0, 16).replace("T", " ")} · {c.cartId}
                  </Text>
                  <Divider />
                  <VStack gap={2}>
                    {c.lines.map((l, i) => (
                      <HStack key={i} gap={3} vAlign="start">
                        <Text
                          type="code"
                          size="2xs"
                          color={l.who === "shop" ? "accent" : "secondary"}
                          style={{ minWidth: 48 }}
                        >
                          {l.who === "shop" ? "SHOP" : "THEM"}
                        </Text>
                        <VStack gap={1}>
                          <Text>{l.text}</Text>
                          {l.source &&
                          l.source !== "template" &&
                          l.source !== "model" ? (
                            <HStack>
                              <Token
                                size="sm"
                                color="yellow"
                                label={
                                  l.source === "bounds_refused"
                                    ? "blocked, safe line spoken"
                                    : l.source === "model_unavailable"
                                      ? "model unavailable"
                                      : l.source
                                }
                              />
                            </HStack>
                          ) : null}
                        </VStack>
                      </HStack>
                    ))}
                  </VStack>
                </VStack>
              </Card>
            ))}
          </VStack>
        </Block>
      ) : null}

      {d.drafts.length > 0 ? (
        <Block title="Last written">
          <Card padding={0}>
            <Table
              data={d.drafts.map((x) => ({
                id: x.id,
                at: x.at.slice(0, 16).replace("T", " "),
                treatment: x.treatment,
                text: `${x.text.slice(0, 110)}…`,
              }))}
              idKey="id"
              density="compact"
              dividers="rows"
              columns={[
                {
                  key: "at",
                  header: "When",
                  width: pixel(150),
                  renderCell: (x) => (
                    <Text type="code" size="2xs" color="secondary">
                      {String(x.at)}
                    </Text>
                  ),
                },
                {
                  key: "treatment",
                  header: "Kind",
                  width: pixel(130),
                  renderCell: (x) => (
                    <Token size="sm" color="gray" label={String(x.treatment)} />
                  ),
                },
                {
                  key: "text",
                  header: "Text",
                  width: proportional(1),
                  renderCell: (x) => (
                    <Text color="secondary">{String(x.text)}</Text>
                  ),
                },
              ]}
            />
          </Card>
        </Block>
      ) : null}

      <Block title="What would make this better">
        <Card padding={0}>
          <Table
            data={run.gaps.map((g) => ({
              id: g.what,
              what: g.what,
              who: g.who === "merchant" ? "you" : "us",
              unlocks: g.unlocks,
            }))}
            idKey="id"
            density="balanced"
            dividers="rows"
            columns={[
              {
                key: "who",
                header: "Who",
                width: pixel(84),
                renderCell: (g) => (
                  <Token
                    size="sm"
                    color={g.who === "you" ? "yellow" : "gray"}
                    label={String(g.who)}
                  />
                ),
              },
              { key: "what", header: "What", width: proportional(1) },
              {
                key: "unlocks",
                header: "Unlocks",
                width: proportional(1.3),
                renderCell: (g) => (
                  <Text color="secondary">{String(g.unlocks)}</Text>
                ),
              },
            ]}
          />
        </Card>
      </Block>
    </Page>
  );
}
