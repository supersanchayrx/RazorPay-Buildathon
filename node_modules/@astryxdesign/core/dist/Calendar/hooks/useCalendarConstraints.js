// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useCalendarConstraints.ts
 * @input Uses React useCallback, useMemo, PlainDate utilities
 * @output Exports useCalendarConstraints hook for date validation
 * @position Calendar-specific hook; used by Calendar
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Calendar/hooks/index.ts
 */
import { useCallback, useMemo } from 'react';
import { plainDateFromISO, plainDateToDate, plainDateIsBefore, plainDateIsAfter, plainDateDiffDays } from "../../utils/plainDate.js";

/**
 * Configuration for date constraints
 */

/**
 * Return type for useCalendarConstraints hook
 */

/**
 * Hook for managing calendar date validation constraints.
 *
 * Provides a function to check if a date is disabled based on
 * min/max bounds, range-span bounds, and custom constraint functions.
 *
 * @example
 * ```
 * const {isDateDisabled} = useCalendarConstraints({
 *   min: '2026-01-01',
 *   max: '2026-12-31',
 *   maxRangeSpan: 7, // once a start is picked, cap the window at 7 days
 *   rangeAnchor, // the in-progress start (null before the first click)
 *   dateConstraints: [
 *     (date) => date.getDay() !== 0, // No Sundays (receives native Date)
 *   ],
 * });
 *
 * // Check if a PlainDate can be selected
 * if (isDateDisabled({year: 2026, month: 6, day: 15})) {
 *   console.log('This date is not selectable');
 * }
 * ```
 */
export function useCalendarConstraints(options) {
  const {
    min,
    max,
    dateConstraints,
    maxRangeSpan,
    minRangeSpan,
    rangeAnchor
  } = options;

  // Parse min/max dates
  const minDate = useMemo(() => min ? plainDateFromISO(min) : null, [min]);
  const maxDate = useMemo(() => max ? plainDateFromISO(max) : null, [max]);

  // Check if a date is disabled
  const isDateDisabled = useCallback(date => {
    // Check min bound
    if (minDate && plainDateIsBefore(date, minDate)) {
      return true;
    }

    // Check max bound
    if (maxDate && plainDateIsAfter(date, maxDate)) {
      return true;
    }

    // Range-span bounds, measured from the in-progress start. Spans count
    // both endpoints (a span of 7 spans a 7-day window), so the reachable
    // distance from the anchor is `span - 1` days in either direction. Only
    // active once a start is picked — before that, every day stays pickable.
    if (rangeAnchor) {
      const distance = Math.abs(plainDateDiffDays(rangeAnchor, date));
      if (maxRangeSpan != null && distance > maxRangeSpan - 1) {
        return true;
      }
      // The anchor itself (distance 0) is never disabled by minRangeSpan —
      // it is the picked start, and disabling it would render the active
      // selection start as aria-disabled to keyboard and screen-reader users.
      if (minRangeSpan != null && distance > 0 && distance < minRangeSpan - 1) {
        return true;
      }
    }

    // Check custom constraints (convert to Date for public API compatibility)
    if (dateConstraints) {
      for (const constraint of dateConstraints) {
        if (!constraint(plainDateToDate(date))) {
          return true;
        }
      }
    }
    return false;
  }, [minDate, maxDate, dateConstraints, maxRangeSpan, minRangeSpan, rangeAnchor]);
  return {
    isDateDisabled,
    minDate,
    maxDate
  };
}