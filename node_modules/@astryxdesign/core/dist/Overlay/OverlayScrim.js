// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file OverlayScrim.tsx
 * @input Scrim props (mode, position, align, visibility)
 * @output Renders the scrim div with background, media theme, transitions
 * @position Internal rendering primitive; used by Overlay and useOverlay
 *
 * Not exported directly — consumers use Overlay (component) or
 * useOverlay (hook), both of which render this internally.
 */
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, durationVars, easeVars, spacingVars } from "../theme/tokens.stylex.js";
import { MediaTheme } from "../theme/MediaTheme.js";
import { mergeProps } from "../utils/index.js";
import "./overlay.markers.stylex.js";
import { overlayScope } from "./overlay.markers.stylex.js";
import { themeProps } from "../utils/themeProps.js";

// =============================================================================
// Types (re-exported from index.ts for consumers)
// =============================================================================
import { jsx as _jsx } from "react/jsx-runtime";
// =============================================================================
// Styles
// =============================================================================

const styles = {
  base: {
    kVAEAm: "x10l6tqk",
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    kOIVth: "x1txdalj",
    kmVPX3: "x1b2ylru",
    kfzvcC: "x47corl",
    k1ekBW: "xxup5nn",
    kIyJzY: "xuedmi6 x12w9bfk",
    kAMwcw: "xlr8y92",
    $$css: true
  },
  fill: {
    kpwlN0: "x10a8y8t",
    $$css: true
  },
  bottom: {
    kkqhue: "x17y0mx6",
    krVfgx: "x1ey2m1c",
    $$css: true
  },
  top: {
    kkqhue: "x17y0mx6",
    k87sOh: "x13vifvy",
    $$css: true
  },
  alignStart: {
    kGNEyG: "x1cy8zhl",
    kjj79g: "x1nhvcw1",
    $$css: true
  },
  alignCenter: {
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    $$css: true
  },
  alignEnd: {
    kGNEyG: "xuk3077",
    kjj79g: "x1nhvcw1",
    $$css: true
  },
  scrimDark: {
    kWkggS: "x1u4601x",
    $$css: true
  },
  scrimLight: {
    kWkggS: "x1rkw3yq",
    $$css: true
  },
  hidden: {
    kSiTet: "xg01cxk",
    k33iCy: "xlshs6z",
    $$css: true
  },
  hiddenBottom: {
    k3aq6I: "x1weeur4",
    $$css: true
  },
  hiddenTop: {
    k3aq6I: "x105ttfm",
    $$css: true
  },
  visible: {
    kSiTet: "x1hc1fzr",
    k33iCy: "xnpuxes",
    kfzvcC: "x67bb7w",
    k3aq6I: "xnn1q72",
    kamtoy: "x4itv7f",
    $$css: true
  },
  visibleFromBottom: {
    kamtoy: "x4itv7f",
    k1tdAh: "xhbqy3z",
    $$css: true
  },
  visibleFromTop: {
    kamtoy: "x4itv7f",
    k1tdAh: "xub2912",
    $$css: true
  },
  hoverReveal: {
    kSiTet: "xg01cxk xcwhr9z x1v2claj",
    k33iCy: "xlshs6z xneequu x7v6acp",
    kfzvcC: "x47corl x8ydxbz x3730vf",
    $$css: true
  },
  hoverRevealBottom: {
    k3aq6I: "x1weeur4 x17hxqr7 xuqivmr",
    $$css: true
  },
  hoverRevealTop: {
    k3aq6I: "x105ttfm x17hxqr7 xuqivmr",
    $$css: true
  },
  focusReveal: {
    kSiTet: "xg01cxk x1v2claj",
    k33iCy: "xlshs6z x7v6acp",
    kfzvcC: "x47corl x3730vf",
    $$css: true
  },
  focusRevealBottom: {
    k3aq6I: "x1weeur4 xuqivmr",
    $$css: true
  },
  focusRevealTop: {
    k3aq6I: "x105ttfm xuqivmr",
    $$css: true
  }
};
const alignMap = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd
};
const positionMap = {
  fill: styles.fill,
  bottom: styles.bottom,
  top: styles.top
};

// =============================================================================
// Visibility style helpers — extract branching logic from render
// =============================================================================

/**
 * Returns visibility/animation styles for JS-controlled overlays (isOpen defined).
 * Uses position to determine slide direction for strips.
 */
function getControlledVisibility(isOpen, position) {
  if (isOpen) {
    return {
      base: styles.visible,
      bottom: position === 'bottom' && styles.visibleFromBottom,
      top: position === 'top' && styles.visibleFromTop
    };
  }
  return {
    base: styles.hidden,
    bottom: position === 'bottom' && styles.hiddenBottom,
    top: position === 'top' && styles.hiddenTop
  };
}

/**
 * Returns visibility/animation styles for CSS-driven overlays (showOn mode).
 * Each mode has a base reveal style + optional position-based slide.
 */
function getShowOnVisibility(showOn, position) {
  switch (showOn) {
    case 'always':
      return {
        base: styles.visible,
        bottom: position === 'bottom' && styles.visibleFromBottom,
        top: position === 'top' && styles.visibleFromTop
      };
    case 'hover':
    case 'hover-or-focus':
      return {
        base: styles.hoverReveal,
        bottom: position === 'bottom' && styles.hoverRevealBottom,
        top: position === 'top' && styles.hoverRevealTop
      };
    case 'focus':
      return {
        base: styles.focusReveal,
        bottom: position === 'bottom' && styles.focusRevealBottom,
        top: position === 'top' && styles.focusRevealTop
      };
  }
}

// =============================================================================
// Component (internal)
// =============================================================================

export function OverlayScrim({
  scrim,
  position,
  align,
  showOn,
  isOpen,
  children
}) {
  const isControlled = isOpen !== undefined;
  const themeMode = scrim === 'dark' ? 'dark' : scrim === 'light' ? 'light' : null;
  const content = themeMode ? /*#__PURE__*/_jsx(MediaTheme, {
    mode: themeMode,
    children: children
  }) : children;
  const visibility = isControlled ? getControlledVisibility(isOpen, position) : getShowOnVisibility(showOn, position);
  return /*#__PURE__*/_jsx("div", {
    ...mergeProps(themeProps('overlay-scrim', {
      position
    }), stylex.props(styles.base, positionMap[position], alignMap[align], scrim === 'dark' && styles.scrimDark, scrim === 'light' && styles.scrimLight, visibility.base, visibility.bottom, visibility.top)),
    inert: isControlled && !isOpen ? true : undefined,
    children: content
  });
}