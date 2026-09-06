// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file StackItem.tsx
 * @input Uses React, ElementType, stackItem utility
 * @output Exports StackItem polymorphic component and StackItemProps
 * @position Layout/Stack component; uses stackItem.stylex.ts
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Stack/Stack.doc.mjs
 * - /packages/cli/assets/templates/blocks/components/Stack/ (showcase blocks)
 */

import { createElement } from 'react';
import * as stylex from '@stylexjs/stylex';
import { stackItem } from "./stackItem.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
const overflowStyles = {
  scrollable: {
    kVQacm: "xysyzu8",
    $$css: true
  }
};
/**
 * Stack item component for controlling individual item behavior within a stack.
 *
 * Supports polymorphic rendering via the `as` prop.
 *
 * @example
 * ```
 * <HStack gap={2}>
 *   <StackItem size="static">Logo</StackItem>
 *   <StackItem size="fill">Content</StackItem>
 *   <StackItem size="static">Actions</StackItem>
 * </HStack>
 * ```
 */
export function StackItem({
  crossAlignSelf,
  size,
  isScrollable,
  as: element = 'div',
  xstyle,
  className,
  style,
  children,
  ref,
  ...props
}) {
  const stylexProps = stylex.props(...stackItem({
    crossAlignSelf,
    size
  }), isScrollable && overflowStyles.scrollable, xstyle);
  return /*#__PURE__*/createElement(element, {
    ref: ref,
    ...mergeProps(themeProps('stack-item', {
      size
    }), stylexProps, className, style),
    ...props
  }, children);
}
StackItem.displayName = 'StackItem';