// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file CommandPaletteGroup.tsx
 * @input Uses React, StyleX
 * @output Exports CommandPaletteGroup component
 * @position Sub-component; visual grouping with heading
 *
 * SYNC: When modified, update:
 * - /packages/cli/assets/templates/blocks/components/CommandPalette/ (showcase blocks)
 */

'use client';

import * as stylex from '@stylexjs/stylex';
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars, typographyVars } from "../theme/tokens.stylex.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  group: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    kOIVth: "x1lsbc85",
    k8WAf4: "xu0wf1k",
    $$css: true
  }
};
/**
 * Visual grouping for command palette items with a heading label.
 *
 * Heading style matches DropdownMenu section headings:
 * supporting-size (12px), secondary color, no uppercase/letterSpacing.
 *
 * @compositionHint Place inside CommandPaletteList.
 *   Contains CommandPaletteItem children.
 *
 * @example
 * ```
 * <CommandPaletteGroup heading="Navigation">
 *   <CommandPaletteItem value="home" onSelect={goHome}>
 *     Home
 *   </CommandPaletteItem>
 * </CommandPaletteGroup>
 * ```
 */
export function CommandPaletteGroup({
  heading,
  children,
  ref,
  xstyle,
  className,
  style,
  ...props
}) {
  return /*#__PURE__*/_jsxs("div", {
    ref: ref,
    role: "group",
    "aria-label": heading,
    ...mergeProps(themeProps('command-palette-group'), stylex.props(styles.group, xstyle), className, style),
    ...props,
    children: [/*#__PURE__*/_jsx("div", {
      "aria-hidden": "true",
      ...mergeProps(
      // Stable theme target for the group heading text. The root carries
      // `astryx-command-palette-group`, but the heading itself had no
      // handle, so a theme could only reach it through a fragile structural
      // selector. This adds an `astryx-command-palette-group-heading` class
      // so `defineTheme` can scope overrides (e.g. heading typography) to
      // the heading alone.
      themeProps('command-palette-group-heading'), {
        className: "xrrkdod xu0wf1k x9ynric x141an7d x1ltkj2j xv1l7n4 x87ps6o"
      }),
      children: heading
    }), children]
  });
}
CommandPaletteGroup.displayName = 'CommandPaletteGroup';