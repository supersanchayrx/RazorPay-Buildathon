// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file anchorName.ts
 * @input HTMLElement with CSS anchor-name property
 * @output Helpers for managing comma-separated anchor-name lists
 * @position Utility; used by useLayer for multi-anchor support
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Layer/useLayer.tsx (imports from here)
 */

/**
 * CSS `anchor-name` is a comma-separated list, so multiple layers can anchor to
 * the same element (e.g. several TopNavMegaMenus anchored to one <nav>). These
 * helpers add/remove a single layer's anchor id without clobbering the others —
 * overwriting the whole property would break every sibling layer's positioning.
 */

export function readAnchorNames(el) {
  const value = el.style.anchorName ?? '';
  return value.split(',').map(name => name.trim()).filter(Boolean);
}
export function writeAnchorNames(el, names) {
  el.style.anchorName = names.join(', ');
}
export function addAnchorName(el, name) {
  const names = readAnchorNames(el);
  if (!names.includes(name)) {
    names.push(name);
    writeAnchorNames(el, names);
  }
}
export function removeAnchorName(el, name) {
  writeAnchorNames(el, readAnchorNames(el).filter(existing => existing !== name));
}