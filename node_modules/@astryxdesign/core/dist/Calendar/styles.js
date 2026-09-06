// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file styles.ts
 * @input Uses stylex, theme tokens
 * @output Exports calendar styles (structural) and theme styles (customizable)
 * @position Shared styles; used by Calendar
 *
 * Style Organization:
 * - *Styles objects: Structural/layout styles (spacing, sizing, positioning)
 * - *Theme objects: Themeable styles (colors, borders) that can be overridden
 *
 * SYNC: When modified, update this header
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, sizeVars, radiusVars, durationVars, easeVars, fontWeightVars, typeScaleVars } from "../theme/tokens.stylex.js";

// =============================================================================
// Calendar Container Styles
// =============================================================================

export const calendarStyles = {
  calendar: {
    k1xSpc: "x1rg5ohu",
    kmVPX3: "x1b2ylru",
    k7Eaqz: "x12rczxh",
    $$css: true
  },
  header: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "x1qughib",
    k1K539: "x1p37lm5",
    kOIVth: "x1txdalj",
    $$css: true
  },
  monthYearLabel: {
    kUk6DE: "x98rzlu",
    k9WMMc: "x2b8uid",
    k63SB2: "x2mo6ok",
    kGuDYH: "xcr08ib",
    kMwMTN: "x1tgivj0",
    $$css: true
  },
  monthsContainer: {
    k1xSpc: "x78zum5",
    kwnvtZ: "x1a02dak",
    kOIVth: "x18g69wz",
    $$css: true
  },
  navIcon: {
    k1xSpc: "x3nfvp2",
    $$css: true
  }
};

// =============================================================================
// Month Grid Styles
// =============================================================================

export const monthGridStyles = {
  monthGrid: {
    kUk6DE: "x1cqoux5",
    $$css: true
  },
  dayName: {
    kzqmXN: "x805d0l",
    kZKoxP: "x1u5rhrp",
    kGO01o: "xy143xn",
    kB7OPa: "x9f619",
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kGuDYH: "x141an7d",
    k63SB2: "x1sodnla",
    kMwMTN: "xv1l7n4",
    $$css: true
  },
  weekNumberHeader: {
    kzqmXN: "x805d0l",
    $$css: true
  },
  daysGrid: {
    k1xSpc: "xrvj5dj",
    kumcoG: "x1mzazjb",
    $$css: true
  },
  daysGridWithNumbers: {
    kumcoG: "x1wthsqz",
    $$css: true
  },
  weekNumber: {
    kzqmXN: "x805d0l",
    kZKoxP: "x1ueg155",
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kGuDYH: "x141an7d",
    kMwMTN: "xv1l7n4",
    $$css: true
  },
  weekRow: {
    k1xSpc: "xjp7ctv",
    $$css: true
  }
};

// =============================================================================
// Day Cell Styles - Structural (layout, sizing, positioning)
// =============================================================================

// Half the gap between the day button and its cell — (--size-element-md minus
// --size-element-sm) / 2 — so the band's rounded caps line up with the button
// and the button's ::before bleeds out to meet its neighbour's. Deliberately a
// literal and NOT a spacing token: this is a layout value derived from the two
// size tokens, and pinning it to --spacing-0-5 desynchronises it from them
// (matcha sets that step to 3px, which overlaps adjacent days' hit targets by
// 2px). Deriving it with calc() from the size tokens would be better still and
// would close butter's 4px dead gap; that needs its own measured change.
const BAND_INSET = '2px';
const HIT_BLEED = '-2px';
export const dayCellStyles = {
  cell: {
    kVAEAm: "x1n2onr6",
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kZKoxP: "x1ueg155",
    kHBbk8: "xc8icb0",
    $$css: true
  },
  rangeBg: {
    kVAEAm: "x10l6tqk",
    k87sOh: "xs7f9wi",
    krVfgx: "x1c7jfne",
    kLqNvP: "x1o0tod",
    kt4wiu: "xtijo5x",
    $$css: true
  },
  rangeBgRadiusStart: {
    kLqNvP: "xaoy8p5",
    krdFHd: "x19415el",
    kVL7Gh: "x1wc3881",
    $$css: true
  },
  rangeBgRadiusEnd: {
    kt4wiu: "xz03a8w",
    kfmiAY: "x8agd5o",
    kT0f0o: "x1dgc8on",
    $$css: true
  },
  rangeInsetStart: {
    kLqNvP: "xaoy8p5",
    $$css: true
  },
  rangeInsetEnd: {
    kt4wiu: "xz03a8w",
    $$css: true
  },
  previewBg: {
    kVAEAm: "x10l6tqk",
    k87sOh: "xs7f9wi",
    krVfgx: "x1c7jfne",
    kLqNvP: "x1o0tod",
    kt4wiu: "xtijo5x",
    $$css: true
  },
  previewBgRadiusStart: {
    kLqNvP: "xaoy8p5",
    krdFHd: "x19415el",
    kVL7Gh: "x1wc3881",
    $$css: true
  },
  previewBgRadiusEnd: {
    kt4wiu: "xz03a8w",
    kfmiAY: "x8agd5o",
    kT0f0o: "x1dgc8on",
    $$css: true
  },
  previewStart: {
    kLqNvP: "xaoy8p5",
    krdFHd: "x19415el",
    kVL7Gh: "x1wc3881",
    $$css: true
  },
  previewEnd: {
    kt4wiu: "xz03a8w",
    kfmiAY: "x8agd5o",
    kT0f0o: "x1dgc8on",
    $$css: true
  },
  day: {
    kzqmXN: "x1fvqzum",
    kZKoxP: "x6k0iem",
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kaIpWk: "xjspbzw",
    kMzoRj: "xc342km",
    ksu8eU: "xng3xce",
    kkrTdU: "x1ypdohk x16khyan",
    kMv6JI: "xjb2p0i",
    kGuDYH: "xjm74w1",
    kmVPX3: "x1717udv",
    kVAEAm: "x1n2onr6",
    kY2c9j: "x1vjfegm",
    k1ekBW: "xs2xxs2 x4wkmsb",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    kgeoSG: "x1cpjm7i",
    kEoFBp: "x1hmns74",
    k96MEf: "x51xajf",
    koaPKo: "xekda60",
    k5Ofw7: "xe80sof",
    kSJ0CW: "xvw6utc",
    $$css: true
  },
  dayOutside: {
    kSiTet: "xbyyjgo",
    $$css: true
  },
  dayToday: {
    $$css: true
  },
  dayTodayInRange: {
    $$css: true
  },
  daySelected: {
    $$css: true
  },
  dayDisabled: {
    kkrTdU: "xt0e3qv",
    $$css: true
  }
};

// =============================================================================
// Day Cell Theme - Colors and visual appearance (customizable)
// =============================================================================

export const dayCellTheme = {
  rangeBg: {
    kWkggS: "xgcxg3y",
    $$css: true
  },
  previewBg: {
    kWkggS: "x1lmrjuc",
    $$css: true
  },
  day: {
    kMwMTN: "x1tgivj0",
    kWkggS: "xjbqb8w",
    $$css: true
  },
  dayOutside: {
    kMwMTN: "xv1l7n4",
    $$css: true
  },
  dayToday: {
    kGVxlE: "x1lp15jv",
    $$css: true
  },
  dayTodayInRange: {
    kGVxlE: "x1iobdd1",
    $$css: true
  },
  daySelected: {
    kAXs8y: "x1kzknox",
    kWkggS: "x1ewilqj x1jzqe4",
    kMwMTN: "x17wrial x1k5gbb1",
    $$css: true
  },
  dayDisabled: {
    kSiTet: "xuzhngd",
    kKwaWg: "x18o3ruo x1bm8j9m",
    $$css: true
  }
};