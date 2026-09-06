// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file stackItem.stylex.ts
 * @input Uses @stylexjs/stylex
 * @output StyleX utility for stack item styling
 * @position Layout utility; used by StackItem and directly by components
 *
 * SYNC: When modified, update /packages/core/src/Stack/Stack.doc.mjs
 */

import * as stylex from '@stylexjs/stylex';

/**
 * "Resets" the min-width and min-height of the flex item to behave predictably.
 *
 * Flex items have an implicit min size of auto, meaning they will never shrink
 * smaller than their contents. This reset allows items to be constrained by
 * their flex parent and become scrollable if necessary.
 */
const minSizeResetStyles = {
  reset: {
    kAzted: "x2lwn1j",
    k7Eaqz: "xeuugli",
    $$css: true
  }
};
const crossAlignSelfStyles = {
  center: {
    kSGwAc: "xamitd3",
    $$css: true
  },
  end: {
    kSGwAc: "xpvyfi4",
    $$css: true
  },
  start: {
    kSGwAc: "xqcrz7y",
    $$css: true
  },
  stretch: {
    kSGwAc: "xkh2ocl",
    $$css: true
  }
};

/**
 * Cross-alignment options for stack items.
 * Overrides the default cross-alignment set on the parent stack.
 */

const sizeStyles = {
  fill: {
    kzQI83: "x1iyjqo2",
    $$css: true
  },
  static: {
    kzQI83: "x1c4vz4f",
    kmuXW: "x2lah0s",
    $$css: true
  }
};

/**
 * Size options for stack items.
 * - `static`: Item uses its intrinsic size, won't grow or shrink
 * - `fill`: Item grows to fill remaining space (flexGrow: 1)
 */

/**
 * StyleX utility to add stack item styles to any component.
 *
 * Use this to avoid wrapping components in StackItem when you need
 * direct control over flex behavior.
 *
 * @example
 * ```
 * import { stackItem } from '@astryxdesign/core/Layout';
 *
 * <div {...stylex.props(...stackItem({ size: 'fill' }))}>
 *   Content that fills remaining space
 * </div>
 * ```
 */
export function stackItem({
  crossAlignSelf,
  size
} = {}) {
  return [minSizeResetStyles.reset, sizeStyles[size ?? 'static'], crossAlignSelf != null && crossAlignSelfStyles[crossAlignSelf]];
}