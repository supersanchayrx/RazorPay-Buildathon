// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports SideNav components and types
 * @output Exports SideNav, SideNavHeading, SideNavItem, SideNavSection
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * SYNC: When modified, update this header and /packages/core/src/SideNav/SideNav.doc.mjs
 */
export { SideNav } from "./SideNav.js";
export { SideNavHeading } from "./SideNavHeading.js";
export { SideNavItem } from "./SideNavItem.js";
export { SideNavSection } from "./SideNavSection.js";
export { SideNavCollapseButton } from "./SideNavCollapseButton.js";
export { useSideNavCollapse } from "./SideNavCollapseContext.js";
export { SideNavRenderContext, useSideNavRenderMode } from "./SideNavRenderContext.js";