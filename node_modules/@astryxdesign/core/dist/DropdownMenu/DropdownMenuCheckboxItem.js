// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file DropdownMenuCheckboxItem.tsx
 * @input React, stylex, Item + CheckboxInput + DropdownMenu context + tokens from core
 * @output DropdownMenuCheckboxItem — a standalone checkable menu item.
 * @position Sub-component; used inside DropdownMenu.
 *
 * A menu item that toggles an independent boolean (role="menuitemcheckbox").
 * Unlike CheckboxInput, there is no nested native <input> that participates in
 * accessibility: the row itself owns the role and aria-checked, per the
 * WAI-ARIA menuitemcheckbox pattern. Keyboard navigation (arrows/typeahead) and
 * Enter/Space activation come from the parent DropdownMenu's useListFocus +
 * activation path, which matches menuitemcheckbox alongside plain menuitem rows.
 *
 * The checkbox visual is the shared checkbox indicator, decorative
 * (aria-hidden) — the row owns the role, checked state, and accessible name, so
 * there is no nested native <input> to shim out of the accessibility tree. It
 * picks up the same `checkbox` theming (and any theme replacement) as
 * CheckboxInput. The control size is derived from the menu's item size (a `sm`
 * menu gets the compact control; `md`/`lg` get the standard one) and the marker
 * box swaps to the inline-end of the row on coarse-pointer (touch) devices via
 * CSS `order`, so it lands where selection toggles are conventionally placed on
 * mobile.
 */
import { useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import { renderIconSlot } from "../Icon/index.js";
import { useIndicator } from "../Indicator/index.js";
import { Item } from "../Item/index.js";
import { useDropdownMenuContext } from "./DropdownMenuContext.js";
import { focusMenuItemOnHover } from "./menuItemHover.js";
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars } from "../theme/tokens.stylex.js";
import { mergeProps, themeProps } from "../utils/index.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  root: {
    kzqmXN: "xh8yej3",
    kaIpWk: "x1ws5lxm",
    kMwMTN: "x1tgivj0",
    kWkggS: "xjbqb8w x1c52tdz",
    kkrTdU: "x1ypdohk x16khyan",
    kI3sdo: "x1a2a7pz",
    $$css: true
  },
  disabled: {
    kSiTet: "xbyyjgo",
    kkrTdU: "xt0e3qv",
    $$css: true
  },
  marker: {
    kfzvcC: "x47corl",
    kayTVb: "x1g77sc7 xozvky",
    keTefX: "x1lziwak x1jymrmb",
    $$css: true
  }
};

// Matches the control sizes CheckboxInput uses, so a checkbox reads the same in
// a menu row as it does in a form.

/**
 * A checkable dropdown menu item (role="menuitemcheckbox").
 *
 * Must be used inside a DropdownMenu. Toggles an independent boolean; for a
 * one-of-N choice use DropdownMenuRadioGroup + DropdownMenuRadioItem instead.
 *
 * @example
 * ```
 * import {DropdownMenuCheckboxItem} from '@astryxdesign/core/DropdownMenu';
 * <DropdownMenu button={{label: 'View'}}>
 *   <DropdownMenuCheckboxItem
 *     label="Show archived"
 *     value={showArchived}
 *     onChange={setShowArchived}
 *   />
 * </DropdownMenu>
 * ```
 */
export function DropdownMenuCheckboxItem({
  label,
  description,
  icon,
  value,
  onChange,
  isDisabled = false,
  hasCloseOnSelect = false,
  endContent,
  xstyle,
  className,
  style,
  ...rest
}) {
  const ctx = useDropdownMenuContext();
  const menuSize = ctx?.menuSize ?? 'md';
  const controlSize = menuSize === 'sm' ? 'sm' : 'md';
  const CheckboxControl = useIndicator('checkbox');
  const handleClick = useCallback(() => {
    if (isDisabled) {
      return;
    }
    onChange?.(!value);
    if (hasCloseOnSelect) {
      ctx?.closeMenu();
    }
  }, [isDisabled, onChange, value, hasCloseOnSelect, ctx]);
  const handlePointerMove = useCallback(e => focusMenuItemOnHover(e, isDisabled), [isDisabled]);
  return /*#__PURE__*/_jsx(Item, {
    ...rest,
    role: "menuitemcheckbox",
    "aria-checked": value,
    tabIndex: isDisabled ? undefined : -1,
    onPointerMove: handlePointerMove,
    marker:
    /*#__PURE__*/
    // No wrapper, and no menu-specific theme target: the shared
    // `astryx-checkbox` target is already on this element (main reached
    // the menu checkbox through it too), so the menu adds only its own
    // placement rules. A wrapper here would have duplicated the
    // indicator's control size and moved nothing themeable.
    _jsx(CheckboxControl, {
      state: value ? 'checked' : 'unchecked',
      size: controlSize,
      isDisabled: isDisabled,
      xstyle: styles.marker
    }),
    startContent: icon ? renderIconSlot(icon, {
      size: 'sm',
      color: 'secondary'
    }) : undefined,
    label: label,
    description: description,
    endContent: endContent,
    onClick: handleClick,
    isDisabled: isDisabled,
    xstyle: [styles.root, isDisabled && styles.disabled, xstyle],
    ...mergeProps(themeProps('dropdown-menu-item', {
      size: menuSize
    }), {
      className,
      style
    })
  });
}
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';