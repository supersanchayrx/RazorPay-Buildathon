// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useTableSortableState.tsx
 * @input React, TableSortState types
 * @output Exports useTableSortableState hook and config types
 * @position Sort state helper; manages sort state + applies local sort to data.
 *   Pairs with useTableSortable (the headless sort plugin).
 *
 * Modeled after useTableSelectionState — a convenience layer that owns state
 * and produces a ready-to-use config for the headless plugin.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Table/plugins/sortable/index.ts (exports)
 * - /packages/core/src/Table/Table.doc.mjs (sort documentation)
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import { useCollator } from "../../../i18n/useCollator.js";

// =============================================================================
// Comparator Types
// =============================================================================

/**
 * Custom comparator for a single sort key.
 * Receives two row values and returns a standard comparison number.
 * Direction (ascending/descending) is applied automatically by the hook —
 * comparators should always sort in ascending order.
 */

function toSortableString(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

// =============================================================================
// Hook Config
// =============================================================================

/**
 * Configuration for useTableSortableState.
 *
 * @template T - The row data type
 * @template TSortKey - Union of valid sort key strings
 *
 * @example
 * ```
 * const { sortedData, sortConfig } = useTableSortableState({
 *   data: users,
 *   defaultSort: [{ sortKey: 'name', direction: 'ascending' }],
 * });
 * const sortPlugin = useTableSortable(sortConfig);
 * <Table data={sortedData} plugins={{ sort: sortPlugin }} />
 * ```
 */

// =============================================================================
// Hook Result
// =============================================================================

// =============================================================================
// Default Comparator
// =============================================================================

function defaultCompare(a, b, sortKey, collator) {
  const aVal = a[sortKey];
  const bVal = b[sortKey];

  // null/undefined/NaN sort to the end. NaN must not reach the numeric fast
  // path: a NaN comparator result reads as "equal" to Array.sort, which makes
  // the comparator inconsistent and corrupts the order of the other rows.
  const aMissing = aVal == null || typeof aVal === 'number' && Number.isNaN(aVal);
  const bMissing = bVal == null || typeof bVal === 'number' && Number.isNaN(bVal);
  if (aMissing && bMissing) {
    return 0;
  }
  if (aMissing) {
    return 1;
  }
  if (bMissing) {
    return -1;
  }

  // number fast path
  if (typeof aVal === 'number' && typeof bVal === 'number') {
    return aVal - bVal;
  }

  // string comparison with numeric collation, bound to the provider locale
  // via useCollator() rather than a raw localeCompare(value, locale) call.
  return collator.compare(toSortableString(aVal), toSortableString(bVal));
}

// =============================================================================
// Sort Logic
// =============================================================================

function sortData(data, sortState, comparators, collator) {
  if (sortState.length === 0) {
    return data;
  }
  return [...data].sort((a, b) => {
    for (const entry of sortState) {
      const {
        sortKey,
        direction
      } = entry;
      const customCmp = comparators?.[sortKey];
      const cmp = customCmp ? customCmp(a, b) : defaultCompare(a, b, sortKey, collator);
      if (cmp !== 0) {
        return direction === 'ascending' ? cmp : -cmp;
      }
    }
    return 0;
  });
}

// =============================================================================
// Hook
// =============================================================================

/**
 * useTableSortableState — manages sort state and applies local sort to data.
 *
 * Convenience layer over useTableSortable. Owns sort state internally
 * (or accepts controlled state), sorts the data, and produces a ready-to-use
 * config for the headless sortable plugin.
 *
 * @example
 * ```
 * const { sortedData, sortConfig } = useTableSortableState({
 *   data: employees,
 *   defaultSort: [{ sortKey: 'name', direction: 'ascending' }],
 *   comparators: { age: (a, b) => a.age - b.age },
 * });
 * const sortPlugin = useTableSortable(sortConfig);
 * <Table data={sortedData} columns={columns} plugins={{ sort: sortPlugin }} />
 * ```
 */
export function useTableSortableState(config) {
  const {
    data,
    defaultSort = [],
    sort: controlledSort,
    onSortChange: controlledOnSortChange,
    comparators,
    allowUnsortedState,
    isMultiSortEnabled
  } = config;
  const collator = useCollator({
    numeric: true
  });

  // Internal state (used in uncontrolled mode)
  const [internalSort, setInternalSort] = useState(defaultSort);

  // Resolve controlled vs uncontrolled
  const isControlled = controlledSort !== undefined;
  const sort = isControlled ? controlledSort : internalSort;
  const onSortChange = isControlled ? controlledOnSortChange ?? (() => {}) : setInternalSort;

  // Stable ref for comparators to avoid re-sorting on inline object identity changes
  const comparatorsRef = useRef(comparators);
  comparatorsRef.current = comparators;

  // Stable ref for onSortChange to avoid recreating sortConfig on inline callback identity changes
  const onSortChangeRef = useRef(onSortChange);
  onSortChangeRef.current = onSortChange;

  // Sorted data — memoized on sort state + data identity
  const sortedData = useMemo(() => sortData(data, sort, comparatorsRef.current, collator), [data, sort, collator]);

  // applySort — lets consumers sort arbitrary data with the current state
  const applySort = useCallback(inputData => sortData(inputData, sort, comparatorsRef.current, collator), [sort, collator]);

  // Config ready for useTableSortable
  const sortConfig = useMemo(() => ({
    sort,
    onSortChange: onSortChangeRef.current,
    allowUnsortedState,
    isMultiSortEnabled
  }), [sort, allowUnsortedState, isMultiSortEnabled]);
  return {
    sortedData,
    sort,
    sortConfig,
    applySort
  };
}