// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Popover component and hook
 * @output Exports all Popover module public API
 * @position Entry point for Popover module
 *
 * SYNC: When adding new Popover files, update exports here
 */

// Popover hook
export { usePopover } from "./usePopover.js";
// Popover component
export { Popover } from "./Popover.js";