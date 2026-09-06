// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file NavHeadingMenu.tsx
 * @input Uses React, StyleX, useListFocus, NavMenuContext
 * @output Exports NavHeadingMenu component and NavHeadingMenuProps type
 * @position Core implementation; consumed by index.ts
 *
 * SYNC: When modified, update:
 * - /packages/core/src/NavMenu/index.ts
 */
import React, { useCallback, useMemo } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import { composeEventHandlers, mergeProps } from "../utils/index.js";
import { useListFocus } from "../hooks/useListFocus.js";
import { useTypeahead } from "../hooks/useTypeahead.js";
import { themeProps } from "../utils/themeProps.js";
import { NavHeadingMenuContext, useNavHeadingCloseContext } from "./NavMenuContext.js";
import { useMergedRefs } from "../hooks/useMergedRefs.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  root: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    kOIVth: "x1lsbc85",
    $$css: true
  }
};
const sizeStyles = {
  sm: {
    k7Eaqz: "x5w4yej",
    $$css: true
  },
  md: {
    k7Eaqz: "x1jzhcrs",
    $$css: true
  },
  lg: {
    k7Eaqz: "xlm99nl",
    $$css: true
  }
};
/**
 * Accessible menu container for nav heading popovers.
 *
 * Provides `role="menu"` with arrow-key navigation (Home/End/Escape)
 * and a size context that flows to child items for consistent padding.
 * Pass as the `menu` prop of SideNavHeading or TopNavHeading.
 *
 * The parent heading component injects the close callback via context,
 * so items automatically dismiss the popover on selection.
 *
 * @example
 * ```
 * <SideNavHeading
 *   heading="Products"
 *   menu={
 *     <NavHeadingMenu size="lg">
 *       <NavHeadingMenuItem label="Dashboard" href="/dashboard" />
 *       <NavHeadingMenuItem label="Analytics" href="/analytics" />
 *     </NavHeadingMenu>
 *   }
 * />
 * ```
 */
export function NavHeadingMenu({
  ref,
  children,
  size = 'md',
  minWidth,
  xstyle,
  className,
  style: styleProp,
  'data-testid': testId,
  onKeyDown: onKeyDownProp,
  ...rest
}) {
  const closeCtx = useNavHeadingCloseContext();
  const closeMenu = closeCtx?.closeMenu;
  const {
    listRef,
    handleKeyDown,
    focusItem
  } = useListFocus({
    itemSelector: '[role="menuitem"]:not([aria-disabled="true"])',
    onEscape: closeMenu
  });

  // First-character typeahead over the (enabled) menu items (menus-11).
  const getMenuItems = useCallback(() => listRef.current ? Array.from(listRef.current.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')) : [], [listRef]);
  const typeahead = useTypeahead({
    getItemLabels: () => getMenuItems().map(el => el.textContent),
    onMatch: focusItem,
    getCurrentIndex: () => getMenuItems().findIndex(el => el === document.activeElement || el.contains(document.activeElement))
  });

  // Extend useListFocus with Enter/Space activation. Items rendered without an
  // `href` are `<div role="menuitem">` elements, which have no native keyboard
  // activation — without this, Enter/Space on a focused onClick-only item does
  // nothing. Anchor items (with `href`) already activate on Enter natively.
  const listKeyDown = useCallback(e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const focused = document.activeElement;
      if (focused?.getAttribute('role') === 'menuitem') {
        e.preventDefault();
        focused.click();
        return;
      }
    }
    if (typeahead.onKeyDown(e)) {
      e.preventDefault();
      return;
    }
    handleKeyDown(e);
  }, [handleKeyDown, typeahead]);
  const ctx = useMemo(() => ({
    closeMenu: closeMenu ?? (() => {}),
    size
  }), [closeMenu, size]);
  const inlineStyle = minWidth != null ? {
    ...styleProp,
    minWidth
  } : styleProp;
  return /*#__PURE__*/_jsx(NavHeadingMenuContext, {
    value: ctx,
    children: /*#__PURE__*/_jsx("div", {
      ref: useMergedRefs(ref, listRef),
      "data-testid": testId,
      ...mergeProps(themeProps('nav-heading-menu', {
        size
      }), stylex.props(styles.root, sizeStyles[size], xstyle), className, inlineStyle),
      ...rest,
      role: "menu",
      onKeyDown: composeEventHandlers(onKeyDownProp, listKeyDown),
      children: children
    })
  });
}
NavHeadingMenu.displayName = 'NavHeadingMenu';