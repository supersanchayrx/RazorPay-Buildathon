// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file index.ts
 * @input Imports stack components
 * @output Exports Stack, HStack, VStack, StackItem components
 * @position Entry point for Layout/Stack
 *
 * SYNC: When modified, update /packages/core/src/Stack/Stack.doc.mjs
 */

// Unified stack component
export { Stack } from "./Stack.js";
// Convenience wrappers (re-exported from their own directories)
export { HStack } from "../HStack/index.js";
export { VStack } from "../VStack/index.js";
export { StackItem } from "./StackItem.js";