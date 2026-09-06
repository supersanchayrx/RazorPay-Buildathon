// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file Section.tsx
 * @input Uses container utility, StyleX
 * @output Exports Section component and SectionProps
 * @position Core section container component
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Section/Section.doc.mjs (props table, features)
 * - /packages/core/src/Section/index.ts (exports if types change)
 * - /apps/storybook/stories/Section.stories.tsx (storybook stories)
 * - /packages/cli/assets/templates/blocks/components/Section/ (showcase blocks)
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars } from "../theme/tokens.stylex.js";
import { container } from "../Layout/container.stylex.js";
import { paddingStyles, paddingInlineStyles, paddingInlineStartStyles, paddingInlineEndStyles, paddingBlockStyles, paddingBlockStartStyles, paddingBlockEndStyles, containerPaddingInlineVarStyles, containerPaddingInlineStartVarStyles, containerPaddingInlineEndVarStyles, containerPaddingBlockStartVarStyles, containerPaddingBlockEndVarStyles, sectionPaddingPropagationStyles, spacingStepToToken } from "../Layout/padding.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

/**
 * Visual variant for the section.
 * Extensible via module augmentation of SectionVariantMap.
 */
import { jsx as _jsx } from "react/jsx-runtime";
const variantStyles = {
  section: {
    kWkggS: "x10xzikg",
    $$css: true
  },
  transparent: {
    kWkggS: "xjbqb8w",
    $$css: true
  },
  muted: {
    kWkggS: "xwmxj5m",
    $$css: true
  }
};

// Styles for escaping parent container padding when nested
const nestedStyles = {
  outer: {
    keTefX: "xojxgvx",
    k71WvV: "x1fcf3bl",
    keoZOQ: "xkibk3",
    k1K539: "xlayyun",
    $$css: true
  },
  inner: {
    "--container-padding-inline-start": "xrhngw9",
    "--container-padding-inline-end": "xjsfl84",
    "--container-padding-block-start": "x1047aw6",
    "--container-padding-block-end": "xax9j7h",
    kZKoxP: "x5yr21d",
    $$css: true
  }
};

// Divider styles for each side
const dividerStyles = {
  top: {
    kEafiO: "x178xt8z",
    kPef9Z: "x13fuv20",
    kLZC3w: "x1pc3f07",
    $$css: true
  },
  bottom: {
    kt9PQ7: "xso031l",
    kfdmCh: "x1q0q8m5",
    kL6WhQ: "xw8gpjh",
    $$css: true
  },
  start: {
    k2ei4v: "xpilrb4",
    kVhnKS: "x1t7ytsu",
    kGJrpR: "x1j92z86",
    $$css: true
  },
  end: {
    ke9TFa: "x1lun4ml",
    k8ry5P: "x18b5jzi",
    kBCPoo: "x1gejf6u",
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
 * A section container with background variants.
 *
 * Applies section-specific appearance based on the variant prop
 * and sets CSS variables for child layout components.
 *
 * @compositionHint Use inside Card to create visually distinct regions.
 * Sections automatically escape parent container padding for edge-to-edge fills.
 *
 * @example
 * ```
 * <Section variant="muted" width={300} height={250}>
 *   <Layout
 *     content={<LayoutContent>Content in muted section</LayoutContent>}
 *   />
 * </Section>
 * ```
 */
export function Section({
  variant = 'section',
  width,
  height,
  maxWidth,
  minHeight,
  children,
  dividers,
  padding,
  paddingInline,
  paddingInlineStart,
  paddingInlineEnd,
  paddingBlock,
  paddingBlockStart,
  paddingBlockEnd,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  // When no explicit padding prop, use theme default (set via container tokens)
  const useThemeDefault = padding == null;
  const effectivePadding = padding ?? 4;
  const paddingToken = spacingStepToToken[effectivePadding];
  const outerStylex = stylex.props(nestedStyles.outer, dynamicStyles.sizing(width ?? null, height ?? null, maxWidth ?? null, minHeight ?? null), xstyle);
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    className: [outerStylex.className, className].filter(Boolean).join(' ') || undefined,
    style: style && outerStylex.style ? {
      ...outerStylex.style,
      ...style
    } : style || outerStylex.style,
    ...props,
    children: /*#__PURE__*/_jsx("div", {
      ...mergeProps(themeProps('section', {
        variant
      }), stylex.props(nestedStyles.inner, ...container(useThemeDefault ? {
        useThemeDefault: 'section'
      } : {
        paddingInnerX: paddingToken,
        paddingInnerY: paddingToken,
        paddingOuterX: paddingToken,
        paddingOuterY: paddingToken
      }), !useThemeDefault && effectivePadding !== 4 && paddingStyles[effectivePadding], !useThemeDefault && effectivePadding !== 4 && containerPaddingInlineVarStyles[effectivePadding], !useThemeDefault && effectivePadding !== 4 && containerPaddingBlockStartVarStyles[effectivePadding], !useThemeDefault && effectivePadding !== 4 && containerPaddingBlockEndVarStyles[effectivePadding], !useThemeDefault && sectionPaddingPropagationStyles[effectivePadding], paddingInline != null && paddingInlineStyles[paddingInline], paddingInline != null && containerPaddingInlineVarStyles[paddingInline], paddingBlock != null && paddingBlockStyles[paddingBlock], paddingBlock != null && containerPaddingBlockStartVarStyles[paddingBlock], paddingBlock != null && containerPaddingBlockEndVarStyles[paddingBlock],
      // Per-edge overrides come last so they win over `paddingBlock`
      // and `padding` on their own edge. The matching container var is
      // updated alongside so bleed children (Table, Divider, nested
      // Section) compensate against the padding actually applied.
      paddingBlockStart != null && paddingBlockStartStyles[paddingBlockStart], paddingBlockStart != null && containerPaddingBlockStartVarStyles[paddingBlockStart], paddingBlockEnd != null && paddingBlockEndStyles[paddingBlockEnd], paddingBlockEnd != null && containerPaddingBlockEndVarStyles[paddingBlockEnd], paddingInlineStart != null && paddingInlineStartStyles[paddingInlineStart], paddingInlineStart != null && containerPaddingInlineStartVarStyles[paddingInlineStart], paddingInlineEnd != null && paddingInlineEndStyles[paddingInlineEnd], paddingInlineEnd != null && containerPaddingInlineEndVarStyles[paddingInlineEnd], variantStyles[variant], dividers?.includes('top') && dividerStyles.top, dividers?.includes('bottom') && dividerStyles.bottom, dividers?.includes('start') && dividerStyles.start, dividers?.includes('end') && dividerStyles.end)),
      children: children
    })
  });
}
Section.displayName = 'Section';