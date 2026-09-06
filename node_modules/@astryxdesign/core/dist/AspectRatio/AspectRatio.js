// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file AspectRatio.tsx
 * @input Uses React, stylex
 * @output Exports AspectRatio component, AspectRatioProps, AspectRatioShape, AspectRatioFit
 * @position AspectRatio component; maintains a specific aspect ratio for its children
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/AspectRatio/AspectRatio.doc.mjs
 * - /packages/core/src/AspectRatio/AspectRatio.test.tsx
 * - /packages/core/src/reset.css (AspectRatio fit baseline rules)
 * - /apps/storybook/stories/AspectRatio.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/AspectRatio/ (showcase blocks)
 */

import * as stylex from '@stylexjs/stylex';
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

/**
 * The shape of the aspect ratio container.
 * - `rectangle`: standard rectangular container (default).
 * - `ellipse`: clips the container to an ellipse. Combined with the `ratio`,
 *   this renders a circle at `ratio={1}` and an oval at non-square ratios.
 */

/**
 * How the child is sized and positioned inside the ratio box.
 * - `cover`: the child fills the box; media is cropped to preserve its own
 *   aspect ratio (`object-fit: cover`).
 * - `contain`: the child fills the box; media is letterboxed to stay fully
 *   visible (`object-fit: contain`).
 * - `center`: the child keeps its natural size and sits centered in the box.
 */
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  container: {
    kVAEAm: "x1n2onr6",
    kzqmXN: "xh8yej3",
    kVQacm: "x7giv3",
    kAzted: "x2lwn1j",
    kmuXW: "x2lah0s",
    $$css: true
  },
  ellipse: {
    kaIpWk: "x16rqkct",
    $$css: true
  }
};

// The ratio compiles to a CSS variable + a class-level declaration
// (aspect-ratio: var(--x)) instead of a raw inline style, so consumer
// overrides — `xstyle` rules, including ones inside @media/@container
// queries — can still win. A raw inline `aspect-ratio` would beat any class
// (same rationale as Grid's dynamic track values). Non-StyleX consumers
// don't need a dedicated hook: the compiled declaration sits in the
// `astryx-base` cascade layer, so any unlayered consumer rule wins
// regardless of specificity.
const dynamicStyles = {
  ratio: ratio => [{
    kOBAk4: ratio != null ? "x10y9f9r" : ratio,
    $$css: true
  }, {
    "--x-aspectRatio": ratio != null ? ratio : undefined
  }]
};

/**
 * AspectRatio component for maintaining a specific aspect ratio for its children.
 *
 * Uses the CSS aspect-ratio property to maintain the ratio. The child element
 * is positioned absolutely to fill the container, which is useful for images,
 * videos, embeds, and placeholders.
 *
 * Use `fit` to let the component size the child: `cover`/`contain` stretch
 * the child to fill the box (cropping or letterboxing media), `center` keeps
 * the child at its natural size. Without `fit`, the child styles itself.
 *
 * Use `shape="ellipse"` to clip the container into an ellipse — a circle at
 * `ratio={1}` or an oval at other ratios. Both shapes respect the provided
 * `ratio`.
 *
 * The ratio is a class-level declaration (not an inline style), so it can be
 * overridden responsively — via `xstyle` for StyleX consumers, or with a
 * plain unlayered `aspect-ratio` rule for plain-CSS consumers (component
 * styles live in the `astryx-base` cascade layer, which unlayered CSS beats).
 *
 * Sizing: the box takes its width from its container and derives its height
 * from the ratio, so it needs an ancestor with a definite width. Two
 * consequences are worth knowing. Constraining only the height (`height` or
 * `maxHeight`) clamps the box without releasing the width, so the rendered
 * ratio no longer matches `ratio`; pass `width: 'auto'` alongside to size from
 * the height instead. And in a shrink-to-fit parent (`inline-flex`,
 * `width: fit-content`, a floated box) it contributes no intrinsic width and
 * collapses to zero.
 *
 * @example
 * ```
 * <AspectRatio ratio={16 / 9} fit="cover">
 *   <img src="image.jpg" alt="Widescreen image" />
 * </AspectRatio>
 * ```
 *
 * @example
 * ```
 * <AspectRatio ratio={1} shape="ellipse" fit="cover">
 *   <img src="avatar.jpg" alt="" />
 * </AspectRatio>
 * ```
 */
export function AspectRatio({
  ratio,
  shape = 'rectangle',
  fit,
  children,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    ...mergeProps(themeProps('aspect-ratio', {
      shape
    }), stylex.props(styles.container, dynamicStyles.ratio(ratio), shape === 'ellipse' && styles.ellipse, xstyle), className, style),
    ...props,
    children: /*#__PURE__*/_jsx("div", {
      "data-astryx-aspect-ratio-override": fit,
      ...{
        0: {
          className: "x10l6tqk x13vifvy x1o0tod xh8yej3 x5yr21d"
        },
        1: {
          className: "x10l6tqk x13vifvy x1o0tod xh8yej3 x5yr21d x78zum5 x6s0dn4 xl56j7k"
        }
      }[!!(fit === 'center') << 0],
      children: children
    })
  });
}
AspectRatio.displayName = 'AspectRatio';