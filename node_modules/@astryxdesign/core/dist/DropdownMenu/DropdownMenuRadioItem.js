// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file DropdownMenuRadioItem.tsx
 * @input React, stylex, Item + Icon + DropdownMenu context + tokens from core
 * @output DropdownMenuRadioItem — a single option in a radio group.
 * @position Sub-component; must be used inside a DropdownMenuRadioGroup.
 *
 * A menu item representing one option in a single-select group
 * (role="menuitemradio"). The row owns the role and aria-checked; there is no
 * nested native <input> (per the WAI-ARIA menuitemradio pattern). Selection
 * state + onChange come from DropdownMenuRadioGroupContext. Keyboard nav +
 * Enter/Space activation come from the parent DropdownMenu.
 *
 * The round radio visual is the shared radio indicator, decorative
 * (aria-hidden) — the row owns the checked state, and menu radios pick up the
 * same `radio` theming (and any theme replacement) as RadioList. This row keeps
 * the marker box: its size is derived from the menu's item size and it swaps to
 * the inline-end of the row on coarse-pointer (touch) devices via CSS `order`.
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
import { useDropdownMenuRadioGroupContext } from "./DropdownMenuContext.js";
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

// Matches the control sizes RadioList uses, so a radio reads the same in a
// menu row as it does in a radio group.

/**
 * A single option in a DropdownMenuRadioGroup (role="menuitemradio").
 *
 * @example
 * ```
 * <DropdownMenuRadioGroup value={sort} onChange={setSort} label="Sort by">
 *   <DropdownMenuRadioItem value="newest" label="Newest" />
 *   <DropdownMenuRadioItem value="oldest" label="Oldest" icon="clock" />
 * </DropdownMenuRadioGroup>
 * ```
 */
export function DropdownMenuRadioItem({
  value,
  label,
  description,
  icon,
  isDisabled = false,
  endContent,
  xstyle,
  className,
  style,
  ...rest
}) {
  const menuCtx = useDropdownMenuContext();
  const groupCtx = useDropdownMenuRadioGroupContext();
  if (!groupCtx) {
    throw new Error('DropdownMenuRadioItem must be used within a DropdownMenuRadioGroup');
  }
  const menuSize = menuCtx?.menuSize ?? 'md';
  const controlSize = menuSize === 'sm' ? 'sm' : 'md';
  const isChecked = groupCtx.value === value;
  const RadioControl = useIndicator('radio');
  const handleClick = useCallback(() => {
    if (isDisabled) {
      return;
    }
    groupCtx.onChange(value);
    if (groupCtx.hasCloseOnSelect) {
      menuCtx?.closeMenu();
    }
  }, [isDisabled, groupCtx, value, menuCtx]);
  const handlePointerMove = useCallback(e => focusMenuItemOnHover(e, isDisabled), [isDisabled]);
  return /*#__PURE__*/_jsx(Item, {
    ...rest,
    role: "menuitemradio",
    "aria-checked": isChecked,
    tabIndex: isDisabled ? undefined : -1,
    onPointerMove: handlePointerMove,
    marker:
    /*#__PURE__*/
    // No wrapper — see DropdownMenuCheckboxItem: the target belongs on the
    // visible circle, and the indicator already owns its control size.
    _jsx(RadioControl, {
      state: isChecked ? 'checked' : 'unchecked',
      size: controlSize,
      isDisabled: isDisabled,
      xstyle: styles.marker,
      ...themeProps('dropdown-menu-radio', {
        size: controlSize,
        checked: isChecked ? 'checked' : null,
        disabled: isDisabled ? 'disabled' : null
      })
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
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';