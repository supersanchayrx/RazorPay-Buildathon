// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useTableRowIndex.tsx
 * @input React, StyleX, Table types + the rendered data array
 * @output Exports useTableRowIndex hook + config type
 * @position Row-index plugin; consumed by Table via plugins prop
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Table/index.ts (exports)
 */
import { useMemo } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../../../theme/tokens.stylex.js";
import { colorVars, typeScaleVars } from "../../../theme/tokens.stylex.js";

/**
 * Configuration for {@link useTableRowIndex}.
 *
 * Astryx's `renderCell` receives only the row item (not its position), so the
 * plugin needs the rendered `data` array — the same array passed to
 * `<Table data>` — to derive each row's 1-based ordinal. Pass `getRowKey` when
 * items don't have a stable identity by reference (e.g. new objects each
 * render); it must return a **unique** string per row (duplicate keys collapse
 * to a single ordinal).
 */
import { jsx as _jsx } from "react/jsx-runtime";
const INDEX_COLUMN_WIDTH = {
  type: 'pixel',
  value: 48
};
/**
 * Returns a {@link TablePlugin} that prepends a right-aligned, monospaced
 * row-number column. Numbering follows the order of the rendered `data` array,
 * so it reflects the current sort / filter / pagination view.
 *
 * @example
 * ```
 * const rowIndex = useTableRowIndex({data});
 * <Table data={data} columns={columns} idKey="id" plugins={{rowIndex}} />;
 * ```
 */
export function useTableRowIndex(config) {
  const {
    data,
    getRowKey,
    label = '#',
    startFrom = 1
  } = config;

  // Single item → ordinal lookup, built in one pass and rebuilt only when the
  // data array or key extractor changes. Keyed by getRowKey when provided
  // (stable across new object identities), otherwise by object reference.
  const lookup = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      map.set(getRowKey ? getRowKey(item) : item, i);
    }
    return item => map.get(getRowKey ? getRowKey(item) : item);
  }, [data, getRowKey]);

  // The plugin object depends only on the stable lookup and the presentational
  // props — not on data directly — so it stays as stable as its inputs allow.
  return useMemo(() => ({
    transformColumns(columns) {
      const indexColumn = {
        key: '__rowIndex',
        header: label,
        width: INDEX_COLUMN_WIDTH,
        align: 'end',
        resizable: false,
        renderCell: item => {
          const idx = lookup(item);
          if (idx == null) {
            return null;
          }
          return /*#__PURE__*/_jsx("span", {
            ...{
              className: "x9m5x89 x141an7d xss6m8b xv1l7n4"
            },
            children: idx + startFrom
          });
        }
      };
      return [indexColumn, ...columns];
    }
  }), [label, startFrom, lookup]);
}