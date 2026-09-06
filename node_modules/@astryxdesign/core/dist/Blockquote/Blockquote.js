// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file Blockquote.tsx
 * @input Uses React, stylex, spacing and color tokens
 * @output Exports Blockquote component and BlockquoteProps
 * @position Blockquote component; renders styled quotations with optional attribution
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Blockquote/Blockquote.doc.mjs
 * - /packages/core/src/Blockquote/Blockquote.test.tsx
 * - /apps/storybook/stories/Blockquote.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Blockquote/ (showcase blocks)
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars } from "../theme/tokens.stylex.js";
import { isRenderable, mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  root: {
    k2ei4v: "xtpqe59",
    kVhnKS: "x1t7ytsu",
    kGJrpR: "x14ydlgx",
    kZCmMZ: "x1rey3nv",
    kMwMTN: "xv1l7n4",
    kHjlTd: "x1mzt3pk",
    keTefX: "x1lziwak",
    k71WvV: "x14z9mp",
    keoZOQ: "xdj266r",
    k1K539: "xat24cr",
    $$css: true
  }
};

/**
 * Blockquote component for displaying quoted content.
 *
 * Renders a semantic `<blockquote>` with an inline-start rule and secondary
 * text color, matching the Astryx visual language.
 *
 * @example
 * ```
 * <Blockquote>Design is not just what it looks like.</Blockquote>
 * ```
 */
export function Blockquote({
  children,
  cite,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  return /*#__PURE__*/_jsxs("blockquote", {
    ref: ref,
    ...mergeProps(themeProps('blockquote'), stylex.props(styles.root, xstyle), className, style),
    ...props,
    children: [children, isRenderable(cite) && /*#__PURE__*/_jsx("cite", {
      ...{
        className: "x1lliihq xtbrsbv x141an7d x1ltkj2j x1j61x8r"
      },
      children: cite
    })]
  });
}
Blockquote.displayName = 'Blockquote';