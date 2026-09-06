// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file SideNavCollapseContext.ts
 * @input React createContext, use
 * @output Exports SideNavCollapseContext and useSideNavCollapse hook
 * @position Internal context for sidenav collapse state
 *
 * Provides collapse state to SideNavCollapseButton and other
 * sidenav children. Set by SideNav when isCollapsible is true.
 * A button rendered outside the SideNav tree is out of context's reach and
 * takes the controlled `collapsible` config as a prop instead.
 */
import { createContext, use } from 'react';

/** Object form of SideNav's `collapsible` prop. */

/**
 * The controlled form: the consumer holds the state, so it can be handed to
 * both SideNav and a SideNavCollapseButton rendered outside it.
 */

/**
 * @deprecated Pass the same controlled `collapsible` config to SideNav and to
 * the out-of-tree SideNavCollapseButton instead. The state then reaches the
 * button through props rather than through a ref.
 */

export const SideNavCollapseContext = /*#__PURE__*/createContext({
  isCollapsed: false,
  toggle: () => {},
  isCollapsible: false
});
SideNavCollapseContext.displayName = 'SideNavCollapseContext';

/**
 * Read the sidenav collapse state from context.
 * Returns { isCollapsed, toggle, isCollapsible }.
 * When used outside a sidenav with isCollapsible, isCollapsible is false.
 */
export function useSideNavCollapse() {
  return use(SideNavCollapseContext);
}