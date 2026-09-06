// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input PowerSearch component and types
 * @output Exports all PowerSearch module public API
 * @position Entry point for PowerSearch module
 *
 * SYNC: When adding new PowerSearch files, update exports here
 */
export { PowerSearch } from "./PowerSearch.js";
export { PowerSearchToken } from "./PowerSearchToken.js";
export { PowerSearchFilterEditor } from "./PowerSearchFilterEditor.js";
export { resolveOperatorLabel } from "./resolveOperatorLabel.js";
export { createPowerSearchConfig, usePowerSearchConfig } from "./usePowerSearchConfig.js";