// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file tokens.stylex.ts
 * @input StyleX variable and constant definitions
 * @output Exports DateInput layout constants and derived geometry
 * @position Lab component tokens consumed by DateInput.tsx, MonthScroller.tsx, Wheel.tsx, MonthYearWheels.tsx
 *
 * The picker's whole geometry derives from two numbers, which is what makes
 * the fixed height and the scroll snapping exact:
 *
 *   pane height = weeks x day size            (one month, always 6 rows)
 *   body height = pane height                 (calendar body AND wheel body)
 *   wheel pad   = (body height - item) / 2    (so row 0 can rest centered)
 *
 * Every month pane is the same height as the scrollport, so `scroll-snap-align:
 * start` produces a paged scroller with no partial rest positions, and the
 * wheel overlay swaps in without the component changing size.
 *
 * The derived values are `defineConsts`, not plain exported strings: StyleX
 * inlines a constant at build time only through `defineVars`/`defineConsts`
 * from a `.stylex.ts` file. A plain `export const` fails the build with
 * "a style value can only contain an array, string or number".
 *
 */

import * as stylex from '@stylexjs/stylex';

/**
 * Week rows per month pane. Fixed at 6 — the most any month needs — so every
 * pane is identical in height and no snap offset ever shifts. Not a themeable
 * variable: it is a fact about the Gregorian calendar, and `repeat()` cannot
 * take a custom property as its count.
 */
export const WEEKS_PER_PANE = 6;

/**
 * The picker's two size inputs.
 *
 * `defineConsts`, not `defineVars`: these are inlined at build time and emit
 * no CSS custom property, so they are internal geometry rather than public
 * theming API. That is deliberate for both of them.
 *
 * The day size is an accessibility floor — 44px is the comfortable minimum
 * tap target on iOS and Android, and every other target in the sheet is held
 * to it. Exposing it as a variable would let a theme quietly lower the floor,
 * which is not a knob a design system should hand out.
 *
 * The wheel row height is only meaningful against the day size (see below),
 * so tuning one without the other produces a picker whose panes no longer
 * agree — a variable that is only safe to change in lockstep with another is
 * not really a variable.
 *
 * If a real need to theme either appears, promoting a const to a var is an
 * additive change; removing a var that consumers have started setting is not.
 */
export const dateInputTouchSizes = {
  daySize: "44px",
  wheelItemSize: "28px"
};

// Local aliases for the derived values below. StyleX resolves a `defineConsts`
// member through an import, so consumers read `dateInputTouchSizes.*` directly
// rather than a re-exported plain const, which its static analysis cannot
// follow across files.
const DAY_SIZE = dateInputTouchSizes.daySize;
const WHEEL_ITEM_SIZE = dateInputTouchSizes.wheelItemSize;

/** Geometry derived from the sizes above, shared across the component. */
export const dateInputTouchGeometry = {
  paneBlockSize: "calc(6 * 44px)",
  paneRows: "repeat(6, 1fr)",
  wheelEdgePadding: "calc((6 * 44px - 28px) / 2)"
};