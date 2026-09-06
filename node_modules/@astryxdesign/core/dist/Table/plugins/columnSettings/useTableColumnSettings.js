// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useTableColumnSettings.tsx
 * @input React, Table types
 * @output Exports useTableColumnSettings plugin hook and types
 * @position Column settings plugin; consumed by Table via plugins prop
 *
 * Pure plugin hook — takes column settings config, returns a TablePlugin
 * that filters and reorders columns via `transformColumns`.
 *
 * For state management (toggle, reset, visibility checks), use
 * `useTableColumnSettingsState` which produces the config this hook needs.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Table/plugins/columnSettings/index.ts (exports)
 * - /packages/core/src/Table/index.ts (exports)
 */
import { useMemo, useRef } from 'react';

// =============================================================================
// Config Types
// =============================================================================

/**
 * Definition of a column for the column settings UI.
 * Separate from TableColumn because the settings UI needs metadata
 * (label, group, disableability) that the table column doesn't carry.
 */

/**
 * Configuration for useTableColumnSettings.
 *
 * This is the same shape as UseTableColumnSettingsStateConfig —
 * you can pass `state.columnSettingsConfig` directly, or construct
 * it manually if you don't need the state hook.
 *
 * @template TColumnKey - String literal union of column keys
 */

// =============================================================================
// Plugin Hook
// =============================================================================

/**
 * Column settings table plugin — filters and reorders columns based on
 * the active column keys.
 *
 * Returns a `TablePlugin` directly (same pattern as `useTableSortable`,
 * `useTableSelection`, etc.).
 *
 * @example
 * ```
 * const state = useTableColumnSettingsState({ columns, activeColumnKeys, onChangeActiveColumnKeys });
 * const plugin = useTableColumnSettings(state.columnSettingsConfig);
 * <Table columns={allColumns} plugins={{ columnSettings: plugin }} />
 * ```
 */
export function useTableColumnSettings(config) {
  // Keep config in a ref so the plugin reads the latest values
  // without changing plugin identity.
  const configRef = useRef(config);
  configRef.current = config;
  return useMemo(() => ({
    transformColumns(columns) {
      const cfg = configRef.current;
      const activeSet = new Set(cfg.activeColumnKeys);
      // Build a map for ordering by activeColumnKeys position
      const orderMap = new Map(cfg.activeColumnKeys.map((key, index) => [key, index]));
      return columns.filter(col => activeSet.has(col.key)).sort((a, b) => {
        const orderA = orderMap.get(a.key) ?? Infinity;
        const orderB = orderMap.get(b.key) ?? Infinity;
        return orderA - orderB;
      });
    }
  }), []);
}