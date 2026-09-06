// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file syntax/index.ts
 * @position Re-exports for the syntax theme subsystem
 *
 * No `'use client'` here on purpose. Most of what this barrel exports is data
 * (presets, token defaults) or pure functions, and a directive on the barrel
 * turns every export into a client reference for a server importer — so
 * `dracula.tokens` reads back `undefined` instead of colors. `SyntaxTheme.tsx`
 * carries its own directive, which is what the provider actually needs.
 */

export { syntaxTokenDefaults } from "./tokens.js";
export { defineSyntaxTheme, syntaxThemeStyle, syntaxThemeToCSS } from "./defineSyntaxTheme.js";
export { SyntaxTheme, useSyntaxTheme } from "./SyntaxTheme.js";
// Community syntax theme presets (formerly @astryxdesign/theme-syntax)
export { oneDarkPro, dracula, monokai, nord, tokyoNight, catppuccinMocha, githubDark, githubLight, solarizedLight, oneLight, catppuccinLatte, tokyoNightLight, darkSyntaxPresets, lightSyntaxPresets, allSyntaxPresets } from "./presets.js";