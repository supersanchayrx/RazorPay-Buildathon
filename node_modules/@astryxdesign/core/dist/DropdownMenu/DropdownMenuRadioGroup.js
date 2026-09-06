// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file DropdownMenuRadioGroup.tsx
 * @output DropdownMenuRadioGroup — a single-select group of menu items.
 * @position Sub-component; wraps DropdownMenuRadioItem inside a DropdownMenu.
 *
 * Owns single-selection state (value/onChange) for its child
 * DropdownMenuRadioItems and exposes it via context. Renders role="group" with
 * an accessible name so the radios are announced as a set. Keyboard navigation
 * comes from the parent DropdownMenu's useListFocus, which matches
 * menuitemradio rows.
 */
import { useMemo } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { DropdownMenuRadioGroupContext } from "./DropdownMenuContext.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  group: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    kOIVth: "x1lsbc85",
    $$css: true
  }
};
/**
 * A single-select group of radio menu items (role="group" of menuitemradio).
 *
 * @example
 * ```
 * import {
 *   DropdownMenuRadioGroup,
 *   DropdownMenuRadioItem,
 * } from '@astryxdesign/core/DropdownMenu';
 * <DropdownMenu button={{label: 'Sort'}}>
 *   <DropdownMenuRadioGroup value={sort} onChange={setSort} label="Sort by">
 *     <DropdownMenuRadioItem value="newest" label="Newest" />
 *     <DropdownMenuRadioItem value="oldest" label="Oldest" />
 *   </DropdownMenuRadioGroup>
 * </DropdownMenu>
 * ```
 */
export function DropdownMenuRadioGroup({
  value,
  onChange,
  label,
  hasCloseOnSelect = true,
  children,
  xstyle,
  className,
  style,
  ...rest
}) {
  const contextValue = useMemo(() => ({
    value,
    onChange,
    hasCloseOnSelect
  }), [value, onChange, hasCloseOnSelect]);
  return /*#__PURE__*/_jsx("div", {
    ...rest,
    role: "group",
    "aria-label": label,
    ...mergeProps(stylex.props(styles.group, xstyle), {
      className,
      style
    }),
    children: /*#__PURE__*/_jsx(DropdownMenuRadioGroupContext, {
      value: contextValue,
      children: children
    })
  });
}
DropdownMenuRadioGroup.displayName = 'DropdownMenuRadioGroup';