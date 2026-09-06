// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file index.ts
 * @input Imports Card component
 * @output Exports Card, CardProps, CardVariant, CardVariantMap
 * @position Entry point for @astryxdesign/core/Card module
 *
 * SYNC: When modified, update /packages/core/src/Card/Card.doc.mjs
 */

/**
 * Extensible variant map for Card.
 *
 * Theme packages can add custom variants via TypeScript module augmentation:
 * @example
 * ```
 * declare module '@astryxdesign/core/Card' {
 *   interface CardVariantMap {
 *     'brand': true;
 *   }
 * }
 * ```
 *
 * Pair the theme rule's `backgroundColor` with `--selectable-card-ring-color`.
 * SelectableCard rings an added variant in that var, defaulting to the accent —
 * no token the component could pick is guaranteed to contrast with a fill it
 * cannot know, so the theme that supplied the fill picks the ring, in the same
 * rule.
 */

export { Card } from "./Card.js";