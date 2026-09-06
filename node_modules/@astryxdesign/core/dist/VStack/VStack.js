// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file VStack.tsx
 * @input Uses Stack component
 * @output Exports VStack as a thin wrapper around Stack
 * @position Layout/Stack component; wraps Stack with direction='vertical'
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Stack/Stack.doc.mjs
 * - /packages/core/src/VStack/VStack.test.tsx
 * - /packages/cli/assets/templates/blocks/components/VStack/ (showcase blocks)
 */

import { Stack } from "../Stack/Stack.js";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Vertical stack component for arranging items top-to-bottom.
 * Convenience wrapper around `Stack` with `direction="vertical"`.
 *
 * @example
 * ```
 * <VStack gap={2}>
 *   <Item />
 *   <Item />
 * </VStack>
 * ```
 */
export function VStack({
  ref,
  justify,
  align,
  hAlign,
  vAlign,
  ...props
}) {
  return /*#__PURE__*/_jsx(Stack, {
    ...props,
    direction: "vertical",
    hAlign: hAlign ?? align,
    vAlign: vAlign ?? justify,
    ref: ref
  });
}
VStack.displayName = 'VStack';