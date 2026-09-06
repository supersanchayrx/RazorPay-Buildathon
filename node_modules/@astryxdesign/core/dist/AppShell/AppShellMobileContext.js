// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file AppShellMobileContext.tsx
 * @input Uses React createContext, use
 * @output Exports AppShellMobileContext, useAppShellMobile
 * @position Internal context for mobile nav state; consumed by MobileNavToggle, TopNav (future)
 *
 * Provides mobile navigation state to any component in the AppShell tree.
 * Used by MobileNavToggle to open/close the drawer and by TopNav (future)
 * to adapt rendering based on mobile context.
 */
import { createContext, use } from 'react';
const defaultValue = {
  isMobile: false,
  isMobileNavOpen: false,
  toggleMobileNav: () => {},
  openMobileNav: () => {},
  closeMobileNav: () => {},
  isMobileNavEnabled: false,
  hasAutoToggle: true
};
export const AppShellMobileContext = /*#__PURE__*/createContext(defaultValue);
AppShellMobileContext.displayName = 'AppShellMobileContext';

/**
 * Hook to access mobile nav state from anywhere in the AppShell tree.
 */
export function useAppShellMobile() {
  return use(AppShellMobileContext);
}