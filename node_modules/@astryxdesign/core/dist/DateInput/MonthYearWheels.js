// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file MonthYearWheels.tsx
 * @input A month index, the reachable month bounds, a change callback
 * @output Exports MonthYearWheels — the month + year wheel pair
 * @position Internal component; consumed by TouchDateField.tsx
 *
 * The shortcut out of continuous scrolling. Scrolling is the right gesture for
 * "a month or two either way" and the wrong one for "December 2019", so the
 * header title opens this instead: two wheels, one flick each.
 *
 * It occupies exactly the same box as the month scroller, so opening it never
 * changes the picker's height.
 *
 * SYNC: When modified, update:
 * - /packages/core/src/DateInput/TouchDateField.tsx
 * - /packages/core/src/DateTimeInput/TouchDateTimeField.tsx
 * - /packages/core/src/DateInput/DateInput.doc.mjs
 * - /packages/core/src/DateInput/DateInputTouch.test.tsx
 */
import { useMemo } from 'react';
import * as stylex from '@stylexjs/stylex';
import { useLocale } from "../i18n/index.js";
import { DATE_FORMAT_MONTH_ONLY, plainDateFormat } from "../utils/index.js";
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import "./tokens.stylex.js";
import { dateInputTouchGeometry } from "./tokens.stylex.js";
import { Wheel } from "./Wheel.js";
import { fromMonthIndex, toMonthIndex } from "./monthGeometry.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Month and year wheels, bounded by the same range as the scroller.
 */
export function MonthYearWheels({
  monthIndex,
  minMonthIndex,
  maxMonthIndex,
  onChange,
  monthLabel,
  yearLabel,
  isActive = true
}) {
  const locale = useLocale();
  const {
    year,
    month
  } = fromMonthIndex(monthIndex);

  // Day 15 of a fixed year: no timezone can push it into an adjacent month
  // the way day 1 or day 31 can.
  //
  // `plainDateFormat` rather than a raw `Intl.DateTimeFormat`, which the
  // shared lint rule forbids and which would duplicate the format vocabulary
  // besides. Recompute when the provider locale changes so the wheel labels
  // stay in sync with the field and calendar.
  const monthNames = useMemo(() => Array.from({
    length: 12
  }, (_, index) => plainDateFormat({
    year: 2021,
    month: index + 1,
    day: 15
  }, DATE_FORMAT_MONTH_ONLY, locale)), [locale]);

  // Months outside the range stay on the wheel rather than vanishing: a list
  // whose length changes with the year would jump under the finger.
  const monthOptions = useMemo(() => monthNames.map((name, index) => {
    const candidate = toMonthIndex(year, index + 1);
    return {
      value: index + 1,
      label: name,
      isDisabled: candidate < minMonthIndex || candidate > maxMonthIndex
    };
  }), [monthNames, year, minMonthIndex, maxMonthIndex]);
  const yearOptions = useMemo(() => {
    const first = fromMonthIndex(minMonthIndex).year;
    const last = fromMonthIndex(maxMonthIndex).year;
    const options = [];
    for (let candidate = first; candidate <= last; candidate++) {
      options.push({
        value: candidate,
        label: String(candidate),
        // A year is reachable when any of its months is.
        isDisabled: toMonthIndex(candidate, 12) < minMonthIndex || toMonthIndex(candidate, 1) > maxMonthIndex
      });
    }
    return options;
  }, [minMonthIndex, maxMonthIndex]);
  return /*#__PURE__*/_jsxs("div", {
    ...{
      className: "x78zum5 xm8gem x1txdalj"
    },
    children: [/*#__PURE__*/_jsx(Wheel, {
      label: monthLabel,
      options: monthOptions,
      value: month,
      isActive: isActive,
      onChange: nextMonth => onChange(toMonthIndex(year, nextMonth))
    }), /*#__PURE__*/_jsx(Wheel, {
      label: yearLabel,
      options: yearOptions,
      value: year,
      isActive: isActive,
      onChange: nextYear => {
        // Jan 31 -> Feb has no equivalent here (months carry no day), but a
        // year change can still land outside the range; clamp to it.
        const candidate = toMonthIndex(nextYear, month);
        onChange(Math.min(Math.max(candidate, minMonthIndex), maxMonthIndex));
      }
    })]
  });
}
MonthYearWheels.displayName = 'MonthYearWheels';