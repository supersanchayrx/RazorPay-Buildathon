// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useLinkify.tsx
 * @input Uses React, Link, useLinkComponent
 * @output Exports useLinkify hook for auto-detecting links in plain text
 * @position Link utility hook; turns plain text into a mix of strings and Link elements
 *
 * Detects URLs, email addresses, and custom patterns (e.g. T1234, D5678)
 * in plain text and renders them as Link elements that respect
 * LinkProvider for client-side routing.
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Link/index.ts (exports)
 * - /packages/core/src/Link/useLinkify.test.tsx (tests)
 */
import { useMemo } from 'react';
import { Link } from "./Link.js";

// =============================================================================
// Types
// =============================================================================

/**
 * A custom pattern for detecting linkable text.
 */
import { jsx as _jsx } from "react/jsx-runtime";
// =============================================================================
// Built-in patterns
// =============================================================================

// URL pattern: matches http(s) URLs
const URL_PATTERN = {
  pattern: /https?:\/\/[^\s<>'")\]},]+/g,
  href: match => match[0],
  isExternal: true
};

// Email pattern: matches email addresses
const EMAIL_PATTERN = {
  pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  href: match => `mailto:${match[0]}`
};
const BUILTIN_PATTERNS = [URL_PATTERN, EMAIL_PATTERN];

// =============================================================================
// Match processing
// =============================================================================

/**
 * Find all non-overlapping matches across all patterns.
 * Custom patterns are checked first (higher priority), then builtins.
 * First match wins for overlapping ranges.
 */
function findMatches(text, patterns) {
  const allMatches = [];
  for (const p of patterns) {
    // Clone the regex to reset lastIndex
    const re = new RegExp(p.pattern.source, p.pattern.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        href: p.href(match),
        label: p.label ? p.label(match) : match[0],
        isExternal: p.isExternal ?? false
      });
    }
  }

  // Sort by start position, then by earlier pattern priority (stable sort)
  allMatches.sort((a, b) => a.start - b.start);

  // Remove overlapping matches (first wins)
  const result = [];
  let lastEnd = 0;
  for (const m of allMatches) {
    if (m.start >= lastEnd) {
      result.push(m);
      lastEnd = m.end;
    }
  }
  return result;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Detects URLs, emails, and custom patterns in plain text and returns
 * a ReactNode array with Link elements for each match.
 *
 * Links render via Link, respecting LinkProvider for client-side routing.
 *
 * @example
 * ```
 * const nodes = useLinkify('Visit https://example.com or email hi@example.com');
 * return <p>{nodes}</p>;
 * ```
 */
export function useLinkify(text, options) {
  const {
    patterns: customPatterns,
    hasBuiltins = true
  } = options ?? {};

  // Build the pattern list: custom first (higher priority), then builtins
  const allPatterns = useMemo(() => {
    const result = [];
    if (customPatterns) {
      result.push(...customPatterns);
    }
    if (hasBuiltins) {
      result.push(...BUILTIN_PATTERNS);
    }
    return result;
  }, [customPatterns, hasBuiltins]);
  return useMemo(() => {
    if (allPatterns.length === 0 || text.length === 0) {
      return [text];
    }
    const matches = findMatches(text, allPatterns);
    if (matches.length === 0) {
      return [text];
    }
    const nodes = [];
    let lastIndex = 0;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];

      // Text before this match
      if (m.start > lastIndex) {
        nodes.push(text.slice(lastIndex, m.start));
      }

      // The link
      nodes.push(/*#__PURE__*/_jsx(Link, {
        href: m.href,
        isExternalLink: m.isExternal,
        children: m.label
      }, `linkify-${i}`));
      lastIndex = m.end;
    }

    // Remaining text after the last match
    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex));
    }
    return nodes;
  }, [text, allPatterns]);
}