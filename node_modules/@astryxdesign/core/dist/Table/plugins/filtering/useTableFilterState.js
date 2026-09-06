// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useTableFilterState.tsx
 * @input React, filter types
 * @output Exports useTableFilterState hook for managing filter state
 * @position Filter state helper; manages the filter state object.
 *   Pairs with useTableFiltering for the UI plugin.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Table/plugins/filtering/index.ts (exports)
 * - /packages/core/src/Table/Table.doc.mjs (filtering documentation)
 */
import { useState, useCallback } from 'react';
/**
 * useTableFilterState — manages the filter state object.
 *
 * A convenience hook that bundles `useState<TableFilterState>` with a
 * correctly-typed `onFilterChange` handler. Eliminates the boilerplate of
 * writing the state update logic in every consumer.
 *
 * The returned `filters` and `onFilterChange` are passed directly to
 * `useTableFiltering`.
 *
 * @example
 * ```
 * const {filters, onFilterChange} = useTableFilterState();
 * const filterPlugin = useTableFiltering({
 *   filters,
 *   onFilterChange,
 *   variant: 'inline',
 *   searchConfig: config,
 * });
 * ```
 */
export function useTableFilterState(initialState) {
  const [filters, setFilters] = useState(initialState ?? {});
  const onFilterChange = useCallback((key, value) => {
    setFilters(prev => {
      if (value == null) {
        const {
          [key]: _removed,
          ...next
        } = prev;
        return next;
      }
      return {
        ...prev,
        [key]: value
      };
    });
  }, []);
  const clearAll = useCallback(() => {
    setFilters({});
  }, []);
  return {
    filters,
    onFilterChange,
    clearAll
  };
}