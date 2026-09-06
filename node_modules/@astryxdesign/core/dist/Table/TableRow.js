// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TableRow.tsx
 * @input React, StyleX, TableContext, theme tokens
 * @output Exports TableRow component, TableRowProps
 * @position Sub-component; used inside a Table section (TableHeader /
 *   TableBody / TableFooter) in children mode
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Table/Table.doc.mjs
 * - /packages/core/src/Table/index.ts
 * - /packages/cli/assets/templates/blocks/components/Table/ (showcase blocks)
 */
import { use } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, durationVars, easeVars } from "../theme/tokens.stylex.js";
import { tableRowMarker } from "./table.stylex.js";
import { TableContext } from "./TableContext.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

/** Props for TableRow — thin `<tr>` wrapper */
import { jsx as _jsx } from "react/jsx-runtime";
const stripedRowStyles = {
  row: {
    kWkggS: "x1dnou9g",
    "--table-row-overlay": "x1rht92",
    $$css: true
  }
};
const hoverRowStyles = {
  row: {
    kWkggS: "xoevpu5",
    "--table-row-overlay": "xc01ov8",
    k1ekBW: "x15406qy",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    $$css: true
  }
};
const stripedHoverRowStyles = {
  row: {
    kWkggS: "x1dnou9g xoevpu5",
    "--table-row-overlay": "x1rht92 xc01ov8",
    k1ekBW: "x15406qy",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    $$css: true
  }
};

/**
 * TableRow — a `<tr>` wrapper for children/streaming mode.
 *
 * When used inside `<Table>`, inherits styling from the table context
 * (striped, hover, divider overrides). When used standalone, renders a plain `<tr>`.
 *
 * Rows go inside a section — `<TableBody>`, `<TableHeader>`, or
 * `<TableFooter>`. `<table>` cannot contain a `<tr>` directly: the HTML parser
 * inserts an implied `<tbody>` when it parses server-rendered markup and React
 * does not when it renders on the client, so the two trees mismatch on
 * hydration. Children mode passes children straight through, so the section is
 * the caller's to supply — the data-driven `data={...}` mode renders it for
 * you.
 *
 * @example
 * ```
 * <Table>
 *   <TableBody>
 *     <TableRow>
 *       <TableCell>Alice</TableCell>
 *       <TableCell>30</TableCell>
 *     </TableRow>
 *   </TableBody>
 * </Table>
 * ```
 */
export function TableRow({
  children,
  xstyle,
  ref,
  isHeaderRow = false,
  className: incomingClassName,
  style: incomingStyle,
  ...props
}) {
  const ctx = use(TableContext);
  if (!ctx) {
    return /*#__PURE__*/_jsx("tr", {
      ref: ref,
      ...props,
      ...mergeProps(themeProps('table-row'), stylex.props(tableRowMarker, xstyle), incomingClassName, incomingStyle),
      children: children
    });
  }
  const rowStyles = [];

  // Striped + hover styling is for body rows only — the header row must not
  // pick up the hover highlight (or striping) even when hasHover/isStriped.
  if (!isHeaderRow) {
    // Handle striped + hover combination to avoid backgroundColor conflicts
    if (ctx.isStriped && ctx.hasHover) {
      rowStyles.push(stripedHoverRowStyles.row);
    } else if (ctx.isStriped) {
      rowStyles.push(stripedRowStyles.row);
    } else if (ctx.hasHover) {
      rowStyles.push(hoverRowStyles.row);
    }
  }
  if (ctx.dividers === 'rows' || ctx.dividers === 'grid') {
    // Note: last-body-row border removal is handled by TableCell
    // to avoid affecting the header row in <thead>.
  }
  if (xstyle) {
    rowStyles.push(...xstyle);
  }
  return /*#__PURE__*/_jsx("tr", {
    ref: ref,
    ...props,
    ...mergeProps(themeProps('table-row'), stylex.props(tableRowMarker, ...rowStyles), incomingClassName, incomingStyle),
    children: children
  });
}
TableRow.displayName = 'TableRow';