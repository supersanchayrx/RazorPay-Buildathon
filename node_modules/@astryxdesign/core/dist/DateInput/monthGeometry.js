// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file monthGeometry.ts
 * @input PlainDate values, scroll offsets, pane heights
 * @output Pure month-index arithmetic and the virtualized pane window
 * @position Internal helper; consumed by MonthScroller.tsx and DateInput.tsx
 *
 * A "month index" is a single integer that totally orders calendar months:
 * `year * 12 + (month - 1)`. The scroller is a list of equal-width panes, so
 * one integer converts freely between a month, a row in that list, and a
 * scroll offset — which is the whole trick behind continuous scrolling.
 *
 * These are pure functions on purpose: the scroll math is the part most likely
 * to be wrong, and it is testable without a layout engine.
 *
 * SYNC: When modified, update DateInputTouch.test.tsx.
 */

/** How many months are reachable in either direction when unbounded. */
export const DEFAULT_MONTH_REACH = 600;

/** `year * 12 + (month - 1)`, for a 1-based month. */
export function toMonthIndex(year, month) {
  return year * 12 + (month - 1);
}

/** The month index of a PlainDate. */
export function monthIndexOf(date) {
  return toMonthIndex(date.year, date.month);
}

/** Inverse of {@link toMonthIndex}; month comes back 1-based. */
export function fromMonthIndex(index) {
  return {
    year: Math.floor(index / 12),
    month: (index % 12 + 12) % 12 + 1
  };
}

/** `value` limited to `[min, max]`. */
export function clampIndex(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * The month a scrollport is resting on (or nearest to, mid-scroll).
 *
 * Returns a row offset from the start of the list, not a month index — add
 * `minMonthIndex` for that.
 *
 * `scrollOffset` is `scrollLeft` for the horizontal scroller. Under RTL that
 * is NEGATIVE — the spec has the inline start at 0 and scrolling run down
 * from there — so the sign is normalized away here rather than at each call
 * site, where forgetting it would silently pin the calendar to month zero.
 */
export function rowAtScrollOffset(scrollOffset, paneSize, rowCount, isRTL = false) {
  if (paneSize <= 0) {
    return 0;
  }
  const distance = isRTL ? -scrollOffset : scrollOffset;
  return clampIndex(Math.round(distance / paneSize), 0, rowCount - 1);
}

/**
 * The scroll offset that brings `row` to rest, ready for `scrollTo`. The
 * inverse of {@link rowAtScrollOffset}, including its RTL sign.
 */
export function scrollOffsetForRow(row, paneSize, isRTL = false) {
  const distance = row * paneSize;
  return isRTL ? -distance : distance;
}
/**
 * The slice of rows to actually mount around `centerRow`.
 *
 * Only a handful of panes exist in the DOM at a time; the rest of the list is
 * a spacer. `overscan` is how many extra panes ride along on each side so a
 * fast fling never lands on an unmounted one — which under `scroll-snap-type:
 * mandatory` would be visible as a jump.
 */
export function paneWindow(centerRow, rowCount, overscan) {
  return {
    start: Math.max(0, centerRow - overscan),
    end: Math.min(rowCount - 1, centerRow + overscan)
  };
}

/** `[start, end]` inclusive, as an array of rows. */
export function rowsIn({
  start,
  end
}) {
  const rows = [];
  for (let row = start; row <= end; row++) {
    rows.push(row);
  }
  return rows;
}