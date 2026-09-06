// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file formatInstant.ts
 * @input A Date, one absolute format name, and an optional time zone
 * @output That instant rendered as a string
 * @position Leaf shared by Timestamp's visible text and each of its tooltip
 *   lines; owns every absolute format Timestamp can produce
 *
 * Timestamp renders the same instant on two surfaces — the visible text and,
 * on hover, one line per configured time zone. They differ only in which zone
 * they name and whether they carry a zone abbreviation, so they are one
 * formatter parameterized by zone rather than two switches that have to be
 * kept in step by hand. Adding a member to `TimestampFormat` now fails to
 * compile in exactly one place.
 *
 * Each caller keeps its own policy for the zone abbreviation: the visible text
 * takes it straight from the `isTimezoneShown` prop, a tooltip line derives it
 * from how many zones are on screen (see tooltipEntries.ts). Only the
 * rendering is shared, not the decision.
 *
 * Omitting `timeZone` means the viewer's own zone. That path hands `Intl` no
 * `timeZone` and keeps `system_*` on plain `Date` getters, so it produces
 * exactly what it produced before this module existed.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Timestamp/Timestamp.tsx
 * - /packages/core/src/Timestamp/tooltipEntries.ts
 * - /packages/core/src/Timestamp/Timestamp.test.tsx
 */

import { SHARED_DATE_FORMAT_OPTIONS, getTimeZoneParts } from "../utils/plainDate.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Every format that names a fixed instant, plus `'full'` — the long absolute
 * style ("February 19, 2026 at 5:00:00 PM UTC") that backs a relative
 * timestamp's accessible name and the tooltip's default line.
 *
 * `'relative'`, `'relative_short'`, and `'auto'` are excluded: a relative
 * phrase names no instant, so a zone could not change what it says.
 */

// =============================================================================
// Option bags
// =============================================================================

/** The long absolute style, with seconds and a zone name. */
const FULL_OPTIONS = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short'
};

/** The time-of-day part, shared by `time` and `date_time`. */
const TIME_OPTIONS = {
  hour: 'numeric',
  minute: '2-digit'
};

/**
 * The date part here is spelled out rather than taken from
 * `SHARED_DATE_FORMAT_OPTIONS.date`. That bag is shared with DateInput, and
 * pointing `date_time` at it would mean a change made for date-only fields
 * silently reshaped every date-and-time reading too. The two agree today; they
 * are not the same decision.
 */
const DATE_TIME_OPTIONS = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  ...TIME_OPTIONS
};

// =============================================================================
// Formatting
// =============================================================================

function pad(n) {
  return String(n).padStart(2, '0');
}

/** The fields a `system_*` string is assembled from. */

/**
 * Wall-clock fields for an instant: in the named zone, or — with no zone —
 * the viewer's own, read straight off the `Date`. The zone-less branch
 * deliberately stays on plain getters so the default rendering never gains a
 * dependency on `Intl` zone data it did not have before.
 *
 * The explicit return type is load-bearing: it is what forces the two branches
 * to keep producing the same shape.
 */
function getWallClock(date, timeZone) {
  return timeZone === undefined ? {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds()
  } : getTimeZoneParts(date.getTime(), timeZone);
}

/**
 * Renders one instant in one absolute format.
 *
 * Pure: the same arguments always produce the same string for the requested
 * locale (and, when no `timeZone` is given, host zone).
 */
export function formatInstant(date, format, locale, {
  timeZone,
  isTimezoneShown = false,
  timeZoneNameStyle = 'short'
} = {}) {
  const zone = timeZone === undefined ? {} : {
    timeZone
  };
  const zoneName = isTimezoneShown ? {
    timeZoneName: 'short'
  } : {};
  switch (format) {
    case 'full':
      return new Intl.DateTimeFormat(locale, {
        ...FULL_OPTIONS,
        timeZoneName: timeZoneNameStyle,
        ...zone,
        calendar: 'gregory'
      }).format(date);
    case 'date':
      return new Intl.DateTimeFormat(locale, {
        ...SHARED_DATE_FORMAT_OPTIONS.date,
        ...zone,
        calendar: 'gregory'
      }).format(date);
    case 'date_long':
      return new Intl.DateTimeFormat(locale, {
        ...SHARED_DATE_FORMAT_OPTIONS.date_long,
        ...zone,
        calendar: 'gregory'
      }).format(date);
    case 'date_weekday':
      return new Intl.DateTimeFormat(locale, {
        ...SHARED_DATE_FORMAT_OPTIONS.date_weekday,
        ...zone,
        calendar: 'gregory'
      }).format(date);
    case 'date_time':
      return new Intl.DateTimeFormat(locale, {
        ...DATE_TIME_OPTIONS,
        ...zoneName,
        ...zone,
        calendar: 'gregory'
      }).format(date);
    case 'time':
      return new Intl.DateTimeFormat(locale, {
        ...TIME_OPTIONS,
        ...zoneName,
        ...zone
      }).format(date);
    case 'system_date':
      {
        const w = getWallClock(date, timeZone);
        return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
      }
    case 'system_date_time':
      {
        const w = getWallClock(date, timeZone);
        return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
      }
    case 'system_time':
      {
        const w = getWallClock(date, timeZone);
        return `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
      }
    case 'unix_seconds':
      // Unix time in whole seconds since the epoch. The epoch is an absolute
      // instant, so this is zone-independent — `timeZone` is intentionally
      // ignored (a wall-clock zone can't change how many seconds have elapsed).
      return String(Math.floor(date.getTime() / 1000));
  }
}