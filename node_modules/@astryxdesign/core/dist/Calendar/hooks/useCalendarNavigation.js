// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useCalendarNavigation.ts
 * @input Uses React useState, useMemo, useCallback, useLocale, PlainDate utilities
 * @output Exports useCalendarNavigation hook for month navigation
 * @position Calendar-specific hook; used by Calendar
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Calendar/hooks/index.ts
 */
import { useState, useMemo, useCallback } from 'react';
import { plainDateFromISO, plainDateToISO, plainDateToday, plainDateSetFirstOfMonth, plainDateAddMonths, plainDateAddDays, plainDateFormat, DATE_FORMAT_MONTH_YEAR } from "../../utils/plainDate.js";
import { useLocale } from "../../i18n/index.js";

/**
 * Configuration for calendar navigation
 */

/**
 * Return type for useCalendarNavigation hook
 */

/**
 * Hook for managing calendar month navigation.
 *
 * Handles the current focus date (which month is visible), previous/next
 * navigation, and pending focus for keyboard navigation across months.
 *
 * @example
 * ```
 * const {
 *   visibleMonths,
 *   monthYearLabel,
 *   navigateMonth,
 *   pendingFocus,
 *   clearPendingFocus,
 * } = useCalendarNavigation({
 *   initialValue: '2026-01-15',
 *   numberOfMonths: 1,
 * });
 *
 * // Navigate to next month
 * navigateMonth(1);
 *
 * // Navigate from arrow key (with focus tracking)
 * navigateMonth(1, focusedDate, 1); // horizontal offset
 * navigateMonth(1, focusedDate, 7); // vertical offset
 * ```
 */
export function useCalendarNavigation(options) {
  const {
    initialValue,
    focusDate: focusDateProp,
    onFocusDateChange,
    numberOfMonths = 1
  } = options;
  const locale = useLocale();

  // Pending focus target after month navigation
  const [pendingFocus, setPendingFocus] = useState(null);

  // Internal focus date state (PlainDate)
  const [internalFocusDate, setInternalFocusDate] = useState(() => {
    if (focusDateProp) {
      return plainDateFromISO(focusDateProp);
    }
    if (initialValue) {
      return plainDateFromISO(initialValue);
    }
    return plainDateToday();
  });

  // Determine if focus is controlled
  const isControlledFocus = focusDateProp !== undefined && onFocusDateChange !== undefined;
  const focusDate = isControlledFocus ? plainDateFromISO(focusDateProp) : internalFocusDate;

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

  // Navigate to previous/next month
  const navigateMonth = useCallback((delta, focusedDate, offset) => {
    const newMonth = plainDateAddMonths(baseMonth, delta);
    const newISO = plainDateToISO(newMonth);

    // Calculate target focus date if provided
    if (focusedDate) {
      const currentDate = plainDateFromISO(focusedDate);
      // Use the provided offset (1 for horizontal, 7 for vertical)
      const daysToMove = offset ?? 7;
      const targetDate = plainDateAddDays(currentDate, delta * daysToMove);
      setPendingFocus(plainDateToISO(targetDate));
    }
    if (onFocusDateChange) {
      onFocusDateChange(newISO);
    } else {
      setInternalFocusDate(newMonth);
    }
  }, [baseMonth, onFocusDateChange]);

  // Clear pending focus
  const clearPendingFocus = useCallback(() => {
    setPendingFocus(null);
  }, []);
  return {
    baseMonth,
    visibleMonths,
    monthYearLabel,
    navigateMonth,
    pendingFocus,
    clearPendingFocus
  };
}