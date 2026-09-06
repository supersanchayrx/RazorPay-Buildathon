// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file padding.stylex.ts
 * @input Uses @stylexjs/stylex, spacing from theme
 * @output StyleX styles for numeric padding prop on layout components
 * @position Layout utility; used by Card, Section, and Layout sub-components
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
/**
 * Maps numeric SpacingStep values to SpacingToken keys used by the container system.
 */
export const spacingStepToToken = {
  0: 'spacing0',
  0.5: 'spacing0_5',
  1: 'spacing1',
  1.5: 'spacing1_5',
  2: 'spacing2',
  3: 'spacing3',
  4: 'spacing4',
  5: 'spacing5',
  6: 'spacing6',
  8: 'spacing8',
  10: 'spacing10'
};

/**
 * Padding styles for all sides using spacing tokens.
 * Each key applies uniform padding to all four sides.
 */
export const paddingStyles = {
  "0": {
    kZCmMZ: "x18gyask",
    kwRFfy: "x1s0aq8i",
    kLKAdn: "x1ydh6w3",
    kGO01o: "x1l20ajd",
    $$css: true
  },
  "1": {
    kZCmMZ: "x1vsv5vr",
    kwRFfy: "x1nryj5t",
    kLKAdn: "xfsso4q",
    kGO01o: "xy143xn",
    $$css: true
  },
  "2": {
    kZCmMZ: "x12gdq22",
    kwRFfy: "x1djylfy",
    kLKAdn: "x1xye8es",
    kGO01o: "x1wesfrj",
    $$css: true
  },
  "3": {
    kZCmMZ: "x126nfab",
    kwRFfy: "x1t818jl",
    kLKAdn: "x1vlblms",
    kGO01o: "xvmdzux",
    $$css: true
  },
  "4": {
    kZCmMZ: "x1rey3nv",
    kwRFfy: "xnjyzlh",
    kLKAdn: "x1oa1p4a",
    kGO01o: "x1awphl8",
    $$css: true
  },
  "5": {
    kZCmMZ: "x1blguxw",
    kwRFfy: "xdbrk9v",
    kLKAdn: "xx7rijo",
    kGO01o: "x1hk98q",
    $$css: true
  },
  "6": {
    kZCmMZ: "x31w388",
    kwRFfy: "x1we12cn",
    kLKAdn: "x1adxfkp",
    kGO01o: "xjpqqx5",
    $$css: true
  },
  "8": {
    kZCmMZ: "x1j3hnjz",
    kwRFfy: "x1q91b2g",
    kLKAdn: "xoxd1wu",
    kGO01o: "x2oz4g1",
    $$css: true
  },
  "10": {
    kZCmMZ: "xqp078j",
    kwRFfy: "x160ivqr",
    kLKAdn: "xk6660b",
    kGO01o: "x2izi54",
    $$css: true
  },
  "0.5": {
    kZCmMZ: "x138rykx",
    kwRFfy: "x1le3yxw",
    kLKAdn: "xbx876j",
    kGO01o: "xij103a",
    $$css: true
  },
  "1.5": {
    kZCmMZ: "xfti1ec",
    kwRFfy: "x17hk9do",
    kLKAdn: "x1kwdpsa",
    kGO01o: "x1opdxmq",
    $$css: true
  }
};

/**
 * Container padding inline CSS variable styles for edge compensation.
 * Sets --container-padding-inline-start and --container-padding-inline-end so
 * edge-compensating children know the inline padding to compensate against.
 */
export const containerPaddingInlineVarStyles = {
  "0": {
    "--container-padding-inline-start": "x1gu2k80",
    "--container-padding-inline-end": "x91ghl5",
    $$css: true
  },
  "1": {
    "--container-padding-inline-start": "x1cvlban",
    "--container-padding-inline-end": "x2oyxnl",
    $$css: true
  },
  "2": {
    "--container-padding-inline-start": "x1xlrr2o",
    "--container-padding-inline-end": "xcas3b9",
    $$css: true
  },
  "3": {
    "--container-padding-inline-start": "xfdwxua",
    "--container-padding-inline-end": "xu0ipoa",
    $$css: true
  },
  "4": {
    "--container-padding-inline-start": "x1dlhslv",
    "--container-padding-inline-end": "xs0pscg",
    $$css: true
  },
  "5": {
    "--container-padding-inline-start": "x1s81nki",
    "--container-padding-inline-end": "xgkj7vj",
    $$css: true
  },
  "6": {
    "--container-padding-inline-start": "x1ep0dkj",
    "--container-padding-inline-end": "x94cj42",
    $$css: true
  },
  "8": {
    "--container-padding-inline-start": "xw1diwv",
    "--container-padding-inline-end": "x1b9k1pi",
    $$css: true
  },
  "10": {
    "--container-padding-inline-start": "xserb3f",
    "--container-padding-inline-end": "xx5lg5w",
    $$css: true
  },
  "0.5": {
    "--container-padding-inline-start": "x14ws0sr",
    "--container-padding-inline-end": "x1wz3t3y",
    $$css: true
  },
  "1.5": {
    "--container-padding-inline-start": "x176g23i",
    "--container-padding-inline-end": "xntetml",
    $$css: true
  }
};

/**
 * Container padding block-start/block-end CSS variable styles for vertical bleed.
 * Sets --container-padding-block-start and --container-padding-block-end so bleed children (Table, Divider, Section)
 * know the block padding to compensate against when first/last child.
 */
export const containerPaddingBlockStartVarStyles = {
  "0": {
    "--container-padding-block-start": "x1i3qcxz",
    $$css: true
  },
  "1": {
    "--container-padding-block-start": "xnsckjb",
    $$css: true
  },
  "2": {
    "--container-padding-block-start": "xa8b4fq",
    $$css: true
  },
  "3": {
    "--container-padding-block-start": "x11k4f5r",
    $$css: true
  },
  "4": {
    "--container-padding-block-start": "xm01sq8",
    $$css: true
  },
  "5": {
    "--container-padding-block-start": "xp8wdkl",
    $$css: true
  },
  "6": {
    "--container-padding-block-start": "x1hmud4d",
    $$css: true
  },
  "8": {
    "--container-padding-block-start": "xfv60at",
    $$css: true
  },
  "10": {
    "--container-padding-block-start": "x17h9kl7",
    $$css: true
  },
  "0.5": {
    "--container-padding-block-start": "xvdf9ev",
    $$css: true
  },
  "1.5": {
    "--container-padding-block-start": "x1kbx601",
    $$css: true
  }
};
export const containerPaddingBlockEndVarStyles = {
  "0": {
    "--container-padding-block-end": "xkunwnr",
    $$css: true
  },
  "1": {
    "--container-padding-block-end": "x57a7ii",
    $$css: true
  },
  "2": {
    "--container-padding-block-end": "x1lsgcmx",
    $$css: true
  },
  "3": {
    "--container-padding-block-end": "x1q3ppug",
    $$css: true
  },
  "4": {
    "--container-padding-block-end": "x4hfsld",
    $$css: true
  },
  "5": {
    "--container-padding-block-end": "xbib2ws",
    $$css: true
  },
  "6": {
    "--container-padding-block-end": "x1q8d17g",
    $$css: true
  },
  "8": {
    "--container-padding-block-end": "x8lgq76",
    $$css: true
  },
  "10": {
    "--container-padding-block-end": "x15vxphk",
    $$css: true
  },
  "0.5": {
    "--container-padding-block-end": "x1cao3zv",
    $$css: true
  },
  "1.5": {
    "--container-padding-block-end": "xv53x8y",
    $$css: true
  }
};

/**
 * Layout outer X padding CSS variable styles.
 */
export const layoutPaddingOuterXVarStyles = {
  "0": {
    "--layout-padding-outer-x": "xswhm3q",
    $$css: true
  },
  "1": {
    "--layout-padding-outer-x": "xc96xmq",
    $$css: true
  },
  "2": {
    "--layout-padding-outer-x": "x15dxnc0",
    $$css: true
  },
  "3": {
    "--layout-padding-outer-x": "xadgj3j",
    $$css: true
  },
  "4": {
    "--layout-padding-outer-x": "x1v56qcf",
    $$css: true
  },
  "5": {
    "--layout-padding-outer-x": "x1nzs0gl",
    $$css: true
  },
  "6": {
    "--layout-padding-outer-x": "x1c3n52a",
    $$css: true
  },
  "8": {
    "--layout-padding-outer-x": "x1t3kfz",
    $$css: true
  },
  "10": {
    "--layout-padding-outer-x": "x1jdf5a4",
    $$css: true
  },
  "0.5": {
    "--layout-padding-outer-x": "xihiwg7",
    $$css: true
  },
  "1.5": {
    "--layout-padding-outer-x": "x1u93lgd",
    $$css: true
  }
};

/**
 * Layout outer Y padding CSS variable styles.
 */
export const layoutPaddingOuterYVarStyles = {
  "0": {
    "--layout-padding-outer-y": "x1mzf5mb",
    $$css: true
  },
  "1": {
    "--layout-padding-outer-y": "x1gpfxoh",
    $$css: true
  },
  "2": {
    "--layout-padding-outer-y": "x10pz7y9",
    $$css: true
  },
  "3": {
    "--layout-padding-outer-y": "x1p6yq3h",
    $$css: true
  },
  "4": {
    "--layout-padding-outer-y": "xx738ci",
    $$css: true
  },
  "5": {
    "--layout-padding-outer-y": "x6yxws5",
    $$css: true
  },
  "6": {
    "--layout-padding-outer-y": "x180vrwl",
    $$css: true
  },
  "8": {
    "--layout-padding-outer-y": "xid7e43",
    $$css: true
  },
  "10": {
    "--layout-padding-outer-y": "x26l4wa",
    $$css: true
  },
  "0.5": {
    "--layout-padding-outer-y": "x1vj96e0",
    $$css: true
  },
  "1.5": {
    "--layout-padding-outer-y": "xd3dqby",
    $$css: true
  }
};

/**
 * Inline-only padding styles.
 * Use when a component needs to set inline (horizontal) padding independently
 * of block padding — e.g. the `paddingX` prop on Stack.
 */
export const paddingInlineStyles = {
  "0": {
    kZCmMZ: "x18gyask",
    kwRFfy: "x1s0aq8i",
    $$css: true
  },
  "1": {
    kZCmMZ: "x1vsv5vr",
    kwRFfy: "x1nryj5t",
    $$css: true
  },
  "2": {
    kZCmMZ: "x12gdq22",
    kwRFfy: "x1djylfy",
    $$css: true
  },
  "3": {
    kZCmMZ: "x126nfab",
    kwRFfy: "x1t818jl",
    $$css: true
  },
  "4": {
    kZCmMZ: "x1rey3nv",
    kwRFfy: "xnjyzlh",
    $$css: true
  },
  "5": {
    kZCmMZ: "x1blguxw",
    kwRFfy: "xdbrk9v",
    $$css: true
  },
  "6": {
    kZCmMZ: "x31w388",
    kwRFfy: "x1we12cn",
    $$css: true
  },
  "8": {
    kZCmMZ: "x1j3hnjz",
    kwRFfy: "x1q91b2g",
    $$css: true
  },
  "10": {
    kZCmMZ: "xqp078j",
    kwRFfy: "x160ivqr",
    $$css: true
  },
  "0.5": {
    kZCmMZ: "x138rykx",
    kwRFfy: "x1le3yxw",
    $$css: true
  },
  "1.5": {
    kZCmMZ: "xfti1ec",
    kwRFfy: "x17hk9do",
    $$css: true
  }
};

/**
 * Block-only padding override styles.
 * Use when a component needs to override block padding independently
 * of inline padding (e.g., Toolbar sets tight block padding while
 * inheriting inline padding from its container).
 */
export const paddingBlockStyles = {
  "0": {
    kLKAdn: "x1ydh6w3",
    kGO01o: "x1l20ajd",
    $$css: true
  },
  "1": {
    kLKAdn: "xfsso4q",
    kGO01o: "xy143xn",
    $$css: true
  },
  "2": {
    kLKAdn: "x1xye8es",
    kGO01o: "x1wesfrj",
    $$css: true
  },
  "3": {
    kLKAdn: "x1vlblms",
    kGO01o: "xvmdzux",
    $$css: true
  },
  "4": {
    kLKAdn: "x1oa1p4a",
    kGO01o: "x1awphl8",
    $$css: true
  },
  "5": {
    kLKAdn: "xx7rijo",
    kGO01o: "x1hk98q",
    $$css: true
  },
  "6": {
    kLKAdn: "x1adxfkp",
    kGO01o: "xjpqqx5",
    $$css: true
  },
  "8": {
    kLKAdn: "xoxd1wu",
    kGO01o: "x2oz4g1",
    $$css: true
  },
  "10": {
    kLKAdn: "xk6660b",
    kGO01o: "x2izi54",
    $$css: true
  },
  "0.5": {
    kLKAdn: "xbx876j",
    kGO01o: "xij103a",
    $$css: true
  },
  "1.5": {
    kLKAdn: "x1kwdpsa",
    kGO01o: "x1opdxmq",
    $$css: true
  }
};

/**
 * Inline-start-only padding override styles.
 * Use when a component needs to override the inline-start edge independently
 * of inline-end. Logical, so it follows the writing direction (left in LTR,
 * right in RTL).
 */
export const paddingInlineStartStyles = {
  "0": {
    kZCmMZ: "x18gyask",
    $$css: true
  },
  "1": {
    kZCmMZ: "x1vsv5vr",
    $$css: true
  },
  "2": {
    kZCmMZ: "x12gdq22",
    $$css: true
  },
  "3": {
    kZCmMZ: "x126nfab",
    $$css: true
  },
  "4": {
    kZCmMZ: "x1rey3nv",
    $$css: true
  },
  "5": {
    kZCmMZ: "x1blguxw",
    $$css: true
  },
  "6": {
    kZCmMZ: "x31w388",
    $$css: true
  },
  "8": {
    kZCmMZ: "x1j3hnjz",
    $$css: true
  },
  "10": {
    kZCmMZ: "xqp078j",
    $$css: true
  },
  "0.5": {
    kZCmMZ: "x138rykx",
    $$css: true
  },
  "1.5": {
    kZCmMZ: "xfti1ec",
    $$css: true
  }
};

/**
 * Inline-end-only padding override styles.
 * The inline-end counterpart of paddingInlineStartStyles.
 */
export const paddingInlineEndStyles = {
  "0": {
    kwRFfy: "x1s0aq8i",
    $$css: true
  },
  "1": {
    kwRFfy: "x1nryj5t",
    $$css: true
  },
  "2": {
    kwRFfy: "x1djylfy",
    $$css: true
  },
  "3": {
    kwRFfy: "x1t818jl",
    $$css: true
  },
  "4": {
    kwRFfy: "xnjyzlh",
    $$css: true
  },
  "5": {
    kwRFfy: "xdbrk9v",
    $$css: true
  },
  "6": {
    kwRFfy: "x1we12cn",
    $$css: true
  },
  "8": {
    kwRFfy: "x1q91b2g",
    $$css: true
  },
  "10": {
    kwRFfy: "x160ivqr",
    $$css: true
  },
  "0.5": {
    kwRFfy: "x1le3yxw",
    $$css: true
  },
  "1.5": {
    kwRFfy: "x17hk9do",
    $$css: true
  }
};

/**
 * Container padding inline-start CSS variable style, set independently of
 * inline-end so a per-edge override keeps edge-compensating children (Card,
 * Divider, a nested Section) compensating against the padding actually
 * applied on that edge.
 */
export const containerPaddingInlineStartVarStyles = {
  "0": {
    "--container-padding-inline-start": "x1gu2k80",
    $$css: true
  },
  "1": {
    "--container-padding-inline-start": "x1cvlban",
    $$css: true
  },
  "2": {
    "--container-padding-inline-start": "x1xlrr2o",
    $$css: true
  },
  "3": {
    "--container-padding-inline-start": "xfdwxua",
    $$css: true
  },
  "4": {
    "--container-padding-inline-start": "x1dlhslv",
    $$css: true
  },
  "5": {
    "--container-padding-inline-start": "x1s81nki",
    $$css: true
  },
  "6": {
    "--container-padding-inline-start": "x1ep0dkj",
    $$css: true
  },
  "8": {
    "--container-padding-inline-start": "xw1diwv",
    $$css: true
  },
  "10": {
    "--container-padding-inline-start": "xserb3f",
    $$css: true
  },
  "0.5": {
    "--container-padding-inline-start": "x14ws0sr",
    $$css: true
  },
  "1.5": {
    "--container-padding-inline-start": "x176g23i",
    $$css: true
  }
};

/**
 * Container padding inline-end CSS variable style, the counterpart of
 * containerPaddingInlineStartVarStyles.
 */
export const containerPaddingInlineEndVarStyles = {
  "0": {
    "--container-padding-inline-end": "x91ghl5",
    $$css: true
  },
  "1": {
    "--container-padding-inline-end": "x2oyxnl",
    $$css: true
  },
  "2": {
    "--container-padding-inline-end": "xcas3b9",
    $$css: true
  },
  "3": {
    "--container-padding-inline-end": "xu0ipoa",
    $$css: true
  },
  "4": {
    "--container-padding-inline-end": "xs0pscg",
    $$css: true
  },
  "5": {
    "--container-padding-inline-end": "xgkj7vj",
    $$css: true
  },
  "6": {
    "--container-padding-inline-end": "x94cj42",
    $$css: true
  },
  "8": {
    "--container-padding-inline-end": "x1b9k1pi",
    $$css: true
  },
  "10": {
    "--container-padding-inline-end": "xx5lg5w",
    $$css: true
  },
  "0.5": {
    "--container-padding-inline-end": "x1wz3t3y",
    $$css: true
  },
  "1.5": {
    "--container-padding-inline-end": "xntetml",
    $$css: true
  }
};

/**
 * Block-start-only padding override styles.
 * Use when a component needs to override the block-start (top) edge
 * independently of block-end — e.g. a section that sits under a sticky
 * header and needs less padding above than below.
 */
export const paddingBlockStartStyles = {
  "0": {
    kLKAdn: "x1ydh6w3",
    $$css: true
  },
  "1": {
    kLKAdn: "xfsso4q",
    $$css: true
  },
  "2": {
    kLKAdn: "x1xye8es",
    $$css: true
  },
  "3": {
    kLKAdn: "x1vlblms",
    $$css: true
  },
  "4": {
    kLKAdn: "x1oa1p4a",
    $$css: true
  },
  "5": {
    kLKAdn: "xx7rijo",
    $$css: true
  },
  "6": {
    kLKAdn: "x1adxfkp",
    $$css: true
  },
  "8": {
    kLKAdn: "xoxd1wu",
    $$css: true
  },
  "10": {
    kLKAdn: "xk6660b",
    $$css: true
  },
  "0.5": {
    kLKAdn: "xbx876j",
    $$css: true
  },
  "1.5": {
    kLKAdn: "x1kwdpsa",
    $$css: true
  }
};

/**
 * Block-end-only padding override styles.
 * The block-end counterpart of paddingBlockStartStyles.
 */
export const paddingBlockEndStyles = {
  "0": {
    kGO01o: "x1l20ajd",
    $$css: true
  },
  "1": {
    kGO01o: "xy143xn",
    $$css: true
  },
  "2": {
    kGO01o: "x1wesfrj",
    $$css: true
  },
  "3": {
    kGO01o: "xvmdzux",
    $$css: true
  },
  "4": {
    kGO01o: "x1awphl8",
    $$css: true
  },
  "5": {
    kGO01o: "x1hk98q",
    $$css: true
  },
  "6": {
    kGO01o: "xjpqqx5",
    $$css: true
  },
  "8": {
    kGO01o: "x2oz4g1",
    $$css: true
  },
  "10": {
    kGO01o: "x2izi54",
    $$css: true
  },
  "0.5": {
    kGO01o: "xij103a",
    $$css: true
  },
  "1.5": {
    kGO01o: "x1opdxmq",
    $$css: true
  }
};

/**
 * Propagation styles for `--_section-padding-propagated`.
 * When a parent section sets explicit padding, this propagates the value
 * through the CSS custom property cascade so nested sections that use
 * useThemeDefault inherit the parent's padding instead of the theme default.
 *
 * This is deliberately NOT the public `--astryx-section-padding` token. The
 * two carry different authority: the public token is the THEME's section
 * padding, set once at the theme root, while this one is one ancestor
 * Section's padding, propagated down the tree. An overlay has to drop the
 * inherited value at its boundary (see {@link overlayPaddingReset}) without
 * dropping the theme's — impossible while both live under one name.
 * `container.stylex.ts` reads this ahead of the public token, so a propagated
 * value still wins over the theme for nested sections, as before.
 */
export const sectionPaddingPropagationStyles = {
  "0": {
    "--_section-padding-propagated": "x7mo41q",
    $$css: true
  },
  "1": {
    "--_section-padding-propagated": "x1j3iakl",
    $$css: true
  },
  "2": {
    "--_section-padding-propagated": "xezgk69",
    $$css: true
  },
  "3": {
    "--_section-padding-propagated": "x1wtz8uf",
    $$css: true
  },
  "4": {
    "--_section-padding-propagated": "x5wdj8h",
    $$css: true
  },
  "5": {
    "--_section-padding-propagated": "xgjndll",
    $$css: true
  },
  "6": {
    "--_section-padding-propagated": "x15i4jqh",
    $$css: true
  },
  "8": {
    "--_section-padding-propagated": "xmb9lpv",
    $$css: true
  },
  "10": {
    "--_section-padding-propagated": "x4h2jfd",
    $$css: true
  },
  "0.5": {
    "--_section-padding-propagated": "x2ccaqq",
    $$css: true
  },
  "1.5": {
    "--_section-padding-propagated": "xxa843v",
    $$css: true
  }
};

/**
 * Padding-variable reset for overlay roots (Dialog, BottomSheet, Drawer,
 * MobileNav, Lightbox, and every layer surface).
 *
 * ## Why an overlay needs this
 *
 * The container padding system talks to descendants through inherited custom
 * properties: a padded container announces its padding, and children read the
 * value either to apply it or to cancel it with a negative margin
 * (`Section`, `Divider`, `Layout`, `Table`).
 *
 * Inheritance follows the DOM, but an overlay leaves its parent's visual box —
 * a fixed/top-layer `<dialog>` is a DOM descendant of the padded page while
 * being nowhere near it on screen. It inherits values describing padding that
 * is not there, and its content compensates against phantom space: a `Section`
 * inside a 640px sheet rendered 672px wide and hung off both edges (#5208).
 *
 * Two families leak, and they need opposite treatments:
 *
 * - `--container-padding-*` -> `0px`. Descendants SUBTRACT these (bleed
 *   margins). The overlay root has no padding of its own to escape, so the
 *   honest answer is zero. Nested containers that do set padding (a Dialog's
 *   content wrapper) re-announce their own values below this point, so
 *   legitimate edge-to-edge bleed inside the overlay is unaffected.
 * - `--layout-padding-*` and `--_section-padding-propagated` -> `initial`.
 *   Descendants ADD these, so zeroing them would strip padding rather than
 *   restore it. `initial` makes each guaranteed-invalid, so readers fall
 *   through their own `var(…, fallback)` chain and land on the theme default —
 *   which is what an overlay at the top of the tree should show.
 *
 * `initial` is also why propagation moved off `--astryx-section-padding`: that
 * name is public theme surface, set at the theme root, and making it invalid
 * here would blank the theme's own section padding inside every overlay.
 *
 * Apply on the overlay's outermost styled element.
 *
 * @example
 * ```
 * <dialog {...stylex.props(styles.dialog, overlayPaddingReset.reset)} />
 * ```
 */
export const overlayPaddingReset = {
  reset: {
    "--container-padding-inline-start": "xrhngw9",
    "--container-padding-inline-end": "xjsfl84",
    "--container-padding-block-start": "x1047aw6",
    "--container-padding-block-end": "xax9j7h",
    "--layout-padding-outer-x": "xdt8ak2",
    "--layout-padding-outer-y": "x1rs4lu4",
    "--layout-padding-inner-x": "x1qfll2g",
    "--layout-padding-inner-y": "xyvxpqs",
    "--_section-padding-propagated": "x1f17rg1",
    $$css: true
  }
};