// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file CommandPaletteList.tsx
 * @input Uses React, StyleX, CommandPaletteContext
 * @output Exports CommandPaletteList component
 * @position Sub-component; scrollable results container
 *
 * SYNC: When modified, update:
 * - /packages/core/src/CommandPalette/index.ts
 * - /packages/cli/assets/templates/blocks/components/CommandPalette/ (showcase blocks)
 */

'use client';

import * as stylex from '@stylexjs/stylex';
import { mergeProps } from "../utils/index.js";
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import { useCommandPaletteContext } from "./CommandPaletteContext.js";
import { themeProps } from "../utils/themeProps.js";
import { useTranslator } from "../i18n/index.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  list: {
    kORKVm: "x1odjw0f",
    kskxy: "xmz0i5r",
    kmVPX3: "x9epnlk",
    kUk6DE: "x98rzlu",
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    kOIVth: "x1lsbc85",
    $$css: true
  }
};
/**
 * Scrollable results container for the command palette.
 * Renders as a listbox for ARIA compliance.
 *
 * When used inside CommandPalette, automatically gets the correct
 * ID for aria-controls linking with the input.
 *
 * @compositionHint Place inside CommandPalette, after CommandPaletteInput.
 *   Contains CommandPaletteItem and CommandPaletteGroup children.
 *
 * @example
 * ```
 * <CommandPaletteList>
 *   <CommandPaletteItem value="home" onSelect={goHome}>
 *     Go Home
 *   </CommandPaletteItem>
 * </CommandPaletteList>
 * ```
 */
export function CommandPaletteList({
  children,
  label: labelFromProps,
  ref,
  xstyle,
  className,
  style,
  ...props
}) {
  const t = useTranslator();
  const label = labelFromProps ?? t('@astryx.commandPalette.list.label');
  const ctx = useCommandPaletteContext();
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    ...props,
    id: ctx?.listId,
    role: "listbox",
    "aria-label": label,
    ...mergeProps(themeProps('command-palette-list'), stylex.props(styles.list, xstyle), className, style),
    children: children
  });
}
CommandPaletteList.displayName = 'CommandPaletteList';