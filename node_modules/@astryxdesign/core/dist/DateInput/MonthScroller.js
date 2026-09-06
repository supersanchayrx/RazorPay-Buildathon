// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file MonthScroller.tsx
 * @input Month bounds, selected value, constraints, week start
 * @output Exports MonthScroller and MonthScrollerHandle
 * @position Internal component; consumed by TouchDateField.tsx
 *
 * The continuous surface: months stacked vertically in one scroller, each pane
 * exactly as tall as the scrollport and snapped to its start. Two consequences
 * fall out of that single geometric choice — the picker never changes height,
 * and there is no resting position that shows half of two months.
 *
 * Every pane is a fixed six-row grid, including the months that only need
 * four or five, because a pane whose height depended on its contents would
 * make snap offsets vary from month to month and the scroll position drift.
 *
 * The list is long (a century by default) but only a few panes are ever
 * mounted: a spacer holds the full scroll height and the visible panes are
 * positioned into it absolutely. Nothing is stitched or recycled during a
 * scroll, so snap offsets are constant and momentum is never interrupted —
 * which is the failure mode of the usual "append months at the edge" approach.
 *
 * SYNC: When modified, update:
 * - /packages/core/src/DateInput/TouchDateField.tsx
 * - /packages/core/src/DateTimeInput/TouchDateTimeField.tsx
 * - /packages/core/src/DateInput/DateInput.doc.mjs
 * - /packages/core/src/DateInput/DateInputTouch.test.tsx
 */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { useCalendarDays } from "../Calendar/index.js";
import { useDirection, useLocale } from "../i18n/index.js";
import "../theme/tokens.stylex.js";
import { colorVars, radiusVars, fontWeightVars, typeScaleVars, durationVars, borderVars } from "../theme/tokens.stylex.js";
import { focusOutlineStyles } from "../utils/index.js";
import { plainDateAddDays, plainDateDayOfWeek, plainDateFormat, plainDateIsEqual, plainDateToISO, DATE_FORMAT_MONTH_YEAR, DATE_FORMAT_WITH_WEEKDAY } from "../utils/index.js";
import "./tokens.stylex.js";
import { dateInputTouchSizes, dateInputTouchGeometry } from "./tokens.stylex.js";
import { useOwnScrollGesture } from "./useOwnScrollGesture.js";
import { useScrollSettle } from "./useScrollSettle.js";
import { fromMonthIndex, monthIndexOf, paneWindow, rowAtScrollOffset, rowsIn, scrollOffsetForRow } from "./monthGeometry.js";
import { jsx as _jsx } from "react/jsx-runtime";
const DAY_SIZE = dateInputTouchSizes.daySize;

/**
 * Panes mounted on each side of the visible one. Sized against a fast fling:
 * the window widens once per animation frame, so it only fails if a single
 * frame travels further than this — three months, about 800px at the default
 * day size. Under `scroll-snap-type: mandatory`, landing on an unmounted pane
 * would not merely show a gap, it would re-snap to the nearest mounted one.
 */
const OVERSCAN = 3;
const styles = {
  spacer: {
    kVAEAm: "x1n2onr6",
    kZKoxP: "x5yr21d",
    $$css: true
  },
  pane: {
    kVAEAm: "x10l6tqk",
    kYYq5F: "x10no89f",
    kZKoxP: "xm8gem",
    k5xd4v: "x1bhewko",
    k1xSpc: "xrvj5dj",
    kumcoG: "x1mzazjb",
    k9llMU: "xy8nx85",
    $$css: true
  },
  day: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kzqmXN: "xh8yej3",
    kZKoxP: "x5yr21d",
    k7Eaqz: "x1tutbut",
    kAzted: "x1dg37ty",
    kmVPX3: "x1717udv",
    kMzoRj: "xc342km",
    ksu8eU: "xng3xce",
    kWkggS: "xjbqb8w",
    kMwMTN: "x1tgivj0",
    kGuDYH: "xjm74w1",
    k63SB2: "x1sodnla",
    kkrTdU: "x1ypdohk x16khyan",
    kfSwDN: "x87ps6o",
    kQizK7: "x1i10hfl",
    $$css: true
  },
  dayOutside: {
    kMwMTN: "xv1l7n4",
    kSiTet: "xbyyjgo",
    $$css: true
  },
  dayDisabled: {
    kSiTet: "xuzhngd",
    kkrTdU: "xt0e3qv",
    $$css: true
  }
};
const _temp = {
  kzqmXN: "x1uyokj7",
  "$$css": true
};
const _temp2 = {
  kLqNvP: "x1lxsm33",
  kzqmXN: "x1uyokj7",
  "$$css": true
};
const dynamic = {
  spacer: inlineSize => [_temp, {
    "--x-inlineSize": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(`${inlineSize}px`)
  }],
  pane: (insetInlineStart, inlineSize) => [_temp2, {
    "--x-insetInlineStart": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(`${insetInlineStart}px`),
    "--x-inlineSize": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(`${inlineSize}px`)
  }]
};
/**
 * A vertically continuous, snap-paged run of month grids.
 */
export function MonthScroller({
  handleRef,
  minMonthIndex,
  maxMonthIndex,
  initialMonthIndex,
  onVisibleMonthChange,
  selectedDate,
  today,
  isDateDisabled,
  weekStartsOn,
  onSelect
}) {
  const scrollerRef = useRef(null);
  const rowCount = maxMonthIndex - minMonthIndex + 1;

  // Pane WIDTH is read from layout, never assumed: it is whatever the CSS
  // says the scrollport is, so the snap offsets and the virtualization follow
  // a resize (rotation, a split-screen change) without re-deriving anything.
  const [paneSize, setPaneSize] = useState(0);
  // Which way the inline axis runs. Under RTL the panes lay out from the
  // right and scrollLeft counts DOWN from 0, so every conversion between a
  // row and a scroll offset has to know.
  const isRTL = useDirection() === 'rtl';
  const [centerRow, setCenterRow] = useState(initialMonthIndex - minMonthIndex);
  // The visible row, mirrored so the scroll handler can tell "changed" from
  // "same" without reading state, and notify the parent OUTSIDE a state
  // updater — React runs updaters during render, where another component's
  // setState is illegal.
  const centerRowRef = useRef(centerRow);
  // A row to scroll to once its pane is mounted; see scrollToMonth.
  const pendingScrollRef = useRef(null);

  /**
   * The row a programmatic scroll is heading for, so its own scroll events
   * are not reported back as if the user had gone there. Null once a finger
   * touches the scroller, or once the steered scroll has arrived.
   */
  const steeredRowRef = useRef(null);

  // Keyboard focus moves by date, not by cell index, so it crosses month
  // boundaries the way a calendar should. Null until the user takes the grid
  // with the keyboard.
  const [focusedDate, setFocusedDate] = useState(null);
  const shouldRestoreFocusRef = useRef(false);
  const onVisibleMonthChangeRef = useRef(onVisibleMonthChange);
  onVisibleMonthChangeRef.current = onVisibleMonthChange;
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller == null) {
      return;
    }
    const measure = () => {
      // Ignore zero: the picker can be mounted inside something not yet
      // displayed (a closed BottomSheet), and a zero width would unmount
      // every pane and lose the scroll position.
      const measured = scroller.clientWidth;
      if (measured > 0) {
        // eslint-disable-next-line @eslint-react/set-state-in-effect -- pane width is a measurement; layout is the only place it exists
        setPaneSize(measured);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Land on the initial month before the first paint. Runs once the height is
  // known; `hasPositioned` keeps a later resize from yanking the user back.
  const hasPositionedRef = useRef(false);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller == null || paneSize === 0 || hasPositionedRef.current) {
      return;
    }
    hasPositionedRef.current = true;
    scroller.scrollLeft = scrollOffsetForRow(initialMonthIndex - minMonthIndex, paneSize, isRTL);
  }, [paneSize, initialMonthIndex, minMonthIndex, isRTL]);
  const scrollToMonth = useCallback((monthIndex, behavior = 'smooth') => {
    const scroller = scrollerRef.current;
    if (scroller == null || paneSize === 0) {
      return;
    }
    const row = Math.min(rowCount - 1, Math.max(0, monthIndex - minMonthIndex));
    if (Math.abs(row - centerRowRef.current) > OVERSCAN) {
      // Beyond the mounted window there is no pane at the target offset, and
      // `scroll-snap-type: mandatory` will not leave the scroller resting
      // where no snap area is — it re-snaps to the nearest mounted pane, so
      // a jump to another year lands one month away instead. Mount the
      // target first and scroll once it exists (see the layout effect
      // below); a jump that far is never worth animating either.
      pendingScrollRef.current = row;
      centerRowRef.current = row;
      setCenterRow(row);
      return;
    }
    steeredRowRef.current = row;
    scroller.scrollTo({
      left: scrollOffsetForRow(row, paneSize, isRTL),
      behavior
    });
  }, [paneSize, minMonthIndex, rowCount, isRTL]);

  // Deliberately un-keyed: it runs after every render, costs a null check, and
  // must fire on whichever render finally mounts the pending row's pane.
  useLayoutEffect(() => {
    const row = pendingScrollRef.current;
    const scroller = scrollerRef.current;
    if (row == null || scroller == null || paneSize === 0) {
      return;
    }
    pendingScrollRef.current = null;
    scroller.scrollTo({
      left: scrollOffsetForRow(row, paneSize, isRTL),
      behavior: 'auto'
    });
  });
  useImperativeHandle(handleRef, () => ({
    scrollToMonth
  }), [scrollToMonth]);

  /**
   * Put the scroller back on a pane boundary once the gesture is over.
   *
   * `scroll-snap-type: mandatory` is supposed to make this unnecessary, and
   * on a static list it does. This list is virtualized: seven panes exist out
   * of twelve hundred, and the panes ARE the snap areas — so every month the
   * finger crosses mounts one and unmounts another, mid-fling.
   *
   * iOS scrolls off the main thread. It picks a landing place from the snap
   * points it knows about at the time, and a React re-render that lands after
   * that decision moves them; the scroller then comes to rest where no snap
   * point exists any more, and nothing re-snaps it. That is the calendar
   * sitting between two months with the weekday header still square — the
   * grid is not skewed, the scrollport is simply parked a couple of columns
   * into a pane. Chrome hides it by snapping again after the mutation.
   *
   * So the rest position is corrected here rather than trusted. It waits for
   * a true settle — touch released AND quiet, since iOS below 26 has no
   * `scrollend` and its momentum outlasts any naive timer (see
   * useScrollSettle) — and only moves when the offset is genuinely off, so a
   * scroller the browser snapped for itself is left alone.
   *
   * ## Why it re-checks that the scroller is still
   *
   * A quiet period is not proof of rest, and getting that wrong here does not
   * merely fail to fix the bug — it REVERSES the user's swipe. iOS runs its
   * own snap animation for ~150-300ms after the finger lifts, and the scroll
   * events it fires during that animation arrive irregularly; a gap longer
   * than the quiet period is routine in the slow tail. The settle then lands
   * mid-animation, reads a scrollLeft still travelling toward April, rounds
   * THAT to the nearest pane — which is still March, because the animation is
   * not yet halfway — and drags the calendar back where it came from. Swipe
   * forward, get pulled backward, which is what this looked like on a device.
   *
   * Two samples a frame apart settle it: if the offset moved, the scroller is
   * still going somewhere and its destination is not ours to guess. Skipping
   * costs nothing, because the animation's own scroll events re-arm the
   * settle, and the last of them gets a quiet period that ends at true rest.
   *
   * The threshold is a subpixel rather than exact equality. A scroller at rest
   * on a fractional-density viewport can report an offset that wobbles in the
   * last decimal place, and exact equality would read that as travel and never
   * correct at all — the failure mode being silent, which is the worst kind.
   * A tail crawling slower than half a pixel a frame has effectively arrived,
   * so treating it as arrived is right anyway.
   *
   * The correction is at most half a pane by construction, and its own scroll
   * settles onto the boundary it just aimed at, so it cannot oscillate.
   */
  const settleFrameRef = useRef(undefined);
  useEffect(() => () => {
    if (settleFrameRef.current != null) {
      cancelAnimationFrame(settleFrameRef.current);
    }
  }, []);
  useScrollSettle(scrollerRef, scroller => {
    if (paneSize === 0) {
      return;
    }
    const offsetBefore = scroller.scrollLeft;
    if (settleFrameRef.current != null) {
      cancelAnimationFrame(settleFrameRef.current);
    }
    settleFrameRef.current = requestAnimationFrame(() => {
      settleFrameRef.current = undefined;
      // Still travelling — including a snap animation iOS has not finished.
      // Correcting toward the nearest pane from a position mid-flight would
      // undo the swipe rather than complete it.
      if (Math.abs(scroller.scrollLeft - offsetBefore) >= 0.5) {
        return;
      }
      const row = rowAtScrollOffset(scroller.scrollLeft, paneSize, rowCount, isRTL);
      const target = scrollOffsetForRow(row, paneSize, isRTL);
      // Sub-pixel drift is the browser's own rounding, not a failed snap.
      if (Math.abs(scroller.scrollLeft - target) < 1) {
        return;
      }
      scroller.scrollTo({
        left: target,
        behavior: 'smooth'
      });
    });
  });

  // Claim horizontal gestures, leave vertical ones to the sheet.
  //
  // `touch-action: pan-x` alone is NOT enough: it governs what the browser
  // pans natively, and the sheet's listener is JavaScript whose
  // preventDefault() cancels the scroll regardless. Measured — a swipe 9° off
  // horizontal had every touchmove cancelled by the sheet and the month never
  // changed. The axis lock is biased toward horizontal, because a thumb arcs
  // as it swipes; `onSwipe` then pages the diagonals the browser itself
  // declines to pan, so no angle is left doing nothing. See
  // useOwnScrollGesture.
  useOwnScrollGesture(scrollerRef, 'inline', {
    onSwipe: direction => {
      const scroller = scrollerRef.current;
      if (scroller == null || paneSize === 0) {
        return;
      }
      scroller.scrollBy({
        left: direction * paneSize,
        behavior: 'smooth'
      });
    }
  });

  // rAF-throttled: a touch scroll fires far more scroll events than frames,
  // and all this does is move a label and widen a window.
  const frameRef = useRef(undefined);
  useEffect(() => {
    const scroller = scrollerRef.current;
    // Not before the height is known. A listener attached while it was zero
    // would close over that zero and report row 0 for any scroll — and the
    // scroll event fired by the initial positioning arrives just late enough
    // to be handled by that stale listener. Every pane then unmounts except
    // rows 0-2, and `scroll-snap-type: mandatory` yanks the scroller to the
    // nearest surviving snap area, a century away from where it just landed.
    if (scroller == null || paneSize === 0) {
      return;
    }
    // A finger on the scroller ends any steering: from here the months it
    // passes are the user's doing and every one of them is worth reporting.
    const onTouchStart = () => {
      steeredRowRef.current = null;
    };
    const onScroll = () => {
      if (frameRef.current != null) {
        return;
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = undefined;
        const row = rowAtScrollOffset(scroller.scrollLeft, paneSize, rowCount, isRTL);
        if (row === centerRowRef.current) {
          return;
        }
        centerRowRef.current = row;
        setCenterRow(row);
        // Report nothing while a steer is in flight. `scrollToMonth` is only
        // ever called by something that already knows the month — a wheel
        // commit, a header arrow, the re-assert when the wheels close — so
        // none of the scrolling it causes is news, including whatever the
        // scroller passes through on the way.
        //
        // Reporting it is a feedback cycle, and worse on iOS. A wheel commit
        // steers this scroller while it is hidden behind the wheels, and a
        // hidden scroller does not reliably stay where it was put: iOS
        // re-snaps it when the panel becomes visible again, firing scrolls at
        // the exact moment reports start being trusted again. The month drifted
        // on the way back to the calendar.
        //
        // Cleared on arrival, or by a touch below — once a finger is on the
        // scroller the user owns it, and every month it passes is worth
        // reporting.
        if (steeredRowRef.current != null) {
          if (steeredRowRef.current === row) {
            steeredRowRef.current = null;
          }
          return;
        }
        onVisibleMonthChangeRef.current(minMonthIndex + row);
      });
    };
    scroller.addEventListener('scroll', onScroll, {
      passive: true
    });
    scroller.addEventListener('touchstart', onTouchStart, {
      passive: true
    });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('touchstart', onTouchStart);
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
    };
  }, [paneSize, rowCount, minMonthIndex, isRTL]);

  // Move the keyboard focus by whole days and let the scroller follow. Paging
  // by month is PageUp/PageDown; everything else is the APG grid vocabulary.
  const moveFocus = useCallback((from, deltaDays) => {
    const next = plainDateAddDays(from, deltaDays);
    const nextIndex = monthIndexOf(next);
    if (nextIndex < minMonthIndex || nextIndex > maxMonthIndex) {
      return;
    }
    shouldRestoreFocusRef.current = true;
    setFocusedDate(next);
    if (nextIndex !== monthIndexOf(from)) {
      scrollToMonth(nextIndex, 'smooth');
    }
  }, [minMonthIndex, maxMonthIndex, scrollToMonth]);
  const handleKeyDown = useCallback((event, date) => {
    // Column within the displayed week, which is what Home/End move to —
    // not the day of the month.
    const column = (plainDateDayOfWeek(date) - weekStartsOn + 7) % 7;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus(date, -1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveFocus(date, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(date, -7);
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(date, 7);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus(date, -column);
        break;
      case 'End':
        event.preventDefault();
        moveFocus(date, 6 - column);
        break;
      default:
        break;
    }
  }, [moveFocus, weekStartsOn]);

  // The focused day may have been in an unmounted pane a frame ago; focus it
  // once it exists, and only in response to a key press so a scroll never
  // steals focus.
  const focusedISO = focusedDate == null ? null : plainDateToISO(focusedDate);
  useEffect(() => {
    if (!shouldRestoreFocusRef.current || focusedISO == null) {
      return;
    }
    const target = scrollerRef.current?.querySelector(`[data-date="${focusedISO}"]`);
    if (target != null) {
      shouldRestoreFocusRef.current = false;
      // preventScroll: the scroller is already snapping to this month; a
      // browser scroll-into-view here would fight the snap and land between
      // two panes.
      target.focus({
        preventScroll: true
      });
    }
  }, [focusedISO]);
  const visibleRows = paneWindow(centerRow, rowCount, OVERSCAN);

  // A focus event fires for the programmatic focus above too; only take the
  // date when it is actually a different day.
  const handleDayFocus = useCallback(date => {
    setFocusedDate(previous => previous != null && plainDateIsEqual(previous, date) ? previous : date);
  }, []);
  return /*#__PURE__*/_jsx("div", {
    ref: scrollerRef,
    "data-scroller": "months",
    ...{
      className: "x1n2onr6 xm8gem x9f619 xw2csxc x10wlt62 xhfbhpw xish69e x1rohswg x1bblx7b"
    },
    children: /*#__PURE__*/_jsx("div", {
      ...stylex.props(styles.spacer, dynamic.spacer(rowCount * paneSize)),
      children: paneSize > 0 && rowsIn(visibleRows).map(row => /*#__PURE__*/_jsx(MonthPane, {
        monthIndex: minMonthIndex + row,
        insetInlineStart: row * paneSize,
        inlineSize: paneSize,
        selectedDate: selectedDate,
        focusedDate: focusedDate,
        today: today,
        isDateDisabled: isDateDisabled,
        weekStartsOn: weekStartsOn,
        onSelect: onSelect,
        onDayKeyDown: handleKeyDown,
        onDayFocus: handleDayFocus
      }, row))
    })
  });
}
MonthScroller.displayName = 'MonthScroller';
/**
 * One month, as a six-row grid.
 *
 * There is no `role="columnheader"` row in here: the weekday names are a
 * single sticky row outside the scroller (they would otherwise scroll away),
 * so each day instead carries its weekday in its accessible name.
 */
function MonthPane({
  monthIndex,
  insetInlineStart,
  inlineSize,
  selectedDate,
  focusedDate,
  today,
  isDateDisabled,
  weekStartsOn,
  onSelect,
  onDayKeyDown,
  onDayFocus
}) {
  const locale = useLocale();
  const {
    year,
    month
  } = fromMonthIndex(monthIndex);
  const {
    weeks
  } = useCalendarDays({
    year,
    month,
    weekStartsOn,
    // Always six rows: a variable grid would make pane heights differ, and
    // with them every snap offset below this month.
    hasVariableRowCount: false
  });
  const monthLabel = plainDateFormat({
    year,
    month,
    day: 1
  }, DATE_FORMAT_MONTH_YEAR, locale);

  // Exactly one day per pane is tab-reachable, so Tab moves through the
  // picker rather than through 42 buttons: the focused day if the keyboard
  // owns one, else the selection, else the first of the month.
  const tabbableISO = (() => {
    if (focusedDate != null && focusedDate.year === year && focusedDate.month === month) {
      return plainDateToISO(focusedDate);
    }
    if (selectedDate != null && selectedDate.year === year && selectedDate.month === month) {
      return plainDateToISO(selectedDate);
    }
    return plainDateToISO({
      year,
      month,
      day: 1
    });
  })();
  return /*#__PURE__*/_jsx("div", {
    role: "grid",
    "aria-label": monthLabel,
    "data-month": monthLabel,
    ...stylex.props(styles.pane, dynamic.pane(insetInlineStart, inlineSize)),
    children: weeks.map(week => /*#__PURE__*/_jsx("div", {
      role: "row",
      ...{
        className: "xjp7ctv"
      },
      children: week.map(day => {
        // A spilled day is context, not a choice. Calendar computes the
        // same thing as `effectivelyDisabled: isDisabled || isOutside`,
        // and guards today/selected on `!isOutside` beside it, so a date
        // borrowed from a neighbouring month never carries a ring or a
        // puck in the pane that is only showing it.
        const isDisabled = day.isOutside || isDateDisabled(day.date);
        const isSelected = !day.isOutside && selectedDate != null && plainDateIsEqual(day.date, selectedDate);
        const isToday = !day.isOutside && plainDateIsEqual(day.date, today);
        return /*#__PURE__*/_jsx("div", {
          role: "gridcell",
          "aria-selected": isSelected || undefined,
          ...{
            className: "x1n2onr6 x78zum5 x6s0dn4 xl56j7k"
          },
          children: /*#__PURE__*/_jsx("button", {
            type: "button",
            "data-date": day.iso,
            tabIndex: day.iso === tabbableISO ? 0 : -1,
            "aria-label": plainDateFormat(day.date, DATE_FORMAT_WITH_WEEKDAY, locale),
            "aria-disabled": isDisabled || undefined,
            "aria-current": isToday ? 'date' : undefined,
            onClick: () => {
              if (!isDisabled) {
                onSelect(day.iso);
              }
            },
            onFocus: () => onDayFocus(day.date),
            onKeyDown: event => onDayKeyDown(event, day.date),
            ...stylex.props(styles.day, focusOutlineStyles.focusVisible,
            // Outside FIRST, so disabled wins where both apply: a
            // spilled day past the range is unselectable, and must
            // not be painted more available than the in-month days
            // beside it.
            day.isOutside && styles.dayOutside, isDisabled && styles.dayDisabled),
            children: /*#__PURE__*/_jsx("span", {
              ...{
                0: {
                  className: "x78zum5 x6s0dn4 xl56j7k x1y2t9nm xw1wawg xjspbzw x1litavf x1y0btm7 x9r1u3d xjbqb8w xzo0q3i xuedmi6"
                },
                4: {
                  className: "x78zum5 x6s0dn4 xl56j7k x1y2t9nm xw1wawg xjspbzw x1litavf x1y0btm7 x9r1u3d xzo0q3i xuedmi6 xjbqb8w x150ydqw xoevpu5"
                },
                2: {
                  className: "x78zum5 x6s0dn4 xl56j7k x1y2t9nm xw1wawg xjspbzw x1litavf x1y0btm7 xjbqb8w xzo0q3i xuedmi6 xvy26l8 x2mo6ok"
                },
                6: {
                  className: "x78zum5 x6s0dn4 xl56j7k x1y2t9nm xw1wawg xjspbzw x1litavf x1y0btm7 xzo0q3i xuedmi6 xjbqb8w x150ydqw xoevpu5 xvy26l8 x2mo6ok"
                },
                1: {
                  className: "x78zum5 x6s0dn4 xl56j7k x1y2t9nm xw1wawg xjspbzw x1litavf x1y0btm7 xzo0q3i xuedmi6 x1ewilqj x1spg45b xad5do x17wrial x2mo6ok"
                },
                5: {
                  className: "x78zum5 x6s0dn4 xl56j7k x1y2t9nm xw1wawg xjspbzw x1litavf x1y0btm7 xzo0q3i xuedmi6 x1ewilqj x1spg45b xad5do x17wrial x2mo6ok"
                },
                3: {
                  className: "x78zum5 x6s0dn4 xl56j7k x1y2t9nm xw1wawg xjspbzw x1litavf x1y0btm7 xzo0q3i xuedmi6 x1ewilqj x1spg45b xad5do x17wrial x2mo6ok"
                },
                7: {
                  className: "x78zum5 x6s0dn4 xl56j7k x1y2t9nm xw1wawg xjspbzw x1litavf x1y0btm7 xzo0q3i xuedmi6 x1ewilqj x1spg45b xad5do x17wrial x2mo6ok"
                }
              }[!!!isDisabled << 2 | !!isToday << 1 | !!isSelected << 0],
              children: day.dayNumber
            })
          })
        }, day.iso);
      })
    }, week[0].iso))
  });
}
MonthPane.displayName = 'MonthPane';