// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file CommandPaletteContext.ts
 * @input Uses React createContext
 * @output Exports CommandPaletteContext and useCommandPaletteContext hook
 * @position Internal context; consumed by composable sub-components
 */
import { createContext, use } from 'react';
export const CommandPaletteContext = /*#__PURE__*/createContext(null);
CommandPaletteContext.displayName = 'CommandPaletteContext';

/**
 * Access the command palette context.
 * Returns null when used outside a CommandPalette (for standalone usage).
 */
export function useCommandPaletteContext() {
  return use(CommandPaletteContext);
}