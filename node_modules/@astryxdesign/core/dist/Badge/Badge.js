// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file Badge.tsx
 * @input Uses React, HTMLAttributes
 * @output Exports Badge component, BadgeProps, BadgeVariant types
 * @position Core implementation; consumed by index.ts
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Badge/Badge.doc.mjs (props table, features, implementation notes)
 * - /packages/core/src/Badge/Badge.test.tsx (tests for new/changed behavior)
 * - /packages/core/src/Badge/index.ts (exports if types change)
 * - /apps/storybook/stories/Badge.stories.tsx (storybook stories)
 * - /packages/cli/assets/templates/blocks/components/Badge/ (showcase blocks)
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, radiusVars, fontWeightVars, typeScaleVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Base badge styles
 */
const styles = {
  base: {
    k1xSpc: "x3nfvp2",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kOIVth: "xzye2dw",
    kZKoxP: "x1grt7ep",
    k8WAf4: "xt970qd",
    kg3NbH: "xf314gf",
    kaIpWk: "xjspbzw",
    kMv6JI: "xjb2p0i",
    kGuDYH: "x141an7d",
    kLWn49: "x1ltkj2j",
    k63SB2: "x1e4wzip",
    khDVqt: "xuxw1ft",
    ks0D6T: "x193iq5w",
    k7Eaqz: "xeuugli",
    $$css: true
  }
};

/**
 * Variant styles for different badge appearances.
 * Semantic variants use solid backgrounds; non-semantic use tinted backgrounds.
 */
const variants = {
  neutral: {
    kWkggS: "x17x4s8c",
    kMwMTN: "x1tgivj0",
    $$css: true
  },
  info: {
    kWkggS: "x1ewilqj",
    kMwMTN: "x17wrial",
    $$css: true
  },
  success: {
    kWkggS: "xdsz4j9",
    kMwMTN: "xri61p4",
    $$css: true
  },
  warning: {
    kWkggS: "x1q8g9m5",
    kMwMTN: "xrebv38",
    $$css: true
  },
  error: {
    kWkggS: "x1pjz0fi",
    kMwMTN: "x1m024r3",
    $$css: true
  },
  blue: {
    kWkggS: "x1o0wnni",
    kMwMTN: "x1vvqiwl",
    $$css: true
  },
  cyan: {
    kWkggS: "x1rgj867",
    kMwMTN: "x1txnczv",
    $$css: true
  },
  green: {
    kWkggS: "x1sqjeoo",
    kMwMTN: "xltfdvo",
    $$css: true
  },
  orange: {
    kWkggS: "x1e9xt6e",
    kMwMTN: "xm47u9q",
    $$css: true
  },
  pink: {
    kWkggS: "xnpoty2",
    kMwMTN: "xiuofww",
    $$css: true
  },
  purple: {
    kWkggS: "x16i6n6f",
    kMwMTN: "x1m9wyeb",
    $$css: true
  },
  red: {
    kWkggS: "x1cibrc5",
    kMwMTN: "x1joocv1",
    $$css: true
  },
  teal: {
    kWkggS: "x1jtji5o",
    kMwMTN: "x9x0lbs",
    $$css: true
  },
  yellow: {
    kWkggS: "x1bo7t0x",
    kMwMTN: "xdhq94a",
    $$css: true
  }
};

/**
 * Badge variant type derived from BadgeVariantMap.
 * Extensible via module augmentation of BadgeVariantMap.
 */

/**
 * A badge component for displaying status indicators, counts, or labels.
 *
 * Styles use Astryx theme tokens via StyleX.
 * Wrap your app in <Theme> to apply a theme.
 *
 * @example
 * ```
 * <Badge label="Active" />
 * <Badge variant="success" label="Active" />
 * <Badge variant="error" label="3" />
 * <Badge variant="purple" label="Engineering" />
 * ```
 */
export function Badge({
  variant = 'neutral',
  label,
  icon,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  // Clipping a label makes its tail unrecoverable, so the full text has to
  // stay reachable somewhere. `title` is the half of that answer which costs
  // nothing: no measurement, no hook, so `Badge` renders the same on the
  // server and stays usable in a server component. It follows the shape
  // `BaseTable` already uses for a truncated header cell (BaseTable.tsx) —
  // string content only, and only when there is something to show.
  //
  // A rich label is left alone: it is a subtree whose text would have to be
  // flattened to a string, and flattening renders a guess — an icon, a
  // `<strong>`, a nested element all read differently.
  //
  // It is set whether or not the label actually fits, because knowing that
  // requires measuring. The refinement — a tooltip only when the text is
  // really cut, reachable by hover and by focus — needs that measurement and
  // a client component, so it is tracked in #5585.
  const labelTitle = typeof label === 'number' ? String(label) : typeof label === 'string' && label.length > 0 ? label : undefined;
  return /*#__PURE__*/_jsxs("span", {
    ref: ref,
    ...mergeProps(themeProps('badge', {
      variant
    }), stylex.props(styles.base, variants[variant], xstyle), className, style),
    title: labelTitle,
    ...props,
    children: [icon, /*#__PURE__*/_jsx("span", {
      ...{
        className: "xb3r6kr xlyipyv xeuugli"
      },
      children: label
    })]
  });
}
Badge.displayName = 'Badge';