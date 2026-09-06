// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TableHeaderCell.tsx
 * @input React, StyleX, TableContext, theme tokens, useTableCellStyles
 * @output Exports TableHeaderCell component, TableHeaderCellProps
 * @position Sub-component; used inside Table for header cells
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Table/Table.doc.mjs
 * - /packages/core/src/Table/index.ts
 * - /packages/cli/assets/templates/blocks/components/Table/ (showcase blocks)
 */
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, fontWeightVars, typeScaleVars, borderVars } from "../theme/tokens.stylex.js";
import { overflowStyles, containerEdgeStyles } from "./table.stylex.js";
import { useTableContext, mergeXStyle } from "./useTableCellStyles.js";
import { wrapInTableContextMenu } from "./tableContextMenu.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

/** Props for TableHeaderCell — `<th>` wrapper with context-aware styling */
import { jsx as _jsx } from "react/jsx-runtime";
const densityStyles = {
  compact: {
    k8WAf4: "xu0wf1k",
    kg3NbH: "xf314gf",
    kGuDYH: "xcr08ib",
    kB7OPa: "x9f619",
    $$css: true
  },
  balanced: {
    k8WAf4: "xce4md1",
    kg3NbH: "xrrkdod",
    kGuDYH: "xcr08ib",
    kB7OPa: "x9f619",
    $$css: true
  },
  spacious: {
    k8WAf4: "x8o8v82",
    kg3NbH: "x1pzlopt",
    kGuDYH: "xcr08ib",
    kB7OPa: "x9f619",
    $$css: true
  }
};
const headerStyles = {
  cell: {
    k63SB2: "x2mo6ok",
    kMwMTN: "xv1l7n4",
    k9WMMc: "x1yc453h",
    $$css: true
  }
};
const headerDividerStyles = {
  cell: {
    kt9PQ7: "x92x3c3",
    kfdmCh: "x1q0q8m5",
    kL6WhQ: "xw8gpjh",
    $$css: true
  }
};
const dividerColumnStyles = {
  cell: {
    ke9TFa: "xw8tdv1 x1qlsc9e",
    k8ry5P: "x18b5jzi",
    kBCPoo: "x1gejf6u",
    $$css: true
  }
};

/**
 * TableHeaderCell — a `<th>` wrapper for header cells.
 *
 * When used inside `<Table>`, inherits styling from the table context
 * (density padding, header font weight/color, divider borders).
 * When used standalone, renders a plain `<th>`.
 *
 * Accepts `xstyle` for plugin-provided styles that merge on top.
 *
 * @example
 * ```
 * <thead>
 *   <tr>
 *     <TableHeaderCell>Name</TableHeaderCell>
 *     <TableHeaderCell>Age</TableHeaderCell>
 *   </tr>
 * </thead>
 * ```
 */
export function TableHeaderCell({
  children,
  xstyle,
  ref,
  className: incomingClassName,
  style: incomingStyle,
  contextMenuActions,
  ...props
}) {
  const ctx = useTableContext();

  // Header cells always get the bottom divider (separates header from body).
  // When used standalone (no table context) the cell renders plain, with no
  // density/divider styles.
  const cellStyles = [];
  if (ctx) {
    cellStyles.push(headerStyles.cell, densityStyles[ctx.density], headerDividerStyles.cell, overflowStyles.cell, containerEdgeStyles[ctx.density]);
    // Column dividers come from the shared builder (column axis only).
    if (ctx.dividers === 'columns' || ctx.dividers === 'grid') {
      cellStyles.push(dividerColumnStyles.cell);
    }
  }

  // The cell owns the context-menu wrapper so it controls how the menu
  // interacts with its padding / content. No-op when no actions.
  const content = wrapInTableContextMenu(children, contextMenuActions);
  return /*#__PURE__*/_jsx("th", {
    ref: ref,
    ...props,
    ...mergeProps(themeProps('table-header-cell', {
      density: ctx?.density
    }), stylex.props(...mergeXStyle(cellStyles, xstyle)), incomingClassName, incomingStyle),
    children: content
  });
}
TableHeaderCell.displayName = 'TableHeaderCell';