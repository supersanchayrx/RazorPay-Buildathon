// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file GridSpan.tsx
 * @input Uses React, stylex
 * @output Exports GridSpan component and GridSpanProps
 * @position Grid span component; controls grid item span
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Grid/Grid.doc.mjs
 * - /packages/core/src/Grid/Grid.test.tsx
 * - /apps/storybook/stories/Grid.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Grid/ (showcase blocks)
 */

import * as stylex from '@stylexjs/stylex';
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx } from "react/jsx-runtime";
const baseStyles = {
  span: {
    k7Eaqz: "xeuugli",
    k1xSpc: "xrvj5dj",
    kZKoxP: "x5yr21d",
    $$css: true
  }
};

/**
 * Grid span component for controlling how many columns/rows a grid item spans.
 *
 * Use as a direct child of Grid to make an item span multiple columns
 * or rows.
 *
 * @example
 * ```
 * <Grid columns={3} gap={4}>
 *   <GridSpan columns={2}>Wide item</GridSpan>
 *   <div>Normal</div>
 * </Grid>
 * ```
 */
export function GridSpan({
  columns,
  rows,
  xstyle,
  className,
  style,
  children,
  ref,
  ...props
}) {
  // Build inline style for grid spanning
  const inlineStyle = {
    ...(columns != null && {
      gridColumn: columns === 'full' ? '1 / -1' : `span ${columns}`
    }),
    ...(rows != null && {
      gridRow: `span ${rows}`
    })
  };
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    ...mergeProps(themeProps('grid-span'), stylex.props(baseStyles.span, xstyle), className, {
      ...style,
      ...inlineStyle
    }),
    ...props,
    children: children
  });
}
GridSpan.displayName = 'GridSpan';