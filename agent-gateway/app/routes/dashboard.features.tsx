import { useEffect, useState } from "react";
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
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import { Block, Note, Page, PageHead } from "../components/console";
import { requireMerchant } from "../lib/auth.server";
import { inspectStorefrontInstall } from "../lib/installstatus.server";
import {
  agentPaymentControlState,
  linkAgentRazorpay,
} from "../lib/sitepayments.server";
import { sitesForMerchant } from "../lib/sites.server";
import {
  ALWAYS_ON,
  SWITCHES,
  readFlagsFile,
  writeFlags,
  type FeatureKey,
} from "../lib/featureflags.server";

/**
 * What this shop has switched on.
 *
 * CHAPMAN is a tool for any merchant, and no merchant wants all of it. Until
 * this page existed the only way to not use a feature was to not open its page,
 * which is not the same thing at all: an unopened page still advertises its
 * tool to every agent that asks, and still writes a memory about every shopper
 * who talks to the widget.
 *
 * THE PROMISE THIS PAGE MAKES. Off means off at the surface, not hidden on the
 * dashboard. Each switch below states what actually stops, and that sentence
 * comes from the same module the routes check — so the claim on screen and the
 * code that honours it cannot drift apart without someone editing both.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Nothing here deletes anything. Switching
 * memory off leaves every stored memory exactly where it was; switching offers
 * off leaves the approvals intact. A switch is reversible by definition, and a
 * switch that quietly destroyed data would be a button labelled with a lie.
 * Deletion lives on the feature's own page, where it can ask twice.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site)
    return {
      site: null,
      switches: [],
      alwaysOn: [],
      flags: null,
      meta: null,
      installation: null,
    };

  const f = readFlagsFile(site.key);
  const installation = await inspectStorefrontInstall(site);
  const payment = agentPaymentControlState(site);
  const paymentSetup = payment.ready
    ? {
        label: "Razorpay linked",
        detail:
          "Chapman can advertise its Razorpay handler while this switch is on. The storefront's own checkout is separate.",
      }
    : payment.credentialsReady
      ? {
          label: "Ready to link",
          detail:
            "Turn this on and save to link Chapman to the existing server-side Razorpay keys. No credential enters the browser.",
        }
      : {
          label: payment.linked ? "Keys missing" : "Setup needed",
          detail: `Add ${payment.keyIdEnv} and ${payment.keySecretEnv} to Docker, recreate the gateway, then turn this on.`,
        };

  return {
    site: { key: site.key, name: site.name },
    /**
     * The registry travels as DATA rather than as an import the component
     * makes.
     *
     * `featureflags.server.ts` is a server module, and React Router only strips
     * server code out of `loader`/`action`. A component that imports one keeps
     * the whole graph — and here, `node:fs` — in the client bundle, which fails
     * the production build while dev mode carries on happily. The same note is
     * on `dashboard.memory.tsx` for the same reason.
     */
    switches: SWITCHES.map((s) => ({
      key: s.key,
      name: s.name,
      offMeans: s.offMeans,
      gates: s.gates,
      inflight: s.inflight ?? [],
      tools: [...s.ucpTools, ...s.shopperTools],
      setup: s.key === "payments" ? paymentSetup : null,
    })),
    alwaysOn: ALWAYS_ON,
    // A policy default cannot make an unavailable payment integration "On".
    // The switch becomes effective only when the site is linked and both
    // server-side credentials resolve.
    flags: {
      ...f.flags,
      payments: f.flags.payments && payment.ready,
    },
    installation,
    meta: {
      updatedAt: f.updatedAt,
      updatedBy: f.updatedBy,
      history: f.history.slice(-8).reverse(),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  // Scoped at the write, not only at the read. A console page that filters on
  // the way out and trusts the form on the way back in is not scoped.
  if (!merchant.sites.includes(shop))
    return { ok: false as const, error: "not your store" };
  const site = sitesForMerchant(merchant.sites).find((s) => s.key === shop);
  if (!site)
    return { ok: false as const, error: "storefront is not registered" };

  const patch: Partial<Record<FeatureKey, boolean>> = {};
  for (const s of SWITCHES) {
    // Read as an explicit "on"/"off" rather than checkbox presence. An
    // unchecked box submits nothing, and "absent" would be indistinguishable
    // from "this key was not on the form" — which is how a future partial form
    // silently switches half the product off.
    const v = form.get(`f_${s.key}`);
    if (v === "on") patch[s.key] = true;
    else if (v === "off") patch[s.key] = false;
  }

  const before = readFlagsFile(shop);
  let linkedPayments = false;
  if (patch.payments === true) {
    const payment = agentPaymentControlState(site);
    if (!payment.credentialsReady) {
      return {
        ok: false as const,
        error: `Razorpay agent checkout needs ${payment.keyIdEnv} and ${payment.keySecretEnv}. Add both values to Docker and recreate the gateway before enabling it.`,
      };
    }
    if (!payment.linked) {
      try {
        linkedPayments = linkAgentRazorpay(shop).changed;
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const saved = writeFlags(shop, patch, merchant.email);
  const paymentChanged =
    before.flags.payments !== saved.flags.payments || linkedPayments;
  const off = SWITCHES.filter((s) => !saved.flags[s.key]).length;
  return {
    ok: true as const,
    message: linkedPayments
      ? "Razorpay agent checkout is linked and enabled. The storefront's native checkout was not changed."
      : paymentChanged
        ? saved.flags.payments
          ? "Razorpay agent checkout enabled."
          : "Razorpay agent checkout switched off. Existing payments can still finish, and the storefront's native checkout is unchanged."
        : off === 0
          ? "Everything is on."
          : `Saved. ${off} feature${off === 1 ? "" : "s"} switched off.`,
  };
};

export default function FeaturesPage() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [on, setOn] = useState<Record<string, boolean>>(() => ({
    ...(d.flags ?? {}),
  }));
  useEffect(() => {
    setOn({ ...(d.flags ?? {}) });
  }, [d.flags]);

  if (!d.site) {
    return (
      <Page>
        <PageHead title="Feature controls" />
        <EmptyState
          title="No store yet"
          description="Connect your first storefront before configuring its feature policy."
          actions={
            <Button
              href="/dashboard/setup"
              variant="primary"
              label="Connect storefront"
            />
          }
        />
      </Page>
    );
  }

  const offCount = d.switches.filter((s) => !on[s.key]).length;

  return (
    <Page>
      <PageHead
        title="Feature controls"
        lede={`What ${d.site.name} has switched on. Off means off at the surface — the tool leaves the agent's list and the route stops answering — not just hidden from this console.`}
      />

      {d.installation &&
      !d.installation.assistant.installed &&
      !d.installation.agentFront.installed ? (
        <Banner
          status="warning"
          title="The storefront is not installed yet"
          description="These switches are Chapman policy defaults. An on switch does not mean the embed tag or UCP route exists on the storefront; complete either setup first."
        />
      ) : null}

      {a?.error ? (
        <Banner
          status="error"
          title="That did not go through"
          description={a.error}
        />
      ) : null}
      {a?.ok && a.message ? (
        <Banner status="success" title={a.message} isDismissable />
      ) : null}

      <Form method="post">
        <input type="hidden" name="shop" value={d.site.key} />

        <Block
          title="Switchable"
          hint="Each of these can be turned off without breaking the rest. Nothing is deleted — switch one back on and it picks up exactly where it was."
        >
          <VStack gap={4}>
            {d.switches.map((s, i) => (
              <div key={s.key}>
                {i > 0 ? <Divider /> : null}
                <Card variant="transparent">
                  <VStack gap={2}>
                    <HStack gap={3} hAlign="between" vAlign="start">
                      <VStack gap={1}>
                        <Heading level={3}>{s.name}</Heading>
                        <Text color="secondary">{s.offMeans}</Text>
                      </VStack>
                      <VStack gap={1} hAlign="end">
                        <Switch
                          label={on[s.key] ? "On" : "Off"}
                          value={Boolean(on[s.key])}
                          onChange={(v: boolean) =>
                            setOn((p) => ({ ...p, [s.key]: v }))
                          }
                        />
                      </VStack>
                    </HStack>
                    {/* The explicit value the action reads. See the note there. */}
                    <input
                      type="hidden"
                      name={`f_${s.key}`}
                      value={on[s.key] ? "on" : "off"}
                    />
                    {s.setup ? (
                      <HStack gap={2} wrap="wrap" vAlign="center">
                        <Token label={s.setup.label} />
                        <Text color="secondary">{s.setup.detail}</Text>
                      </HStack>
                    ) : null}
                    {s.tools.length ? (
                      <HStack gap={2} wrap="wrap">
                        <Text type="label" color="secondary">
                          Withdraws:
                        </Text>
                        {s.tools.map((t) => (
                          <Token key={t} label={t} />
                        ))}
                      </HStack>
                    ) : null}
                    {s.inflight.length ? (
                      <Text type="label" color="secondary">
                        Keeps working either way: {s.inflight.join(", ")} —
                        something already in flight must be allowed to finish.
                      </Text>
                    ) : null}
                  </VStack>
                </Card>
              </div>
            ))}
          </VStack>
        </Block>

        <HStack gap={3} vAlign="center">
          <Button
            type="submit"
            isDisabled={busy}
            label={busy ? "Saving…" : "Save"}
          />
          <Text color="secondary">
            {offCount === 0 ? "Everything on." : `${offCount} switched off.`}
          </Text>
        </HStack>
      </Form>

      <Block
        title="Always on"
        hint="Three that have no switch, and why not — so you are not left looking for one."
      >
        <VStack gap={3}>
          {d.alwaysOn.map((f) => (
            <Card key={f.key} variant="transparent">
              <VStack gap={1}>
                <Heading level={3}>{f.name}</Heading>
                <Text color="secondary">{f.why}</Text>
              </VStack>
            </Card>
          ))}
        </VStack>
      </Block>

      {d.meta?.history.length ? (
        <Block title="Recent changes" hint="Who switched what, and when.">
          <VStack gap={2}>
            {d.meta.history.map((h, i) => (
              <Text key={`${h.ts}-${h.key}-${i}`} color="secondary">
                {new Date(h.ts).toLocaleString()} — {h.by} turned {h.key}{" "}
                {h.to ? "on" : "off"}
              </Text>
            ))}
          </VStack>
        </Block>
      ) : null}

      <Note>
        A switch here changes what your shop does, not what CHAPMAN can do.
        Turning the agent surface off does not uninstall it — an agent simply
        finds nothing at your well-known path, the same as before you installed
        anything.
      </Note>
    </Page>
  );
}
