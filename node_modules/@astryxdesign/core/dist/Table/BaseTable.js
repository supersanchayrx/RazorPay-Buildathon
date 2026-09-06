// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file BaseTable.tsx
 * @input React, types.ts, columnUtils.ts
 * @output Exports BaseTable component
 * @position Core structural component; wrapped by Table.tsx
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Table/Table.doc.mjs (component description, props)
 * - /packages/core/src/Table/Table.test.tsx (tests for new/changed behavior)
 * - /packages/core/src/Table/index.ts (exports if types change)
 * - /packages/cli/assets/templates/blocks/components/Table/ (showcase blocks)
 */
import { memo, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import { generateColumns, defaultCellRenderer, resolveColumnWidths } from "./columnUtils.js";
import { TableRow } from "./TableRow.js";
import { TableCell } from "./TableCell.js";
import { TableHeaderCell } from "./TableHeaderCell.js";
import { TableHeader } from "./TableHeader.js";
import { TableBody } from "./TableBody.js";
import { mergeProps } from "../utils/index.js";
import { devError } from "../utils/devWarning.js";
import { EmptyState } from "../EmptyState/index.js";
import { Text } from "../Text/index.js";
import { themeProps } from "../utils/themeProps.js";
import { useTranslator } from "../i18n/index.js";
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  table: {
    kzqmXN: "xh8yej3",
    kLvRdT: "x1mwwwfo",
    kheTzg: "x1gukg7c",
    kPzzVL: "x140o2bo",
    $$css: true
  },
  tableAutoLayout: {
    kPzzVL: "x1drmoe9",
    $$css: true
  }
};

/**
 * Run a value through a pipeline of plugin transform functions.
 * Wraps each transform in a try-catch so a single broken plugin
 * doesn't crash the entire table. In development, logs a warning
 * with the plugin index and error details.
 */
function applyPlugins(plugins, getter, initial, ...args) {
  return plugins.reduce((acc, plugin, index) => {
    const transform = getter(plugin);
    if (!transform) {
      return acc;
    }
    try {
      return transform(acc, ...args);
    } catch (error) {
      devError('Table', `Plugin at index ${index} threw in transform:`, error);
      return acc;
    }
  }, initial);
}

// =============================================================================
// Memoized Table Row Component
// =============================================================================

// Stable empty array to avoid creating new reference on each render
const EMPTY_PLUGINS = [];

/**
 * Shallow-compare two arrays by element identity.
 * Used to stabilize the resolved columns array across renders.
 */
function areArraysShallowEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
/**
 * Memoized table row component.
 * Only re-renders when the specific row's data changes.
 * Uses component props for context-based styling, with plugin support.
 */
function TableRowInner({
  item,
  rowIndex,
  rowKey,
  columns,
  plugins,
  textOverflow,
  RowComponent,
  CellComponent,
  ariaRowIndex
}) {
  // Build cells first
  const cells = columns.map((col, columnIndex) => {
    // Apply column alignment to body cells
    const initialCellHtmlProps = {};
    if (col.align) {
      initialCellHtmlProps.style = {
        textAlign: col.align
      };
    }
    const initialBodyCellRenderProps = {
      htmlProps: initialCellHtmlProps,
      xstyle: [],
      columnIndex,
      columns: columns
    };
    const cellRenderProps = applyPlugins(plugins, p => p.transformBodyCell, initialBodyCellRenderProps, col, item, columnIndex, columns);
    const isDefaultRenderer = !col.renderCell;
    let rawContent = null;
    if (!cellRenderProps.isContentSuppressed) {
      rawContent = isDefaultRenderer ? defaultCellRenderer(item, col.key) : col.renderCell?.(item) ?? null;
    }

    // In truncate mode, wrap default-rendered string content in
    // <Text maxLines={1}> for smart tooltips that only appear
    // when text is actually overflowing. In wrap mode (default),
    // content renders as-is — the cell's CSS handles wrapping.
    let content;
    if (isDefaultRenderer && textOverflow === 'truncate' && typeof rawContent === 'string' && rawContent.length > 0) {
      content = /*#__PURE__*/_jsx(Text, {
        type: "body",
        maxLines: 1,
        children: rawContent
      });
    } else {
      content = rawContent;
    }
    return /*#__PURE__*/_jsx(CellComponent, {
      ...cellRenderProps.htmlProps,
      contextMenuActions: cellRenderProps.contextMenuActions,
      xstyle: cellRenderProps.xstyle,
      children: content
    }, col.key);
  });

  // Apply plugin transforms for row (with pre-rendered children).
  // Seed `aria-rowindex` (when the table opts into ARIA row indexing) as a
  // base htmlProp so plugins compose over it and can still override.
  const rowRenderProps = applyPlugins(plugins, p => p.transformBodyRow, {
    htmlProps: ariaRowIndex == null ? {} : {
      'aria-rowindex': ariaRowIndex
    },
    xstyle: [],
    children: /*#__PURE__*/_jsx(_Fragment, {
      children: cells
    })
  }, item, rowIndex);
  const row = /*#__PURE__*/_jsx(RowComponent, {
    ref: rowRenderProps.ref,
    ...rowRenderProps.htmlProps,
    xstyle: rowRenderProps.xstyle,
    children: rowRenderProps.children
  }, rowKey);

  // afterRow: plugins (e.g. row expansion) can append a full-width detail
  // panel `<tr>` after the row. Rendered as a sibling fragment.
  if (rowRenderProps.afterRow) {
    return /*#__PURE__*/_jsxs(_Fragment, {
      children: [row, rowRenderProps.afterRow]
    });
  }
  return row;
}

/**
 * Compares TableRowProps to determine if re-render is needed.
 * Shallow compares the item object and checks if columns/plugins references changed.
 *
 * Includes rowIndex in the comparison so that plugins using the index
 * (e.g. for row numbering or conditional formatting) get correct values
 * after insertions/deletions. This also future-proofs for tree grid
 * index paths where structural position matters.
 */
function areRowPropsEqual(prevProps, nextProps) {
  if (prevProps.rowKey !== nextProps.rowKey) {
    return false;
  }
  if (prevProps.rowIndex !== nextProps.rowIndex) {
    return false;
  }
  if (prevProps.ariaRowIndex !== nextProps.ariaRowIndex) {
    return false;
  }
  if (prevProps.columns !== nextProps.columns) {
    return false;
  }
  if (prevProps.plugins !== nextProps.plugins) {
    return false;
  }
  if (prevProps.textOverflow !== nextProps.textOverflow) {
    return false;
  }
  if (prevProps.RowComponent !== nextProps.RowComponent) {
    return false;
  }
  if (prevProps.CellComponent !== nextProps.CellComponent) {
    return false;
  }

  // Shallow compare the item - if same reference, skip re-render
  if (prevProps.item === nextProps.item) {
    return true;
  }

  // Different object reference - compare values. This is intentionally a
  // one-level shallow compare: nested fields rely on reference identity.
  const prevItem = prevProps.item;
  const nextItem = nextProps.item;
  const keys = Object.keys(nextItem);

  // A key deleted from nextItem would never be visited by the loop below,
  // and the row would keep rendering the removed field's stale value.
  if (Object.keys(prevItem).length !== keys.length) {
    return false;
  }
  for (const key of keys) {
    if (prevItem[key] !== nextItem[key]) {
      return false;
    }
  }
  return true;
}

// Create the memoized component
const MemoizedTableRow = /*#__PURE__*/memo(TableRowInner, areRowPropsEqual);

// =============================================================================
// BaseTable Component
// =============================================================================

/**
 * Inner BaseTable implementation (generic-preserving).
 */
function BaseTableInner({
  data,
  columns: columnsProp,
  idKey,
  plugins: pluginsProp,
  children,
  textOverflow = 'wrap',
  scrollWrapper: ScrollWrapper,
  emptyState,
  rowIndexStart,
  rowCount,
  xstyle,
  className,
  style,
  ref,
  ...rest
}) {
  const t = useTranslator();
  // Use stable empty array when no plugins provided
  const plugins = pluginsProp ?? EMPTY_PLUGINS;

  // ARIA row indexing. The row ordinal is an accessibility concern that is
  // independent of any visible index column: when the consumer opts in (by
  // passing rowIndexStart or rowCount), body rows carry `aria-rowindex`
  // reflecting their position in the full dataset, and the <table> carries
  // `aria-rowcount`. `aria-rowindex` is 1-based and counts data rows from
  // `rowIndexStart` (default 1); a windowed/paginated view passes the offset
  // of its first visible row. `aria-rowcount` is `rowCount` when known, or
  // `-1` (ARIA's "unknown count") for a windowed view with an unknown total.
  const ariaRowIndexingEnabled = rowIndexStart != null || rowCount != null;
  const firstRowAriaIndex = rowIndexStart ?? 1;
  const ariaRowCount = ariaRowIndexingEnabled ? rowCount ?? -1 : undefined;
  const RowComponent = TableRow;
  const CellComponent = TableCell;
  const HeaderCellComponent = TableHeaderCell;

  // Resolve columns: explicit > auto-generated from data.
  const baseColumns = columnsProp ?? (data ? generateColumns(data) : []);

  // --- Plugin pipeline: transformColumns ---
  // Runs before any element-level transforms. Allows plugins to filter,
  // reorder, or inject synthetic columns (e.g. selection checkbox).
  const transformedColumns = applyPlugins(plugins, p => p.transformColumns, baseColumns);

  // Stabilize the resolved columns array — transformColumns returns a
  // new array on every call, but if the contents haven't changed, we
  // reuse the previous reference. This prevents MemoizedTableRow from
  // re-rendering all rows when the column array is structurally identical.
  const resolvedColumnsRef = useRef(transformedColumns);
  if (!areArraysShallowEqual(resolvedColumnsRef.current, transformedColumns)) {
    resolvedColumnsRef.current = transformedColumns;
  }
  const resolvedColumns = resolvedColumnsRef.current;

  // Resolve all column widths in a single pass — produces per-column
  // inline styles and the aggregate table min-width.
  const resolvedWidths = resolveColumnWidths(resolvedColumns);

  // --- Plugin pipeline: table ---
  const tableRenderProps = applyPlugins(plugins, p => p.transformTable, {
    htmlProps: {},
    xstyle: children ? [styles.table, styles.tableAutoLayout] : [styles.table]
  });

  // --- Plugin pipeline: header cells ---
  const headerCells = resolvedColumns.map((col, columnIndex) => {
    const headerContent = col.header ?? col.key;

    // Build initial htmlProps with column alignment if specified.
    // `scope: 'col'` is the default so every column header associates its
    // data cells with the correct column for screen readers; a plugin's
    // transformHeaderCell can override it via htmlProps.scope.
    const initialHeaderHtmlProps = {
      'data-column-key': col.key,
      scope: 'col'
    };
    if (col.align) {
      initialHeaderHtmlProps.style = {
        textAlign: col.align
      };
    }
    const initialHeaderRenderProps = {
      htmlProps: initialHeaderHtmlProps,
      xstyle: [],
      content: headerContent,
      columnIndex,
      columns: resolvedColumns
    };
    const cellRenderProps = applyPlugins(plugins, p => p.transformHeaderCell, initialHeaderRenderProps, col, columnIndex, resolvedColumns);

    // Apply pre-computed column width styles on the <th>.
    // With table-layout: fixed, header cell sizing controls column widths.
    const widthStyle = resolvedWidths.columns.get(col.key)?.style ?? {};
    const existingStyle = cellRenderProps.htmlProps.style;
    const mergedHtmlProps = {
      ...cellRenderProps.htmlProps,
      style: existingStyle ? {
        ...widthStyle,
        ...existingStyle
      } : widthStyle
    };

    // Resolve header content from slots — plugins write to named slots
    // to avoid conflicts (e.g. sort writes `after`, resize writes `overlay`)
    const resolvedContent = cellRenderProps.content ?? headerContent;
    const headerTitleProp = typeof resolvedContent === 'string' && resolvedContent.length > 0 ? {
      title: resolvedContent
    } : {};
    const {
      before,
      after,
      overlay,
      below
    } = cellRenderProps;
    const hasSlots = before != null || after != null || overlay != null || below != null;
    const headerInner = hasSlots ? /*#__PURE__*/_jsxs(_Fragment, {
      children: [before, after != null ? /*#__PURE__*/_jsxs("div", {
        ...{
          className: "x3nfvp2 x6s0dn4 xzye2dw xeuugli"
        },
        children: [resolvedContent, after]
      }) : resolvedContent, overlay, below]
    }) : resolvedContent;
    return /*#__PURE__*/_jsx(HeaderCellComponent, {
      ...mergedHtmlProps,
      ...headerTitleProp,
      contextMenuActions: cellRenderProps.contextMenuActions,
      xstyle: cellRenderProps.xstyle,
      children: headerInner
    }, col.key);
  });

  // --- Plugin pipeline: header row ---
  const headerRowRenderProps = applyPlugins(plugins, p => p.transformHeaderRow, {
    htmlProps: {},
    xstyle: [],
    children: /*#__PURE__*/_jsx(_Fragment, {
      children: headerCells
    })
  });

  // --- Render ---
  const hasData = data != null && data.length > 0;
  const hasColumns = resolvedColumns.length > 0;

  // Style precedence: consumer style < the computed column min-width
  // (structural — derived from column defs, so it
  // must win when present; when absent, a consumer minWidth survives).
  const tableStyle = {
    ...tableRenderProps.htmlProps.style,
    ...style,
    ...(resolvedWidths.tableMinWidth > 0 ? {
      minWidth: `${resolvedWidths.tableMinWidth}px`
    } : null)
  };
  let tableElement = /*#__PURE__*/_jsx("table", {
    ref: ref,
    ...(ariaRowCount != null ? {
      'aria-rowcount': ariaRowCount
    } : null),
    ...tableRenderProps.htmlProps,
    ...mergeProps(themeProps('table', undefined, {
      // `base-table` was a second root on the same <table> element that
      // `table` names; themes styling it keep working until the next
      // major.
      legacyNames: ['base-table']
    }), stylex.props(...tableRenderProps.xstyle, xstyle), [tableRenderProps.htmlProps.className, className].filter(Boolean).join(' ') || undefined, tableStyle),
    ...rest,
    children: children ? children : /*#__PURE__*/_jsxs(_Fragment, {
      children: [hasColumns && /*#__PURE__*/_jsx(TableHeader, {
        children: /*#__PURE__*/_jsx(RowComponent, {
          ...headerRowRenderProps.htmlProps,
          isHeaderRow: true,
          xstyle: headerRowRenderProps.xstyle,
          children: headerRowRenderProps.children
        })
      }), /*#__PURE__*/_jsx(TableBody, {
        children: hasData ? data.map((item, rowIndex) => {
          const rowKey = idKey == null ? rowIndex : typeof idKey === 'function' ? idKey(item) : String(item[idKey]);
          return /*#__PURE__*/_jsx(MemoizedTableRow, {
            item: item,
            rowIndex: rowIndex,
            rowKey: rowKey,
            columns: resolvedColumns,
            plugins: plugins,
            textOverflow: textOverflow,
            RowComponent: RowComponent,
            CellComponent: CellComponent,
            ariaRowIndex: ariaRowIndexingEnabled ? firstRowAriaIndex + rowIndex : undefined
          }, rowKey);
        }) : data != null && emptyState !== false && /*#__PURE__*/_jsx("tr", {
          children: /*#__PURE__*/_jsx("td", {
            colSpan: resolvedColumns.length,
            children: emptyState ?? /*#__PURE__*/_jsx(EmptyState, {
              title: t('@astryx.table.noData'),
              isCompact: true
            })
          })
        })
      })]
    })
  });

  // Wrap the <table> in a scroll container so it scrolls horizontally
  // when columns exceed the container width. This wrapper sits between
  // the <table> and transformTableContext, so plugin chrome (pagination,
  // toolbars) renders outside the scroll area.
  //
  // Before rendering the wrapper, run the plugin `transformScrollWrapper`
  // pipeline so plugins can attach a ref to the scroll container (scroll-aware
  // sticky shadows, virtualization) and inject before/after chrome.
  if (ScrollWrapper) {
    const scrollWrapperRenderProps = applyPlugins(plugins, p => p.transformScrollWrapper, {
      htmlProps: {},
      xstyle: []
    });
    tableElement = /*#__PURE__*/_jsx(ScrollWrapper, {
      htmlProps: scrollWrapperRenderProps.htmlProps,
      xstyle: scrollWrapperRenderProps.xstyle,
      beforeTable: scrollWrapperRenderProps.beforeTable,
      afterTable: scrollWrapperRenderProps.afterTable,
      children: tableElement
    });
  }

  // Apply transformTableContext from each plugin.
  // Iterates in reverse so the first plugin in the array wraps outermost,
  // matching the mental model: plugins are listed in priority order, and
  // the first plugin's context provider encompasses all others.
  for (let i = plugins.length - 1; i >= 0; i--) {
    const plugin = plugins[i];
    if (plugin.transformTableContext) {
      try {
        tableElement = plugin.transformTableContext(tableElement);
      } catch (error) {
        devError('Table', 'Plugin threw in transformTableContext:', error);
      }
    }
  }
  return tableElement;
}

/**
 * BaseTable — an unstyled, generic `<table>` component.
 *
 * Supports data-driven rendering (via `data` + `columns`) and children mode.
 * Applies plugins as a transform pipeline over render props.
 * Accepts a `components` prop to render styled components instead of raw elements.
 *
 * @example
 * ```
 * <BaseTable
 *   data={[{ name: 'Alice', age: 30 }]}
 *   columns={[
 *     { key: 'name', header: 'Name' },
 *     { key: 'age', header: 'Age', width: pixel(80) },
 *   ]}
 * />
 * ```
 */
export const BaseTable = BaseTableInner;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
BaseTable.displayName = 'BaseTable';