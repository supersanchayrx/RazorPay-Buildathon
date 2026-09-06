// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file SideNavSection.tsx
 * @input Uses React, StyleX
 * @output Exports SideNavSection component and SideNavSectionProps
 * @position Core implementation; used inside SideNav children
 *
 * Section grouping for navigation items with optional title and end content.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/SideNav/SideNav.doc.mjs
 * - /packages/core/src/SideNav/SideNav.test.tsx
 * - /packages/core/src/SideNav/index.ts
 * - /apps/storybook/stories/SideNav.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/SideNav/ (showcase blocks)
 */
import React, { useId } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, fontWeightVars, typeScaleVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { useSideNavCollapse } from "./SideNavCollapseContext.js";
import { VisuallyHidden } from "../VisuallyHidden/index.js";
import { themeProps } from "../utils/themeProps.js";
// =============================================================================
// Styles
// =============================================================================
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
const styles = {
  root: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    k8WAf4: "xu0wf1k",
    $$css: true
  }
};

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Component
// =============================================================================

/**
 * Section grouping for SideNav items.
 *
 * Renders a labeled group of navigation items.
 * Uses `role="group"` with `aria-labelledby` for accessibility.
 *
 * @example
 * ```
 * <SideNavSection title="Main">
 *   <SideNavItem label="Dashboard" icon={HomeIcon} isSelected />
 *   <SideNavItem label="Projects" icon={FolderIcon} />
 * </SideNavSection>
 * ```
 */
export function SideNavSection({
  ref,
  title,
  subtitle,
  children,
  endContent,
  isHeaderHidden = false,
  xstyle,
  className,
  style,
  'data-testid': testId,
  ...rest
}) {
  const {
    isCollapsed
  } = useSideNavCollapse();
  const id = useId();
  const titleId = `${id}-title`;
  const headerContent = /*#__PURE__*/_jsxs(_Fragment, {
    children: [/*#__PURE__*/_jsxs("span", {
      ...{
        className: "x78zum5 xdt5ytf x98rzlu xeuugli"
      },
      children: [/*#__PURE__*/_jsx("span", {
        id: titleId,
        ...{
          className: "x141an7d x2mo6ok x1ltkj2j xv1l7n4 xb3r6kr xlyipyv xuxw1ft"
        },
        children: title
      }), subtitle && /*#__PURE__*/_jsx("span", {
        ...{
          className: "x141an7d x1ltkj2j xv1l7n4 xb3r6kr xlyipyv xuxw1ft"
        },
        children: subtitle
      })]
    }), endContent && /*#__PURE__*/_jsx("span", {
      ...{
        className: "x2lah0s x78zum5 x6s0dn4"
      },
      children: endContent
    })]
  });
  const shouldHideHeader = isHeaderHidden || isCollapsed;
  return /*#__PURE__*/_jsxs("div", {
    ref: ref,
    ...mergeProps(themeProps('side-nav-section'), stylex.props(styles.root, xstyle), className, style),
    ...rest,
    role: "group",
    "aria-labelledby": titleId,
    "data-testid": testId,
    children: [shouldHideHeader ? /*#__PURE__*/_jsx(VisuallyHidden, {
      as: "div",
      children: headerContent
    }) : /*#__PURE__*/_jsx("div", {
      ...{
        className: "x78zum5 x6s0dn4 x1txdalj xf314gf xu0wf1k xt0e3qv x87ps6o"
      },
      children: headerContent
    }), /*#__PURE__*/_jsx("div", {
      ...{
        className: "x78zum5 xdt5ytf x1lsbc85"
      },
      children: children
    })]
  });
}
SideNavSection.displayName = 'SideNavSection';