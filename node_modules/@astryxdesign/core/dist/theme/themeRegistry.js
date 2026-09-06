// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file themeRegistry.ts
 * @input DefinedTheme objects from defineTheme() or built theme packages
 * @output Exports registerTheme, getRegisteredTheme, getRegisteredThemes, resetThemes
 * @position Server-safe theme registry for theme-name-based SSR resolution
 *
 * This module has NO 'use client' directive. It is importable from SSR/RSC and
 * lets code resolve theme data by stable theme name without React context.
 */

const themeRegistry = new Map();

/**
 * Register a defined theme under its `name`.
 *
 * Registration is idempotent and replaces any previous theme with the same
 * name. Call from app initialization, theme packages, or <Theme> to make the
 * theme available to SSR-safe resolvers by name.
 */
export function registerTheme(theme) {
  themeRegistry.set(theme.name, theme);
}

/**
 * Return a previously registered theme by name.
 */
export function getRegisteredTheme(name) {
  if (name == null || name === '') {
    return null;
  }
  return themeRegistry.get(name) ?? null;
}

/**
 * Return all registered themes keyed by theme name.
 */
export function getRegisteredThemes() {
  return new Map(themeRegistry);
}

/**
 * Reset the theme registry. For testing only.
 * @internal
 */
export function resetThemes() {
  themeRegistry.clear();
}