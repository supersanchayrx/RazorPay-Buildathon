// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports from CodeBlock.tsx, Code.tsx, tokenizer.ts, highlightRanges.ts, highlightStyles.ts
 * @output Exports CodeBlock, Code components, tokenizer utilities, and highlight APIs
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * SYNC: When modified, update /packages/core/src/CodeBlock/CodeBlock.doc.mjs
 */
export { CodeBlock } from "./CodeBlock.js";
export { Code } from "../Code/index.js";
export { tokenize, tokenizeAsync, tokenizeStreaming, flatTokensToLines, SYNC_TOKENIZE_THRESHOLD } from "./tokenizer.js";
export { applyHighlightRangesChunked, applyHighlightRangesBatch, applyHighlightRangesFlat, cleanupRanges } from "./highlightRanges.js";
export { ensureHighlightStyles, TOKEN_TYPES } from "./highlightStyles.js";