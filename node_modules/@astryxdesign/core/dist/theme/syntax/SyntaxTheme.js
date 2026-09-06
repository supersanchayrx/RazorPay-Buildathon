// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file SyntaxTheme.tsx
 * @input SyntaxTheme from defineSyntaxTheme.ts
 * @output SyntaxTheme provider, useSyntaxTheme hook
 * @position Provider component; wraps code surfaces to apply syntax coloring
 *
 * @see https://github.com/facebook/astryx/issues/1148
 */
import React, { createContext, use, useMemo } from 'react';
import { syntaxThemeStyle, resolveSyntaxTokenForMode, ALL_SYNTAX_KEYS } from "./defineSyntaxTheme.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";

// =============================================================================
// Context
// =============================================================================

/** @internal */
import { jsx as _jsx } from "react/jsx-runtime";
const SyntaxThemeContext = /*#__PURE__*/createContext(null);
SyntaxThemeContext.displayName = 'SyntaxThemeContext';

// =============================================================================
// Return type
// =============================================================================

// =============================================================================
// Hook
// =============================================================================

/**
 * Access the current syntax theme's token values, resolved for the active
 * color mode. Returns null if no SyntaxTheme provider is present.
 *
 * @example
 * function CodeCanvas() {
 *   const syntax = useSyntaxTheme();
 *   if (!syntax) {
 *     return null;
 *   }
 *   ctx.fillStyle = syntax.token('keyword');
 * }
 */
export function useSyntaxTheme() {
  const ctx = use(SyntaxThemeContext);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const effectiveMode = prefersDark ? 'dark' : 'light';
  const tokens = useMemo(() => {
    if (!ctx) {
      return null;
    }
    const resolved = {};
    for (const key of ALL_SYNTAX_KEYS) {
      resolved[key] = resolveSyntaxTokenForMode(ctx.theme.__inputTokens[key], effectiveMode);
    }
    return resolved;
  }, [ctx, effectiveMode]);
  if (!ctx || !tokens) {
    return null;
  }
  return {
    name: ctx.theme.name,
    mode: effectiveMode,
    token: name => tokens[name] ?? '',
    tokens
  };
}

// =============================================================================
// Component
// =============================================================================

/**
 * Syntax theme provider. Sets CSS custom properties on a wrapper div
 * so child code components inherit via cascade.
 */
export function SyntaxTheme({
  theme,
  children
}) {
  const style = useMemo(() => syntaxThemeStyle(theme), [theme]);
  const value = useMemo(() => ({
    theme
  }), [theme]);
  return /*#__PURE__*/_jsx(SyntaxThemeContext, {
    value: value,
    children: /*#__PURE__*/_jsx("div", {
      style: style,
      "data-astryx-syntax-theme": theme.name,
      children: children
    })
  });
}
SyntaxTheme.displayName = 'SyntaxTheme';