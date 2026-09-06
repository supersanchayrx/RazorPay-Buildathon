// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file layerAnimations.stylex.ts
 * @input Uses StyleX, theme duration/easing tokens
 * @output Exports shared entry animation styles for layer-based components
 * @position Shared animation primitives; consumed by DropdownMenu, Popover,
 *   HoverCard, Tooltip, Selector, and any component using useLayer
 *
 * Provides opt-in entry animations for popover/layer components.
 * Components apply these via the `xstyle` prop on `layer.render()`.
 *
 * @example
 * ```
 * import {layerAnimations} from '../Layer/layerAnimations.stylex';
 *
 * // Direction-aware (for components that know placement):
 * layer.render(<Content />, {
 *   xstyle: layerAnimations[placement],
 * });
 *
 * // Fixed direction:
 * layer.render(<Content />, {
 *   xstyle: layerAnimations.below,
 * });
 * ```
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { durationVars, easeVars, spacingVars } from "../theme/tokens.stylex.js";
const enterBelow = "xv1hr86-B";
const enterAbove = "x1ahk7ht-B";
const enterEnd = "xwmkjkf-B";
const enterStart = "xu7jd1z-B";

// RTL: the horizontal entrance nudge is a physical translateX, so it must
// mirror under RTL — a layer on the inline-end/start side must slide in from
// the correct physical side following the reading flow. Only the horizontal
// (translateX) keyframes need mirroring; the vertical enterAbove/enterBelow
// (translateY) entrances are direction-neutral and are left as-is.
const enterEndRtl = "xu7jd1z-B";
const enterStartRtl = "xwmkjkf-B";
const animationBase = {
  animationDuration: durationVars['--duration-fast-max'],
  animationTimingFunction: easeVars['--ease-standard'],
  animationFillMode: 'backwards'
};

/**
 * Shared entry animation styles for layer-based components.
 *
 * Keyed by LayerPlacement ('above' | 'below' | 'start' | 'end')
 * for easy lookup: `layerAnimations[placement]`.
 *
 * Each entry disables its keyframe animation under
 * `prefers-reduced-motion: reduce` so the layer appears instantly instead of
 * translating/scaling in (infra-6).
 */
export const layerAnimations = {
  below: {
    kKVMdj: "xl1vlw0 x1aquc0h",
    k44tkh: "x9uej1z",
    kyAemX: "x128ha8g",
    kWV6AL: "xskzprw",
    $$css: true
  },
  above: {
    kKVMdj: "x3psbcj x1aquc0h",
    k44tkh: "x9uej1z",
    kyAemX: "x128ha8g",
    kWV6AL: "xskzprw",
    $$css: true
  },
  end: {
    kKVMdj: "x1i331go x1vxsm5i x1aquc0h",
    k44tkh: "x9uej1z",
    kyAemX: "x128ha8g",
    kWV6AL: "xskzprw",
    $$css: true
  },
  start: {
    kKVMdj: "xck01x9 x18lne9g x1aquc0h",
    k44tkh: "x9uej1z",
    kyAemX: "x128ha8g",
    kWV6AL: "xskzprw",
    $$css: true
  }
};