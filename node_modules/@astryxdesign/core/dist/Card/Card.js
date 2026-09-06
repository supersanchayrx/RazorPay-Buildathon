// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file Card.tsx
 * @input Uses container utility, StyleX
 * @output Exports Card component, CardProps, CardVariant types
 * @position Core card container component
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Card/Card.doc.mjs (props table, features)
 * - /packages/core/src/Card/index.ts (exports if types change)
 * - /apps/storybook/stories/Card.stories.tsx (storybook stories)
 * - /packages/cli/assets/templates/blocks/components/Card/ (showcase blocks)
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { borderVars, colorVars, radiusVars, shadowVars } from "../theme/tokens.stylex.js";
import { container } from "../Layout/container.stylex.js";
import { spacingStepToToken } from "../Layout/padding.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

// =============================================================================
// Variant type
// =============================================================================

/**
 * Background color variant for Card, derived from CardVariantMap.
 * Extensible via module augmentation of CardVariantMap.
 *
 * - `default`: standard card background with visible border
 * - `transparent`: no background, no visible border — for grouping content without visual weight
 * - `muted`: subtle muted background for de-emphasised cards
 * - Non-semantic palette: `blue | cyan | gray | green | orange | pink | purple | red | teal | yellow`
 *   Each uses the corresponding `--color-background-<name>` token (20% opacity tint).
 *
 * Only `default` draws a visible border. Its border width is subtracted from
 * the padding so the total inset (border + padding) equals the padding token —
 * keeping content geometry faithful to the spacing scale and identical to the
 * borderless variants. Themes can override borderWidth/borderColor.
 */
import { jsx as _jsx } from "react/jsx-runtime";
// =============================================================================
// Styles
// =============================================================================

const styles = {
  card: {
    "--_card-radius": "x2kkz0m",
    kaIpWk: "x153u1i6",
    kVQacm: "x7giv3",
    kGVxlE: "x1p8z4y0",
    $$css: true
  },
  withBorder: {
    kMzoRj: "x1litavf",
    ksu8eU: "x1y0btm7",
    kVAM5u: "x14i3s5s",
    kZCmMZ: "xs19ii7",
    kwRFfy: "x12frdag",
    kLKAdn: "x1nex4ik",
    kGO01o: "xbv1mwh",
    $$css: true
  },
  scrollable: {
    kVQacm: "xysyzu8",
    $$css: true
  }
};

// Background variant styles — each maps to a design token. Typed as PARTIAL
// over CardVariant: a theme can add a variant, and the record deliberately has
// no entry for it, so the lookup is undefined, StyleX drops it, and the card
// takes base styles for the theme rule to paint over.
const variantStyles = {
  default: {
    kWkggS: "x1de1mus",
    $$css: true
  },
  transparent: {
    kWkggS: "xjbqb8w",
    $$css: true
  },
  muted: {
    kWkggS: "xwmxj5m",
    $$css: true
  },
  blue: {
    kWkggS: "x1o0wnni",
    $$css: true
  },
  cyan: {
    kWkggS: "x1rgj867",
    $$css: true
  },
  gray: {
    kWkggS: "xspzpui",
    $$css: true
  },
  green: {
    kWkggS: "x1sqjeoo",
    $$css: true
  },
  orange: {
    kWkggS: "x1e9xt6e",
    $$css: true
  },
  pink: {
    kWkggS: "xnpoty2",
    $$css: true
  },
  purple: {
    kWkggS: "x16i6n6f",
    $$css: true
  },
  red: {
    kWkggS: "x1cibrc5",
    $$css: true
  },
  teal: {
    kWkggS: "x1jtji5o",
    $$css: true
  },
  yellow: {
    kWkggS: "x1bo7t0x",
    $$css: true
  }
};

// Elevation → shadow-token map. Sets the private --_card-elevation variable
// (not box-shadow directly) so it composes with --_card-ring in the shadow
// list above — a selection ring and a resting elevation coexist without one
// overwriting the other. 'none' is a transparent no-op (not the CSS literal
// `none`, which would be invalid inside the comma-separated shadow list).
const elevationStyles = {
  none: {
    "--_card-elevation": "xw28qpl",
    $$css: true
  },
  low: {
    "--_card-elevation": "x1nn8khe",
    $$css: true
  },
  med: {
    "--_card-elevation": "x1ovzxg0",
    $$css: true
  },
  high: {
    "--_card-elevation": "xnpe7fx",
    $$css: true
  }
};

// Dynamic styles for sizing props
const dynamicStyles = {
  sizing: (width, height, maxWidth, minHeight) => [{
    kzqmXN: width != null ? "x5lhr3w" : width,
    kZKoxP: height != null ? "x16ye13r" : height,
    ks0D6T: maxWidth != null ? "xf68679" : maxWidth,
    kAzted: minHeight != null ? "x82snj4" : minHeight,
    $$css: true
  }, {
    "--x-width": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(width),
    "--x-height": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(height),
    "--x-maxWidth": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(maxWidth),
    "--x-minHeight": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(minHeight)
  }]
};
/**
 * A card container with border and themed styling.
 *
 * Applies card-specific appearance (background, border, border-radius)
 * and sets CSS variables for child layout components.
 *
 * @compositionHint Use as a top-level container for elevated content.
 * Pair with Layout for structured header/content/footer layouts.
 *
 * @example
 * ```
 * <Card width={400} height={300}>
 *   <Layout
 *     header={<LayoutHeader hasDivider>Title</LayoutHeader>}
 *     content={<LayoutContent>Content</LayoutContent>}
 *     footer={<LayoutFooter hasDivider>Actions</LayoutFooter>}
 *   />
 * </Card>
 * ```
 *
 * @example
 * ```
 * <Card variant="blue" width={300}>
 *   <p>Blue tinted card</p>
 * </Card>
 * ```
 *
 * @example
 * ```
 * <Card variant="muted" width={300}>
 *   <p>Subtle de-emphasised card</p>
 * </Card>
 * ```
 */
export function Card({
  width,
  height,
  maxWidth,
  minHeight,
  children,
  padding,
  variant = 'default',
  elevation = 'none',
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  // Only enable scrolling when card has a fixed height (not null/undefined and not "auto")
  const hasFixedHeight = height != null && height !== 'auto';

  // When no explicit padding prop, use theme default (set via container tokens)
  const useThemeDefault = padding == null;
  const paddingToken = useThemeDefault ? undefined : spacingStepToToken[padding];
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    ...mergeProps(themeProps('card', {
      variant,
      elevation
    }), stylex.props(styles.card,
    // A theme's own variant is not a key here: the lookup is undefined,
    // StyleX drops it, and the theme rule paints over base styles.
    variantStyles[variant], elevationStyles[elevation], hasFixedHeight && styles.scrollable, dynamicStyles.sizing(width ?? null, height ?? null, maxWidth ?? null, minHeight ?? null), ...container(paddingToken == null ? {
      useThemeDefault: 'card'
    } : {
      paddingInnerX: paddingToken,
      paddingInnerY: paddingToken,
      paddingOuterX: paddingToken,
      paddingOuterY: paddingToken
    }),
    // Applied after the container padding so the border-inset calc wins;
    // it reads the --container-padding-* vars set above.
    variant === 'default' && styles.withBorder, xstyle), className, style),
    ...props,
    children: children
  });
}
Card.displayName = 'Card';