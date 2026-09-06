// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TableCell.tsx
 * @input React, StyleX, TableContext, theme tokens, useTableCellStyles
 * @output Exports TableCell component, TableCellProps
 * @position Sub-component; used inside Table children mode
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Table/Table.doc.mjs
 * - /packages/core/src/Table/index.ts
 * - /packages/cli/assets/templates/blocks/components/Table/ (showcase blocks)
 */
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { borderVars, colorVars, spacingVars, typeScaleVars } from "../theme/tokens.stylex.js";
import { wrapInTableContextMenu } from "./tableContextMenu.js";
import "./table.stylex.js";
import { overflowStyles, wrapStyles, containerEdgeStyles, tableRowMarker } from "./table.stylex.js";
import { useTableContext, buildDividerStyles, mergeXStyle } from "./useTableCellStyles.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

/** Props for TableCell — thin `<td>` wrapper */
import { jsx as _jsx } from "react/jsx-runtime";
const densityStyles = {
  compact: {
    k8WAf4: "xu0wf1k",
    kg3NbH: "xf314gf",
    kGuDYH: "xjm74w1",
    kB7OPa: "x9f619",
    $$css: true
  },
  balanced: {
    k8WAf4: "xce4md1",
    kg3NbH: "xrrkdod",
    kGuDYH: "xjm74w1",
    kB7OPa: "x9f619",
    $$css: true
  },
  spacious: {
    k8WAf4: "x8o8v82",
    kg3NbH: "x1pzlopt",
    kGuDYH: "xjm74w1",
    kB7OPa: "x9f619",
    $$css: true
  }
};

// When a cell owns a context menu, its padding moves from the `<td>` onto the
// right-click trigger wrapper so the *entire* cell (padding included) opens the
// menu. Without this, right-clicking the padding ring near a cell edge falls
// through to the browser's native menu. Paired with `contextMenuCellStyles` on
// the `<td>` (font/box-sizing only — no padding).
const densityTextStyles = {
  compact: {
    kGuDYH: "xjm74w1",
    kB7OPa: "x9f619",
    $$css: true
  },
  balanced: {
    kGuDYH: "xjm74w1",
    kB7OPa: "x9f619",
    $$css: true
  },
  spacious: {
    kGuDYH: "xjm74w1",
    kB7OPa: "x9f619",
    $$css: true
  }
};
const densityPaddingStyles = {
  compact: {
    k8WAf4: "xu0wf1k",
    kg3NbH: "xf314gf",
    $$css: true
  },
  balanced: {
    k8WAf4: "xce4md1",
    kg3NbH: "xrrkdod",
    $$css: true
  },
  spacious: {
    k8WAf4: "x8o8v82",
    kg3NbH: "x1pzlopt",
    $$css: true
  }
};

// The trigger wrapper fills the whole cell (a `<td>` child with height:100%
// stretches to the row height) so a right-click anywhere in the cell opens the
// menu. It carries the density padding relocated off the `<td>`.
const triggerFillStyles = {
  fill: {
    k1xSpc: "x1lliihq",
    kB7OPa: "x9f619",
    kZKoxP: "x5yr21d",
    kzqmXN: "xh8yej3",
    $$css: true
  }
};

// `height:100%` on the `<td>` is the CSS trick that lets a block child resolve
// its own `height:100%` against the row height — so the trigger fills the cell
// vertically (top/bottom padding included) and is fully right-clickable.
const contextMenuCellStyles = {
  cell: {
    kZKoxP: "x5yr21d",
    $$css: true
  }
};
const dividerRowStyles = {
  cell: {
    kt9PQ7: "x92x3c3 x1wp2rvj",
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
const verticalAlignStyles = {
  middle: {
    kXLuUW: "xxymvpz",
    $$css: true
  },
  top: {
    kXLuUW: "x16dsc37",
    $$css: true
  },
  bottom: {
    kXLuUW: "x3ajldb",
    $$css: true
  }
};

/**
 * TableCell — a `<td>` wrapper for children/streaming mode.
 *
 * When used inside `<Table>`, inherits styling from the table context
 * (density padding, divider borders). When used standalone, renders a plain `<td>`.
 *
 * @example
 * ```
 * <TableRow>
 *   <TableCell>Alice</TableCell>
 *   <TableCell>30</TableCell>
 * </TableRow>
 * ```
 */
export function TableCell({
  children,
  xstyle,
  ref,
  className: incomingClassName,
  style: incomingStyle,
  contextMenuActions,
  ...props
}) {
  const ctx = useTableContext();
  const hasContextMenu = typeof contextMenuActions === 'function' || Array.isArray(contextMenuActions) && contextMenuActions.length > 0;

  // When the cell owns a context menu, its density padding is relocated onto
  // the right-click trigger wrapper (see `content` below) so the entire cell —
  // padding included — opens the menu. Otherwise padding lives on the `<td>`.
  const cellStyles = ctx ? [hasContextMenu ? densityTextStyles[ctx.density] : densityStyles[ctx.density], ctx.textOverflow === 'truncate' ? overflowStyles.cell : wrapStyles.cell, containerEdgeStyles[ctx.density], verticalAlignStyles[ctx.verticalAlign], ...buildDividerStyles(ctx, dividerRowStyles.cell, dividerColumnStyles.cell), ...(hasContextMenu ? [contextMenuCellStyles.cell] : [])] : [];

  // The cell owns the context-menu wrapper so it controls how the menu
  // interacts with its padding / content. No-op when no actions. When actions
  // exist we make the trigger fill the cell and carry the density padding so a
  // right-click anywhere in the cell (including the padding ring) opens it.
  const triggerXstyle = hasContextMenu && ctx ? [triggerFillStyles.fill, densityPaddingStyles[ctx.density]] : hasContextMenu ? triggerFillStyles.fill : undefined;
  const content = wrapInTableContextMenu(children, contextMenuActions, triggerXstyle);
  return /*#__PURE__*/_jsx("td", {
    ref: ref,
    ...props,
    ...mergeProps(themeProps('table-cell', {
      density: ctx?.density
    }), stylex.props(...mergeXStyle(cellStyles, xstyle)), incomingClassName, incomingStyle),
    children: content
  });
}
TableCell.displayName = 'TableCell';