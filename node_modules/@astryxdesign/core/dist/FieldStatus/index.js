// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input FieldStatus component source
 * @output Exports FieldStatus and related types
 * @position Entry point for @astryxdesign/core/FieldStatus subpath export
 */

/**
 * Extensible variant map for FieldStatus.
 *
 * Theme packages can add custom variants via TypeScript module augmentation:
 * @example
 * ```
 * declare module '@astryxdesign/core/FieldStatus' {
 *   interface FieldStatusVariantMap {
 *     'inline': true;
 *   }
 * }
 * ```
 */
export { FieldStatus } from "./FieldStatus.js";