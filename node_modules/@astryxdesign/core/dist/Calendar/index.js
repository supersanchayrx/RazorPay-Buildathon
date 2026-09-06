// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports calendar components and types
 * @output Exports Calendar and related types
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * SYNC: When modified, update this header and /packages/core/src/Calendar/Calendar.doc.mjs
 */
export { Calendar } from "./Calendar.js";
// Re-export hooks for advanced usage
export { useCalendarDays, useCalendarConstraints, useCalendarNavigation } from "./hooks/index.js";
// Re-export calendar-specific utilities for advanced usage
export { isSameDay, isDateInRange, getWeekNumber } from "./utils.js";

// Re-export theme styles for customization