// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file HStack.tsx
 * @input Uses Stack component
 * @output Exports HStack as a thin wrapper around Stack
 * @position Layout/Stack component; wraps Stack with direction='horizontal'
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Stack/Stack.doc.mjs
 * - /packages/core/src/HStack/HStack.test.tsx
 * - /packages/cli/assets/templates/blocks/components/HStack/ (showcase blocks)
 */

import { Stack } from "../Stack/Stack.js";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Horizontal stack component for arranging items left-to-right.
 * Convenience wrapper around `Stack` with `direction="horizontal"`.
 *
 * @example
 * ```
 * <HStack gap={2}>
 *   <Item />
 *   <Item />
 * </HStack>
 * ```
 */
export function HStack({
  ref,
  justify,
  align,
  hAlign,
  vAlign,
  ...props
}) {
  return /*#__PURE__*/_jsx(Stack, {
    ...props,
    direction: "horizontal",
    hAlign: hAlign ?? justify,
    vAlign: vAlign ?? align,
    ref: ref
  });
}
HStack.displayName = 'HStack';