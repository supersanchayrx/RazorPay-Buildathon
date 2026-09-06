// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports Link, LinkProvider, useLinkComponent, types
 * @output Exports all public Link components, hooks, and types
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * SYNC: When modified, update this header and /packages/core/src/Link/Link.doc.mjs
 */
export { Link } from "./Link.js";
export { LinkProvider } from "./LinkProvider.js";
export { useLinkComponent } from "./useLinkComponent.js";
export { useLinkify } from "./useLinkify.js";