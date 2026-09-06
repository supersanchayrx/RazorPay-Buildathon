// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file ProgressBar component barrel export
 */

/**
 * Extensible variant map for ProgressBar.
 *
 * Theme packages can add custom variants via TypeScript module augmentation:
 * @example
 * ```
 * declare module '@astryxdesign/core/ProgressBar' {
 *   interface ProgressBarVariantMap {
 *     'brand': true;
 *   }
 * }
 * ```
 */
export { ProgressBar } from "./ProgressBar.js";