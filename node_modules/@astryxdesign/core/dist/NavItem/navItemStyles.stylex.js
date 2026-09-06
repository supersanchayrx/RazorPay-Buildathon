// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file navItemStyles.stylex.ts
 * @input Uses theme tokens (color, spacing, radius, typography, transition, size)
 * @output Exports shared nav item appearance styles and NavItemSize type
 * @position Shared styles consumed by SideNavItem, TopNavItem (drawer mode),
 *   TopNavMenu (drawer mode), and any custom nav items that need to match.
 *
 * Centralizes the nav item appearance (layout, colors, hover/active/selected states,
 * disabled state) so all nav-like components stay in sync — especially important
 * when TopNav items render inside MobileNav drawers alongside SideNav items.
 *
 * Individual components layer their own overrides (e.g. collapsed mode,
 * indentation) via stylex.props composition.
 *
 * The focus ring is not defined here. Compose
 * `focusOutlineProps.focusVisible` (utils/focusOutline.stylex.ts) at the call
 * site, on whichever element actually takes focus — in a split-action row that
 * is the link and the toggle, not the row that contains them.
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, radiusVars, typeScaleVars, fontWeightVars, sizeVars } from "../theme/tokens.stylex.js";

/**
 * Base styles shared by all nav item components.
 * Apply as a foundation and override specific properties as needed.
 *
 * @example
 * ```
 * import {navItemStyles} from '@astryxdesign/core/navItemStyles';
 *
 * const styles = stylex.create({
 *   indented: { paddingInlineStart: spacingVars['--spacing-6'] },
 * });
 *
 * <a {...stylex.props(navItemStyles.item, styles.indented)}>
 *   Dashboard
 * </a>
 * ```
 */
export const navItemStyles = {
  item: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kOIVth: "x1txdalj",
    kzqmXN: "xh8yej3",
    kZKoxP: "x1ueg155",
    kg3NbH: "xf314gf",
    k8WAf4: "xt970qd",
    kaIpWk: "xh6dtrn",
    kMzoRj: "xc342km",
    ksu8eU: "xng3xce",
    kWkggS: "xjbqb8w",
    kMwMTN: "x1tgivj0",
    kybGjl: "x1hl2dhg",
    kkrTdU: "x1ypdohk x16khyan",
    kMv6JI: "xjb2p0i",
    kGuDYH: "xcr08ib",
    k63SB2: "x1sodnla",
    kLWn49: "x1kq96og",
    k9WMMc: "x1yc453h",
    kB7OPa: "x9f619",
    $$css: true
  },
  selected: {
    kWkggS: "x17x4s8c x1jzqe4",
    kMwMTN: "x1k5gbb1",
    k63SB2: "x1e4wzip",
    kRL5z6: "xcu6dpe x1d42zcn",
    kSReZ0: "xjtnuge x1vo6n7o",
    $$css: true
  },
  disabled: {
    kMwMTN: "xnbbluu",
    kkrTdU: "xt0e3qv",
    kfzvcC: "x47corl",
    $$css: true
  },
  sm: {
    kZKoxP: "x6k0iem",
    kg3NbH: "x7a5moj",
    $$css: true
  },
  md: {
    kZKoxP: "x1ueg155",
    kg3NbH: "xf314gf",
    $$css: true
  },
  lg: {
    kZKoxP: "xssyfek",
    kg3NbH: "xf314gf",
    $$css: true
  }
};