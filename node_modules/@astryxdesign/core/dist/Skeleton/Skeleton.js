// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file Skeleton.tsx
 * @input Uses React, StyleX keyframes and tokens
 * @output Exports Skeleton component, SkeletonProps, SkeletonRadius types
 * @position Core implementation of skeleton loading placeholder
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Skeleton/Skeleton.doc.mjs
 * - /packages/core/src/Skeleton/index.ts
 * - /apps/storybook/stories/Skeleton.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Skeleton/ (showcase blocks)
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, radiusVars, durationVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

// =============================================================================
// Animation Timing Constants
// =============================================================================

/**
 * Initial delay before animation starts (ms).
 * Prevents flash of animation for fast-loading content.
 */
import { jsx as _jsx } from "react/jsx-runtime";
const DELAY_TIME = 1000;

/**
 * Stagger increment between sequential skeleton elements (ms).
 * Creates a wave effect when multiple skeletons are used together.
 */
const STAGGER_TIME = 100;

// =============================================================================
// Animation Keyframes
// =============================================================================

const skeletonFade = "xgnty7z-B";

// =============================================================================
// Styles
// =============================================================================

const styles = {
  root: {
    kWkggS: "xprdx6m x1j0df82 x1o55y2u",
    kSiTet: "xvpkmg4 x1tbh5bv",
    $$css: true
  },
  animate: {
    kILWW9: "xpz12be",
    k44tkh: "xqgcaz",
    ko0y90: "xa4qsjk",
    kKVMdj: "xeuoslp x1aquc0h",
    kyAemX: "x193epu2",
    $$css: true
  }
};
const radiusStyles = {
  "0": {
    kaIpWk: "xwksslw",
    $$css: true
  },
  "1": {
    kaIpWk: "xx3sua9",
    $$css: true
  },
  "2": {
    kaIpWk: "xh6dtrn",
    $$css: true
  },
  "3": {
    kaIpWk: "x1hviunn",
    $$css: true
  },
  "4": {
    kaIpWk: "x1hviunn",
    $$css: true
  },
  none: {
    kaIpWk: "x2u8bby",
    $$css: true
  },
  rounded: {
    kaIpWk: "xjspbzw",
    $$css: true
  }
};
const _temp = {
  kKxzle: "xvo38ju",
  "$$css": true
};
const dynamicStyles = {
  animationDelay: index => [_temp, {
    "--x-animationDelay": (val => typeof val === "number" ? val + "ms" : val != null ? val : undefined)(`${DELAY_TIME + STAGGER_TIME * index}ms`)
  }],
  dimensions: (width, height) => [{
    kzqmXN: (typeof width === 'number' ? `${width}px` : width) != null ? "x5lhr3w" : typeof width === 'number' ? `${width}px` : width,
    kZKoxP: (typeof height === 'number' ? `${height}px` : height) != null ? "x16ye13r" : typeof height === 'number' ? `${height}px` : height,
    $$css: true
  }, {
    "--x-width": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(typeof width === 'number' ? `${width}px` : width),
    "--x-height": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(typeof height === 'number' ? `${height}px` : height)
  }]
};

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Component
// =============================================================================

/**
 * A placeholder shape that indicates content is loading.
 * Renders a pulsing block with configurable width, height, and border radius.
 * Use the `index` prop to stagger animation timing across multiple skeletons.
 *
 * @example
 * ```
 * <Skeleton width={200} height={20} />
 * <Skeleton width={40} height={40} radius="rounded" />
 * <Skeleton width={300} height={16} index={0} />
 * <Skeleton width={280} height={16} index={1} />
 * ```
 */
export function Skeleton({
  width = '100%',
  height = '100%',
  radius: radiusProp = 3,
  index = 0,
  'data-testid': testId,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  return /*#__PURE__*/_jsx("div", {
    ref: ref
    // Purely decorative loading placeholder — hide from assistive tech so it
    // isn't announced as empty content. The surrounding region should convey
    // the loading/busy state (e.g. aria-busy) (complex-20). Consumers can
    // override via props if a specific skeleton must be exposed.
    ,
    "aria-hidden": "true",
    "data-testid": testId,
    ...mergeProps(themeProps('skeleton'), stylex.props(styles.root, styles.animate, radiusStyles[radiusProp], dynamicStyles.dimensions(width, height), dynamicStyles.animationDelay(index), xstyle), className, style),
    ...props
  });
}
Skeleton.displayName = 'Skeleton';