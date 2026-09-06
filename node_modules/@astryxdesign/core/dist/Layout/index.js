// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports layout utilities and components
 * @output Exports Astryx layout system
 * @position Entry point for @astryxdesign/core/Layout
 *
 * SYNC: When modified, update /packages/core/src/Layout/Layout.doc.mjs
 */

// Container utility
export { container } from "./container.stylex.js";
// Overlay padding-variable reset (applied on overlay roots so the container
// padding system does not cross a fixed/top-layer boundary)
export { overlayPaddingReset } from "./padding.stylex.js";

// Edge compensation utility
export { edgeCompSlot, EDGE_COMP_ATTR } from "./edgeCompensation.stylex.js";

// Stack utilities (re-exported from Stack module)
export { stack } from "../Stack/stack.stylex.js";
export { stackItem } from "../Stack/stackItem.stylex.js";
// Stack components (re-exported from Stack module)
export { Stack, HStack, VStack, StackItem } from "../Stack/index.js";
// Container components (re-exported from their own modules)
export { Card } from "../Card/index.js";
export { Section } from "../Section/index.js";
// Layout structure components
export { Layout } from "./Layout.js";
export { LayoutHeader } from "./LayoutHeader.js";
export { LayoutFooter } from "./LayoutFooter.js";
export { LayoutContent } from "./LayoutContent.js";
export { LayoutPanel } from "./LayoutPanel.js";
export { LayoutAreaContext } from "./LayoutAreaContext.js";
export { LayoutDividerContext } from "./LayoutDividerContext.js";