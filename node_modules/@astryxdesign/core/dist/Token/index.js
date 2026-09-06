// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Token component
 * @output Exports all Token module public API
 * @position Entry point for Token module
 *
 * SYNC: When adding new Token files, update exports here
 */

/**
 * Extensible color map for Token.
 *
 * Theme packages can add custom colors via TypeScript module augmentation:
 * @example
 * ```
 * declare module '@astryxdesign/core/Token' {
 *   interface TokenColorMap {
 *     brand: true;
 *   }
 * }
 * ```
 */
export { Token } from "./Token.js";