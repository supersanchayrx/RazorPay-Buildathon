import { Link as RRLink, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Card } from "@astryxdesign/core/Card";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  Block,
  Cards,
  Figure,
  Figures,
  Note,
  Page,
  PageHead,
  StatusToken,
} from "../components/console";
import { FEATURES, STATUS_LABEL } from "../lib/features";
import type { Feature } from "../lib/features";
import { readFlags, type FeatureKey } from "../lib/featureflags.server";
import { readLedger } from "../lib/ledger.server";
import { sitesForMerchant } from "../lib/sites.server";
import { requireMerchant } from "../lib/auth.server";
import { inspectStorefrontInstall } from "../lib/installstatus.server";
import { isConfigured as paymentsConfigured } from "../lib/razorpay.server";
import { missing as missingVoice } from "../lib/voice.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Scoped to this merchant, never allSites(): a console page that forgets to
  // filter is how one merchant sees another.
  const merchant = requireMerchant(request);
  const ledger = readLedger(2000);
  const scoped = sitesForMerchant(merchant.sites);
  const site = scoped[0] ?? null;

  // What this shop has actually switched on. Without this the grid reports a
  // feature as live while its tool has been withdrawn from every agent — the
  // console asserting something about the shop that is no longer true.
  const flags = site ? readFlags(site.key) : null;
  const installation = site ? await inspectStorefrontInstall(site) : null;
  const hasStorefrontSurface = Boolean(
    installation?.assistant.installed || installation?.agentFront.installed,
  );
  const paymentReady = Boolean(
    site?.razorpay && paymentsConfigured(site.razorpay),
  );
  const voiceMissing = missingVoice();

  const runtimeFeature = (f: Feature): Feature => {
    if (!site || !installation) {
      return {
        ...f,
        status: "needs_setup",
        unlockedBy: "Register a storefront first.",
      };
    }

    const needs = (unlockedBy: string): Feature => ({
      ...f,
      status: "needs_setup",
      unlockedBy,
    });
    switch (f.key) {
      case "assistant":
        return installation.assistant.installed
          ? f
          : needs(
              "Paste the generated embed tag into the storefront, then refresh this page.",
            );
      case "agent_front":
        return installation.agentFront.installed
          ? f
          : needs(
              "Publish /.well-known/ucp on the storefront, then verify the install.",
            );
      case "payments":
        if (!paymentReady)
          return needs("Add the Razorpay key ID and key secret.");
        return hasStorefrontSurface
          ? f
          : needs(
              "Razorpay is configured, but no installed storefront surface can offer checkout yet.",
            );
      case "orders":
        if (!site.orders)
          return needs(f.unlockedBy ?? "Connect an order source.");
        return hasStorefrontSurface
          ? { ...f, status: "available" }
          : needs(
              "The order source is configured, but the storefront integration is not installed yet.",
            );
      case "memory":
      case "recovery":
        return installation.assistant.installed
          ? f
          : needs(
              "Install the storefront assistant so shopper sessions and baskets can reach Chapman.",
            );
      case "voice":
        return voiceMissing.length === 0
          ? f
          : needs(`Finish voice setup: ${voiceMissing.join(", ")}.`);
      default:
        return f;
    }
  };

  return {
    features: FEATURES.map((f) => ({
      ...runtimeFeature(f),
      switchedOff: flags ? flags[f.key as FeatureKey] === false : false,
    })),
    sites: scoped.map((s) => ({
      key: s.key,
      name: s.name,
      origins: s.origins,
    })),
    installation,
    counts: {
      replies: ledger.filter((e) => e.kind === "reply").length,
      refusals: ledger.filter((e) => e.kind === "refusal").length,
    },
  };
};

/**
 * A live feature reads as a door: name, one sentence, and the way in.
 *
 * The card is clickable across its whole surface rather than only on a small
 * "Open →" link, because a target the size of a word is a target you miss.
 */
function LiveCard({ f }: { f: Feature }) {
  const body = (
    <Card height="100%">
      <VStack gap={3} height="100%">
        <HStack gap={3} hAlign="between" vAlign="start">
          <Heading level={3}>{f.name}</Heading>
          <StatusToken status={f.status} label={STATUS_LABEL[f.status]} />
        </HStack>
        <Text color="secondary">{f.blurb}</Text>
        {f.href ? (
          <VStack gap={0} paddingBlockStart={1}>
            <Text type="label" color="accent">
              Open →
            </Text>
          </VStack>
        ) : null}
      </VStack>
    </Card>
  );
  return f.href ? (
    <RRLink
      to={f.href}
      style={{
        textDecoration: "none",
        color: "inherit",
        display: "block",
        height: "100%",
      }}
    >
      {body}
    </RRLink>
  ) : (
    body
  );
}

/**
 * A locked feature owes the reader the exact obstacle.
 *
 * `unlockedBy` is rendered as the body, not hidden behind a tooltip, because
 * the whole argument of this page is that a roadmap you can check beats one
 * you cannot.
 */
function PendingRow({ f }: { f: Feature }) {
  return (
    <Card variant="transparent">
      <VStack gap={2}>
        <HStack gap={3} hAlign="between" vAlign="start">
          <Heading level={3}>{f.name}</Heading>
          <StatusToken status={f.status} label={STATUS_LABEL[f.status]} />
        </HStack>
        <Text color="secondary">{f.blurb}</Text>
        {f.unlockedBy ? (
          <Card variant="yellow" padding={3}>
            <Text type="supporting">
              <Text type="label" as="span">
                Needs:{" "}
              </Text>
              {f.unlockedBy}
            </Text>
          </Card>
        ) : null}
      </VStack>
    </Card>
  );
}

export default function Overview() {
  const { features, sites, counts, installation } =
    useLoaderData<typeof loader>();

  if (sites.length === 0) {
    return (
      <Page>
        <PageHead
          back={null}
          title="Welcome to CHAPMAN"
          lede="Your merchant account is ready. Chapman does not know about a storefront, catalogue, customer, or order yet."
        />

        <Card>
          <EmptyState
            title="No storefront connected"
            description="Register the store you own before any capability is enabled or any catalogue is fetched."
            actions={
              <Button
                href="/dashboard/setup"
                variant="primary"
                label="Configure your storefront"
              />
            }
          />
        </Card>

        <Block
          title="What setup will do"
          hint="Three explicit steps, and each one is verified separately."
        >
          <Cards>
            <Card>
              <VStack gap={2}>
                <Heading level={3}>1. Register the store</Heading>
                <Text color="secondary">
                  Name its browser origin and the catalogue URL Chapman may
                  read.
                </Text>
              </VStack>
            </Card>
            <Card>
              <VStack gap={2}>
                <Heading level={3}>2. Install the assistant</Heading>
                <Text color="secondary">
                  Paste one generated script tag. It stays not installed until
                  Chapman detects it.
                </Text>
              </VStack>
            </Card>
            <Card>
              <VStack gap={2}>
                <Heading level={3}>3. Publish agent discovery</Heading>
                <Text color="secondary">
                  Expose /.well-known/ucp, then verify the route from the
                  dashboard.
                </Text>
              </VStack>
            </Card>
          </Cards>
        </Block>

        <Note>
          API keys are configured outside the browser. Store setup records only
          environment-variable names, never secret values.
        </Note>
      </Page>
    );
  }

  // Switched off is its own state, not a variety of live and not a variety of
  // unbuilt. Folding it into either would have this page misreport the shop.
  const live = features.filter(
    (f) => f.status === "available" && !f.switchedOff,
  );
  const off = features.filter((f) => f.switchedOff);
  const rest = features.filter(
    (f) => f.status !== "available" && !f.switchedOff,
  );
  const shop = sites[0]?.name ?? "your store";
  const installedSurfaces = installation
    ? Number(installation.assistant.installed) +
      Number(installation.agentFront.installed)
    : 0;

  return (
    <Page>
      <PageHead
        back={null}
        title={`CHAPMAN setup for ${shop}`}
        lede="What is installed on the storefront, what is ready inside Chapman, and what still needs you."
      >
        <Figures>
          <Figure
            value={counts.replies.toLocaleString("en-IN")}
            label="replies sent"
            tone="accent"
          />
          <Figure
            value={counts.refusals.toLocaleString("en-IN")}
            label="claims blocked"
          />
          <Figure value={installedSurfaces} label="storefront surfaces live" />
          <Figure value={live.length} label="capabilities ready" />
          <Figure
            value={sites.length}
            label={
              sites.length === 1
                ? "storefront registered"
                : "storefronts registered"
            }
            note={sites[0]?.key}
          />
        </Figures>
      </PageHead>

      {installation ? (
        <Block
          title="Storefront installation"
          hint={`Checked from Chapman through ${installation.probeOrigin}. Registration alone does not count as an install.`}
        >
          <Cards minWidth={380}>
            <Card>
              <VStack gap={3}>
                <HStack gap={3} hAlign="between" vAlign="start">
                  <Heading level={3}>Assistant embed</Heading>
                  <StatusToken
                    status={
                      installation.assistant.installed
                        ? "available"
                        : "needs_setup"
                    }
                    label={
                      installation.assistant.installed
                        ? "Installed"
                        : "Not installed"
                    }
                  />
                </HStack>
                <Text color="secondary">{installation.assistant.detail}</Text>
                <Button
                  href="/dashboard/chatbot"
                  variant="ghost"
                  size="sm"
                  label="View setup instructions"
                />
              </VStack>
            </Card>
            <Card>
              <VStack gap={3}>
                <HStack gap={3} hAlign="between" vAlign="start">
                  <Heading level={3}>Agent discovery</Heading>
                  <StatusToken
                    status={
                      installation.agentFront.installed
                        ? "available"
                        : "needs_setup"
                    }
                    label={
                      installation.agentFront.installed
                        ? "Installed"
                        : "Not installed"
                    }
                  />
                </HStack>
                <Text color="secondary">{installation.agentFront.detail}</Text>
                <Button
                  href="/dashboard/agentfront"
                  variant="ghost"
                  size="sm"
                  label="Set up and verify"
                />
              </VStack>
            </Card>
          </Cards>
        </Block>
      ) : null}

      <Block
        title="Ready in Chapman"
        hint="Available now with their runtime requirements met. Storefront-dependent capabilities stay out until the install is detected."
      >
        <Cards>
          {live.map((f) => (
            <LiveCard key={f.key} f={f} />
          ))}
        </Cards>
      </Block>

      {off.length ? (
        <Block
          title="Switched off"
          hint="Built and working, but turned off for this store. Their tools are withdrawn from agents and their routes stop answering."
        >
          <Cards minWidth={380}>
            {off.map((f) => (
              <Card key={f.key} variant="transparent">
                <VStack gap={2}>
                  <HStack gap={3} hAlign="between" vAlign="start">
                    <Heading level={3}>{f.name}</Heading>
                    <StatusToken status="planned" label="Off" />
                  </HStack>
                  <Text color="secondary">{f.blurb}</Text>
                  <RRLink to="/dashboard/features" style={{ color: "inherit" }}>
                    <Text type="label" color="accent">
                      Turn back on →
                    </Text>
                  </RRLink>
                </VStack>
              </Card>
            ))}
          </Cards>
        </Block>
      ) : null}

      <Block
        title="Needs setup or still being built"
        hint="Each one names the exact thing standing in its way instead of treating an enabled default as a live integration."
      >
        <Cards minWidth={380}>
          {rest.map((f) => (
            <PendingRow key={f.key} f={f} />
          ))}
        </Cards>
      </Block>

      <Note>
        “Ready in Chapman” describes a gateway capability. “Installed” is
        reserved for a surface this gateway actually found on your storefront.
      </Note>
    </Page>
  );
}
