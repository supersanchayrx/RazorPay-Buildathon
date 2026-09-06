// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useTreeFocus.ts
 * @input Uses React useCallback, useRef, useIsomorphicLayoutEffect, isRtlElement
 * @output Exports useTreeFocus hook for WAI-ARIA tree keyboard navigation
 * @position Core hook; used by TreeList for roving tabindex + APG tree keyboard model
 *
 * SYNC: When modified, update:
 * - /packages/core/src/hooks/index.ts
 * - /packages/core/src/hooks/useTreeFocus.doc.mjs
 * - /packages/core/src/hooks/useTreeFocus.test.tsx
 */
import { useCallback, useRef } from 'react';
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect.js";
import { isRtlElement } from "./isRtlElement.js";

/** Keys handled by the tree keyboard model (used to gate typeahead). */
const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' ']);

/** Default reset delay for the typeahead buffer. */
const DEFAULT_TYPEAHEAD_RESET_MS = 500;

/**
 * Configuration for tree focus behavior.
 *
 * The tree keyboard model differs from a linear list (useListFocus): while
 * ArrowUp/ArrowDown/Home/End roam linearly over the *visible* treeitems,
 * ArrowRight/ArrowLeft carry tree semantics (expand/collapse, move to
 * first-child / parent). The hook stays generic by taking callbacks for the
 * tree-specific bits (expansion toggling, activation) — mirroring how
 * useGridFocus takes `isCellFocusable` rather than hardcoding disabled logic.
 */

/**
 * Return type for useTreeFocus hook.
 */

/**
 * Hook for managing roving-tabindex focus + the WAI-ARIA tree keyboard model.
 *
 * A tree is not a linear list: ArrowUp/ArrowDown/Home/End roam linearly over
 * the *visible* treeitems (skipping disabled ones), but ArrowRight/ArrowLeft
 * carry tree semantics. This is why a tree needs its own hook rather than
 * reusing `useListFocus` — the same reason 2D grids get `useGridFocus`.
 *
 * - ArrowDown / ArrowUp: move to next/previous visible treeitem (skip disabled)
 * - ArrowRight: collapsed parent → expand; expanded parent → first child;
 *   leaf → no-op
 * - ArrowLeft: expanded parent → collapse; otherwise → move to parent treeitem
 * - Home / End: first / last visible treeitem
 * - Enter / Space: activate (`onActivate`), falling back to expansion toggle
 * - Printable characters: typeahead to the next matching treeitem
 *
 * The hook is DOM-query based (reads aria-expanded/aria-level and data-*
 * attributes) and stays generic via option callbacks for the tree-specific
 * bits (`onToggleExpand`, `onActivate`, `getLevel`, `isItemDisabled`, …).
 *
 * @example
 * ```
 * const {treeRef, handleKeyDown, handleFocus} = useTreeFocus<HTMLUListElement>({
 *   onToggleExpand: id => toggle(id),
 *   hasRovingTabIndex: true,
 * });
 *
 * <ul ref={treeRef} role="tree" onKeyDown={handleKeyDown} onFocus={handleFocus}>
 *   {items.map(item => <li role="treeitem" tabIndex={-1}>{item.label}</li>)}
 * </ul>
 * ```
 */
export function useTreeFocus(options = {}) {
  const {
    itemSelector = '[role="treeitem"]',
    isItemDisabled,
    getLevel,
    isExpanded,
    isCollapsed,
    getItemId,
    onToggleExpand,
    onActivate,
    typeahead = true,
    typeaheadResetMs = DEFAULT_TYPEAHEAD_RESET_MS,
    onActiveChange,
    hasRovingTabIndex = false
  } = options;
  const treeRef = useRef(null);
  const typeaheadRef = useRef({
    buffer: '',
    timer: null
  });

  /** Visible treeitems in DOM order (collapsed subtrees are not rendered). */
  const getItems = useCallback(() => {
    const root = treeRef.current;
    if (root == null) {
      return [];
    }
    return Array.from(root.querySelectorAll(itemSelector));
  }, [itemSelector]);
  const itemDisabled = useCallback(el => isItemDisabled ? isItemDisabled(el) : el.dataset.treeDisabled != null || el.getAttribute('aria-disabled') === 'true', [isItemDisabled]);
  const levelOf = useCallback(el => getLevel ? getLevel(el) : Number(el.getAttribute('aria-level') ?? '1'), [getLevel]);
  const expandedOf = useCallback(el => isExpanded ? isExpanded(el) : el.getAttribute('aria-expanded') === 'true', [isExpanded]);
  const collapsedOf = useCallback(el => isCollapsed ? isCollapsed(el) : el.getAttribute('aria-expanded') === 'false', [isCollapsed]);
  const idOf = useCallback(el => getItemId ? getItemId(el) : el.dataset.treeId, [getItemId]);

  // --- Roving tabindex ownership (opt-in via `hasRovingTabIndex`) -------------

  /**
   * Set `tabindex` on a treeitem, but only when it differs (avoids redundant
   * DOM writes).
   */
  const setTabIndex = useCallback((el, value) => {
    if (el.getAttribute('tabindex') !== String(value)) {
      el.setAttribute('tabindex', String(value));
    }
  }, []);

  /**
   * Make `target` the sole tabbable treeitem: 0 on it, -1 on every other
   * visible treeitem.
   */
  const moveTabStop = useCallback((items, target) => {
    for (const el of items) {
      setTabIndex(el, el === target ? 0 : -1);
    }
  }, [setTabIndex]);

  /**
   * Repair the roving tab stop: exactly one enabled treeitem is tabbable (0),
   * the rest are -1. Prefer an existing `tabindex="0"` treeitem (so a consumer
   * can seed the active item in its render); otherwise promote the first
   * enabled treeitem.
   */
  const syncTabStops = useCallback(() => {
    const items = getItems();
    const enabled = items.filter(el => !itemDisabled(el));
    if (enabled.length === 0) {
      return;
    }
    const current = enabled.find(el => el.getAttribute('tabindex') === '0');
    moveTabStop(items, current ?? enabled[0]);
  }, [getItems, itemDisabled, moveTabStop]);

  // Keep the tab stop valid across renders (items added/removed, disabled
  // toggled). Runs after every commit but only when roving tabindex is on.
  useIsomorphicLayoutEffect(() => {
    if (hasRovingTabIndex) {
      syncTabStops();
    }
  });

  /** Move focus to a treeitem and notify the active-change listener. */
  const focusItem = useCallback(el => {
    if (el == null) {
      return;
    }
    if (hasRovingTabIndex) {
      moveTabStop(getItems(), el);
    }
    onActiveChange?.(idOf(el));
    el.focus();
  }, [idOf, onActiveChange, hasRovingTabIndex, moveTabStop, getItems]);

  /**
   * Focus the first enabled treeitem from `start`, moving by `dir`. No wrap —
   * a tree's linear roam clamps at the ends.
   */
  const focusEnabledFrom = useCallback((items, start, dir) => {
    for (let i = start; i >= 0 && i < items.length; i += dir) {
      const candidate = items[i];
      if (candidate != null && !itemDisabled(candidate)) {
        focusItem(candidate);
        return;
      }
    }
  }, [itemDisabled, focusItem]);
  const focusFirst = useCallback(() => {
    focusEnabledFrom(getItems(), 0, 1);
  }, [getItems, focusEnabledFrom]);
  const focusLast = useCallback(() => {
    const items = getItems();
    focusEnabledFrom(items, items.length - 1, -1);
  }, [getItems, focusEnabledFrom]);
  const runTypeahead = useCallback((e, items, currentIndex) => {
    const state = typeaheadRef.current;
    if (state.timer != null) {
      clearTimeout(state.timer);
    }
    // "aa" would match nothing; a repeat means "next match" (useTypeahead).
    const char = e.key.toLowerCase();
    const isRepeatSameChar = state.buffer.length > 0 && state.buffer.split('').every(c => c === char);
    state.buffer = isRepeatSameChar ? char : state.buffer + char;
    state.timer = setTimeout(() => {
      typeaheadRef.current.buffer = '';
    }, typeaheadResetMs);
    const query = state.buffer;
    // A longer query is refining, so the current item may still be the match.
    const hasCurrent = currentIndex >= 0;
    const start = hasCurrent ? currentIndex : 0;
    const offset = hasCurrent && query.length === 1 ? 1 : 0;
    const ordered = [...items.slice(start + offset), ...items.slice(0, start + offset)];
    const match = ordered.find(item => !itemDisabled(item) && (item.textContent ?? '').trim().toLowerCase().startsWith(query));
    if (match != null) {
      e.preventDefault();
      focusItem(match);
    }
  }, [typeaheadResetMs, itemDisabled, focusItem]);
  const handleKeyDown = useCallback(e => {
    const items = getItems();
    if (items.length === 0) {
      return;
    }
    const active = document.activeElement;
    // Resolve the treeitem that owns focus: the nearest treeitem ancestor of
    // the active element (never an outer treeitem that merely contains it).
    const activeItem = active instanceof Element ? active.closest('[role="treeitem"]') : null;
    const currentIndex = items.findIndex(item => item === activeItem);
    const current = currentIndex >= 0 ? items[currentIndex] : undefined;

    // Typeahead: printable single characters jump to the next matching item.
    if (typeahead && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && NAVIGATION_KEYS.has(e.key) === false) {
      runTypeahead(e, items, currentIndex);
      return;
    }
    if (!NAVIGATION_KEYS.has(e.key)) {
      return;
    }

    // Under RTL, swap the horizontal arrows to a logical key so the
    // expand/collapse case bodies (written LTR-first) stay unchanged.
    let key = e.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const rtl = isRtlElement(treeRef.current);
      if (rtl) {
        key = key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
      }
    }
    switch (key) {
      case 'ArrowDown':
        {
          e.preventDefault();
          focusEnabledFrom(items, currentIndex < 0 ? 0 : currentIndex + 1, 1);
          break;
        }
      case 'ArrowUp':
        {
          e.preventDefault();
          focusEnabledFrom(items, currentIndex < 0 ? items.length - 1 : currentIndex - 1, -1);
          break;
        }
      case 'ArrowRight':
        {
          if (current == null) {
            break;
          }
          e.preventDefault();
          if (collapsedOf(current)) {
            // Collapsed parent → expand.
            const id = idOf(current);
            if (id != null) {
              onToggleExpand?.(id);
            }
          } else if (expandedOf(current)) {
            // Expanded parent → move to first child.
            const next = items[currentIndex + 1];
            if (next != null && levelOf(next) > levelOf(current)) {
              focusItem(next);
            }
          }
          // Leaf → no-op.
          break;
        }
      case 'ArrowLeft':
        {
          if (current == null) {
            break;
          }
          e.preventDefault();
          if (expandedOf(current)) {
            // Expanded parent → collapse.
            const id = idOf(current);
            if (id != null) {
              onToggleExpand?.(id);
            }
          } else {
            // Otherwise → move to parent treeitem (nearest shallower item
            // scanning upward in visible order).
            const currentLevel = levelOf(current);
            for (let i = currentIndex - 1; i >= 0; i--) {
              const candidate = items[i];
              if (candidate != null && levelOf(candidate) < currentLevel) {
                focusItem(candidate);
                break;
              }
            }
          }
          break;
        }
      case 'Home':
        {
          e.preventDefault();
          focusEnabledFrom(items, 0, 1);
          break;
        }
      case 'End':
        {
          e.preventDefault();
          focusEnabledFrom(items, items.length - 1, -1);
          break;
        }
      case 'Enter':
      case ' ':
        {
          if (current == null || itemDisabled(current)) {
            break;
          }
          e.preventDefault();
          const id = idOf(current);
          // Activate the item: prefer the consumer's onActivate (e.g. click an
          // inner link/button). Fall back to toggling expansion for a parent
          // without its own action.
          const handled = onActivate ? onActivate(current, id) === true : false;
          if (!handled && current.getAttribute('aria-expanded') != null) {
            if (id != null) {
              onToggleExpand?.(id);
            }
          }
          break;
        }
      default:
        break;
    }
  }, [getItems, typeahead, runTypeahead, focusEnabledFrom, focusItem, collapsedOf, expandedOf, idOf, levelOf, itemDisabled, onToggleExpand, onActivate]);

  /**
   * Keep the roving stop pointing at whatever ended up focused (e.g. a click
   * or programmatic focus) so the next Tab behaves correctly. No-op unless
   * roving tabindex is enabled.
   */
  const handleFocus = useCallback(() => {
    if (hasRovingTabIndex) {
      syncTabStops();
    }
  }, [hasRovingTabIndex, syncTabStops]);
  return {
    treeRef,
    handleKeyDown,
    handleFocus,
    focusFirst,
    focusLast
  };
}