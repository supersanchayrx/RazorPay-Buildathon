// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file renderDropdownItems.tsx
 * @output Converts data-driven menu items into DropdownMenuItem components
 * @position Utility; used by DropdownMenu to unify data-driven and compound paths
 */

import * as stylex from '@stylexjs/stylex';
import { DropdownMenuItem } from "./DropdownMenuItem.js";
import { DropdownMenuDivider } from "./DropdownMenuDivider.js";
import { DropdownMenuSubMenu } from "./DropdownMenuSubMenu.js";
import "../theme/tokens.stylex.js";
import { spacingVars, typographyVars, typeScaleVars, colorVars } from "../theme/tokens.stylex.js";
import { mergeProps, themeProps } from "../utils/index.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
function getItemKey(item, index) {
  return `item-${item.id ?? index}`;
}
function getSectionKey(section, index) {
  return `section-${section.id ?? index}`;
}

/**
 * Renders one leaf row as a `DropdownMenuItem`.
 *
 * Keyed by `item.id` when the caller supplies one, else by position. NOT by
 * label: an item that reports its own result (a copy row swapping to "Copied")
 * would change key mid-interaction, remounting the row and dropping keyboard
 * focus. Position is the safe default because a menu's rows are usually fixed;
 * a menu whose items reorder or filter needs `id` for the same reason.
 *
 * `items` selects the submenu shape rather than being an item prop, and `id` is
 * identity for React rather than something `DropdownMenuItem` renders, so both
 * are stripped. Every remaining field of `DropdownMenuItemData` is a
 * `DropdownMenuItem` prop by construction (the type is `Pick`ed from
 * `DropdownMenuItemProps`), so the data path forwards them wholesale and can't
 * silently drop a field the data API advertises.
 */
function renderLeafItem(item, index) {
  const {
    items: _submenuItems,
    id: _id,
    ...itemProps
  } = item;
  return /*#__PURE__*/_jsx(DropdownMenuItem, {
    ...itemProps
  }, getItemKey(item, index));
}

/**
 * Converts data-driven items into DropdownMenuItem components,
 * so both modes share the same rendering and keyboard navigation path.
 */
export function renderDropdownItems(items) {
  const elements = [];
  for (let i = 0; i < items.length; i++) {
    const option = items[i];
    if ('type' in option && option.type === 'divider') {
      elements.push(/*#__PURE__*/_jsx(DropdownMenuDivider, {}, `divider-${i}`));
    } else if ('type' in option && option.type === 'section') {
      elements.push(/*#__PURE__*/_jsxs("div", {
        role: "group",
        "aria-label": option.title,
        children: [option.title && /*#__PURE__*/_jsx("div", {
          "aria-hidden": "true",
          ...mergeProps(themeProps('dropdown-menu-section-heading'), {
            className: "xu0wf1k xf314gf x9ynric x141an7d x1ltkj2j xv1l7n4 x87ps6o"
          }),
          children: option.title
        }), option.items.map(renderLeafItem)]
      }, getSectionKey(option, i)));
    } else if (!('type' in option)) {
      // A plain item that declares nested `items` becomes a submenu (data-mode
      // parity with the compound DropdownMenuSubMenu API); otherwise it's a
      // leaf. renderDropdownItems owns the recursion and hands the rendered
      // children to DropdownMenuSubMenu — so DropdownMenuSubMenu never imports
      // this module back (no import cycle).
      if (option.items && option.items.length > 0) {
        elements.push(/*#__PURE__*/_jsx(DropdownMenuSubMenu, {
          icon: option.icon,
          label: option.label,
          isDisabled: option.isDisabled,
          children: renderDropdownItems(option.items)
        }, getItemKey(option, i)));
      } else {
        elements.push(renderLeafItem(option, i));
      }
    }
  }
  return elements;
}