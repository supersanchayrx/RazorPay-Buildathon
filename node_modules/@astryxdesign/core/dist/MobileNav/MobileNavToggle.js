// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file MobileNavToggle.tsx
 * @input Uses React, Button, Icon, AppShell mobile context
 * @output Exports MobileNavToggle component
 * @position Standalone toggle button; can be placed anywhere in the AppShell tree.
 *
 * Hamburger button that opens/closes the mobile nav drawer.
 * Reads from AppShell mobile context — renders nothing above the mobile breakpoint.
 * Can be placed anywhere in the component tree (TopNav, content area, custom toolbar, etc.).
 */
import React from 'react';
import { Button } from "../Button/index.js";
import { Icon } from "../Icon/index.js";
import { useAppShellMobile } from "../AppShell/AppShellMobileContext.js";
import { useTranslator } from "../i18n/index.js";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Mobile nav toggle button. Reads from AppShell context to open/close
 * the mobile navigation drawer.
 *
 * Renders nothing when above the mobile breakpoint — safe to include
 * unconditionally in your layout.
 *
 * @example
 * ```
 * <div className="my-toolbar">
 *   <MobileNavToggle />
 *   <h1>Page Title</h1>
 * </div>
 * <MobileNavToggle label="Menu">
 *   <MyCustomMenuIcon />
 * </MobileNavToggle>
 * ```
 */
export function MobileNavToggle({
  ref,
  children,
  label: labelFromProps,
  'data-testid': testId,
  xstyle,
  className,
  style
}) {
  const t = useTranslator();
  const label = labelFromProps ?? t('@astryx.mobileNav.toggle.open');
  const {
    isMobile,
    isMobileNavEnabled,
    isMobileNavOpen,
    mobileNavId,
    toggleMobileNav
  } = useAppShellMobile();

  // Don't render above the breakpoint or when mobile nav is disabled
  if (!isMobile || !isMobileNavEnabled) {
    return null;
  }
  return /*#__PURE__*/_jsx(Button, {
    ref: ref,
    variant: "ghost",
    label: label,
    icon: children ?? /*#__PURE__*/_jsx(Icon, {
      icon: "menu",
      color: "inherit"
    }),
    onClick: toggleMobileNav,
    "aria-expanded": isMobileNavOpen,
    "aria-controls": mobileNavId || undefined,
    "data-testid": testId ?? 'mobile-nav-toggle',
    xstyle: xstyle,
    className: className,
    style: style,
    isIconOnly: true
  });
}
MobileNavToggle.displayName = 'MobileNavToggle';