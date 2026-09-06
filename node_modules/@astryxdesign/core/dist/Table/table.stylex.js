// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file table.stylex.ts
 * @input StyleX, theme tokens
 * @output Shared table styles used by TableCell, TableHeaderCell, TableRow
 * @position Utility styles; consumed by cell and row components
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Table/TableCell.tsx
 * - /packages/core/src/Table/TableHeaderCell.tsx
 * - /packages/core/src/Table/TableRow.tsx
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";

/**
 * Scoped marker for table row ancestor selectors.
 *
 * Applied to each `<tr>` via TableRow so that cell-level
 * `stylex.when.ancestor(':last-child', tableRowMarker)` only matches
 * the parent row — not other ancestors like `<tbody>` or `<table>`.
 */
export const tableRowMarker = {
  x139im0d: "x139im0d",
  $$css: true
};

/**
 * Overflow truncation for table cells.
 *
 * Applied at the <td>/<th> level when textOverflow is 'truncate'.
 * For data-driven tables in truncate mode, the default renderer wraps
 * content in <Text maxLines={1}> for smart tooltips that only appear
 * when text is actually overflowing.
 */
export const overflowStyles = {
  cell: {
    kVQacm: "xb3r6kr",
    kg5iWk: "xlyipyv",
    khDVqt: "xuxw1ft",
    ks0D6T: "x1m189uc",
    $$css: true
  }
};

/**
 * Wrap styles for table cells.
 *
 * Applied at the <td>/<th> level when textOverflow is 'wrap'.
 * Text wraps naturally and the row grows taller to fit. No content is hidden.
 */
export const wrapStyles = {
  cell: {
    kVQacm: "xb3r6kr",
    kHjlTd: "x1mzt3pk",
    kTgw9: "x13faqbe",
    ks0D6T: "x1m189uc",
    $$css: true
  }
};

/**
 * Container edge compensation for table cells.
 *
 * When a table is inside a Card, Section, or Layout area, the table
 * element applies negative inline margins to bleed edge-to-edge
 * (see Table.tsx containerBleed style). These styles ensure the
 * first and last columns' outer padding aligns with the container's
 * content inset, with a minimum of --spacing-2 (8px).
 *
 * Each density variant uses its own paddingInline as the fallback,
 * so standalone tables (where --container-padding-inline-start/end are unset)
 * keep their normal density-based cell padding unchanged.
 */
export const containerEdgeStyles = {
  compact: {
    kZCmMZ: "x5uh4xs",
    kwRFfy: "xbg7gas",
    $$css: true
  },
  balanced: {
    kZCmMZ: "x9bi00s",
    kwRFfy: "xpilulx",
    $$css: true
  },
  spacious: {
    kZCmMZ: "x18c6q21",
    kwRFfy: "x1wzlfcn",
    $$css: true
  }
};