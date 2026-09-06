// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports from TabList component files
 * @output Exports TabList, Tab, TabMenu and their types
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * SYNC: When modified, update this header and /packages/core/src/TabList/TabList.doc.mjs
 */
export { TabList } from "./TabList.js";
export { Tab } from "./Tab.js";
export { TabMenu } from "./TabMenu.js";
export { useTabListContext } from "./TabListContext.js";