import {
  Form,
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
  Link as RRLink,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AppShell } from "@astryxdesign/core/AppShell";
import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { LinkProvider } from "@astryxdesign/core/Link";
import { Theme } from "@astryxdesign/core/theme";

import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "../styles/theme/matcha.css";
import { matchaTheme } from "../styles/theme/matcha.js";

import { readSession } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";

/**
 * One guard, on the layout, covering every child route.
 *
 * Putting the check here rather than in each page means a new page cannot ship
 * unprotected by omission — the commonest way an authenticated app grows a hole.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = readSession(request.headers.get("Cookie"));
  if (!merchant) throw redirect("/login");
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";
  if (!site && pathname !== "/dashboard" && pathname !== "/dashboard/setup") {
    throw redirect("/dashboard/setup");
  }
  return {
    merchant: {
      name: merchant.name,
      email: merchant.email,
      sites: merchant.sites,
    },
    site: site ? { key: site.key, name: site.name } : null,
  };
};

/**
 * The merchant console.
 *
 * Deliberately outside `app.tsx`, which is the Shopify-embedded layout and
 * requires a Shopify session. CHAPMAN has custom-site merchants too, and they
 * have no Shopify admin to be embedded in — a console reachable only through
 * Shopify would lock out half the product.
 */

/**
 * Astryx renders nav items as `<a href>`; React Router navigates on `to`.
 * Without this adapter every sidebar click is a full document load, which
 * throws away the loader cache and blanks the page between routes.
 */
const RouterLink = ({
  href,
  ...rest
}: { href?: string } & Record<string, unknown>) => (
  <RRLink to={href ?? "#"} {...rest} />
);

/**
 * Eleven destinations, nine of them grouped by the job they do.
 *
 * The grouping is the point. A flat list of ten teaches nothing, and the four
 * headings happen to be an accurate summary of the product: it has two front
 * doors, it makes decisions you approve, it keeps one memory, and it writes
 * down everything it did. A merchant who reads only the sidebar has still
 * learned the shape of the thing.
 */
const NAV: Array<{
  group: string;
  links: Array<{ to: string; label: string }>;
}> = [
  {
    group: "Front doors",
    links: [
      { to: "/dashboard/chatbot", label: "Assistant" },
      { to: "/dashboard/agentfront", label: "Agent front" },
    ],
  },
  {
    group: "Decisions",
    links: [
      { to: "/dashboard/offers", label: "Offers" },
      { to: "/dashboard/recovery", label: "Recovery" },
    ],
  },
  {
    group: "What it knows",
    links: [
      { to: "/dashboard/cortex", label: "Shop cortex" },
      { to: "/dashboard/memory", label: "Shopper memory" },
      { to: "/dashboard/analyst", label: "Analyst" },
    ],
  },
  {
    group: "The record",
    links: [
      { to: "/dashboard/ledger", label: "Decision ledger" },
      { to: "/dashboard/testbench", label: "Test bench" },
    ],
  },
];

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const { merchant, site } = useLoaderData<typeof loader>();

  return (
    <Theme theme={matchaTheme} mode="light">
      <LinkProvider component={RouterLink}>
        <AppShell
          height="auto"
          contentPadding={0}
          variant="section"
          sideNav={
            <SideNav
              aria-label="Console"
              header={
                <SideNavHeading
                  heading="CHAPMAN"
                  headingHref="/dashboard"
                  subheading={site?.name ?? undefined}
                />
              }
              footer={
                <HStack gap={2} vAlign="center" hAlign="between">
                  <Text type="supporting" color="secondary">
                    {merchant.email}
                  </Text>
                  {/* A form, not a link: sign-out changes state, so it is a POST. */}
                  <Form method="post" action="/logout">
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      label="Sign out"
                    />
                  </Form>
                </HStack>
              }
            >
              <SideNavItem
                as={RouterLink}
                href="/dashboard"
                label="Overview"
                isSelected={pathname === "/dashboard"}
              />
              {!site ? (
                <SideNavItem
                  as={RouterLink}
                  href="/dashboard/setup"
                  label="Configure storefront"
                  isSelected={pathname === "/dashboard/setup"}
                />
              ) : (
                <>
                  {/* Outside the groups on purpose: this configures an existing
                    install rather than registering a new storefront. */}
                  <SideNavItem
                    as={RouterLink}
                    href="/dashboard/features"
                    label="Feature controls"
                    isSelected={pathname === "/dashboard/features"}
                  />
                  {NAV.map((g) => (
                    <SideNavSection key={g.group} title={g.group}>
                      {g.links.map((l) => (
                        <SideNavItem
                          key={l.to}
                          as={RouterLink}
                          href={l.to}
                          label={l.label}
                          isSelected={pathname === l.to}
                        />
                      ))}
                    </SideNavSection>
                  ))}
                </>
              )}
            </SideNav>
          }
        >
          {/* `key` remounts on navigation so page-level state never leaks
            between routes. */}
          <div key={pathname}>
            <Outlet />
          </div>
        </AppShell>
      </LinkProvider>
    </Theme>
  );
}
