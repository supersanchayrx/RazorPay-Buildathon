// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports from StatusDot component
 * @output Exports StatusDot component and related types
 * @position Entry point for StatusDot; re-exported by /packages/core/src/index.ts
 */

/**
 * Extensible variant map for StatusDot.
 *
 * Theme packages can add custom variants via TypeScript module augmentation:
 * @example
 * ```
 * declare module '@astryxdesign/core/StatusDot' {
 *   interface StatusDotVariantMap {
 *     'critical': true;
 *   }
 * }
 * ```
 */
export { StatusDot } from "./StatusDot.js";