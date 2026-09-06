// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file SelectorOption.tsx
 * @output Exports SelectorOption component for custom option rendering
 * @position Sub-component; used by Selector and consumers for custom options
 *
 * Composes Item for the shared start content + label + description + end content layout.
 */

import * as stylex from '@stylexjs/stylex';
import { renderIconSlot } from "../Icon/index.js";
import { Item } from "../Item/index.js";
import { useSelectorRowLayout } from "./SelectorRowLayoutContext.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx } from "react/jsx-runtime";
const embeddedStyles = {
  root: {
    k8WAf4: "xt970qd",
    kg3NbH: "xnjsko4",
    kaIpWk: "x2u8bby",
    $$css: true
  }
};
/**
 * A helper component for rendering custom selector options with consistent styling.
 *
 * Use this inside the `renderOption` prop of Selector to create
 * custom option layouts while maintaining design system consistency.
 *
 * @example
 * ```
 * <Selector
 *   label="User"
 *   options={users}
 *   value={value}
 *   onChange={setValue}
 *   renderOption={option => (
 *     <SelectorOption
 *       icon={UserIcon}
 *       label={option.label}
 *       description={option.email}
 *     />
 *   )}
 * />
 * ```
 */
export function SelectorOption({
  icon,
  label,
  description,
  layout,
  endContent,
  xstyle,
  className,
  style
}) {
  // A height-pinned host (the trigger inside an InputGroup) overrides the
  // caller's choice: the row physically cannot be two lines there.
  const enforcedLayout = useSelectorRowLayout();
  return /*#__PURE__*/_jsx(Item, {
    startContent: icon ? renderIconSlot(icon, {
      size: 'sm',
      color: 'secondary'
    }) : undefined,
    label: label,
    description: description,
    layout: enforcedLayout === 'inline' ? 'inline' : layout,
    endContent: endContent,
    xstyle: [embeddedStyles.root, xstyle],
    ...mergeProps(themeProps('selector-option'), {
      className,
      style
    })
  });
}
SelectorOption.displayName = 'SelectorOption';