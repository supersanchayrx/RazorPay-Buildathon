// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Breadcrumbs component barrel export
 */

/**
 * Extensible variant map for Breadcrumbs.
 *
 * Theme packages can add custom variants via TypeScript module augmentation:
 * @example
 * ```
 * declare module '@astryxdesign/core/Breadcrumbs' {
 *   interface BreadcrumbsVariantMap {
 *     'compact': true;
 *   }
 * }
 * ```
 */
export { Breadcrumbs } from "./Breadcrumbs.js";
export { BreadcrumbItem } from "./BreadcrumbItem.js";
// The breadcrumb `menu` prop reuses the DropdownMenu item API, so the item
// components are re-exported under `Breadcrumb*` aliases for family coherence
// and discoverability (mirroring ContextMenu). A consumer's existing
// DropdownMenu item definitions are portable into a breadcrumb menu verbatim.
export { DropdownMenuItem as BreadcrumbMenuItem } from "../DropdownMenu/DropdownMenuItem.js";
export { DropdownMenuDivider as BreadcrumbMenuDivider } from "../DropdownMenu/DropdownMenuDivider.js";
export { DropdownMenuCheckboxItem as BreadcrumbMenuCheckboxItem } from "../DropdownMenu/DropdownMenuCheckboxItem.js";
export { DropdownMenuRadioGroup as BreadcrumbMenuRadioGroup } from "../DropdownMenu/DropdownMenuRadioGroup.js";
export { DropdownMenuRadioItem as BreadcrumbMenuRadioItem } from "../DropdownMenu/DropdownMenuRadioItem.js";
export { DropdownMenuSubMenu as BreadcrumbMenuSubMenu } from "../DropdownMenu/DropdownMenuSubMenu.js";