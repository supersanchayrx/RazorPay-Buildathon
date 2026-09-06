// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TreeListBranches.tsx
 * @input Uses React, StyleX, theme tokens
 * @output Exports TreeListBranches component (internal)
 * @position Presentational component for tree connector lines; consumed by TreeListItem.tsx
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/TreeList/TreeListItem.tsx
 * - /packages/cli/assets/templates/blocks/components/TreeList/ (showcase blocks)
 */
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
const LINE_WIDTH = 1;

/**
 * Branch margin from the left edge. No exact spacing token for 10px,
 * so we use calc(--spacing-2 + --spacing-0-5) = 8 + 2 = 10.
 */
const BRANCH_MARGIN = `calc(${spacingVars['--spacing-2']} + ${spacingVars['--spacing-0-5']})`;

/** Per-level indent width. Reads the public, themeable `--tree-list-indent`
 * lever set on the tree-list root (default `--spacing-4`, 16px), so the guide
 * lines stay aligned with the row indent when a theme retunes the step. */
const LEVEL_INDENT = 'var(--tree-list-indent)';
// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Components
// =============================================================================

/**
 * Renders vertical lines showing parent-child relationships in the tree.
 * Positioned in a full-height container to span the entire item including children.
 *
 * The line element carries the stable `astryx-tree-list-guide` theme target so a
 * theme can recolor or hide the connectors via `defineTheme` (e.g.
 * `backgroundColor` or `display: 'none'`) instead of hiding the built-in guides
 * and reimplementing them.
 */
export function TreeListBranches({
  ancestorsIsLast,
  isLast,
  nestedLevel
}) {
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [ancestorsIsLast.map((ancestorIsLast, level) => {
      const branchOffset = `calc(${BRANCH_MARGIN} + ${level} * ${LEVEL_INDENT})`;
      return (
        // Skip the level that the current-item connector occupies
        // (nestedLevel - 1), since that position is rendered below
        // with the correct terminus/continuation style.
        !ancestorIsLast && level !== nestedLevel - 1 && /*#__PURE__*/_jsx("div", {
          ...mergeProps({
            className: "x5yr21d x10l6tqk xfyiiit"
          }, {
            style: {
              insetInlineStart: branchOffset
            }
          }),
          children: /*#__PURE__*/_jsx("div", {
            ...mergeProps(themeProps('tree-list-guide'), {
              className: "x1nj7uno x1o0tod x1bpp3o7 x10l6tqk xtijo5x x1i1rx1s x7njt3n xs02d24"
            })
          })
        }, level)
      );
    }), nestedLevel > 0 && /*#__PURE__*/_jsx("div", {
      ...mergeProps({
        className: "x5yr21d x10l6tqk xfyiiit"
      }, {
        style: {
          insetInlineStart: `calc(${BRANCH_MARGIN} + ${nestedLevel - 1} * ${LEVEL_INDENT})`
        }
      }),
      children: /*#__PURE__*/_jsx("div", {
        ...mergeProps(themeProps('tree-list-guide'), // The last item in a group has no sibling below, so its connector
        // is clamped to the row box's bottom edge (verticalLast) instead
        // of bridging into the inter-row gap — no overhang into empty
        // space. Every other row bridges the gap (verticalFull) so the
        // line stays continuous down to the next sibling.
        {
          0: {
            className: "x1nj7uno x1o0tod x1bpp3o7 x10l6tqk xtijo5x x1i1rx1s x7njt3n xs02d24"
          },
          1: {
            className: "x1nj7uno x1o0tod x1bpp3o7 x10l6tqk xtijo5x x1i1rx1s x7njt3n xuk38ov"
          }
        }[!!isLast << 0])
      })
    })]
  });
}
TreeListBranches.displayName = 'TreeListBranches';