// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file LayoutFooter.tsx
 * @input Uses React StyleX
 * @output Exports LayoutFooter component and LayoutFooterProps
 * @position Bottom bar / footer area for Layout. Use for action bars,
 *   pagination, status bars, or any fixed-height content at the bottom of a layout.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Layout/Layout.doc.mjs
 * - /apps/storybook/stories/Layout.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Layout/ (showcase blocks)
 */
import { use } from 'react';
import * as stylex from '@stylexjs/stylex';
import { LayoutDividerContext } from "./LayoutDividerContext.js";
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { paddingStyles, containerPaddingInlineVarStyles, containerPaddingBlockStartVarStyles, containerPaddingBlockEndVarStyles } from "./padding.stylex.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  footer: {
    kmuXW: "x2lah0s",
    $$css: true
  },
  inner: {
    kB7OPa: "x9f619",
    ks0D6T: "xjl2t3p",
    kUOVxO: "xvueqy4",
    kZCmMZ: "x139j0dd",
    kwRFfy: "xpc6k2p",
    kLKAdn: "xqty4a",
    kGO01o: "xon7vh3",
    "--container-padding-inline-start": "xdvaxxn",
    "--container-padding-inline-end": "xqpvj4r",
    "--container-padding-block-start": "xjmgx01",
    "--container-padding-block-end": "x1xjq73n",
    $$css: true
  },
  fullBleed: {
    kZCmMZ: "x1c1uobl",
    kwRFfy: "xyri2b",
    kLKAdn: "xexx8yu",
    kGO01o: "x18d9i69",
    "--container-padding-inline-start": "xrhngw9",
    "--container-padding-inline-end": "xjsfl84",
    "--container-padding-block-start": "x1047aw6",
    "--container-padding-block-end": "xax9j7h",
    $$css: true
  },
  divider: {
    kEafiO: "x178xt8z",
    kPef9Z: "x13fuv20",
    kLZC3w: "x1pc3f07",
    $$css: true
  }
};

// Dynamic styles for sizing props
const dynamicStyles = {
  sizing: height => [{
    kZKoxP: height != null ? "x16ye13r" : height,
    $$css: true
  }, {
    "--x-height": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(height)
  }]
};
/**
 * Bottom bar / footer for Layout. Use for action bars, pagination, or status bars.
 * Renders in the footer slot with optional divider and padding control.
 *
 * Already provides its own padding — don't add padding to children.
 * Use `padding={0}` if your content manages its own padding.
 *
 * @example
 * ```
 * <LayoutContainer variant="card">
 *   <Layout
 *     content={<LayoutContent>...</LayoutContent>}
 *     footer={<LayoutFooter hasDivider>Actions</LayoutFooter>}
 *   />
 * </LayoutContainer>
 * ```
 */
export function LayoutFooter({
  children,
  hasDivider,
  height,
  label,
  padding,
  role,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  const dividerCtx = use(LayoutDividerContext);
  const resolvedHasDivider = hasDivider ?? dividerCtx?.defaultHasDividers ?? false;
  const isZeroPadding = padding === 0;
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    role: role,
    "aria-label": label,
    "data-divider": resolvedHasDivider || undefined,
    ...mergeProps(themeProps('layout-footer'), stylex.props(styles.footer, dynamicStyles.sizing(height ?? null), resolvedHasDivider && styles.divider, xstyle), className, style),
    ...props,
    children: /*#__PURE__*/_jsx("div", {
      ...stylex.props(styles.inner, isZeroPadding && styles.fullBleed, padding != null && paddingStyles[padding], padding != null && containerPaddingInlineVarStyles[padding], padding != null && containerPaddingBlockStartVarStyles[padding], padding != null && containerPaddingBlockEndVarStyles[padding]),
      children: children
    })
  });
}
LayoutFooter.displayName = 'LayoutFooter';