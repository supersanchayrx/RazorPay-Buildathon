/**
 * The console's page chrome, in one place.
 *
 * Ten pages were each inventing their own heading sizes, their own spacing and
 * their own idea of what a figure looks like. That is the difference between a
 * product and ten pages that happen to share a stylesheet, so the shell lives
 * here and the pages only supply content.
 *
 * Everything below is composed from Astryx primitives. There is no CSS file
 * behind it and no hardcoded colour — the handful of inline styles that remain
 * exist because Astryx has no prop for the thing (a hairline, a tabular-number
 * column) and each one resolves to a theme token, so the whole console still
 * turns with the theme.
 */
import type { ReactNode } from "react";
import { Link as RRLink } from "react-router";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

/** Mono, wide-tracked, small caps. The console's one recurring accent. */
export const MONO = "var(--font-family-code, ui-monospace, monospace)";

const EYEBROW = {
  fontFamily: MONO,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
} as const;

/**
 * The outer frame of every page.
 *
 * `maxWidth` is a measure, not a container: past about 1180px a line of prose
 * stops being readable, and the console is mostly prose and tables.
 */
export function Page({ children }: { children: ReactNode }) {
  return (
    <Section padding={6} maxWidth={1180}>
      <VStack gap={8}>{children}</VStack>
    </Section>
  );
}

/**
 * The head of a page: where you came from, what this is, and why it exists.
 *
 * The lede is capped at 68 characters of measure deliberately. A full-width
 * paragraph under a full-width heading reads as filler; a short column under a
 * long heading reads as an editorial decision.
 */
export function PageHead({
  back = { to: "/dashboard", label: "Overview" },
  title,
  lede,
  actions,
  children,
}: {
  back?: { to: string; label: string } | null;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <VStack gap={4}>
      {back ? (
        <Text type="code" size="2xs" color="secondary">
          <RRLink to={back.to} style={{ color: "inherit", textDecoration: "none" }}>
            ← {back.label}
          </RRLink>
        </Text>
      ) : null}
      <HStack gap={5} hAlign="between" vAlign="end" wrap="wrap">
        <VStack gap={2} maxWidth={760}>
          <Heading level={1}>{title}</Heading>
          {lede ? (
            <Text type="large" color="secondary">
              {lede}
            </Text>
          ) : null}
        </VStack>
        {actions ? <HStack gap={2}>{actions}</HStack> : null}
      </HStack>
      {children}
    </VStack>
  );
}

/**
 * A titled block of the page.
 *
 * The hairline under the heading is what makes a long page scannable — the eye
 * finds a rule faster than it finds a font-size change — and it is the reason
 * these pages can be dense without feeling like a dump.
 */
export function Block({
  title,
  hint,
  actions,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <VStack gap={4}>
      {title ? (
        <VStack gap={3}>
          <HStack gap={4} hAlign="between" vAlign="end" wrap="wrap">
            <Heading level={2}>{title}</Heading>
            {actions ? <HStack gap={2} vAlign="center">{actions}</HStack> : null}
          </HStack>
          {hint ? (
            <Text color="secondary" maxLines={3}>
              {hint}
            </Text>
          ) : null}
          <Divider />
        </VStack>
      ) : null}
      {children}
    </VStack>
  );
}

/**
 * A single number and what it counts.
 *
 * Tabular figures are not a nicety here: a column of counts that shifts width
 * as digits change reads as sloppy at exactly the moment you want it to read
 * as authoritative.
 */
export function Figure({
  value,
  label,
  tone,
  note,
}: {
  value: ReactNode;
  label: string;
  tone?: "accent" | "error" | "warning";
  note?: string;
}) {
  const color = tone === "accent" ? "accent" : "primary";
  /**
   * A number becomes a display heading; anything else is left alone.
   *
   * Some figures on this console are a status rather than a count, and wrapping
   * a Token in a 32px heading stretches its line box and pushes the label out
   * of alignment with the numeric figures beside it.
   */
  const scalar = typeof value === "string" || typeof value === "number";
  return (
    <VStack gap={1} minHeight={72}>
      {scalar ? (
        <Heading level={3} type="display-2" color={color}>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
        </Heading>
      ) : (
        <HStack vAlign="center" minHeight={40}>
          {value}
        </HStack>
      )}
      <Text type="supporting" color="secondary" style={EYEBROW} size="3xs">
        {label}
      </Text>
      {note ? (
        <Text type="supporting" color="disabled">
          {note}
        </Text>
      ) : null}
    </VStack>
  );
}

/**
 * Figures as one instrument panel rather than a row of cards.
 *
 * Four bordered cards in a row is the single most recognisable "generated
 * dashboard" shape there is. One surface divided by hairlines says the same
 * numbers belong to the same reading.
 */
export function Figures({ children }: { children: ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <Card padding={0}>
      <HStack align="stretch" wrap="wrap">
        {items.map((child, i) => (
          <HStack key={i} align="stretch">
            {i > 0 ? <Divider orientation="vertical" /> : null}
            <VStack padding={5} width={210}>
              {child}
            </VStack>
          </HStack>
        ))}
      </HStack>
    </Card>
  );
}

/** A quiet aside. Used for the caveat a page owes the reader, never for chrome. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <Card variant="muted">
      <Text type="supporting" color="secondary">
        {children}
      </Text>
    </Card>
  );
}

/**
 * Installation, folded away.
 *
 * A merchant sets a feature up once and then looks at it every week, so the
 * instructions were taking the top of the page from the thing they came to
 * read. Collapsed, they are one click away and never in the way again.
 */
export function Setup({
  title = "How to set up?",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <Collapsible trigger={<Text weight="semibold">{title}</Text>}>
        <VStack gap={4} paddingBlockStart={4}>
          {children}
        </VStack>
      </Collapsible>
    </Card>
  );
}

/** A small mono label. The console's section-within-a-card marker. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text type="code" size="3xs" color="secondary" style={EYEBROW}>
      {children}
    </Text>
  );
}

/**
 * The four feature states, mapped to Token colours once.
 *
 * Defined here rather than per page so "available" cannot mean green on one
 * screen and grey on the next.
 */
export const STATUS_TONE: Record<string, "green" | "yellow" | "blue" | "gray"> = {
  available: "green",
  needs_setup: "yellow",
  building: "blue",
  planned: "gray",
};

export function StatusToken({ status, label }: { status: string; label: string }) {
  return <Token size="sm" color={STATUS_TONE[status] ?? "gray"} label={label} />;
}

/** Responsive column set used wherever the page shows a grid of equals. */
export function Cards({ children, minWidth = 300 }: { children: ReactNode; minWidth?: number }) {
  return (
    <Grid columns={{ minWidth }} gap={4}>
      {children}
    </Grid>
  );
}
