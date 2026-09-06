// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file createStaticSource.ts
 * @input Array of searchable items, optional config
 * @output SearchSource that filters items by label and keywords
 * @position Utility; convenience factory for static search sources
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Typeahead/index.ts
 */

/**
 * Create a search source from a static array of items.
 *
 * Filters by substring match on `label` and optional keywords.
 * For anything beyond substring matching (fuzzy, ranked, server-side),
 * implement `SearchSource` directly.
 *
 * @compositionHint Pass the result to `searchSource` on Typeahead,
 *   Tokenizer, or CommandPalette.
 *
 * @example
 * ```tsx
 * // Simple — label-only matching
 * const source = createStaticSource([
 *   { id: 'home', label: 'Home' },
 *   { id: 'settings', label: 'Settings' },
 * ]);
 *
 * // With keywords — also matches on aliases
 * const source = createStaticSource(commands, {
 *   keywords: (item) => item.auxiliaryData?.aliases ?? [],
 * });
 * ```
 */
export function createStaticSource(items, options) {
  const getKeywords = options?.keywords;
  return {
    search(query) {
      const lower = query.toLowerCase().trim();
      if (lower === '') {
        return items;
      }
      return items.filter(item => {
        if (item.label.toLowerCase().includes(lower)) {
          return true;
        }
        if (getKeywords) {
          return getKeywords(item).some(kw => kw.toLowerCase().includes(lower));
        }
        return false;
      });
    },
    bootstrap() {
      return items;
    }
  };
}