// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Layer hooks and components
 * @output Exports all Layer module public API
 * @position Entry point for Layer module
 *
 * SYNC: When adding new Layer files, update exports here
 *
 * NOTE: Popover, HoverCard, and Tooltip have been moved to their own
 * top-level directories. They are re-exported here for backward compatibility.
 * New code should import from @astryxdesign/core/Popover, @astryxdesign/core/HoverCard,
 * or @astryxdesign/core/Tooltip directly.
 */

// Core layer hook (remains in Layer)
export { useLayer } from "./useLayer.js";
// Layer dismissal stack — one Escape owner for every overlay family
export { useLayerDismissal } from "./useLayerDismissal.js";
export { LayerDepthProvider } from "./LayerDepthContext.js";

// Shared touch behavior for the hover layers
export { useTouchTrigger, isActionTrigger } from "./useTouchTrigger.js";
// Layer provider
export { LayerProvider } from "./LayerProvider.js";
export { LayerContext, useLayerContext } from "./LayerContext.js";
// Shared entry animation styles for layer-based components
export { layerAnimations } from "./layerAnimations.stylex.js";

// Re-export Popover from new location (backward compat)
export { usePopover, Popover } from "../Popover/index.js";
// Re-export HoverCard from new location (backward compat)
export { useHoverCard, HoverCard } from "../HoverCard/index.js";
// Re-export Tooltip from new location (backward compat)
export { useTooltip, Tooltip } from "../Tooltip/index.js";