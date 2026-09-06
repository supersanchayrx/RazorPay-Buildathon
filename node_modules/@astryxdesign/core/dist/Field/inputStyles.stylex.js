// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file inputStyles.stylex.ts
 * @input Uses theme tokens (color, spacing, radius, shadow, transition)
 * @output Exports shared input wrapper appearance styles
 * @position Shared styles consumed by TextInput, TextArea, NumberInput, DateInput,
 *   TimeInput, Selector, Typeahead, and Tokenizer
 *
 * Centralizes the input wrapper appearance (borders, focus outlines, hover shadows,
 * disabled state, status variants) so all input components stay in sync.
 * Individual components layer their own overrides (padding, alignment, etc.)
 * via stylex.props composition.
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, radiusVars, shadowVars, durationVars, easeVars, borderVars } from "../theme/tokens.stylex.js";

/**
 * Base wrapper styles shared by all input components.
 * Components apply these as a foundation and override specific properties
 * (e.g. padding, alignItems, gap) as needed.
 */
export const inputWrapperStyles = {
  base: {
    kB7OPa: "x9f619",
    kVAEAm: "x1n2onr6",
    kY2c9j: "x1vjfegm",
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kOIVth: "x1txdalj",
    k8WAf4: "xu0wf1k",
    kg3NbH: "xf314gf",
    kMzoRj: "x1litavf",
    ksu8eU: "x1y0btm7",
    kVAM5u: "xvy26l8 x6q1khz",
    "--_field-radius": "x1832zxr",
    kaIpWk: "xvdfih8",
    kWkggS: "x10xzikg",
    k1ekBW: "x12zzom9",
    kIyJzY: "xuedmi6 x12w9bfk",
    kAMwcw: "xlr8y92",
    kGVxlE: "x1gnnqk1 x1xqjsvb xuihb5h",
    kI3sdo: "x1a2a7pz",
    $$css: true
  },
  disabled: {
    kkrTdU: "xt0e3qv",
    kSiTet: "xbyyjgo",
    kVAM5u: "xvy26l8",
    kGVxlE: "x1gnnqk1",
    $$css: true
  }
};

/**
 * Status border colors for input wrappers.
 * Keyed by InputStatusType.
 */
export const inputStatusBorderStyles = {
  warning: {
    kVAM5u: "x8wg1ba",
    $$css: true
  },
  error: {
    kVAM5u: "x1ofxpqo",
    $$css: true
  },
  success: {
    kVAM5u: "x16m2moy",
    $$css: true
  }
};

/**
 * Status hover shadow styles for input wrappers.
 * Keyed by InputStatusType.
 */
export const inputStatusHoverShadowStyles = {
  warning: {
    kGVxlE: "x1gnnqk1 x9156jc",
    $$css: true
  },
  error: {
    kGVxlE: "x1gnnqk1 x1bgmis8",
    $$css: true
  },
  success: {
    kGVxlE: "x1gnnqk1 x8wp45d",
    $$css: true
  }
};

/**
 * Status focus border styles using :focus-within.
 * Used by input wrappers that contain a child input/textarea element.
 * Keyed by InputStatusType.
 */
export const inputStatusFocusWithinStyles = {
  warning: {
    kVAM5u: "x8wg1ba xa1yw2k",
    $$css: true
  },
  error: {
    kVAM5u: "x1ofxpqo xk2sxw7",
    $$css: true
  },
  success: {
    kVAM5u: "x16m2moy xyq33ac",
    $$css: true
  }
};

/**
 * Status focus border styles using :focus.
 * Used by components where the wrapper itself receives focus (e.g. Selector button).
 * Keyed by InputStatusType.
 */
export const inputStatusFocusStyles = {
  warning: {
    kVAM5u: "x8wg1ba x12sck4v",
    $$css: true
  },
  error: {
    kVAM5u: "x1ofxpqo x64lkcz",
    $$css: true
  },
  success: {
    kVAM5u: "x16m2moy x1lglk5v",
    $$css: true
  }
};