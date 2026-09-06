// Copyright (c) Meta Platforms, Inc. and affiliates.
'use client';

/**
 * @file index.ts
 * @output Exports ContextMenu, ContextMenuItem and related types
 * @position Public API entry point
 */
export { ContextMenu } from "./ContextMenu.js";
export { DropdownMenuItem as ContextMenuItem } from "../DropdownMenu/DropdownMenuItem.js";
export { DropdownMenuDivider as ContextMenuDivider } from "../DropdownMenu/DropdownMenuDivider.js";

// Selectable items work inside a ContextMenu too — re-exported under the
// ContextMenu name for a coherent API.
export { DropdownMenuCheckboxItem as ContextMenuCheckboxItem } from "../DropdownMenu/DropdownMenuCheckboxItem.js";
export { DropdownMenuRadioGroup as ContextMenuRadioGroup } from "../DropdownMenu/DropdownMenuRadioGroup.js";
export { DropdownMenuRadioItem as ContextMenuRadioItem } from "../DropdownMenu/DropdownMenuRadioItem.js";
// Submenus work inside a ContextMenu too (nested flyout of items).
export { DropdownMenuSubMenu as ContextMenuSubMenu } from "../DropdownMenu/DropdownMenuSubMenu.js";