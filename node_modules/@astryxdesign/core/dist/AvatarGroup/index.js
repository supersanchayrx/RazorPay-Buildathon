// Copyright (c) Meta Platforms, Inc. and affiliates.
'use client';

/**
 * @file index.ts
 * @input Imports from AvatarGroup.tsx, AvatarGroupOverflow.tsx, AvatarGroupContext.ts
 * @output Exports AvatarGroup, AvatarGroupOverflow, context hook, and types
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * SYNC: When modified, update this header and /packages/core/src/AvatarGroup/AvatarGroup.doc.mjs
 */
export { AvatarGroup } from "./AvatarGroup.js";
export { AvatarGroupOverflow } from "./AvatarGroupOverflow.js";
export { useAvatarGroup } from "./AvatarGroupContext.js";