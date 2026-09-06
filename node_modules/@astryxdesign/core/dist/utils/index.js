// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file index.ts
 * @input Utils module exports
 * @output Re-exports all utility functions and shared types
 * @position Package entry point for utils
 */

export { parseDateInput, dateToISO, parseISO, isLocaleDayFirst } from "./dateParser.js";
export { plainDateCreate, plainDateFromISO, plainDateToISO, plainDateToDate, plainDateFromDate, plainDateToday, getDaysInMonth, plainDateDayOfWeek, plainDateAddMonths, plainDateAddDays, plainDateToInstant, plainDateFromInstant, plainDateIsBefore, plainDateIsAfter, plainDateIsEqual, plainDateMax, plainDateMin, plainDateIsInRange, plainDateSetFirstOfMonth, plainDateSetStartOfWeek, plainDateSetEndOfWeekExclusive, plainDateGetWeekNumber, plainDateFormat, formatSharedDate, DATE_FORMAT_WITH_WEEKDAY, DATE_FORMAT_SHORT_WITH_WEEKDAY, DATE_FORMAT_LONG, DATE_FORMAT_MONTH_YEAR, DATE_FORMAT_MONTH_ONLY, DATE_FORMAT_WEEKDAY_ONLY, DATE_FORMAT_SHORT, DATE_FORMAT_SHORT_WITH_YEAR, SHARED_DATE_FORMAT_OPTIONS } from "./plainDate.js";
export { parseISOTime, formatISOTime, formatDisplayTime12h, formatDisplayTime24h, parseTimeInput, compareTime, isTimeInRange, clampTime, adjustTime, createISOTimeString } from "./timeParser.js";
export { parseStyleKey } from "./parseStyleKey.js";
export { getKey } from "./getKey.js";
export { characterCount, firstCharacter, truncateCharacters } from "./characters.js";
export { mergeProps } from "./mergeProps.js";
export { mergeRefs } from "./mergeRefs.js";
export { isFocusDetached } from "./focusReturn.js";
export { composeEventHandlers } from "./composeEventHandlers.js";
export { themeProps, themeDataAttributes } from "./themeProps.js";
export { groupItems, getItemGroup } from "./groupItems.js";
export { observeResize, unobserveResize } from "./sharedResizeObserver.js";
export { isRenderable } from "./isRenderable.js";
export { getInputARIA } from "./inputAria.js";
export { parseHex, parseRgb, parseColor, formatHex, formatColor, toGLFloats } from "./color.js";
export { devWarn, devError, warnOnce, formatDevMessage } from "./devWarning.js";
export { rtlStyles } from "./rtlStyles.js";

// The shared focus ring, exported for @astryxdesign/lab — same reason
// rtlStyles is: a style that must be identical across packages, not copied.
export { focusOutlineStyles, focusOutlineProps } from "./focusOutline.stylex.js";
export { isImeKeyEvent } from "./ime.js";