// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports Dialog component and types from Dialog.tsx
 * @output Exports Dialog, DialogHeader, and related types
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * SYNC: When modified, update this header and /packages/core/src/Dialog/Dialog.doc.mjs
 */

/**
 * Extensible variant map for Dialog.
 *
 * Theme packages can add custom variants via TypeScript module augmentation:
 * @example
 * ```
 * declare module '@astryxdesign/core/Dialog' {
 *   interface DialogVariantMap {
 *     'drawer': true;
 *   }
 * }
 * ```
 */
export { Dialog } from "./Dialog.js";
export { DialogHeader } from "./DialogHeader.js";
export { useImperativeDialog } from "./useImperativeDialog.js";