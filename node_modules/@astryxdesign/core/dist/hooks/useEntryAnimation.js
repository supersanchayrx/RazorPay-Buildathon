// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useEntryAnimation.ts
 * @input Uses React, StyleX, theme tokens
 * @output Exports useEntryAnimation hook for mount-only entry animations
 * @position Hook utility; consumed by FieldStatus and available to consumers
 *
 * Provides entry animations for conditionally rendered elements.
 * Only animates when the element is dynamically mounted after the initial
 * page paint — statically rendered elements on page load are not animated.
 */
import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { durationVars, easeVars, spacingVars } from "../theme/tokens.stylex.js";

// Track whether the initial page paint has completed.
// Elements rendered on page load should not animate;
// only dynamically inserted ones should.
//
// NOTE: This module is marked 'use client' so it never runs on the server.
// If the directive is removed, this flag will always be false during SSR,
// and useState(() => initialPaintComplete) will capture false — meaning
// animations won't run after hydration. Keep 'use client' or add an
// effect-based fallback if SSR support is needed.
let initialPaintComplete = false;
if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    initialPaintComplete = true;
  });
}
const slideDown = "xiylxmw-B";
const slideUp = "x1b6yrix-B";
const fadeIn = "x18re5ia-B";
const scaleIn = "x1k48ry3-B";
const styles = {
  slideDown: {
    kKVMdj: "x1srr2gu x1aquc0h",
    k44tkh: "x9uej1z",
    kyAemX: "x128ha8g",
    kWV6AL: "xskzprw",
    $$css: true
  },
  slideUp: {
    kKVMdj: "x1dvww92 x1aquc0h",
    k44tkh: "x9uej1z",
    kyAemX: "x128ha8g",
    kWV6AL: "xskzprw",
    $$css: true
  },
  fadeIn: {
    kKVMdj: "xqcmdr3 x1aquc0h",
    k44tkh: "x9uej1z",
    kyAemX: "x128ha8g",
    kWV6AL: "xskzprw",
    $$css: true
  },
  scaleIn: {
    kKVMdj: "x97zbip x1aquc0h",
    k44tkh: "x9uej1z",
    kyAemX: "x128ha8g",
    kWV6AL: "xskzprw",
    $$css: true
  }
};
/**
 * Returns a StyleX style for animating an element on mount.
 *
 * Only animates when the element is dynamically inserted after the initial
 * page paint. Elements rendered on page load are not animated.
 *
 * @example
 * ```
 * const entryStyle = useEntryAnimation('slideDown');
 * <div {...stylex.props(entryStyle)}>Animated content</div>
 * ```
 */
export function useEntryAnimation(preset = 'slideDown') {
  const [animate] = useState(() => initialPaintComplete);
  return animate ? styles[preset] : null;
}