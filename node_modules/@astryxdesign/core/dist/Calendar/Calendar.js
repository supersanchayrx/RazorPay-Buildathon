// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Calendar.tsx
 * @input Uses React useState, useMemo, useCallback, hooks
 * @output Exports Calendar component and related types
 * @position Core implementation; forwards DOM ref and exposes navigation via
 *   handleRef
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Calendar/Calendar.doc.mjs (props table, features, implementation notes)
 * - /packages/core/src/Calendar/getInitialFocusDate.ts (which month the calendar opens on)
 * - /packages/core/src/Calendar/Calendar.test.tsx (tests for new/changed behavior)
 * - /packages/core/src/Calendar/index.ts (exports if types change)
 * - /apps/storybook/stories/Calendar.stories.tsx (storybook stories)
 * - /packages/cli/assets/templates/blocks/components/Calendar/ (showcase blocks)
 */
import { useState, useMemo, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Button } from "../Button/index.js";
import { Icon } from "../Icon/index.js";
import { useAnnounce, useGridFocus } from "../hooks/index.js";
import { useCalendarDays, useCalendarConstraints } from "./hooks/index.js";
import { calendarStyles, monthGridStyles, dayCellStyles, dayCellTheme } from "./styles.js";
import { plainDateFromISO, plainDateToISO, plainDateToDate, plainDateToday, plainDateSetFirstOfMonth, plainDateAddMonths, plainDateAddDays, plainDateIsBefore, plainDateIsEqual, plainDateGetWeekNumber, plainDateFormat, DATE_FORMAT_WITH_WEEKDAY, DATE_FORMAT_MONTH_YEAR } from "../utils/plainDate.js";
import { mergeProps, composeEventHandlers, rtlStyles } from "../utils/index.js";
import { focusOutlineProps } from "../utils/focusOutline.stylex.js";
import { interactionOverlayStyles } from "../utils/interactionOverlay.stylex.js";
import { getInitialFocusDate } from "./getInitialFocusDate.js";
import { computeDayCellState, computeRangeRounding, computePreviewRounding, computeDayNeighborContinuity, isEndpoint } from "./dayCellUtils.js";

// =============================================================================
// Types
// =============================================================================

import { normalizeDayOfWeek } from "../utils/dateTypes.js";
import { themeProps } from "../utils/themeProps.js";
import { useLocale, useTranslator } from "../i18n/index.js";

/** Imperative handle for Calendar handleRef */

// ─── Base Props (shared across all modes) ─────────────────────

// ─── Mode-specific Props (discriminated union) ────────────────
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// =============================================================================
// Main Component
// =============================================================================

/**
 * A calendar component for selecting dates or date ranges.
 *
 * @example
 * ```
 * <Calendar value={selectedDate} onChange={setSelectedDate} />
 * ```
 */
export function Calendar({
  ref,
  ...props
}) {
  const t = useTranslator();
  const locale = useLocale();
  const {
    handleRef,
    mode = 'single',
    value,
    defaultValue,
    onChange,
    numberOfMonths: numberOfMonthsProp = 1,
    min,
    max,
    dateConstraints,
    maxRangeSpan,
    minRangeSpan,
    focusDate: focusDateProp,
    onFocusDateChange,
    hasOutsideDays = true,
    hasWeekNumbers = false,
    hasVariableRowCount = false,
    weekStartsOn: weekStartsOnProp = 0,
    xstyle,
    className,
    style,
    onKeyDown,
    ...rest
  } = props;

  // Normalize `weekStartsOn` (number or three-letter day name) to a numeric
  // DayOfWeek so all downstream date math keeps working with an index.
  const weekStartsOn = normalizeDayOfWeek(weekStartsOnProp);

  // `numberOfMonths` is typed `1 | 2`; defensively clamp anything else that
  // slips through at runtime to 1 so `Array.from({length})` can't render an
  // absurd number of month grids (e.g. `numberOfMonths={1000}`).
  const numberOfMonths = numberOfMonthsProp === 2 ? 2 : 1;

  // Today's date (memoized)
  const today = useMemo(() => plainDateToday(), []);

  // Internal state for uncontrolled mode
  const [internalValue, setInternalValue] = useState(defaultValue);

  // Range selection in progress (first click made, waiting for second)
  const [rangeSelectionStart, setRangeSelectionStart] = useState(null);

  // Hovered date for range preview
  const [hoveredDate, setHoveredDate] = useState(null);

  // Pending focus target after month navigation
  const [pendingFocus, setPendingFocus] = useState(null);

  // Determine effective value
  const effectiveValue = value !== undefined ? value : internalValue;

  // Focus date state (which month is visible). Falls back to today, clamped
  // into the min/max window so a window that doesn't contain today doesn't
  // open on an all-disabled month.
  const [internalFocusDate, setInternalFocusDate] = useState(() => getInitialFocusDate({
    focusDate: focusDateProp,
    value: effectiveValue,
    min,
    max,
    numberOfMonths,
    today
  }));

  // Use controlled focusDate if callback is provided, otherwise use internal state
  const isControlledFocus = focusDateProp !== undefined && onFocusDateChange !== undefined;
  const focusDate = isControlledFocus ? plainDateFromISO(focusDateProp) : internalFocusDate;

  // Expose imperative handle for external navigation
  useImperativeHandle(handleRef, () => ({
    navigateTo: date => {
      if (isControlledFocus) {
        onFocusDateChange?.(date);
      } else {
        setInternalFocusDate(plainDateFromISO(date));
      }
    }
  }), [isControlledFocus, onFocusDateChange]);

  // Base month (first day of focus month)
  const baseMonth = useMemo(() => {
    return plainDateSetFirstOfMonth(focusDate);
  }, [focusDate]);

  // Generate visible months
  const visibleMonths = useMemo(() => {
    return Array.from({
      length: numberOfMonths
    }, (_, i) => {
      return plainDateAddMonths(baseMonth, i);
    });
  }, [baseMonth, numberOfMonths]);

  // Format month header
  const monthYearLabel = useMemo(() => {
    if (numberOfMonths === 1) {
      return plainDateFormat(visibleMonths[0], DATE_FORMAT_MONTH_YEAR, locale);
    }
    return visibleMonths.map(m => plainDateFormat(m, DATE_FORMAT_MONTH_YEAR, locale)).join(' – ');
  }, [visibleMonths, numberOfMonths, locale]);

  // Announce the newly visible month to screen readers whenever it changes.
  // The visible month label (`<span>`) carries no live semantics, so paging the
  // grid — via the header prev/next buttons, keyboard grid paging (arrow keys
  // across a month boundary, PageUp/PageDown), the `navigateTo` handle, or a
  // controlled `focusDate` change — otherwise updates the grid silently. Keying
  // off `monthYearLabel` reuses the existing single-/multi-month formatting and
  // only fires when the visible month actually changes (so selecting a date,
  // which does not move the grid, stays silent). The first-render guard avoids
  // announcing the initial month on mount.
  const announce = useAnnounce();
  const isInitialRenderRef = useRef(true);
  useEffect(() => {
    if (isInitialRenderRef.current) {
      isInitialRenderRef.current = false;
      return;
    }
    announce(monthYearLabel);
  }, [monthYearLabel, announce]);

  // Determine if prev/next navigation is possible based on min/max
  const canNavigatePrevious = useMemo(() => {
    if (!min) {
      return true;
    }
    const minDate = plainDateFromISO(min);
    // Can't go back if min is in the current focus month
    return minDate.year < baseMonth.year || minDate.year === baseMonth.year && minDate.month < baseMonth.month;
  }, [min, baseMonth]);
  const canNavigateNext = useMemo(() => {
    if (!max) {
      return true;
    }
    const maxDate = plainDateFromISO(max);
    // Check against the last visible month, not just baseMonth
    const lastVisibleMonth = plainDateAddMonths(baseMonth, numberOfMonths - 1);
    return maxDate.year > lastVisibleMonth.year || maxDate.year === lastVisibleMonth.year && maxDate.month > lastVisibleMonth.month;
  }, [max, baseMonth, numberOfMonths]);

  // Navigation handlers
  const navigateMonth = useCallback((delta, focusedDate, offset) => {
    const newPd = plainDateAddMonths(baseMonth, delta);
    const newISO = plainDateToISO(newPd);

    // Calculate target focus date if a focused date was provided
    if (focusedDate) {
      const currentPd = plainDateFromISO(focusedDate);
      const daysToMove = offset ?? 7;
      const targetPd = plainDateAddDays(currentPd, delta * daysToMove);
      setPendingFocus(plainDateToISO(targetPd));
    }
    if (onFocusDateChange) {
      onFocusDateChange(newISO);
    } else {
      setInternalFocusDate(newPd);
    }
  }, [baseMonth, onFocusDateChange]);

  // Escape key handler to cancel range selection
  const handleCalendarKeyDown = useCallback(e => {
    if (mode === 'range' && rangeSelectionStart !== null && e.key === 'Escape') {
      setRangeSelectionStart(null);
      e.preventDefault();
      e.stopPropagation();
    }
  }, [mode, rangeSelectionStart]);

  // Day click handler
  const handleDayClick = useCallback(date => {
    const iso = plainDateToISO(date);
    if (mode === 'single') {
      setInternalValue(iso);
      onChange?.(iso, plainDateToDate(date));
    } else {
      // Range mode
      if (rangeSelectionStart === null) {
        // First click - start the range. Nothing else about this pick is
        // perceivable non-visually (WCAG 1.3.1) — the grid doesn't move, so
        // the month-change announcement stays silent — so speak the range
        // progress through the same polite live region.
        setRangeSelectionStart(iso);
        announce(t('@astryx.calendar.rangeStartAnnounce', {
          date: plainDateFormat(date, DATE_FORMAT_WITH_WEEKDAY, locale)
        }));
      } else {
        // Second click - complete the range
        const startPd = plainDateFromISO(rangeSelectionStart);

        // Clicking the anchor again commits a one-day range when the minimum
        // span allows it. For longer minimum spans, the repeated click clears
        // the in-progress start instead: the anchor is the only nearby day
        // that remains enabled, so this preserves an escape hatch for moving
        // the start without violating the configured minimum.
        if (plainDateIsEqual(date, startPd) && (minRangeSpan ?? 1) > 1) {
          setRangeSelectionStart(null);
          announce(t('@astryx.calendar.rangeClearedAnnounce', {
            date: plainDateFormat(date, DATE_FORMAT_WITH_WEEKDAY, locale)
          }));
          return;
        }
        let start;
        let end;

        // Ensure start <= end
        if (plainDateIsBefore(date, startPd)) {
          start = iso;
          end = rangeSelectionStart;
        } else {
          start = rangeSelectionStart;
          end = iso;
        }
        const range = {
          start,
          end
        };
        setInternalValue(range);
        setRangeSelectionStart(null);
        onChange?.(range);
        // Completed-range announcement, in chronological order (matches the
        // swapped {start, end} above even for a reverse pick).
        announce(t('@astryx.calendar.rangeCompleteAnnounce', {
          start: plainDateFormat(plainDateFromISO(start), DATE_FORMAT_WITH_WEEKDAY, locale),
          end: plainDateFormat(plainDateFromISO(end), DATE_FORMAT_WITH_WEEKDAY, locale)
        }));
      }
    }
  }, [mode, onChange, rangeSelectionStart, minRangeSpan, announce, t, locale]);
  return /*#__PURE__*/_jsxs("div", {
    ref: ref,
    ...rest,
    ...mergeProps(themeProps('calendar', {
      mode
    }), stylex.props(calendarStyles.calendar, xstyle), className, style),
    onKeyDown: composeEventHandlers(onKeyDown, handleCalendarKeyDown),
    children: [/*#__PURE__*/_jsxs("div", {
      ...stylex.props(calendarStyles.header),
      children: [/*#__PURE__*/_jsx(Button, {
        ...themeProps('calendar-nav', {
          nav: 'prev',
          disabled: !canNavigatePrevious ? 'disabled' : null
        }),
        label: t('@astryx.calendar.previousMonth'),
        variant: "ghost",
        icon:
        /*#__PURE__*/
        // Wrapper span (not Icon props): Icon's string mode clobbers
        // caller classNames, so the RTL mirror must live on its own
        // element.
        _jsx("span", {
          ...stylex.props(calendarStyles.navIcon, rtlStyles.mirror),
          children: /*#__PURE__*/_jsx(Icon, {
            icon: "chevronLeft",
            size: "sm",
            color: "inherit"
          })
        }),
        onClick: () => navigateMonth(-1),
        isDisabled: !canNavigatePrevious,
        isIconOnly: true
      }), /*#__PURE__*/_jsx("span", {
        ...stylex.props(calendarStyles.monthYearLabel),
        children: monthYearLabel
      }), /*#__PURE__*/_jsx(Button, {
        ...themeProps('calendar-nav', {
          nav: 'next',
          disabled: !canNavigateNext ? 'disabled' : null
        }),
        label: t('@astryx.calendar.nextMonth'),
        variant: "ghost",
        icon: /*#__PURE__*/_jsx("span", {
          ...stylex.props(calendarStyles.navIcon, rtlStyles.mirror),
          children: /*#__PURE__*/_jsx(Icon, {
            icon: "chevronRight",
            size: "sm",
            color: "inherit"
          })
        }),
        onClick: () => navigateMonth(1),
        isDisabled: !canNavigateNext,
        isIconOnly: true
      })]
    }), /*#__PURE__*/_jsx("div", {
      ...stylex.props(calendarStyles.monthsContainer),
      children: visibleMonths.map(month => /*#__PURE__*/_jsx(MonthGrid, {
        month: month,
        value: effectiveValue,
        mode: mode,
        rangeSelectionStart: rangeSelectionStart,
        hoveredDate: hoveredDate,
        min: min,
        max: max,
        dateConstraints: dateConstraints,
        maxRangeSpan: maxRangeSpan,
        minRangeSpan: minRangeSpan,
        hasOutsideDays: hasOutsideDays,
        hasWeekNumbers: hasWeekNumbers,
        hasVariableRowCount: hasVariableRowCount,
        weekStartsOn: weekStartsOn,
        onDayClick: handleDayClick,
        onDayHover: date => setHoveredDate(date ? plainDateToISO(date) : null),
        today: today,
        onNavigatePrevious: (focusedDate, offset) => navigateMonth(-1, focusedDate, offset),
        onNavigateNext: (focusedDate, offset) => navigateMonth(1, focusedDate, offset),
        pendingFocus: pendingFocus,
        onPendingFocusHandled: () => setPendingFocus(null)
      }, `${month.year}-${month.month}`))
    })]
  });
}
Calendar.displayName = 'Calendar';

// =============================================================================
// MonthGrid (Private)
// =============================================================================

function MonthGrid({
  month,
  value,
  mode,
  rangeSelectionStart,
  hoveredDate,
  min,
  max,
  dateConstraints,
  maxRangeSpan,
  minRangeSpan,
  hasOutsideDays,
  hasWeekNumbers,
  hasVariableRowCount,
  weekStartsOn,
  onDayClick,
  onDayHover,
  today,
  onNavigatePrevious,
  onNavigateNext,
  pendingFocus,
  onPendingFocusHandled
}) {
  const locale = useLocale();
  const year = month.year;

  // Use hooks for days generation and constraints
  const {
    days,
    weeks,
    dayNames
  } = useCalendarDays({
    year,
    month: month.month,
    weekStartsOn,
    hasVariableRowCount
  });
  const dayNameHeaders = useMemo(() => dayNames.map((name, offset) => ({
    dayOfWeek: (weekStartsOn + offset) % 7,
    name
  })), [dayNames, weekStartsOn]);
  const rangeAnchor = useMemo(() => mode === 'range' && rangeSelectionStart ? plainDateFromISO(rangeSelectionStart) : null, [mode, rangeSelectionStart]);
  const {
    isDateDisabled
  } = useCalendarConstraints({
    min,
    max,
    dateConstraints,
    maxRangeSpan,
    minRangeSpan,
    rangeAnchor
  });

  // Parse selected date for roving tabindex priority
  const selectedDateForTabindex = useMemo(() => {
    if (mode === 'single' && value && typeof value === 'string') {
      return plainDateFromISO(value);
    }
    return null;
  }, [mode, value]);

  // Seed the initial roving tab stop for this month. useGridFocus owns the
  // live tab stop (see `hasRovingTabIndex` below) — it honors an existing
  // `tabindex="0"` and repairs/moves it thereafter — so this only decides
  // which day button starts tabbable. Priority: selected date (if visible and
  // enabled) > today (if visible and enabled) > first enabled in-month day.
  const seedTabbableIso = useMemo(() => {
    if (selectedDateForTabindex) {
      const isSelectedInMonth = selectedDateForTabindex.year === year && selectedDateForTabindex.month === month.month;
      if (isSelectedInMonth && !isDateDisabled(selectedDateForTabindex)) {
        return plainDateToISO(selectedDateForTabindex);
      }
    }
    const isTodayInMonth = today.year === year && today.month === month.month;
    if (isTodayInMonth && !isDateDisabled(today)) {
      return plainDateToISO(today);
    }
    for (const day of days) {
      if (!day.isOutside && !isDateDisabled(day.date)) {
        return day.iso;
      }
    }
    return null;
  }, [days, today, year, month.month, isDateDisabled, selectedDateForTabindex]);

  // Helper to get the focused date from the currently focused element.
  // Reads the machine-readable `data-date` (ISO) attribute rather than parsing
  // the human-readable `aria-label` with `new Date()`, which is locale/format
  // dependent and returns Invalid Date in non-English locales (e.g. fr-FR,
  // ja-JP), silently swallowing month-boundary arrow navigation (complex-4).
  const getFocusedDate = useCallback(() => {
    const activeElement = document.activeElement;
    if (!activeElement) {
      return null;
    }
    const iso = activeElement.getAttribute('data-date');
    if (!iso) {
      return null;
    }
    return iso;
  }, []);

  // Handle navigation to previous month
  const handleNavigatePrevious = useCallback((_column, offset) => {
    const focusedDate = getFocusedDate();
    if (focusedDate) {
      onNavigatePrevious?.(focusedDate, offset);
    }
  }, [getFocusedDate, onNavigatePrevious]);

  // Handle navigation to next month
  const handleNavigateNext = useCallback((_column, offset) => {
    const focusedDate = getFocusedDate();
    if (focusedDate) {
      onNavigateNext?.(focusedDate, offset);
    }
  }, [getFocusedDate, onNavigateNext]);

  // Handle PageUp/PageDown
  const handlePageUp = useCallback(() => {
    const focusedDate = getFocusedDate();
    if (focusedDate) {
      onNavigatePrevious?.(focusedDate, 7);
    }
  }, [getFocusedDate, onNavigatePrevious]);
  const handlePageDown = useCallback(() => {
    const focusedDate = getFocusedDate();
    if (focusedDate) {
      onNavigateNext?.(focusedDate, 7);
    }
  }, [getFocusedDate, onNavigateNext]);

  // Grid focus navigation.
  //
  // The hook enumerates ALL grid cells (every `role="gridcell"`, including
  // disabled days and empty placeholder cells) so the true 7-column geometry is
  // preserved. `isCellFocusable` / `getFocusTarget` tell the hook which cells
  // can take focus (those containing an enabled day button) and where to send
  // focus (the day button inside the cell). Arrow keys move to the target
  // row/column and, if that cell is disabled, continue in the same direction to
  // the next enabled cell.
  const {
    gridRef,
    handleKeyDown: handleGridKeyDown,
    handleFocus: handleGridFocus
  } = useGridFocus({
    columns: 7,
    cellSelector: '[role="gridcell"]',
    isCellFocusable: cell => cell.querySelector('button:not([disabled])') !== null,
    getFocusTarget: cell => cell.querySelector('button'),
    hasRovingTabIndex: true,
    onNavigateBefore: handleNavigatePrevious,
    onNavigateAfter: handleNavigateNext,
    onPageUp: handlePageUp,
    onPageDown: handlePageDown
  });

  // Handle pending focus after month navigation
  useEffect(() => {
    if (!pendingFocus || !gridRef.current) {
      return;
    }
    const buttons = gridRef.current.querySelectorAll('button:not([disabled])');
    const targetPd = plainDateFromISO(pendingFocus);
    const targetIso = plainDateToISO(targetPd);
    let targetButton = null;
    for (const button of buttons) {
      if (button.getAttribute('data-date') === targetIso) {
        targetButton = button;
        break;
      }
    }
    if (!targetButton && buttons.length > 0) {
      targetButton = buttons[0];
    }
    targetButton?.focus();
    onPendingFocusHandled?.();
  }, [pendingFocus, gridRef, onPendingFocusHandled]);

  // Parse selection
  let selectedDate = null;
  let rangeStart = null;
  let rangeEnd = null;
  if (mode === 'single' && value && typeof value === 'string') {
    selectedDate = plainDateFromISO(value);
  } else if (mode === 'range' && value && typeof value === 'object') {
    const range = value;
    rangeStart = plainDateFromISO(range.start);
    rangeEnd = plainDateFromISO(range.end);
  }

  // Handle in-progress range selection
  if (rangeSelectionStart) {
    rangeStart = plainDateFromISO(rangeSelectionStart);
    rangeEnd = rangeStart;
  }

  // Calculate preview range when hovering during range selection
  let previewStart = null;
  let previewEnd = null;
  if (mode === 'range' && rangeSelectionStart && hoveredDate) {
    const startPd = plainDateFromISO(rangeSelectionStart);
    const hoverPd = plainDateFromISO(hoveredDate);
    if (!plainDateIsEqual(startPd, hoverPd)) {
      if (plainDateIsBefore(hoverPd, startPd)) {
        previewStart = hoverPd;
        previewEnd = startPd;
      } else {
        previewStart = startPd;
        previewEnd = hoverPd;
      }
    }
  }

  // Month label for announcements
  const monthLabel = useMemo(() => {
    return plainDateFormat(month, DATE_FORMAT_MONTH_YEAR, locale);
  }, [month, locale]);
  return /*#__PURE__*/_jsx("div", {
    ...stylex.props(monthGridStyles.monthGrid),
    children: /*#__PURE__*/_jsxs("div", {
      ref: gridRef,
      role: "grid",
      "aria-label": monthLabel
      // APG grid pattern: a range selection holds multiple selected cells,
      // so the grid must advertise multi-selectability.
      ,
      "aria-multiselectable": mode === 'range' ? true : undefined,
      onKeyDown: handleGridKeyDown,
      onFocus: handleGridFocus,
      ...stylex.props(monthGridStyles.daysGrid, hasWeekNumbers && monthGridStyles.daysGridWithNumbers),
      children: [/*#__PURE__*/_jsxs("div", {
        role: "row",
        ...stylex.props(monthGridStyles.weekRow),
        children: [hasWeekNumbers && /*#__PURE__*/_jsx("div", {
          ...stylex.props(monthGridStyles.dayName, monthGridStyles.weekNumberHeader)
        }), dayNameHeaders.map(({
          dayOfWeek,
          name
        }) => /*#__PURE__*/_jsx("div", {
          role: "columnheader",
          ...stylex.props(monthGridStyles.dayName),
          children: name
        }, dayOfWeek))]
      }), weeks.map(week => {
        const weekDate = week.find(d => !d.isOutside)?.date || week[0].date;
        const weekNum = plainDateGetWeekNumber(weekDate);
        return /*#__PURE__*/_jsxs("div", {
          role: "row",
          ...stylex.props(monthGridStyles.weekRow),
          children: [hasWeekNumbers && /*#__PURE__*/_jsx("div", {
            role: "rowheader",
            ...stylex.props(monthGridStyles.weekNumber),
            children: weekNum
          }), week.map((day, dayIndex) => {
            // Whether the previous/next day in this week row continues the
            // highlighted run (range and preview). A disabled or
            // adjacent-month neighbour breaks continuity, so this day gets
            // an end cap on that side (#2715).
            const neighbors = computeDayNeighborContinuity({
              week,
              dayIndex,
              mode,
              rangeStart,
              rangeEnd,
              previewStart,
              previewEnd,
              isDisabled: isDateDisabled
            });
            return /*#__PURE__*/_jsx(DayCell, {
              day: day,
              dayIndex: dayIndex,
              mode: mode,
              selectedDate: selectedDate,
              rangeStart: rangeStart,
              rangeEnd: rangeEnd,
              previewStart: previewStart,
              previewEnd: previewEnd,
              today: today,
              hasOutsideDays: hasOutsideDays,
              isDisabled: isDateDisabled(day.date),
              neighbors: neighbors,
              isTabbable: day.iso === seedTabbableIso,
              isRangeSelectionInProgress: rangeSelectionStart !== null,
              onDayClick: onDayClick,
              onDayHover: onDayHover
            }, day.iso);
          })]
        }, plainDateToISO(weekDate));
      })]
    })
  });
}

// =============================================================================
// DayCell (Private)
// =============================================================================

function DayCell({
  day,
  dayIndex,
  mode,
  selectedDate,
  rangeStart,
  rangeEnd,
  previewStart,
  previewEnd,
  today,
  hasOutsideDays,
  isDisabled,
  neighbors,
  isTabbable: isTabbableDay,
  isRangeSelectionInProgress,
  onDayClick,
  onDayHover
}) {
  const t = useTranslator();
  const locale = useLocale();
  const {
    date,
    isOutside,
    dayNumber
  } = day;
  if (isOutside && !hasOutsideDays) {
    // Empty placeholder cell — still a gridcell so the grid geometry stays a
    // clean 7-per-row set for keyboard navigation.
    return /*#__PURE__*/_jsx("div", {
      role: "gridcell",
      ...stylex.props(dayCellStyles.cell)
    });
  }
  const state = computeDayCellState({
    date,
    dayIndex,
    mode,
    selectedDate,
    rangeStart,
    rangeEnd,
    previewStart,
    previewEnd,
    today,
    isDisabled,
    isOutside
  });
  const endpoint = isEndpoint(state);

  // The day's focus-ring treatment, derived once so the reflected `marker`
  // theme state and the StyleX ring styles below share a single source of
  // truth. `state.isSelected` is single-select only, so a range endpoint that
  // is today still qualifies for the today-in-range ring (unchanged prior
  // behavior).
  const showsTodayRing = state.isToday && !state.isSelected && !state.isInRange;
  const showsTodayInRangeRing = state.isToday && !state.isSelected && state.isInRange;
  const markerState = showsTodayRing ? 'today-only' : showsTodayInRangeRing ? 'today-in-range' : null;

  // Accessible name for the day button. Roving focus lands on the <button>,
  // not the role="gridcell" wrapper that carries aria-selected — and
  // aria-selected is invalid on role="button" — so the selection/range state
  // must be encoded into the button's name (WCAG 4.1.2). Localized via ICU
  // params rather than string concatenation. A mid-flight first pick (where
  // rangeStart === rangeEnd) reads as "range start" only; a completed one-day
  // range reads as both start and end.
  const dateLabel = plainDateFormat(date, DATE_FORMAT_WITH_WEEKDAY, locale);
  const dayLabel = state.isSelected ? t('@astryx.calendar.daySelected', {
    date: dateLabel
  }) : state.isRangeStart && state.isRangeEnd ? isRangeSelectionInProgress ? t('@astryx.calendar.dayRangeStart', {
    date: dateLabel
  }) : t('@astryx.calendar.dayRangeStartAndEnd', {
    date: dateLabel
  }) : state.isRangeStart ? t('@astryx.calendar.dayRangeStart', {
    date: dateLabel
  }) : state.isRangeEnd ? t('@astryx.calendar.dayRangeEnd', {
    date: dateLabel
  }) : state.isInRange ? t('@astryx.calendar.dayInRange', {
    date: dateLabel
  }) : dateLabel;
  const rangeRounding = computeRangeRounding(state, {
    prevInRange: neighbors.prevInRange,
    nextInRange: neighbors.nextInRange
  });
  const previewRounding = computePreviewRounding(state, {
    prevInPreview: neighbors.prevInPreview,
    nextInPreview: neighbors.nextInPreview
  });
  return /*#__PURE__*/_jsxs("div", {
    role: "gridcell",
    "aria-selected": state.isSelected || state.isInRange || undefined,
    ...stylex.props(dayCellStyles.cell),
    children: [state.isInRange && /*#__PURE__*/_jsx("div", {
      ...stylex.props(dayCellStyles.rangeBg, dayCellTheme.rangeBg, rangeRounding.roundStart && dayCellStyles.rangeBgRadiusStart, rangeRounding.roundEnd && dayCellStyles.rangeBgRadiusEnd, state.isRangeStart && dayCellStyles.rangeInsetStart, state.isRangeStart && rangeRounding.roundEnd && dayCellStyles.rangeInsetEnd, state.isRangeEnd && dayCellStyles.rangeInsetEnd, state.isRangeStart && rangeRounding.roundStart && dayCellStyles.rangeInsetStart)
    }), state.isInPreview && /*#__PURE__*/_jsx("div", {
      ...stylex.props(dayCellStyles.previewBg, dayCellTheme.previewBg, previewRounding.roundStart && dayCellStyles.previewBgRadiusStart, previewRounding.roundEnd && dayCellStyles.previewBgRadiusEnd, state.isPreviewStart && dayCellStyles.previewStart, state.isPreviewEnd && dayCellStyles.previewEnd)
    }), /*#__PURE__*/_jsx("button", {
      type: "button",
      "data-date": day.iso,
      "aria-label": dayLabel,
      "aria-disabled": state.effectivelyDisabled || undefined
      // Mark today's cell programmatically (APG date-picker pattern), not just
      // visually, so screen-reader users can identify the current date.
      ,
      "aria-current": state.isToday ? 'date' : undefined,
      disabled: isDisabled
      // Initial roving tab-stop seed; useGridFocus owns it after mount.
      ,
      tabIndex: isTabbableDay ? 0 : -1,
      onClick: () => !state.effectivelyDisabled && onDayClick(date),
      onMouseEnter: () => !state.effectivelyDisabled && onDayHover(date),
      onMouseLeave: () => onDayHover(null),
      ...mergeProps(themeProps('calendar-day', {
        selected: endpoint ? 'selected' : null,
        today: state.isToday ? 'today' : null,
        disabled: state.effectivelyDisabled ? 'disabled' : null,
        'in-range': state.isInRange ? 'in-range' : null,
        // `marker` reflects the day's *actual* focus-ring treatment as a
        // single compound state, so a theme can target exactly the states
        // the ring is drawn under without needing `:not()` in the theme
        // key. It is null unless a ring is shown:
        //   'today-only'     → today, not single-selected, not in a range
        //   'today-in-range' → today, not single-selected, inside a range
        // `isSelected` here is single-select only (see computeDayCellState),
        // so a today range endpoint still shows the today-in-range ring —
        // `marker` mirrors the StyleX conditions below exactly, preserving
        // the default rendering.
        marker: markerState
      }), focusOutlineProps.focusVisible(dayCellStyles.day, dayCellTheme.day, interactionOverlayStyles.backgroundImage, isOutside && dayCellStyles.dayOutside, isOutside && dayCellTheme.dayOutside, showsTodayRing && dayCellStyles.dayToday, showsTodayRing && dayCellTheme.dayToday, showsTodayInRangeRing && dayCellStyles.dayTodayInRange, showsTodayInRangeRing && dayCellTheme.dayTodayInRange, endpoint && dayCellStyles.daySelected, endpoint && dayCellTheme.daySelected, state.effectivelyDisabled && dayCellStyles.dayDisabled, state.effectivelyDisabled && dayCellTheme.dayDisabled)),
      children: dayNumber
    })]
  });
}