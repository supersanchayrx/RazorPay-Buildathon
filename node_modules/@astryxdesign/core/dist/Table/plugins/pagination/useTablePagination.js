// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useTablePagination.tsx
 * @input React, Pagination, Table plugin types
 * @output Exports useTablePagination hook and config type
 * @position Pagination plugin; consumed by Table via plugins prop
 *
 * Returns a `TablePlugin` directly (same pattern as useTableSortable,
 * useTableSelection, useTableColumnSettings).
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Table/plugins/pagination/index.ts (exports)
 * - /packages/core/src/Table/index.ts (exports)
 */
import { useMemo, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../../../theme/tokens.stylex.js";
import { spacingVars } from "../../../theme/tokens.stylex.js";
import { Pagination } from "../../../Pagination/index.js";
import { useTranslator } from "../../../i18n/index.js";

// =============================================================================
// Styles
// =============================================================================
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  wrapper: {
    k1xSpc: "x78zum5",
    $$css: true
  },
  marginTop: {
    keoZOQ: "xtbrsbv",
    $$css: true
  },
  marginBottom: {
    k1K539: "x1p37lm5",
    $$css: true
  },
  alignStart: {
    kjj79g: "x1nhvcw1",
    $$css: true
  },
  alignCenter: {
    kjj79g: "xl56j7k",
    $$css: true
  },
  alignEnd: {
    kjj79g: "x13a6bvl",
    $$css: true
  }
};

// =============================================================================
// Config Type
// =============================================================================

/**
 * Configuration for useTablePagination.
 *
 * The consumer owns all state. This hook renders pagination controls
 * around the table via `transformTableContext`.
 *
 * @example
 * ```
 * const [page, setPage] = useState(1);
 * const plugin = useTablePagination({
 *   page,
 *   onPageChange: setPage,
 *   totalItems: data.length,
 *   pageSize: 10,
 * });
 * <Table data={pageData} columns={columns} plugins={{ pagination: plugin }} />
 * ```
 */

// =============================================================================
// Hook
// =============================================================================

/**
 * Pagination table plugin \u2014 renders Pagination controls around the table.
 *
 * Returns a `TablePlugin` directly (same pattern as `useTableSortable`,
 * `useTableSelection`, `useTableColumnSettings`).
 *
 * @example
 * ```
 * const [page, setPage] = useState(1);
 * const plugin = useTablePagination({
 *   page,
 *   onPageChange: setPage,
 *   totalItems: data.length,
 *   pageSize: 10,
 * });
 * <Table data={pageData} plugins={{ pagination: plugin }} />
 * ```
 */
export function useTablePagination(config) {
  const t = useTranslator();
  const {
    page,
    onPageChange,
    totalItems,
    totalPages: totalPagesProp,
    hasMore,
    pageSize: pageSizeConfig = 10,
    onPageSizeChange,
    pageSizeOptions,
    variant = 'pages',
    size = 'md',
    position = 'below',
    align = 'center',
    label: labelFromProps
  } = config;
  const label = labelFromProps ?? t('@astryx.table.pagination.label');
  // position='both' renders two nav landmarks; suffix the base label so each
  // gets a unique accessible name (axe landmark-unique).
  const labelAbove = t('@astryx.table.pagination.labelAbove', {
    label
  });
  const labelBelow = t('@astryx.table.pagination.labelBelow', {
    label
  });

  // Same guard as Pagination itself: 0/NaN/negative pageSize would produce an
  // Infinity/NaN totalPages here, which bypasses Pagination's own coercion
  // because it is passed down as the explicit totalPages prop.
  const pageSize = Number.isFinite(pageSizeConfig) ? Math.max(1, Math.floor(pageSizeConfig)) : 10;
  const computedTotalPages = totalPagesProp ?? (totalItems != null ? Math.ceil(totalItems / pageSize) : undefined);

  // Build Pagination props
  const paginationProps = {
    page,
    onChange: onPageChange,
    totalItems,
    totalPages: computedTotalPages,
    hasMore,
    pageSize,
    onPageSizeChange,
    pageSizeOptions,
    variant,
    size,
    label
  };

  // Keep current config in a ref so the plugin can read the latest values
  // without needing to recreate the plugin object on every change.
  const configRef = useRef({
    paginationProps,
    position,
    align,
    labelAbove,
    labelBelow
  });
  configRef.current = {
    paginationProps,
    position,
    align,
    labelAbove,
    labelBelow
  };

  // Stable plugin object \u2014 created once, reads config via ref.
  return useMemo(() => ({
    transformTableContext(children) {
      const {
        position: pos,
        paginationProps: props,
        align: a,
        labelAbove: above,
        labelBelow: below
      } = configRef.current;
      if (pos === 'none') {
        return children;
      }

      // Don't render pagination when there's only one page and no more data.
      const resolvedTotalPages = props.totalPages ?? (props.totalItems != null && props.pageSize != null ? Math.ceil(props.totalItems / props.pageSize) : undefined);
      const isSinglePage = resolvedTotalPages === 1 && props.hasMore !== true;
      if (isSinglePage) {
        return children;
      }
      const makeWrapper = side => /*#__PURE__*/_jsx("div", {
        ...stylex.props(styles.wrapper, side === 'below' && styles.marginTop, side === 'above' && styles.marginBottom, a === 'center' && styles.alignCenter, a === 'end' && styles.alignEnd, a === 'start' && styles.alignStart),
        children: /*#__PURE__*/_jsx(Pagination, {
          ...props,
          // Two navs with the same name are indistinguishable landmarks;
          // give each side a unique name when both render.
          label: pos === 'both' ? side === 'above' ? above : below : props.label
        })
      });
      return /*#__PURE__*/_jsxs(_Fragment, {
        children: [(pos === 'above' || pos === 'both') && makeWrapper('above'), children, (pos === 'below' || pos === 'both') && makeWrapper('below')]
      });
    }
  }), []);
}