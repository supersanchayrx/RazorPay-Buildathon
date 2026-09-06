// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file LayoutAreaContext.ts
 * @input Uses React createContext
 * @output Exports LayoutAreaContext and LayoutArea type
 * @position Context for layout slot detection
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Layout/Layout.doc.mjs
 */
import { createContext } from 'react';

/**
 * Layout area type representing which slot a component is rendered in.
 * Used by content area components to detect their position and adjust styling.
 */

/**
 * Context for detecting which layout area a component is rendered in.
 * Content area components use this to:
 * - Auto-position dividers correctly
 * - Apply correct semantic elements
 * - Adjust internal spacing
 */
export const LayoutAreaContext = /*#__PURE__*/createContext(null);
LayoutAreaContext.displayName = 'LayoutAreaContext';