// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TopNavItem.tsx
 * @input Uses React, ReactNode, BaseProps, LinkComponentType
 * @output Exports TopNavItem component and TopNavItemProps
 * @position Navigation item component for TopNav startContent
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
import { colorVars, spacingVars, radiusVars, durationVars, easeVars, fontWeightVars, typeScaleVars } from "../theme/tokens.stylex.js";
import { useLinkComponent } from "../Link/useLinkComponent.js";
import { useTopNavRenderMode } from "./TopNavRenderContext.js";
import { navItemStyles } from "../NavItem/navItemStyles.stylex.js";
import { mergeProps } from "../utils/index.js";
import { useAppShellMobile } from "../AppShell/AppShellMobileContext.js";
import { themeProps } from "../utils/themeProps.js";
import { focusOutlineProps } from "../utils/focusOutline.stylex.js";
import { interactionOverlayStyles } from "../utils/interactionOverlay.stylex.js";

/**
 * NavItem styles with hover/selected states
 */
import { jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  base: {
    k1xSpc: "x3nfvp2",
    kGNEyG: "x6s0dn4",
    kOIVth: "x1txdalj",
    k8WAf4: "x1vofgu7",
    kg3NbH: "xrrkdod",
    kaIpWk: "xh6dtrn",
    kGuDYH: "xcr08ib",
    kLWn49: "x1kq96og",
    k63SB2: "x1e4wzip",
    kMwMTN: "xv1l7n4",
    kybGjl: "x1hl2dhg",
    kkrTdU: "x1ypdohk x16khyan",
    k1ekBW: "xs2xxs2",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    $$css: true
  },
  selected: {
    kMwMTN: "x1tgivj0",
    k63SB2: "x2mo6ok",
    kWkggS: "x17x4s8c xcu6dpe xjtnuge",
    $$css: true
  },
  iconOnly: {
    kg3NbH: "xf314gf",
    $$css: true
  }
};
/**
 * Click handler for disabled items. The disabled anchor renders without an
 * href, so there is no navigation to block in practice; preventDefault is a
 * defensive guard against synthetic/programmatic clicks.
 */
function preventDefaultClick(event) {
  event.preventDefault();
}

/**
 * A navigation item for use within TopNav startContent.
 *
 * Renders as an anchor element with hover/selected states.
 * Supports icons and selected state indication with highlighted appearance.
 *
 * @example
 * ```
 * <TopNav
 *   startContent={
 *     <>
 *       <TopNavItem label="Home" href="/" isSelected />
 *       <TopNavItem label="Products" href="/products" />
 *       <TopNavItem label="Settings" href="/settings" icon={<GearIcon />} isIconOnly />
 *     </>
 *   }
 * />
 * ```
 */
export function TopNavItem({
  as,
  href,
  target,
  onClick,
  label,
  isSelected = false,
  isDisabled = false,
  isIconOnly = false,
  icon,
  children,
  size = 'md',
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  const LinkComponent = useLinkComponent(as);
  const renderMode = useTopNavRenderMode();
  const {
    closeMobileNav
  } = useAppShellMobile();

  // A disabled item renders as a plain <a> with no href: an href-less anchor
  // is not focusable and exposes no link affordance, so programmatic focus +
  // Enter, AT activation commands, and middle-click cannot navigate or fire
  // the consumer onClick. The router LinkComponent is deliberately skipped —
  // a disabled item performs no navigation, and custom router links may
  // require a live href. target is omitted with the href. (Mirrors the
  // disabled paths of Link and SideNavItem.)
  const Root = isDisabled ? 'a' : LinkComponent;

  // =========================================================================
  // Drawer mode — render as a SideNavItem-style vertical list element
  // =========================================================================
  if (renderMode === 'drawer') {
    const handleDrawerClick = e => {
      if (isDisabled) {
        preventDefaultClick(e);
        return;
      }
      // Forward the original onClick if present
      onClick?.(e);
      closeMobileNav();
    };
    return /*#__PURE__*/_jsxs(Root, {
      ref: ref,
      href: isDisabled ? undefined : href,
      target: isDisabled ? undefined : target,
      "aria-label": isIconOnly ? label : undefined,
      "aria-current": isSelected ? 'page' : undefined,
      "aria-disabled": isDisabled || undefined,
      tabIndex: isDisabled ? -1 : undefined,
      ...mergeProps(themeProps('top-nav-item', {
        mode: 'drawer',
        selected: isSelected ? 'selected' : null
      }), focusOutlineProps.focusVisible(navItemStyles.item, interactionOverlayStyles.backgroundColor, navItemStyles[size], isSelected && navItemStyles.selected, isDisabled && navItemStyles.disabled, xstyle), className, style),
      ...props,
      onClick: handleDrawerClick,
      children: [icon, !isIconOnly && (children ?? label)]
    });
  }

  // =========================================================================
  // Default / mobile-bar mode — standard horizontal nav item
  // =========================================================================

  return /*#__PURE__*/_jsxs(Root, {
    ref: ref,
    href: isDisabled ? undefined : href,
    target: isDisabled ? undefined : target,
    onClick: isDisabled ? preventDefaultClick : onClick,
    "aria-label": isIconOnly ? label : undefined,
    "aria-current": isSelected ? 'page' : undefined,
    "aria-disabled": isDisabled || undefined,
    tabIndex: isDisabled ? -1 : undefined,
    ...mergeProps(themeProps('top-nav-item', {
      selected: isSelected ? 'selected' : null
    }), focusOutlineProps.focusVisible(styles.base, interactionOverlayStyles.backgroundColor, isSelected && styles.selected, isDisabled && navItemStyles.disabled, isIconOnly && styles.iconOnly, xstyle), className, style),
    ...props,
    children: [icon, !isIconOnly && (children ?? label)]
  });
}
TopNavItem.displayName = 'TopNavItem';