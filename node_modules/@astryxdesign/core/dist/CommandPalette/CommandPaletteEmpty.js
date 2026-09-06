// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file CommandPaletteEmpty.tsx
 * @input Uses React, StyleX
 * @output Exports CommandPaletteEmpty component
 * @position Sub-component; empty state shown when there are no items to display
 *
 * SYNC: When modified, update:
 * - /packages/cli/assets/templates/blocks/components/CommandPalette/ (showcase blocks)
 */

'use client';

import React from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars, typographyVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  empty: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    k8WAf4: "xmfvnks",
    kg3NbH: "x1pzlopt",
    kMv6JI: "x9ynric",
    kGuDYH: "x141an7d",
    kLWn49: "x1ltkj2j",
    kMwMTN: "xv1l7n4",
    k9WMMc: "x2b8uid",
    $$css: true
  }
};
/**
 * Empty state for the command palette list area.
 *
 * Rendered automatically by CommandPalette in two situations:
 * - `emptyBootstrapText`: no search term and bootstrap() returns nothing
 * - `emptySearchText`: a search query returned no results
 *
 * Can also be composed manually inside a custom render function.
 *
 * @example
 * ```
 * <CommandPalette
 *   emptyBootstrapText={<CommandPaletteEmpty>Start typing to search</CommandPaletteEmpty>}
 *   emptySearchText={<CommandPaletteEmpty>No results found</CommandPaletteEmpty>}
 *   searchSource={source}
 * />
 * ```
 */
export function CommandPaletteEmpty({
  ref,
  children,
  xstyle,
  className,
  style,
  ...props
}) {
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    ...mergeProps(themeProps('command-palette-empty'), stylex.props(styles.empty, xstyle), className, style),
    ...props,
    children: children
  });
}
CommandPaletteEmpty.displayName = 'CommandPaletteEmpty';