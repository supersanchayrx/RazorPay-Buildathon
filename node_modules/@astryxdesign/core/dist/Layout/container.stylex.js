// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file container.stylex.ts
 * @input Uses @stylexjs/stylex, spacing from theme
 * @output StyleX utility for layout container styling
 * @position Layout utility; used by Card, Section components
 *
 * ## Public API for themes
 *
 * Themes set `padding` on container component overrides. The theme build
 * pipeline expands this to component-scoped CSS custom properties, emitting
 * the `--astryx-*` tokens that the component reads:
 *
 *   --astryx-card-padding            (shorthand — all sides; emitted)
 *   --astryx-card-padding-inline     (horizontal)
 *   --astryx-card-padding-block-start
 *   --astryx-card-padding-block-end
 *
 * Read order per level: `var(--astryx-…, <next level>)`, terminating at
 * `--spacing-4`. Same pattern for section and dialog.
 *
 * ```ts
 * components: {
 *   card: { base: { padding: '20px' } },          // → --astryx-card-padding: 20px
 *   section: { base: { padding: '12px 20px' } },  // → directional tokens
 *   dialog: { base: { padding: '16px' } },
 * }
 * ```
 *
 * Internal variables (`--layout-padding-inner-x`, `--container-padding-*`,
 * `--_section-padding-propagated`) are implementation details and must not be
 * referenced by themes. They also do not cross an overlay boundary — see
 * `overlayPaddingReset` in padding.stylex.ts.
 *
 * SYNC: When modified, update /packages/core/src/Layout/Layout.doc.mjs
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";

/**
 * Spacing token keys for padding props.
 */

const baseStyles = {
  container: {
    kB7OPa: "x9f619",
    kZCmMZ: "x1c35znw",
    kwRFfy: "x64h4k7",
    kLKAdn: "x14m0hsi",
    kGO01o: "xc1wllq",
    $$css: true
  }
};

/**
 * Component-scoped padding tokens.
 *
 * Each container component (card, section, dialog) has public CSS custom
 * properties that themes can set. The pipeline emits the `--astryx-*` names,
 * which the component reads via `var(--astryx-…, …)`:
 *
 *   --astryx-card-padding          (shorthand — all sides)
 *   --astryx-card-padding-inline
 *   --astryx-card-padding-inline-start
 *   --astryx-card-padding-inline-end
 *   --astryx-card-padding-block-start
 *   --astryx-card-padding-block-end
 *
 * The theme build pipeline maps `padding: '20px'` on a container component
 * to these tokens. The component reads them with var() fallbacks to --spacing-4.
 *
 * This indirection exists because StyleX's useCSSLayers emits priority-0
 * custom property assignments outside any @layer, making them impossible
 * to override from @layer astryx-theme. By reading from a higher-level token,
 * the theme CSS sets the token value and the component picks it up via
 * CSS custom property cascade — no layer competition.
 */
const SP4 = spacingVars['--spacing-4'];

// Card padding chains: --astryx-* then the next specificity level, terminating
// at --spacing-4. Built as chained const strings (no function calls) so StyleX
// can statically analyze them; see naming.ts for the prefix policy.
const cardShorthand = `var(--astryx-card-padding, ${SP4})`;
const cardInline = `var(--astryx-card-padding-inline, ${cardShorthand})`;
const cardInlineStart = `var(--astryx-card-padding-inline-start, ${cardInline})`;
const cardInlineEnd = `var(--astryx-card-padding-inline-end, ${cardInline})`;
const cardBlockStart = `var(--astryx-card-padding-block-start, ${cardShorthand})`;
const cardBlockEnd = `var(--astryx-card-padding-block-end, ${cardShorthand})`;

// Section padding chains: --astryx-* then the next specificity level, terminating
// at --spacing-4. Built as chained const strings (no function calls) so StyleX
// can statically analyze them; see naming.ts for the prefix policy.
// `--_section-padding-propagated` (set by an ancestor Section with explicit
// padding) is read AHEAD of the public theme token, so a propagated value
// still wins over the theme for nested sections. Splitting the two names is
// what lets an overlay drop the inherited value at its boundary while keeping
// the theme's — see `overlayPaddingReset` in padding.stylex.ts.
const sectionThemeShorthand = `var(--astryx-section-padding, ${SP4})`;
const sectionShorthand = `var(--_section-padding-propagated, ${sectionThemeShorthand})`;
const sectionInline = `var(--astryx-section-padding-inline, ${sectionShorthand})`;
const sectionInlineStart = `var(--astryx-section-padding-inline-start, ${sectionInline})`;
const sectionInlineEnd = `var(--astryx-section-padding-inline-end, ${sectionInline})`;
const sectionBlockStart = `var(--astryx-section-padding-block-start, ${sectionShorthand})`;
const sectionBlockEnd = `var(--astryx-section-padding-block-end, ${sectionShorthand})`;

// Dialog padding chains: --astryx-* then the next specificity level, terminating
// at --spacing-4. Built as chained const strings (no function calls) so StyleX
// can statically analyze them; see naming.ts for the prefix policy.
const dialogShorthand = `var(--astryx-dialog-padding, ${SP4})`;
const dialogInline = `var(--astryx-dialog-padding-inline, ${dialogShorthand})`;
const dialogInlineStart = `var(--astryx-dialog-padding-inline-start, ${dialogInline})`;
const dialogInlineEnd = `var(--astryx-dialog-padding-inline-end, ${dialogInline})`;
const dialogBlockStart = `var(--astryx-dialog-padding-block-start, ${dialogShorthand})`;
const dialogBlockEnd = `var(--astryx-dialog-padding-block-end, ${dialogShorthand})`;
const cardDefaultPaddingStyles = {
  containerPaddingInlineStart: {
    "--container-padding-inline-start": "xjmlhfd",
    $$css: true
  },
  containerPaddingInlineEnd: {
    "--container-padding-inline-end": "x1ihxwbr",
    $$css: true
  },
  containerPaddingBlockStart: {
    "--container-padding-block-start": "x1rqz8me",
    $$css: true
  },
  containerPaddingBlockEnd: {
    "--container-padding-block-end": "x1omyuck",
    $$css: true
  },
  layoutPaddingOuterX: {
    "--layout-padding-outer-x": "x14rzhog",
    $$css: true
  },
  layoutPaddingOuterY: {
    "--layout-padding-outer-y": "xjej9fs",
    $$css: true
  },
  layoutPaddingInnerX: {
    "--layout-padding-inner-x": "x4poyjn",
    $$css: true
  },
  layoutPaddingInnerY: {
    "--layout-padding-inner-y": "x1u1kw4e",
    $$css: true
  }
};
const sectionDefaultPaddingStyles = {
  containerPaddingInlineStart: {
    "--container-padding-inline-start": "x19lemt0",
    $$css: true
  },
  containerPaddingInlineEnd: {
    "--container-padding-inline-end": "xu1wldr",
    $$css: true
  },
  containerPaddingBlockStart: {
    "--container-padding-block-start": "xnw7zt4",
    $$css: true
  },
  containerPaddingBlockEnd: {
    "--container-padding-block-end": "xek4msv",
    $$css: true
  },
  layoutPaddingOuterX: {
    "--layout-padding-outer-x": "x15i0zw9",
    $$css: true
  },
  layoutPaddingOuterY: {
    "--layout-padding-outer-y": "x1vw4zgg",
    $$css: true
  },
  layoutPaddingInnerX: {
    "--layout-padding-inner-x": "x1v3gmnx",
    $$css: true
  },
  layoutPaddingInnerY: {
    "--layout-padding-inner-y": "x15yx5hm",
    $$css: true
  }
};
const dialogDefaultPaddingStyles = {
  containerPaddingInlineStart: {
    "--container-padding-inline-start": "x1tewnwq",
    $$css: true
  },
  containerPaddingInlineEnd: {
    "--container-padding-inline-end": "x11h1f2o",
    $$css: true
  },
  containerPaddingBlockStart: {
    "--container-padding-block-start": "x1g2kccc",
    $$css: true
  },
  containerPaddingBlockEnd: {
    "--container-padding-block-end": "x1gvthzm",
    $$css: true
  },
  layoutPaddingOuterX: {
    "--layout-padding-outer-x": "x1hsjncj",
    $$css: true
  },
  layoutPaddingOuterY: {
    "--layout-padding-outer-y": "x1pui4bz",
    $$css: true
  },
  layoutPaddingInnerX: {
    "--layout-padding-inner-x": "x2so38",
    $$css: true
  },
  layoutPaddingInnerY: {
    "--layout-padding-inner-y": "xinu7xd",
    $$css: true
  }
};

/**
 * Map from component name to its theme default padding styles.
 * Each component reads from its own public CSS custom property.
 */
const themeDefaultStyles = {
  card: cardDefaultPaddingStyles,
  section: sectionDefaultPaddingStyles,
  dialog: dialogDefaultPaddingStyles
};
/**
 * Container inline padding styles for edge compensation.
 * Sets --container-padding-inline-start and --container-padding-inline-end so
 * edge-compensating children (bleed tables, dividers, etc.) know the inline
 * padding to compensate against.
 */
const containerPaddingInlineStartStyles = {
  spacing0: {
    "--container-padding-inline-start": "x1gu2k80",
    $$css: true
  },
  spacing0_5: {
    "--container-padding-inline-start": "x14ws0sr",
    $$css: true
  },
  spacing1: {
    "--container-padding-inline-start": "x1cvlban",
    $$css: true
  },
  spacing1_5: {
    "--container-padding-inline-start": "x176g23i",
    $$css: true
  },
  spacing2: {
    "--container-padding-inline-start": "x1xlrr2o",
    $$css: true
  },
  spacing3: {
    "--container-padding-inline-start": "xfdwxua",
    $$css: true
  },
  spacing4: {
    "--container-padding-inline-start": "x1dlhslv",
    $$css: true
  },
  spacing5: {
    "--container-padding-inline-start": "x1s81nki",
    $$css: true
  },
  spacing6: {
    "--container-padding-inline-start": "x1ep0dkj",
    $$css: true
  },
  spacing7: {
    "--container-padding-inline-start": "x157xojc",
    $$css: true
  },
  spacing8: {
    "--container-padding-inline-start": "xw1diwv",
    $$css: true
  },
  spacing9: {
    "--container-padding-inline-start": "xraca2a",
    $$css: true
  },
  spacing10: {
    "--container-padding-inline-start": "xserb3f",
    $$css: true
  },
  spacing11: {
    "--container-padding-inline-start": "xziclwo",
    $$css: true
  },
  spacing12: {
    "--container-padding-inline-start": "x1iiwihq",
    $$css: true
  }
};
const containerPaddingInlineEndStyles = {
  spacing0: {
    "--container-padding-inline-end": "x91ghl5",
    $$css: true
  },
  spacing0_5: {
    "--container-padding-inline-end": "x1wz3t3y",
    $$css: true
  },
  spacing1: {
    "--container-padding-inline-end": "x2oyxnl",
    $$css: true
  },
  spacing1_5: {
    "--container-padding-inline-end": "xntetml",
    $$css: true
  },
  spacing2: {
    "--container-padding-inline-end": "xcas3b9",
    $$css: true
  },
  spacing3: {
    "--container-padding-inline-end": "xu0ipoa",
    $$css: true
  },
  spacing4: {
    "--container-padding-inline-end": "xs0pscg",
    $$css: true
  },
  spacing5: {
    "--container-padding-inline-end": "xgkj7vj",
    $$css: true
  },
  spacing6: {
    "--container-padding-inline-end": "x94cj42",
    $$css: true
  },
  spacing7: {
    "--container-padding-inline-end": "x11tj35w",
    $$css: true
  },
  spacing8: {
    "--container-padding-inline-end": "x1b9k1pi",
    $$css: true
  },
  spacing9: {
    "--container-padding-inline-end": "x19w02kr",
    $$css: true
  },
  spacing10: {
    "--container-padding-inline-end": "xx5lg5w",
    $$css: true
  },
  spacing11: {
    "--container-padding-inline-end": "x1nmgbqg",
    $$css: true
  },
  spacing12: {
    "--container-padding-inline-end": "x1wsfsk2",
    $$css: true
  }
};

/**
 * Container block-start/block-end padding styles for vertical bleed.
 * Split into start and end because Layout areas have asymmetric block padding
 * (e.g., Header: block-start=outer-y, block-end=inner-y).
 */
const containerPaddingBlockStartStyles = {
  spacing0: {
    "--container-padding-block-start": "x1i3qcxz",
    $$css: true
  },
  spacing0_5: {
    "--container-padding-block-start": "xvdf9ev",
    $$css: true
  },
  spacing1: {
    "--container-padding-block-start": "xnsckjb",
    $$css: true
  },
  spacing1_5: {
    "--container-padding-block-start": "x1kbx601",
    $$css: true
  },
  spacing2: {
    "--container-padding-block-start": "xa8b4fq",
    $$css: true
  },
  spacing3: {
    "--container-padding-block-start": "x11k4f5r",
    $$css: true
  },
  spacing4: {
    "--container-padding-block-start": "xm01sq8",
    $$css: true
  },
  spacing5: {
    "--container-padding-block-start": "xp8wdkl",
    $$css: true
  },
  spacing6: {
    "--container-padding-block-start": "x1hmud4d",
    $$css: true
  },
  spacing7: {
    "--container-padding-block-start": "x1c00sag",
    $$css: true
  },
  spacing8: {
    "--container-padding-block-start": "xfv60at",
    $$css: true
  },
  spacing9: {
    "--container-padding-block-start": "x14fzdu7",
    $$css: true
  },
  spacing10: {
    "--container-padding-block-start": "x17h9kl7",
    $$css: true
  },
  spacing11: {
    "--container-padding-block-start": "x1rdjxae",
    $$css: true
  },
  spacing12: {
    "--container-padding-block-start": "xecwdl6",
    $$css: true
  }
};
const containerPaddingBlockEndStyles = {
  spacing0: {
    "--container-padding-block-end": "xkunwnr",
    $$css: true
  },
  spacing0_5: {
    "--container-padding-block-end": "x1cao3zv",
    $$css: true
  },
  spacing1: {
    "--container-padding-block-end": "x57a7ii",
    $$css: true
  },
  spacing1_5: {
    "--container-padding-block-end": "xv53x8y",
    $$css: true
  },
  spacing2: {
    "--container-padding-block-end": "x1lsgcmx",
    $$css: true
  },
  spacing3: {
    "--container-padding-block-end": "x1q3ppug",
    $$css: true
  },
  spacing4: {
    "--container-padding-block-end": "x4hfsld",
    $$css: true
  },
  spacing5: {
    "--container-padding-block-end": "xbib2ws",
    $$css: true
  },
  spacing6: {
    "--container-padding-block-end": "x1q8d17g",
    $$css: true
  },
  spacing7: {
    "--container-padding-block-end": "x1yqogew",
    $$css: true
  },
  spacing8: {
    "--container-padding-block-end": "x8lgq76",
    $$css: true
  },
  spacing9: {
    "--container-padding-block-end": "x1f7f9rt",
    $$css: true
  },
  spacing10: {
    "--container-padding-block-end": "x15vxphk",
    $$css: true
  },
  spacing11: {
    "--container-padding-block-end": "x4bg2x9",
    $$css: true
  },
  spacing12: {
    "--container-padding-block-end": "x186mjxr",
    $$css: true
  }
};
const paddingOuterXStyles = {
  spacing0: {
    "--layout-padding-outer-x": "xswhm3q",
    $$css: true
  },
  spacing0_5: {
    "--layout-padding-outer-x": "xihiwg7",
    $$css: true
  },
  spacing1: {
    "--layout-padding-outer-x": "xc96xmq",
    $$css: true
  },
  spacing1_5: {
    "--layout-padding-outer-x": "x1u93lgd",
    $$css: true
  },
  spacing2: {
    "--layout-padding-outer-x": "x15dxnc0",
    $$css: true
  },
  spacing3: {
    "--layout-padding-outer-x": "xadgj3j",
    $$css: true
  },
  spacing4: {
    "--layout-padding-outer-x": "x1v56qcf",
    $$css: true
  },
  spacing5: {
    "--layout-padding-outer-x": "x1nzs0gl",
    $$css: true
  },
  spacing6: {
    "--layout-padding-outer-x": "x1c3n52a",
    $$css: true
  },
  spacing7: {
    "--layout-padding-outer-x": "x1gfiokx",
    $$css: true
  },
  spacing8: {
    "--layout-padding-outer-x": "x1t3kfz",
    $$css: true
  },
  spacing9: {
    "--layout-padding-outer-x": "xzr4qsh",
    $$css: true
  },
  spacing10: {
    "--layout-padding-outer-x": "x1jdf5a4",
    $$css: true
  },
  spacing11: {
    "--layout-padding-outer-x": "x1hct0t0",
    $$css: true
  },
  spacing12: {
    "--layout-padding-outer-x": "x11cyqoe",
    $$css: true
  }
};
const paddingOuterYStyles = {
  spacing0: {
    "--layout-padding-outer-y": "x1mzf5mb",
    $$css: true
  },
  spacing0_5: {
    "--layout-padding-outer-y": "x1vj96e0",
    $$css: true
  },
  spacing1: {
    "--layout-padding-outer-y": "x1gpfxoh",
    $$css: true
  },
  spacing1_5: {
    "--layout-padding-outer-y": "xd3dqby",
    $$css: true
  },
  spacing2: {
    "--layout-padding-outer-y": "x10pz7y9",
    $$css: true
  },
  spacing3: {
    "--layout-padding-outer-y": "x1p6yq3h",
    $$css: true
  },
  spacing4: {
    "--layout-padding-outer-y": "xx738ci",
    $$css: true
  },
  spacing5: {
    "--layout-padding-outer-y": "x6yxws5",
    $$css: true
  },
  spacing6: {
    "--layout-padding-outer-y": "x180vrwl",
    $$css: true
  },
  spacing7: {
    "--layout-padding-outer-y": "x1q6rme1",
    $$css: true
  },
  spacing8: {
    "--layout-padding-outer-y": "xid7e43",
    $$css: true
  },
  spacing9: {
    "--layout-padding-outer-y": "x1t5kicu",
    $$css: true
  },
  spacing10: {
    "--layout-padding-outer-y": "x26l4wa",
    $$css: true
  },
  spacing11: {
    "--layout-padding-outer-y": "x10zktp0",
    $$css: true
  },
  spacing12: {
    "--layout-padding-outer-y": "x1yz3n6a",
    $$css: true
  }
};
const paddingInnerXStyles = {
  spacing0: {
    "--layout-padding-inner-x": "xj1bl4l",
    $$css: true
  },
  spacing0_5: {
    "--layout-padding-inner-x": "xlriy2h",
    $$css: true
  },
  spacing1: {
    "--layout-padding-inner-x": "x6uuyak",
    $$css: true
  },
  spacing1_5: {
    "--layout-padding-inner-x": "xd38f90",
    $$css: true
  },
  spacing2: {
    "--layout-padding-inner-x": "xxqksqd",
    $$css: true
  },
  spacing3: {
    "--layout-padding-inner-x": "x1fyui2f",
    $$css: true
  },
  spacing4: {
    "--layout-padding-inner-x": "x1i2ajwi",
    $$css: true
  },
  spacing5: {
    "--layout-padding-inner-x": "x1tac27u",
    $$css: true
  },
  spacing6: {
    "--layout-padding-inner-x": "x1ntgf3t",
    $$css: true
  },
  spacing7: {
    "--layout-padding-inner-x": "xhjd9tl",
    $$css: true
  },
  spacing8: {
    "--layout-padding-inner-x": "xn7c84u",
    $$css: true
  },
  spacing9: {
    "--layout-padding-inner-x": "xeqkbsz",
    $$css: true
  },
  spacing10: {
    "--layout-padding-inner-x": "x1vf4qco",
    $$css: true
  },
  spacing11: {
    "--layout-padding-inner-x": "xsmamsf",
    $$css: true
  },
  spacing12: {
    "--layout-padding-inner-x": "x2xk2xj",
    $$css: true
  }
};
const paddingInnerYStyles = {
  spacing0: {
    "--layout-padding-inner-y": "xwuefyo",
    $$css: true
  },
  spacing0_5: {
    "--layout-padding-inner-y": "x180h0y5",
    $$css: true
  },
  spacing1: {
    "--layout-padding-inner-y": "xmpug6m",
    $$css: true
  },
  spacing1_5: {
    "--layout-padding-inner-y": "x1g8jpzm",
    $$css: true
  },
  spacing2: {
    "--layout-padding-inner-y": "x1lksgje",
    $$css: true
  },
  spacing3: {
    "--layout-padding-inner-y": "x4j7gld",
    $$css: true
  },
  spacing4: {
    "--layout-padding-inner-y": "x1s3ehtl",
    $$css: true
  },
  spacing5: {
    "--layout-padding-inner-y": "x1rj5eim",
    $$css: true
  },
  spacing6: {
    "--layout-padding-inner-y": "x1ftgg6u",
    $$css: true
  },
  spacing7: {
    "--layout-padding-inner-y": "x1ho74vh",
    $$css: true
  },
  spacing8: {
    "--layout-padding-inner-y": "xm2cs6f",
    $$css: true
  },
  spacing9: {
    "--layout-padding-inner-y": "x1vsq92b",
    $$css: true
  },
  spacing10: {
    "--layout-padding-inner-y": "x18gbwmk",
    $$css: true
  },
  spacing11: {
    "--layout-padding-inner-y": "x14zymzj",
    $$css: true
  },
  spacing12: {
    "--layout-padding-inner-y": "xzfpkx9",
    $$css: true
  }
};
const maxHeightStyles = {
  containerMaxHeight: maxHeight => [{
    "--container-max-height": maxHeight != null ? "x18nyedi" : maxHeight,
    $$css: true
  }, {
    "--x---container-max-height": maxHeight != null ? maxHeight : undefined
  }]
};
/**
 * StyleX utility to add layout container styles to any element.
 *
 * Sets CSS variables for padding that child layout components read:
 * - `--container-padding-inline-start` / `--container-padding-inline-end` — Inline padding for edge compensation and bleed
 * - `--container-padding-block-start` / `--container-padding-block-end` — Block padding for vertical bleed
 * - `--layout-padding-outer-x`, `--layout-padding-outer-y` (internal)
 * - `--layout-padding-inner-x`, `--layout-padding-inner-y` (internal)
 *
 * Themes should use `padding` (or `paddingBlock`/`paddingInline`) in
 * component overrides to adjust padding. Do not reference
 * `--layout-padding-*` variables directly.
 *
 * @example
 * ```
 * import { container } from '@astryxdesign/core/Layout';
 * import * as stylex from '@stylexjs/stylex';
 *
 * // Card container with default padding (theme-overridable via padding shorthand)
 * <div {...stylex.props(...container({ useThemeDefault: 'card' }))}>
 *   <Layout ... />
 * </div>
 *
 * // Uniform padding
 * <div {...stylex.props(...container({ padding: 'spacing3' }))}>
 *   <Layout ... />
 * </div>
 *
 * // Asymmetric — padding as base, paddingOuterY overrides vertical
 * <div {...stylex.props(
 *   ...container({ padding: 'spacing3', paddingOuterY: 'spacing2' }),
 *   customStyles.card
 * )}>
 *   <Layout ... />
 * </div>
 * ```
 */
export function container({
  padding = 'spacing4',
  paddingOuterX,
  paddingOuterY,
  paddingInnerX,
  paddingInnerY,
  useThemeDefault,
  maxHeight
}) {
  const outerX = paddingOuterX ?? padding;
  const outerY = paddingOuterY ?? padding;
  const innerX = paddingInnerX ?? padding;
  const innerY = paddingInnerY ?? padding;
  const maxHeightStyle = maxHeight ? maxHeightStyles.containerMaxHeight(maxHeight) : null;

  // When useThemeDefault is a component name, cascade from the component's
  // public CSS container tokens (set by theme pipeline from `padding` shorthand)
  // so themes can override each component's padding independently.
  if (useThemeDefault) {
    const defaults = themeDefaultStyles[useThemeDefault];
    return [baseStyles.container, defaults.containerPaddingInlineStart, defaults.containerPaddingInlineEnd, defaults.containerPaddingBlockStart, defaults.containerPaddingBlockEnd, defaults.layoutPaddingOuterX, defaults.layoutPaddingOuterY, defaults.layoutPaddingInnerX, defaults.layoutPaddingInnerY, maxHeightStyle];
  }
  return [baseStyles.container, containerPaddingInlineStartStyles[outerX], containerPaddingInlineEndStyles[outerX], containerPaddingBlockStartStyles[outerY], containerPaddingBlockEndStyles[outerY], paddingOuterXStyles[outerX], paddingOuterYStyles[outerY], paddingInnerXStyles[innerX], paddingInnerYStyles[innerY], maxHeightStyle];
}