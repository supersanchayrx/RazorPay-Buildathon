// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TabMenu.tsx
 * @input Uses React, StyleX, usePopover, TabListContext
 * @output Exports TabMenu component, TabMenuProps type, TabMenuOption type
 * @position Menu trigger button; opens dropdown of overflow menu items and
 *   mirrors selected tab indicator positioning
 *
 * SYNC: When modified, update:
 * - /packages/core/src/TabList/TabList.doc.mjs
 * - /packages/core/src/TabList/index.ts
 * - /packages/core/src/TabList/TabList.test.tsx
 * - /packages/cli/assets/templates/blocks/components/TabList/ (showcase blocks)
 */
import React, { useCallback, useId, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Icon } from "../Icon/index.js";
import { renderIconSlot } from "../Icon/index.js";
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, sizeVars, radiusVars, durationVars, easeVars, fontWeightVars, typeScaleVars } from "../theme/tokens.stylex.js";
import { focusOutlineProps } from "../utils/focusOutline.stylex.js";
import { usePopover } from "../Popover/usePopover.js";
import { MENU_ITEM_SELECTOR } from "../DropdownMenu/menuItemRoles.js";
import { useListFocus } from "../hooks/useListFocus.js";
import { useTabListContext } from "./TabListContext.js";
import "./tab.markers.stylex.js";
import { tabScope } from "./tab.markers.stylex.js";
import { mergeProps } from "../utils/index.js";
import { useMergedRefs } from "../hooks/useMergedRefs.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// =============================================================================
// Styles
// =============================================================================

const styles = {
  trigger: {
    kVAEAm: "x1n2onr6",
    k1xSpc: "x3nfvp2",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kOIVth: "xzye2dw",
    kg3NbH: "xrrkdod",
    kWkggS: "xjbqb8w",
    kMzoRj: "xc342km",
    ksu8eU: "xng3xce",
    kaIpWk: "xh6dtrn",
    kMv6JI: "xjb2p0i",
    kGuDYH: "xcr08ib",
    kLWn49: "x1kq96og",
    k63SB2: "x1sodnla",
    kMwMTN: "xv1l7n4",
    kkrTdU: "x1ypdohk x16khyan",
    kybGjl: "x1hl2dhg",
    k1ekBW: "xt3l3uh",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    $$css: true
  },
  triggerSelected: {
    kMwMTN: "x1tgivj0",
    k63SB2: "x2mo6ok",
    $$css: true
  },
  hoverBg: {
    kVAEAm: "x10l6tqk",
    kpwlN0: "x10a8y8t",
    kogj98: "x1bpp3o7",
    kzqmXN: "xh8yej3",
    kaIpWk: "xh6dtrn",
    kfzvcC: "x47corl",
    kWkggS: "xjbqb8w x1a1zr74",
    k1ekBW: "x15406qy",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    $$css: true
  },
  chevronIcon: {
    k1ekBW: "x11xpdln",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    $$css: true
  },
  chevronOpen: {
    k3aq6I: "x19jd1h0",
    $$css: true
  },
  menuItem: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "x1qughib",
    kOIVth: "x1txdalj",
    k8WAf4: "xce4md1",
    kg3NbH: "xrrkdod",
    kaIpWk: "xh6dtrn",
    kMv6JI: "xjb2p0i",
    kGuDYH: "xcr08ib",
    kLWn49: "x1kq96og",
    k63SB2: "x1sodnla",
    kMwMTN: "x1tgivj0",
    kkrTdU: "x1ypdohk x16khyan",
    k1ekBW: "x15406qy",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    kWkggS: "xjbqb8w xoevpu5",
    $$css: true
  },
  menuItemSelected: {
    k63SB2: "x1e4wzip",
    $$css: true
  }
};
const sizeStyles = {
  sm: {
    kZKoxP: "x6k0iem",
    $$css: true
  },
  md: {
    kZKoxP: "x1ueg155",
    $$css: true
  },
  lg: {
    kZKoxP: "xssyfek",
    $$css: true
  }
};

// Hover bg uses the standard element size (one step smaller than tab)
const hoverSizeStyles = {
  sm: {
    kZKoxP: "x6k0iem",
    $$css: true
  },
  md: {
    kZKoxP: "x1ueg155",
    $$css: true
  },
  lg: {
    kZKoxP: "xssyfek",
    $$css: true
  }
};

/**
 * Tab menu trigger that opens a dropdown of additional tab options.
 * Shows the selected option's label as trigger text when an option is active.
 * Dropdown includes a heading showing the menu's label prop.
 *
 * @example
 * ```
 * <TabList value={tab} onChange={setTab}>
 *   <Tab value="overview" label="Overview" />
 *   <TabMenu label="More" options={[
 *     { value: "settings", label: "Settings" },
 *     { value: "history", label: "History" },
 *   ]} />
 * </TabList>
 * ```
 */
export function TabMenu({
  ref,
  label,
  options,
  xstyle,
  className,
  style
}) {
  const tabListCtx = useTabListContext();
  const menuId = useId();
  const buttonRef = useRef(null);
  const popover = usePopover({
    hasLightDismiss: true,
    hasCloseButton: false,
    hasAutoFocus: false,
    // The popup's own role="menu" is the exposed semantics; a modal dialog
    // wrapper would announce an unnamed dialog around the menu.
    role: 'none',
    // Return focus to the trigger when the menu closes (Escape, Tab, select,
    // or light dismiss) so keyboard focus is never dropped to <body>.
    onHide: useCallback(() => {
      buttonRef.current?.focus();
    }, [])
  });

  // The overflow menu is a composite widget: a single roving tab stop with
  // arrow-key navigation between items, per the APG menu pattern. The hook owns
  // item tabindex — items render tabIndex={-1} and exactly one is promoted to 0.
  const {
    listRef,
    handleKeyDown: handleListKeyDown,
    handleFocus,
    focusFirst
  } = useListFocus({
    hasRovingTabIndex: true,
    // Options render as menuitemradio (single-select menu), which the
    // default '[role="menuitem"]' selector would not match.
    itemSelector: MENU_ITEM_SELECTOR,
    onEscape: () => popover.hide()
  });
  const handleToggle = useCallback(() => {
    if (popover.isOpen) {
      popover.hide();
    } else {
      popover.show();
      // Move focus into the menu on open so arrow navigation works and the
      // roving tab stop lands on a real item (APG menu-button focus-on-open).
      requestAnimationFrame(() => focusFirst());
    }
  }, [popover, focusFirst]);
  const handleMenuKeyDown = useCallback(e => {
    // APG menu-button: Tab leaves the menu rather than walking its items.
    // Close and let onHide return focus to the trigger, from which the
    // browser's default Tab continues to the next element.
    if (e.key === 'Tab') {
      popover.hide();
      return;
    }
    handleListKeyDown(e);
  }, [handleListKeyDown, popover]);
  const selectedOption = options.find(o => o.value === tabListCtx.value);
  const triggerLabel = selectedOption?.label ?? label;
  const hasSelectedOption = selectedOption != null;
  const size = tabListCtx.size;
  const handleSelect = useCallback(value => {
    tabListCtx.onChange(value);
    popover.hide();
  }, [tabListCtx, popover]);
  const setButtonRef = useMergedRefs(popover.triggerRef, buttonRef, ref);
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [/*#__PURE__*/_jsxs("button", {
      ref: setButtonRef,
      type: "button",
      "aria-haspopup": "menu",
      "aria-expanded": popover.isOpen,
      "aria-controls": menuId,
      "data-tab-menu": "",
      tabIndex: hasSelectedOption ? 0 : -1,
      onClick: handleToggle,
      ...mergeProps(themeProps('tab-menu'), focusOutlineProps.focusVisible(styles.trigger, sizeStyles[size], hasSelectedOption && styles.triggerSelected, tabScope, xstyle), className, style),
      children: [/*#__PURE__*/_jsx("span", {
        "aria-hidden": "true",
        ...stylex.props(styles.hoverBg, hoverSizeStyles[size])
      }), /*#__PURE__*/_jsxs("span", {
        ...{
          className: "x1n2onr6 xwz0xwf x6s0dn4 xkh2ocl"
        },
        children: [/*#__PURE__*/_jsx("span", {
          ...{
            className: "x1agbcgv xcrlgei"
          },
          children: triggerLabel
        }), /*#__PURE__*/_jsx("span", {
          "aria-hidden": "true",
          ...{
            className: "x1agbcgv xcrlgei xlshs6z x47corl x2mo6ok"
          },
          children: triggerLabel
        })]
      }), /*#__PURE__*/_jsx("span", {
        "aria-hidden": "true",
        ...{
          className: "x12xnipv x6b6gus x2lah0s"
        },
        children: /*#__PURE__*/_jsx(Icon, {
          icon: "chevronDown",
          size: "sm",
          color: "inherit",
          xstyle: [styles.chevronIcon, popover.isOpen && styles.chevronOpen]
        })
      }), hasSelectedOption && /*#__PURE__*/_jsx("span", {
        ...mergeProps(themeProps('tab-indicator', {
          selected: 'selected'
        }), {
          className: "x10l6tqk xyi47jn x1ybfrjj x1mcfs9z x36qwtl xjspbzw x47corl xnpjden xuedmi6 xlr8y92 xowkcby x1hc1fzr"
        })
      })]
    }), popover.render(/*#__PURE__*/_jsxs("div", {
      ref: listRef,
      id: menuId,
      role: "menu",
      "aria-label": label,
      onKeyDown: handleMenuKeyDown,
      onFocus: handleFocus,
      ...mergeProps(themeProps('tab-menu-dropdown'), {
        className: "x78zum5 xdt5ytf x1lsbc85 xu0wf1k x7a5moj"
      }),
      children: [/*#__PURE__*/_jsx("span", {
        role: "presentation",
        ...{
          className: "x141an7d x1ltkj2j x2mo6ok xv1l7n4 xu0wf1k xrrkdod"
        },
        children: label
      }), options.map(option => {
        const isSelected = tabListCtx.value === option.value;
        return /*#__PURE__*/_jsxs("div", {
          // The menu is single-select: exactly one option can be the
          // active tab, so options are radio menu items with
          // aria-checked (APG menu-button), not plain menuitems with
          // aria-current.
          role: "menuitemradio",
          tabIndex: -1,
          "aria-checked": isSelected,
          onClick: () => handleSelect(option.value),
          onKeyDown: e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleSelect(option.value);
            }
          },
          ...mergeProps(themeProps('tab-menu-item'), focusOutlineProps.focusVisible(styles.menuItem, isSelected && styles.menuItemSelected)),
          children: [/*#__PURE__*/_jsxs("span", {
            ...{
              className: "x78zum5 x6s0dn4 x1txdalj"
            },
            children: [option.icon && renderIconSlot(option.icon, {
              size: 'sm',
              color: 'secondary'
            }), option.label]
          }), isSelected && /*#__PURE__*/_jsx(Icon, {
            icon: "check",
            size: "sm",
            color: "accent"
          })]
        }, option.value);
      })]
    }), {
      placement: 'below',
      alignment: 'start'
    })]
  });
}
TabMenu.displayName = 'TabMenu';