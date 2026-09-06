// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file LayerContext.ts
 * @input React context
 * @output Exports LayerContext and related types
 * @position Context definition for LayerProvider
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Layer/index.ts
 * - /packages/core/src/Layer/LayerProvider.tsx
 */
import { createContext, use } from 'react';

/**
 * Toast configuration passed through the layer provider.
 */

/**
 * Context value provided by LayerProvider.
 */

/**
 * React context for the layer provider.
 * Default value is null — hooks detect this and use the fallback.
 */
export const LayerContext = /*#__PURE__*/createContext(null);
LayerContext.displayName = 'LayerContext';

/**
 * Hook to access the layer context. Returns null if no provider exists.
 */
export function useLayerContext() {
  return use(LayerContext);
}