// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file stack.stylex.ts
 * @input Uses @stylexjs/stylex, spacing from theme
 * @output StyleX utility for stack (flex container) styling
 * @position Layout utility; used by HStack, VStack components
 *
 * SYNC: When modified, update /packages/core/src/Stack/Stack.doc.mjs
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
const alignItemsStyles = {
  center: {
    kGNEyG: "x6s0dn4",
    $$css: true
  },
  end: {
    kGNEyG: "xuk3077",
    $$css: true
  },
  start: {
    kGNEyG: "x1cy8zhl",
    $$css: true
  },
  stretch: {
    kGNEyG: "x1qjc9v5",
    $$css: true
  }
};

/**
 * Cross-axis alignment options for stack items.
 * - For HStack: vertical alignment
 * - For VStack: horizontal alignment
 */

const justifyContentStyles = {
  start: {
    kjj79g: "x1nhvcw1",
    $$css: true
  },
  center: {
    kjj79g: "xl56j7k",
    $$css: true
  },
  end: {
    kjj79g: "x13a6bvl",
    $$css: true
  },
  between: {
    kjj79g: "x1qughib",
    $$css: true
  },
  around: {
    kjj79g: "x1l1ennw",
    $$css: true
  },
  evenly: {
    kjj79g: "xaw8158",
    $$css: true
  }
};

/**
 * Main-axis alignment options for stack items.
 * - For HStack: horizontal alignment
 * - For VStack: vertical alignment
 */

const directionStyles = {
  horizontal: {
    kXwgrk: "x1q0g3np",
    $$css: true
  },
  vertical: {
    kXwgrk: "xdt5ytf",
    $$css: true
  }
};

/**
 * Stack direction.
 * - `horizontal`: Items flow left-to-right (HStack)
 * - `vertical`: Items flow top-to-bottom (VStack)
 */

const wrapStyles = {
  nowrap: {
    kwnvtZ: "xozqiw3",
    $$css: true
  },
  wrap: {
    kwnvtZ: "x1a02dak",
    $$css: true
  },
  "wrap-reverse": {
    kwnvtZ: "x8hhl5t",
    $$css: true
  }
};

/**
 * Flex wrap behavior.
 * - `nowrap`: Items stay on one line (default)
 * - `wrap`: Items wrap to next line
 * - `wrap-reverse`: Items wrap to previous line
 */

const baseStyles = {
  stack: {
    k1xSpc: "x78zum5",
    $$css: true
  }
};

/**
 * Gap styles using spacing tokens from the theme.
 * Keys are numeric SpacingStep values.
 */
const gapStyles = {
  "0": {
    k1C7PZ: "x1o57wo1",
    khm7nJ: "x6yxi7o",
    $$css: true
  },
  "1": {
    k1C7PZ: "x1lfs0n9",
    khm7nJ: "x1ngg2t4",
    $$css: true
  },
  "2": {
    k1C7PZ: "xak3so",
    khm7nJ: "x1x7z4sm",
    $$css: true
  },
  "3": {
    k1C7PZ: "xewh9hi",
    khm7nJ: "x4olc9o",
    $$css: true
  },
  "4": {
    k1C7PZ: "xty4p9g",
    khm7nJ: "xtx9w7w",
    $$css: true
  },
  "5": {
    k1C7PZ: "x1eqhezk",
    khm7nJ: "x1iu6piu",
    $$css: true
  },
  "6": {
    k1C7PZ: "x3qlgwd",
    khm7nJ: "xczp1bk",
    $$css: true
  },
  "8": {
    k1C7PZ: "xicv188",
    khm7nJ: "xgx0vcf",
    $$css: true
  },
  "10": {
    k1C7PZ: "x1p37tyl",
    khm7nJ: "x1xpicb7",
    $$css: true
  },
  "0.5": {
    k1C7PZ: "x1kihgfc",
    khm7nJ: "x1tw44j4",
    $$css: true
  },
  "1.5": {
    k1C7PZ: "x1thn6ci",
    khm7nJ: "xhq53yo",
    $$css: true
  }
};
/**
 * StyleX utility to add stack (flex container) styles to any element.
 *
 * @example
 * ```
 * import { stack } from '@astryxdesign/core/Layout';
 * import * as stylex from '@stylexjs/stylex';
 *
 * // Horizontal stack with numeric gap
 * <div {...stylex.props(...stack({ direction: 'horizontal', gap: 2 }))}>
 *   <Child />
 *   <Child />
 * </div>
 *
 * // Vertical stack with centered items
 * <div {...stylex.props(...stack({ direction: 'vertical', crossAlign: 'center' }))}>
 *   <Child />
 *   <Child />
 * </div>
 *
 * // Wrapping horizontal stack with larger gap
 * <div {...stylex.props(...stack({ direction: 'horizontal', gap: 4, wrap: 'wrap' }))}>
 *   <Child />
 *   <Child />
 *   <Child />
 * </div>
 * ```
 */
export function stack({
  crossAlign,
  direction,
  gap,
  mainAlign,
  wrap
}) {
  return [baseStyles.stack, directionStyles[direction], gap != null && gapStyles[gap], crossAlign != null && alignItemsStyles[crossAlign], mainAlign != null && justifyContentStyles[mainAlign], wrap != null && wrapStyles[wrap]];
}