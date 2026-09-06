// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Typeahead components and types
 * @output Exports all Typeahead module public API
 * @position Entry point for Typeahead module
 *
 * SYNC: When adding new Typeahead files, update exports here
 */

// Shared types
// Search source utilities
export { createStaticSource } from "./createStaticSource.js";
// Base (unstyled) typeahead
export { BaseTypeahead } from "./BaseTypeahead.js";
// Styled typeahead
export { Typeahead } from "./Typeahead.js";
// Typeahead item
export { TypeaheadItem } from "./TypeaheadItem.js";