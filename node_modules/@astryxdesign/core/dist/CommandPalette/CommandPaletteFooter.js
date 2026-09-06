// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file CommandPaletteFooter.tsx
 * @input Uses React, StyleX, Kbd
 * @output Exports CommandPaletteFooter component
 * @position Sub-component; footer with keyboard hints
 *
 * SYNC: When modified, update:
 * - /packages/cli/assets/templates/blocks/components/CommandPalette/ (showcase blocks)
 */

'use client';

import * as stylex from '@stylexjs/stylex';
import { mergeProps } from "../utils/index.js";
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars, typographyVars } from "../theme/tokens.stylex.js";
import { Kbd } from "../Kbd/index.js";
import { themeProps } from "../utils/themeProps.js";
import { useTranslator } from "../i18n/index.js";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
const styles = {
  footer: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kOIVth: "x18g69wz",
    kg3NbH: "x1pzlopt",
    k8WAf4: "xce4md1",
    kmuXW: "x2lah0s",
    kMv6JI: "x9ynric",
    kGuDYH: "x141an7d",
    kLWn49: "x1ltkj2j",
    kMwMTN: "xv1l7n4",
    $$css: true
  }
};
/**
 * Footer for the command palette showing keyboard navigation hints.
 *
 * When no children are provided, renders default hints using Kbd
 * for arrow keys, Enter to select, and Escape to close.
 *
 * @compositionHint Pass to CommandPalette's `footer` slot.
 *
 * @example
 * ```
 * <CommandPalette
 *   isOpen={isOpen}
 *   onOpenChange={setIsOpen}
 *   input={<CommandPaletteInput />}
 *   footer={<CommandPaletteFooter />}>
 *   <CommandPaletteList>...</CommandPaletteList>
 * </CommandPalette>
 * ```
 */
export function CommandPaletteFooter({
  children,
  ref,
  xstyle,
  className,
  style,
  ...props
}) {
  const t = useTranslator();
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    ...mergeProps(themeProps('command-palette-footer'), stylex.props(styles.footer, xstyle), className, style),
    ...props,
    children: children ?? /*#__PURE__*/_jsxs(_Fragment, {
      children: [/*#__PURE__*/_jsxs("span", {
        ...{
          className: "x78zum5 x6s0dn4 xzye2dw"
        },
        children: [/*#__PURE__*/_jsx(Kbd, {
          keys: "up"
        }), /*#__PURE__*/_jsx(Kbd, {
          keys: "down"
        }), t('@astryx.commandPalette.footer.navigate')]
      }), /*#__PURE__*/_jsxs("span", {
        ...{
          className: "x78zum5 x6s0dn4 xzye2dw"
        },
        children: [/*#__PURE__*/_jsx(Kbd, {
          keys: "enter"
        }), t('@astryx.commandPalette.footer.select')]
      }), /*#__PURE__*/_jsxs("span", {
        ...{
          className: "x78zum5 x6s0dn4 xzye2dw"
        },
        children: [/*#__PURE__*/_jsx(Kbd, {
          keys: "escape"
        }), t('@astryx.commandPalette.footer.close')]
      })]
    })
  });
}
CommandPaletteFooter.displayName = 'CommandPaletteFooter';