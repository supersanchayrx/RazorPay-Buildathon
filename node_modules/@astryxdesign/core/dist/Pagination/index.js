// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Pagination component and types
 * @output Public API for Pagination module
 * @position Barrel export; consumed by packages/core/src/index.ts
 */

/**
 * Extensible variant map for Pagination.
 *
 * Theme packages can add custom variants via TypeScript module augmentation:
 * @example
 * ```
 * declare module '@astryxdesign/core/Pagination' {
 *   interface PaginationVariantMap {
 *     'progress': true;
 *   }
 * }
 * ```
 */
export { Pagination, generatePageRange } from "./Pagination.js";