// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file LayoutPanel.tsx
 * @input Uses React StyleX, LayoutAreaContext, LayoutSlotsContext
 * @output Exports LayoutPanel component and LayoutPanelProps
 * @position Sidebar panel for Layout start/end slots. Use for navigation panels,
 *   settings sidebars, detail panels, or any fixed-width side content.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Layout/Layout.doc.mjs
 * - /apps/storybook/stories/Layout.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Layout/ (showcase blocks)
 */
import { use } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars } from "../theme/tokens.stylex.js";
import { LayoutAreaContext } from "./LayoutAreaContext.js";
import { LayoutSlotsContext } from "./LayoutSlotsContext.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { paddingStyles, containerPaddingInlineVarStyles, containerPaddingBlockStartVarStyles, containerPaddingBlockEndVarStyles } from "./padding.stylex.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  panel: {
    kB7OPa: "x9f619",
    kmuXW: "x2lah0s",
    kVQacm: "x7giv3",
    kZCmMZ: "xwjyata",
    kwRFfy: "x1peupej",
    kLKAdn: "xqty4a",
    kGO01o: "xg476vw",
    "--container-padding-inline-start": "x408pgh",
    "--container-padding-inline-end": "xikqloz",
    "--container-padding-block-start": "xjmgx01",
    "--container-padding-block-end": "xi9ns85",
    $$css: true
  },
  startPanel: {
    kZCmMZ: "x139j0dd",
    $$css: true
  },
  endPanel: {
    kwRFfy: "xpc6k2p",
    $$css: true
  },
  noHeader: {
    kLKAdn: "x81pis9",
    $$css: true
  },
  noFooter: {
    kGO01o: "xon7vh3",
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
  scrollable: {
    kVQacm: "xysyzu8",
    $$css: true
  },
  dividerEnd: {
    ke9TFa: "x1lun4ml",
    k8ry5P: "x18b5jzi",
    kBCPoo: "x1gejf6u",
    $$css: true
  },
  dividerStart: {
    k2ei4v: "xpilrb4",
    kVhnKS: "x1t7ytsu",
    kGJrpR: "x1j92z86",
    $$css: true
  },
  collapseStart: {
    keTefX: "x1wim8z0",
    $$css: true
  },
  collapseEnd: {
    k71WvV: "x1kpg4um",
    $$css: true
  }
};

// Dynamic styles for sizing props
const dynamicStyles = {
  sizing: width => [{
    kzqmXN: width != null ? "x5lhr3w" : width,
    $$css: true
  }, {
    "--x-width": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(width)
  }]
};
/**
 * Sidebar or side panel for Layout. Use in the `start` slot for left navigation
 * or in the `end` slot for detail/inspector panels.
 * Renders with optional divider and context-aware padding.
 * Divider position is auto-detected based on which slot the panel is in.
 *
 * Already provides its own padding and scroll — don't add padding or
 * overflow to children. Use `padding={0}` if you need edge-to-edge content.
 *
 * @example
 * ```
 * <LayoutContainer variant="card">
 *   <Layout
 *     start={
 *       <LayoutPanel hasDivider role="navigation">
 *         <Navigation />
 *       </LayoutPanel>
 *     }
 *     content={<LayoutContent>Main content</LayoutContent>}
 *     end={
 *       <LayoutPanel hasDivider role="complementary">
 *         <Sidebar />
 *       </LayoutPanel>
 *     }
 *   />
 * </LayoutContainer>
 * ```
 */
export function LayoutPanel({
  children,
  hasDivider = false,
  isScrollable = true,
  label,
  padding,
  role,
  width,
  resizable,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  const area = use(LayoutAreaContext);
  const {
    hasHeader,
    hasFooter
  } = use(LayoutSlotsContext);

  // When resizable props are provided, use the hook-driven size
  const effectiveWidth = resizable ? resizable._size : width;

  // Determine panel position
  const isStartPanel = area === 'start';
  const isEndPanel = area === 'end';
  const isZeroPadding = padding === 0;

  // When no divider, collapse spacing for seamless visual flow
  const shouldCollapseSpacing = !hasDivider && !isZeroPadding && padding == null;

  // Select divider style based on position
  const dividerStyle = isStartPanel ? styles.dividerEnd : isEndPanel ? styles.dividerStart : null;

  // Select collapse style based on position (collapse the side where divider would be)
  const collapseStyle = isStartPanel ? styles.collapseEnd : isEndPanel ? styles.collapseStart : null;
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    role: role,
    "aria-label": label,
    ...mergeProps(themeProps('layout-panel'), stylex.props(styles.panel, dynamicStyles.sizing(effectiveWidth ?? null),
    // Outer padding on container edges (unless component is full bleed)
    isStartPanel && !isZeroPadding && padding == null && styles.startPanel, isEndPanel && !isZeroPadding && padding == null && styles.endPanel, !hasHeader && !isZeroPadding && padding == null && styles.noHeader, !hasFooter && !isZeroPadding && padding == null && styles.noFooter, isScrollable && styles.scrollable, isZeroPadding && styles.fullBleed, padding != null && paddingStyles[padding], padding != null && containerPaddingInlineVarStyles[padding], padding != null && containerPaddingBlockStartVarStyles[padding], padding != null && containerPaddingBlockEndVarStyles[padding], hasDivider && dividerStyle, shouldCollapseSpacing && collapseStyle, xstyle), className, style),
    ...props,
    children: children
  });
}
LayoutPanel.displayName = 'LayoutPanel';