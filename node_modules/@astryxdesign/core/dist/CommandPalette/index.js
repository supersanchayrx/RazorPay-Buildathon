// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports CommandPalette components and types
 * @output Exports all CommandPalette components and types
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * SYNC: When modified, update this header
 */
export { CommandPalette } from "./CommandPalette.js";
export { CommandPaletteInput } from "./CommandPaletteInput.js";
export { CommandPaletteList } from "./CommandPaletteList.js";
export { CommandPaletteItem } from "./CommandPaletteItem.js";
export { CommandPaletteGroup } from "./CommandPaletteGroup.js";
export { CommandPaletteFooter } from "./CommandPaletteFooter.js";
export { CommandPaletteEmpty } from "./CommandPaletteEmpty.js";
export { useCommandPaletteContext } from "./CommandPaletteContext.js";