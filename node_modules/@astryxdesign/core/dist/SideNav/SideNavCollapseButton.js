// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file SideNavCollapseButton.tsx
 * @input Uses React, StyleX, SideNavCollapseContext, Icon
 * @output Exports SideNavCollapseButton component
 * @position Composable toggle button for sidenav collapse
 *
 * Place inside SideNav (reads context automatically) or outside
 * (pass the same controlled `collapsible` config both get).
 *
 * SYNC: When modified, update:
 * - /packages/core/src/SideNav/SideNav.doc.mjs
 * - /packages/core/src/SideNav/index.ts
 * - /packages/cli/assets/templates/blocks/components/SideNav/ (showcase blocks)
 */
import React, { useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { durationVars, easeVars } from "../theme/tokens.stylex.js";
import { Icon } from "../Icon/index.js";
import { Button } from "../Button/index.js";
import { composeEventHandlers, rtlStyles } from "../utils/index.js";
import { useSideNavCollapse } from "./SideNavCollapseContext.js";
import { useAppShellMobile } from "../AppShell/AppShellMobileContext.js";
import { useTranslator } from "../i18n/index.js";
import { jsx as _jsx } from "react/jsx-runtime";
// =============================================================================
// Styles
// =============================================================================

const styles = {
  chevronMirror: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    $$css: true
  },
  chevron: {
    k1xSpc: "x3nfvp2",
    kGNEyG: "x6s0dn4",
    k1ekBW: "x11xpdln",
    kIyJzY: "xuedmi6 x12w9bfk",
    kAMwcw: "xlr8y92",
    $$css: true
  },
  chevronCollapsed: {
    k3aq6I: "x19jd1h0",
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
 * Composable toggle button for sidenav collapse.
 *
 * Place anywhere inside SideNav (header, topContent, footer, footerIcons)
 * and it reads collapse state from context automatically. For placement
 * outside the sidenav (e.g. in TopNav or content area), hold the state and
 * hand the same `collapsible` config to both.
 *
 * @example
 * ```
 * <SideNav isCollapsible footerIcons={<SideNavCollapseButton />}>
 *   ...
 * </SideNav>
 * ```
 *
 * @example
 * ```
 * const [isCollapsed, setIsCollapsed] = useState(false);
 * const collapsible = {isCollapsed, onCollapsedChange: setIsCollapsed};
 * <TopNav endContent={<SideNavCollapseButton collapsible={collapsible} />} />
 * <SideNav collapsible={{...collapsible, hasButton: false}}>...</SideNav>
 * ```
 */
export function SideNavCollapseButton({
  ref,
  collapsible,
  handleRef,
  label,
  size,
  children,
  onClick: onClickProp,
  ...props
}) {
  const t = useTranslator();
  const {
    isCollapsed,
    toggle,
    isCollapsible
  } = useSideNavCollapseState(collapsible, handleRef);
  const {
    isMobile
  } = useAppShellMobile();

  // Hide when not collapsible, or when in mobile mode (sidenav is in
  // the mobile drawer — collapse doesn't apply there)
  if (!isCollapsible || isMobile) {
    return null;
  }
  return /*#__PURE__*/_jsx(Button, {
    ref: ref,
    label: label ?? (isCollapsed ? t('@astryx.sideNavCollapseButton.expandSidebar') : t('@astryx.sideNavCollapseButton.collapseSidebar')),
    variant: "ghost",
    size: size,
    ...props,
    onClick: composeEventHandlers(onClickProp, toggle),
    icon: children ??
    /*#__PURE__*/
    // The RTL mirror stays on its own element, wrapping (not merged
    // into) the state rotation: both are `transform`, so on a single
    // element one would overwrite the other and the chevron would stop
    // mirroring under RTL. See utils/rtlStyles.ts.
    _jsx("span", {
      ...stylex.props(styles.chevronMirror, rtlStyles.mirror),
      children: /*#__PURE__*/_jsx(Icon, {
        icon: "chevronLeft",
        size: "sm",
        color: "inherit",
        xstyle: [styles.chevron, isCollapsed && styles.chevronCollapsed]
      })
    }),
    isIconOnly: true
  });
}
SideNavCollapseButton.displayName = 'SideNavCollapseButton';
function useSideNavCollapseState(collapsible, handleRef) {
  const contextCollapseState = useSideNavCollapse();
  const {
    isCollapsed,
    onCollapsedChange
  } = collapsible ?? {};
  const toggleCollapsible = useCallback(() => onCollapsedChange?.(!isCollapsed), [isCollapsed, onCollapsedChange]);
  const toggleHandle = useCallback(() => {
    handleRef?.current?.getCollapseState()?.toggle();
  }, [handleRef]);
  if (collapsible != null) {
    return {
      isCollapsed: isCollapsed ?? false,
      toggle: toggleCollapsible,
      isCollapsible: true
    };
  }
  if (handleRef == null) {
    return contextCollapseState;
  }
  const externalCollapseState = handleRef.current?.getCollapseState() ?? null;
  return {
    isCollapsed: externalCollapseState?.isCollapsed ?? false,
    toggle: toggleHandle,
    isCollapsible: externalCollapseState?.isCollapsible ?? true
  };
}