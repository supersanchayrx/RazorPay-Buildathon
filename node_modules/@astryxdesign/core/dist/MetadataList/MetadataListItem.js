// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file MetadataListItem.tsx
 * @input Uses React, ReactNode, StyleXStyles, theme tokens, MetadataListContext
 * @output Exports MetadataListItem component, MetadataListItemProps type
 * @position Core implementation; consumed by MetadataList, index.ts
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/MetadataList/MetadataList.doc.mjs
 * - /packages/core/src/MetadataList/MetadataList.test.tsx
 * - /packages/core/src/MetadataList/index.ts
 * - /apps/storybook/stories/MetadataList.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/MetadataList/ (showcase blocks)
 */
import { use } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars, fontWeightVars } from "../theme/tokens.stylex.js";
import { MetadataListContext } from "./MetadataListContext.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

// =============================================================================
// Types
// =============================================================================
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// =============================================================================
// Styles
// =============================================================================

const styles = {
  label: {
    kMwMTN: "xv1l7n4",
    kGuDYH: "xjm74w1",
    kLWn49: "xw6l6zx",
    k63SB2: "x1e4wzip",
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kOIVth: "x1txdalj",
    kogj98: "x1ghz6dp",
    kmVPX3: "x1717udv",
    kAzted: "xjwf9q1",
    kTgw9: "x13faqbe",
    $$css: true
  },
  stackedWrapper: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    kOIVth: "x1lsbc85",
    $$css: true
  }
};

// =============================================================================
// Component
// =============================================================================

/**
 * A single labeled metadata value within an MetadataList.
 *
 * Renders a `<dt>` / `<dd>` pair. Layout (side-by-side or stacked) is
 * determined by the parent MetadataList's label configuration.
 *
 * @example
 * ```
 * <MetadataListItem label="Status">Active</MetadataListItem>
 * <MetadataListItem label="Created" icon={<CalendarIcon />}>
 *   January 1, 2023
 * </MetadataListItem>
 * ```
 */
export function MetadataListItem({
  children,
  icon,
  label,
  xstyle,
  className,
  style,
  'data-testid': testId,
  ref,
  ...rest
}) {
  const ctx = use(MetadataListContext);
  const labelPosition = ctx?.labelConfig.position ?? 'start';
  const isStacked = labelPosition === 'top' || ctx?.orientation === 'horizontal';
  const labelContent = /*#__PURE__*/_jsxs(_Fragment, {
    children: [icon != null && /*#__PURE__*/_jsx("span", {
      ...{
        className: "x3nfvp2 x6s0dn4 x2lah0s xv1l7n4"
      },
      children: icon
    }), label]
  });

  // Stacked layout: label above content, wrapped in a div
  if (isStacked) {
    return /*#__PURE__*/_jsxs("div", {
      ref: ref,
      "data-testid": testId,
      ...mergeProps(themeProps('metadata-list-item'), stylex.props(styles.stackedWrapper, xstyle), className, style),
      ...rest,
      children: [/*#__PURE__*/_jsx("dt", {
        ...{
          className: "xv1l7n4 xjm74w1 xw6l6zx x1e4wzip x78zum5 x6s0dn4 x1txdalj x1ghz6dp x1717udv"
        },
        children: labelContent
      }), /*#__PURE__*/_jsx("dd", {
        ...{
          className: "x1tgivj0 xjm74w1 xw6l6zx x1ghz6dp x1717udv x13faqbe"
        },
        children: children
      })]
    });
  }

  // Inline layout: dt and dd are direct grid children
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [/*#__PURE__*/_jsx("dt", {
      ref: ref,
      "data-testid": testId ? `${testId}-label` : undefined,
      ...mergeProps(themeProps('metadata-list-item'), stylex.props(styles.label, xstyle), className, style),
      ...rest,
      children: labelContent
    }), /*#__PURE__*/_jsx("dd", {
      "data-testid": testId ? `${testId}-value` : undefined,
      ...{
        className: "x1tgivj0 xjm74w1 xw6l6zx x1ghz6dp x1717udv xjwf9q1 x13faqbe"
      },
      children: children
    })]
  });
}
MetadataListItem.displayName = 'MetadataListItem';