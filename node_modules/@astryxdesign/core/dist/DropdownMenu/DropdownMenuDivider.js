// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file DropdownMenuDivider.tsx
 * @input Uses Divider, spacing tokens, themeProps
 * @output Exports DropdownMenuDivider component and DropdownMenuDividerProps
 * @position Sub-component; used inside DropdownMenu
 *
 * The compound-mode peer of the data API's `{type: 'divider'}` option. The
 * data path renders this same component, so neither mode can drift from the
 * other in DOM, spacing, or theme target.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/DropdownMenu/DropdownMenu.doc.mjs
 * - /packages/core/src/DropdownMenu/DropdownMenuDivider.doc.mjs
 * - /packages/core/src/DropdownMenu/DropdownMenu.test.tsx
 * - /packages/core/src/DropdownMenu/index.ts
 * - /packages/core/src/ContextMenu/index.ts
 * - /packages/core/src/Breadcrumbs/index.ts
 * - /apps/storybook/stories/DropdownMenu.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/DropdownMenu/ (showcase blocks)
 */
import * as stylex from '@stylexjs/stylex';
import { Divider } from "../Divider/index.js";
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  divider: {
    kqGvvJ: "xsq74q5",
    $$css: true
  }
};
const THEME_CLASS_NAME = themeProps('dropdown-menu-divider').className;
/**
 * A horizontal rule separating groups of menu rows.
 *
 * Renders `role="separator"`, so it is never a stop in the menu's arrow-key
 * order. Equivalent to `{type: 'divider'}` in the `items` data API.
 *
 * @example
 * ```
 * <DropdownMenu button={{ label: 'Actions' }}>
 *   <DropdownMenuItem label="Edit" onClick={handleEdit} />
 *   <DropdownMenuDivider />
 *   <DropdownMenuItem label="Delete" variant="destructive" onClick={handleDelete} />
 * </DropdownMenu>
 * ```
 */
export function DropdownMenuDivider({
  xstyle,
  className,
  style,
  ref
}) {
  return /*#__PURE__*/_jsx(Divider, {
    ref: ref,
    xstyle: [styles.divider, xstyle],
    className: className ? `${THEME_CLASS_NAME} ${className}` : THEME_CLASS_NAME,
    style: style
  });
}
DropdownMenuDivider.displayName = 'DropdownMenuDivider';