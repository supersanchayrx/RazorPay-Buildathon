// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file Stack.tsx
 * @input Uses React, ElementType, stack utility
 * @output Exports Stack polymorphic component and StackProps
 * @position Layout/Stack component; uses stack.stylex.ts
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Stack/Stack.doc.mjs
 * - /apps/storybook/stories/Stack.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Stack/ (showcase blocks)
 */

import { createElement } from 'react';
import * as stylex from '@stylexjs/stylex';
import { stack } from "./stack.stylex.js";
import { paddingInlineStartStyles, paddingInlineEndStyles, paddingBlockStartStyles, paddingBlockEndStyles } from "../Layout/padding.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
const overflowStyles = {
  scrollable: {
    kVQacm: "xysyzu8",
    $$css: true
  }
};

/**
 * Alignment values accepted by Stack.
 *
 * The full union of main-axis and cross-axis alignment values.
 * Which values are valid depends on direction and axis:
 * - Main axis (hAlign for horizontal, vAlign for vertical):
 *   `'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'`
 * - Cross axis (vAlign for horizontal, hAlign for vertical):
 *   `'start' | 'center' | 'end' | 'stretch'`
 */

/**
 * Unified stack component for arranging items in a horizontal or vertical layout.
 *
 * Replaces `HStack` and `VStack` with a single component that accepts
 * a `direction` prop. Defaults to `'vertical'` since most layouts stack
 * top-to-bottom.
 *
 * The `hAlign` and `vAlign` props automatically map to the correct CSS axis
 * based on the direction:
 * - `direction='horizontal'`: hAlign → justify-content, vAlign → align-items
 * - `direction='vertical'`: hAlign → align-items, vAlign → justify-content
 *
 * @example
 * ```
 * <Stack gap={2}>
 *   <Item />
 *   <Item />
 * </Stack>
 * <Stack direction="horizontal" gap={4} vAlign="center">
 *   <Item />
 *   <Item />
 * </Stack>
 * ```
 */
export function Stack({
  direction = 'vertical',
  hAlign,
  vAlign,
  justify,
  align,
  gap,
  padding,
  paddingInline,
  paddingInlineStart,
  paddingInlineEnd,
  paddingBlock,
  paddingBlockStart,
  paddingBlockEnd,
  isScrollable,
  width,
  height,
  maxWidth,
  minHeight,
  wrap,
  as: element = 'div',
  xstyle,
  className,
  style,
  children,
  ref,
  ...props
}) {
  // Resolve align/justify aliases based on direction
  const resolvedHAlign = hAlign ?? (direction === 'horizontal' ? justify : align);
  const resolvedVAlign = vAlign ?? (direction === 'horizontal' ? align : justify);

  // Map hAlign/vAlign to mainAlign/crossAlign based on direction
  const mainAlign = direction === 'horizontal' ? resolvedHAlign : resolvedVAlign;
  const crossAlign = direction === 'horizontal' ? resolvedVAlign : resolvedHAlign;

  // Resolve padding to per-edge values. Most specific wins, per edge:
  // edge prop -> axis prop -> `padding`.
  const resolvedPaddingInlineStart = paddingInlineStart ?? paddingInline ?? padding;
  const resolvedPaddingInlineEnd = paddingInlineEnd ?? paddingInline ?? padding;
  const resolvedPaddingBlockStart = paddingBlockStart ?? paddingBlock ?? padding;
  const resolvedPaddingBlockEnd = paddingBlockEnd ?? paddingBlock ?? padding;
  const stylexProps = stylex.props(...stack({
    direction,
    crossAlign,
    mainAlign,
    gap,
    wrap
  }), resolvedPaddingInlineStart != null && paddingInlineStartStyles[resolvedPaddingInlineStart], resolvedPaddingInlineEnd != null && paddingInlineEndStyles[resolvedPaddingInlineEnd], resolvedPaddingBlockStart != null && paddingBlockStartStyles[resolvedPaddingBlockStart], resolvedPaddingBlockEnd != null && paddingBlockEndStyles[resolvedPaddingBlockEnd], isScrollable && overflowStyles.scrollable, xstyle);

  // Build inline style for dynamic sizing values
  const sizingStyle = {
    ...(width != null && {
      width: typeof width === 'number' ? `${width}px` : width
    }),
    ...(height != null && {
      height: typeof height === 'number' ? `${height}px` : height
    }),
    ...(maxWidth != null && {
      maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth
    }),
    ...(minHeight != null && {
      minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight
    })
  };
  return /*#__PURE__*/createElement(element, {
    ref: ref,
    ...mergeProps(themeProps('stack', {
      direction,
      gap,
      wrap
    }), stylexProps, className, {
      ...style,
      ...sizingStyle
    }),
    ...props
  }, children);
}
Stack.displayName = 'Stack';