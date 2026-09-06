// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TopNav.tsx
 * @input Uses React, ReactNode
 * @output Exports TopNav component and TopNavProps
 * @position Core implementation; consumed by index.ts
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/TopNav/TopNav.doc.mjs
 * - /packages/core/src/TopNav/TopNav.test.tsx
 * - /packages/core/src/TopNav/index.ts
 * - /apps/storybook/stories/TopNav.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/TopNav/ (showcase blocks)
 */
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { useTranslator } from "../i18n/index.js";
import { TopNavSlotContext } from "./TopNavContext.js";
import { useTopNavRenderMode } from "./TopNavRenderContext.js";
import { useTopNavMobileContent } from "./TopNavMobileContentContext.js";
import { Divider } from "../Divider/Divider.js";
import { MobileNav } from "../MobileNav/MobileNav.js";
import { MobileNavToggle } from "../MobileNav/MobileNavToggle.js";
import { useAppShellMobile } from "../AppShell/AppShellMobileContext.js";
import { themeProps } from "../utils/themeProps.js";

/**
 * Base TopNav styles
 */
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  base: {
    kGNEyG: "x6s0dn4",
    kzqmXN: "xh8yej3",
    kmVPX3: "xlsj2fj",
    kB7OPa: "x9f619",
    $$css: true
  },
  baseFlex: {
    k1xSpc: "x78zum5",
    $$css: true
  },
  baseGrid: {
    k1xSpc: "xrvj5dj",
    kumcoG: "x134kloy",
    $$css: true
  },
  mobileBar: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kzqmXN: "xh8yej3",
    kmVPX3: "xlsj2fj",
    kB7OPa: "x9f619",
    $$css: true
  },
  drawerDivider: {
    kqGvvJ: "x1g06x3t",
    $$css: true
  }
};
/**
 * Top navigation bar for application headers.
 *
 * Slot-based layout with `heading`, `startContent`, `centerContent`, and
 * `endContent`. `children` are accepted as an alias for `startContent`
 * so navigation items do not silently disappear when using the common
 * React children pattern. When `centerContent` is provided, the layout switches
 * to a three-column CSS grid to keep center content horizontally centered.
 *
 * @example
 * ```
 * <TopNav
 *   label="Main navigation"
 *   heading={<TopNavHeading heading="My App" />}
 *   startContent={<TopNavItem label="Home" href="/" isSelected />}
 *   endContent={<Button label="Search" variant="ghost" />}
 * />
 * ```
 */
export function TopNav({
  heading,
  startContent,
  children,
  centerContent,
  endContent,
  label: labelFromProps,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  const t = useTranslator();
  const label = labelFromProps ?? t('@astryx.topNav.landmarkLabel');
  const renderMode = useTopNavRenderMode();
  const mobileContent = useTopNavMobileContent();
  const {
    hasAutoToggle
  } = useAppShellMobile();
  const resolvedStartContent = startContent ?? children;
  const hasCenterContent = centerContent != null;
  const hasCollapsibleContent = resolvedStartContent != null || centerContent != null;
  // Show mobile toggle when there's ANY drawer content — own items OR SideNav via context
  const hasMobileDrawerContent = hasCollapsibleContent || mobileContent != null;

  // =========================================================================
  // Mobile bar mode — heading + endContent + toggle, hide nav items.
  // Falls through to default when there's no drawer content — no reason
  // to strip down the TopNav if there's nothing to put in the drawer.
  // =========================================================================
  if (renderMode === 'mobile-bar') {
    return /*#__PURE__*/_jsxs("nav", {
      ref: ref,
      role: "navigation",
      "aria-label": label,
      ...mergeProps(themeProps('top-nav', {
        mode: 'mobile-bar'
      }), stylex.props(styles.mobileBar, xstyle), className, style),
      ...props,
      children: [heading && /*#__PURE__*/_jsx("div", {
        ...{
          className: "x78zum5 x6s0dn4 x2lah0s"
        },
        children: heading
      }), /*#__PURE__*/_jsxs("div", {
        ...{
          className: "x78zum5 x6s0dn4 xzye2dw xvc5jky"
        },
        children: [endContent, hasMobileDrawerContent && hasAutoToggle && /*#__PURE__*/_jsx(MobileNavToggle, {})]
      })]
    });
  }

  // =========================================================================
  // Drawer mode — render nav items vertically inside a MobileNav,
  // plus any additional content passed via context (e.g. SideNav items)
  // =========================================================================
  if (renderMode === 'drawer') {
    // Only render if there are collapsible items or extra content
    if (!hasCollapsibleContent && !mobileContent) {
      return null;
    }
    return /*#__PURE__*/_jsxs(MobileNav, {
      header: heading,
      children: [hasCollapsibleContent && /*#__PURE__*/_jsxs("div", {
        ...{
          className: "x78zum5 xdt5ytf x1lsbc85"
        },
        children: [resolvedStartContent, centerContent]
      }), hasCollapsibleContent && mobileContent && /*#__PURE__*/_jsx(Divider, {
        xstyle: styles.drawerDivider
      }), mobileContent && /*#__PURE__*/_jsx("div", {
        ...{},
        children: mobileContent
      })]
    });
  }

  // =========================================================================
  // Default mode — full top bar
  // =========================================================================

  return /*#__PURE__*/_jsxs("nav", {
    ref: ref,
    role: "navigation",
    "aria-label": label,
    ...mergeProps(themeProps('top-nav'), stylex.props(styles.base, hasCenterContent ? styles.baseGrid : styles.baseFlex, xstyle), className, style),
    ...props,
    children: [/*#__PURE__*/_jsxs("div", {
      ...{
        className: "x78zum5 x6s0dn4 x18g69wz x845mor xeuugli"
      },
      children: [heading && /*#__PURE__*/_jsx("div", {
        ...{
          className: "x78zum5 x6s0dn4 x2lah0s"
        },
        children: heading
      }), resolvedStartContent && /*#__PURE__*/_jsx(TopNavSlotContext, {
        value: "start",
        children: /*#__PURE__*/_jsx("div", {
          ...{
            className: "x78zum5 x6s0dn4 xzye2dw"
          },
          children: resolvedStartContent
        })
      })]
    }), hasCenterContent && /*#__PURE__*/_jsx(TopNavSlotContext, {
      value: "center",
      children: /*#__PURE__*/_jsx("div", {
        ...{
          className: "x78zum5 x6s0dn4 xl56j7k xzye2dw"
        },
        children: centerContent
      })
    }), hasCenterContent ? /*#__PURE__*/_jsx("div", {
      ...{
        className: "x78zum5 x6s0dn4 x13a6bvl xzye2dw"
      },
      children: /*#__PURE__*/_jsx(TopNavSlotContext, {
        value: "end",
        children: endContent
      })
    }) : endContent && /*#__PURE__*/_jsx("div", {
      ...{
        className: "x78zum5 x6s0dn4 xzye2dw x2lah0s xvc5jky"
      },
      children: /*#__PURE__*/_jsx(TopNavSlotContext, {
        value: "end",
        children: endContent
      })
    })]
  });
}
TopNav.displayName = 'TopNav';