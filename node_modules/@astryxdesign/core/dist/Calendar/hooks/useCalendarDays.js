// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useCalendarDays.ts
 * @input Uses React useMemo, useLocale, PlainDate utilities, generated CLDR weekday data
 * @output Exports useCalendarDays hook for generating calendar day grids
 * @position Calendar-specific hook; used by Calendar
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Calendar/hooks/index.ts
 */
import { useMemo } from 'react';
import { plainDateToISO, getDaysInMonth, plainDateDayOfWeek, plainDateAddDays } from "../../utils/plainDate.js";
import { useLocale } from "../../i18n/index.js";
import { getStandaloneShortWeekdayNames } from "../getStandaloneShortWeekdayNames.js";

/**
 * Represents a single day in the calendar grid.
 */

/**
 * Configuration for calendar days generation
 */

/**
 * Return type for useCalendarDays hook
 */

/**
 * Hook for generating calendar day grids.
 *
 * Calculates all the days to display for a given month, including
 * days from adjacent months to fill the grid.
 *
 * @example
 * ```
 * const {days, weeks, dayNames} = useCalendarDays({
 *   year: 2026,
 *   month: 1, // January (1-based)
 *   weekStartsOn: 0, // Sunday
 * });
 * // days[i].date is a PlainDate { year, month (1-based), day }
 * ```
 */
export function useCalendarDays(options) {
  const {
    year,
    month,
    weekStartsOn = 0,
    hasVariableRowCount = false
  } = options;
  const locale = useLocale();

  // Calculate grid structure
  const gridInfo = useMemo(() => {
    const totalDaysInMonth = getDaysInMonth(year, month);

    // Calculate starting offset based on weekStartsOn
    let startingDayOfWeek = plainDateDayOfWeek({
      year,
      month,
      day: 1
    }) - weekStartsOn;
    if (startingDayOfWeek < 0) {
      startingDayOfWeek += 7;
    }

    // Calculate total cells
    const totalDays = totalDaysInMonth + startingDayOfWeek;
    const totalRows = hasVariableRowCount ? Math.ceil(totalDays / 7) : 6;
    const totalCells = totalRows * 7;
    return {
      daysInMonth: totalDaysInMonth,
      startingDayOfWeek,
      totalCells
    };
  }, [year, month, weekStartsOn, hasVariableRowCount]);

  // Generated strings avoid Date anchors, so weekday headers cannot shift with
  // the runtime timezone. Keep numeric indices as the rotation source of truth.
  const dayNames = useMemo(() => {
    const names = getStandaloneShortWeekdayNames(locale);
    return Array.from({
      length: 7
    }, (_, index) => names[(index + weekStartsOn) % 7]);
  }, [locale, weekStartsOn]);

  // Generate days array
  const days = useMemo(() => {
    const {
      daysInMonth: totalDaysInMonth,
      startingDayOfWeek,
      totalCells
    } = gridInfo;
    const firstOfMonth = {
      year,
      month,
      day: 1
    };
    const result = [];
    for (let i = 0; i < totalCells; i++) {
      const dayOffset = i - startingDayOfWeek + 1;
      const isOutside = dayOffset < 1 || dayOffset > totalDaysInMonth;
      const pd = isOutside ? plainDateAddDays(firstOfMonth, dayOffset - 1) : {
        year,
        month,
        day: dayOffset
      };
      result.push({
        date: pd,
        iso: plainDateToISO(pd),
        isOutside,
        dayNumber: pd.day
      });
    }
    return result;
  }, [year, month, gridInfo]);

  // Group days into weeks
  const weeks = useMemo(() => {
    const result = [];
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7));
    }
    return result;
  }, [days]);
  return {
    days,
    weeks,
    dayNames,
    totalCells: gridInfo.totalCells
  };
}