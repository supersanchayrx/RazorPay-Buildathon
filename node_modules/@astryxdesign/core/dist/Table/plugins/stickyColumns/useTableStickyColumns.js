// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useTableStickyColumns.tsx
 * @input React, StyleX, theme tokens, Table types
 * @output Exports useTableStickyColumns hook and UseTableStickyColumnsConfig type
 * @position Sticky-columns plugin; consumed by Table via plugins prop
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Table/Table.doc.mjs (sticky-columns documentation)
 * - /packages/core/src/Table/index.ts (exports)
 */
import { useCallback, useMemo, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../../../theme/tokens.stylex.js";
import { colorVars, durationVars, easeVars } from "../../../theme/tokens.stylex.js";
import { DEFAULT_MIN_COLUMN_WIDTH } from "../../columnUtils.js";

// =============================================================================
// Config
// =============================================================================

/**
 * Config for {@link useTableStickyColumns}. Provide at least one of
 * `startKeys` / `endKeys` to pin columns.
 *
 * @remarks Every field is optional by design, so `useTableStickyColumns({})`
 * compiles and is an intentional no-op that pins nothing — the hook returns a
 * plugin that passes every cell through untouched. This lets callers compute
 * the config conditionally (e.g. `endKeys: enabled ? ['notes'] : undefined`)
 * without branching on whether to install the plugin at all.
 */

// =============================================================================
// Width helpers
// =============================================================================

/**
 * Resolve a column's pixel width for cumulative offset math. Mirrors the
 * resize plugin's fallback so offsets line up with rendered widths:
 * pixel columns use their value; proportional columns use their declared
 * minWidth (or the default); unknown widths use the default.
 */
function getColumnWidth(col) {
  const w = col.width;
  if (!w) {
    return DEFAULT_MIN_COLUMN_WIDTH;
  }
  if (w.type === 'pixel') {
    return w.value;
  }
  // proportional
  return w.minWidth ?? DEFAULT_MIN_COLUMN_WIDTH;
}

/**
 * Columns pinned to the START edge → cumulative inline offset (px). The pinned
 * block is the contiguous run from column 0 through the last key in `startKeys`
 * (inclusive of any synthetic columns before it). `null` if none / no context.
 */
function computeStartOffsets(columns, startKeys) {
  if (!columns || columns.length === 0 || startKeys.length === 0) {
    return null;
  }
  let lastStickyIndex = -1;
  for (let i = 0; i < columns.length; i++) {
    if (startKeys.includes(columns[i].key)) {
      lastStickyIndex = i;
    }
  }
  if (lastStickyIndex === -1) {
    return null;
  }
  const offsets = new Map();
  let cumulative = 0;
  for (let i = 0; i <= lastStickyIndex; i++) {
    offsets.set(columns[i].key, cumulative);
    cumulative += getColumnWidth(columns[i]);
  }
  return offsets;
}

/**
 * Mirror of {@link computeStartOffsets} for the END edge — contiguous run from
 * the first key in `endKeys` through the last column, offsets accumulating from
 * the end (last column = 0). `null` if none.
 */
function computeEndOffsets(columns, endKeys) {
  if (!columns || columns.length === 0 || endKeys.length === 0) {
    return null;
  }
  let firstStickyIndex = -1;
  for (let i = 0; i < columns.length; i++) {
    if (endKeys.includes(columns[i].key)) {
      firstStickyIndex = i;
      break;
    }
  }
  if (firstStickyIndex === -1) {
    return null;
  }
  const offsets = new Map();
  let cumulative = 0;
  for (let i = columns.length - 1; i >= firstStickyIndex; i--) {
    offsets.set(columns[i].key, cumulative);
    cumulative += getColumnWidth(columns[i]);
  }
  return offsets;
}
/**
 * Resolve how a single column should be pinned given the start/end configs and
 * the full column list. A key (mis)configured on both edges resolves to start.
 * Returns `null` for columns that should not be pinned.
 */
function resolveStickySide(columns, columnKey, startKeys, endKeys) {
  const startOffsets = computeStartOffsets(columns, startKeys);
  if (startOffsets?.has(columnKey)) {
    return {
      edge: 'start',
      offset: startOffsets.get(columnKey) ?? 0
    };
  }
  const endOffsets = computeEndOffsets(columns, endKeys);
  if (endOffsets?.has(columnKey)) {
    return {
      edge: 'end',
      offset: endOffsets.get(columnKey) ?? 0
    };
  }
  return null;
}

// =============================================================================
// Styles
// =============================================================================

// Scroll-state CSS variables set on the scroll container by the layout ref;
// the cell ::after shadows read them so each edge's shadow only shows when
// content is hidden behind it. (A variable, not stylex.when.ancestor, because
// StyleX ancestor selectors are pseudo-class only — not scroll state.)
const SHADOW_VAR_START = '--table-sticky-shadow-start';
const SHADOW_VAR_END = '--table-sticky-shadow-end';
const stickyStyles = {
  cell: {
    kVAEAm: "x7wzq59",
    kWkggS: "x1fd97le",
    kgeoSG: "x1cpjm7i",
    kEoFBp: "x1hmns74",
    kFcpXp: "xxx281p",
    kxmVGU: "xy5mcqj",
    km8f2m: "xkk1bqk",
    kLkRvE: "x1uvfo0n",
    k7KCAZ: "xxcwgru",
    kKXxxB: "x1y1nw7a",
    kqUdNP: "xa5v58t",
    kHypHr: "xx83zyx",
    kVQacm: "x1rea2x4",
    $$css: true
  },
  headerCell: {
    kY2c9j: "xzkaem6",
    $$css: true
  },
  bodyCell: {
    kY2c9j: "x1vjfegm",
    $$css: true
  }
};

// Soft drop shadow over the scrolling region (a standard sticky-column shadow treatment).
// border-collapse tables don't paint box-shadow on cells in Chromium, so it's a
// ::after gradient strip just past the pinned edge (visible thanks to the cell's
// overflow: visible). Opacity is gated by the scroll-state variable above.
const SHADOW_WIDTH = '6px';
const SHADOW_TINT = colorVars['--color-shadow'];
const shadowStyles = {
  start: {
    k5JduY: "x1s928wv",
    kwXMNM: "x1j6awrg",
    k3foIR: "x1m1drc7",
    k8Iv0R: "x1xrz1ek",
    kH8aOt: "x1unh1gc",
    kkgrvl: "xzkji8o",
    kLigFv: "x1qyefdi x1c108yo",
    kloYau: "x2q1x1w",
    kFJxch: "x17s1k9h",
    kypkao: "x1sggmfs",
    kNctxI: "x1ppu1g5 xk7vujl",
    $$css: true
  },
  end: {
    k5JduY: "x1s928wv",
    kwXMNM: "x1j6awrg",
    k3foIR: "x1m1drc7",
    k8Iv0R: "x1xrz1ek",
    kc1e00: "x1iygr5g",
    kkgrvl: "xzkji8o",
    kLigFv: "xvs0bi2 x12ayhd5",
    kloYau: "x2q1x1w",
    kFJxch: "x17s1k9h",
    kypkao: "x1c2idit",
    kNctxI: "xccdyz0 xlptwl5",
    $$css: true
  }
};

// Stable empty default so an unset start/end doesn't allocate a fresh array
// (and bust the memo) on every render.
const EMPTY = [];

// =============================================================================
// Hook
// =============================================================================

export function useTableStickyColumns(config) {
  const {
    startKeys,
    endKeys
  } = config;
  const start = startKeys ?? EMPTY;
  const end = endKeys ?? EMPTY;
  const hasStart = start.length > 0;
  const hasEnd = end.length > 0;

  // Live snapshot of the resolved config, read inside the (memoized) transforms
  // and the scroll-shadow callback. Keeping these in a ref lets the plugin memo
  // be computed once (deps: only the stable scroll-shadow callback) while never
  // reading stale config — consumers typically pass fresh array literals each
  // render, so we never want array identity in the deps.
  const stateRef = useRef({
    start,
    end,
    hasStart,
    hasEnd
  });
  stateRef.current = {
    start,
    end,
    hasStart,
    hasEnd
  };

  // Scroll-aware shadows: toggle CSS variables on the scroll container so each
  // edge's shadow only paints when there is hidden, horizontally-scrolled
  // content behind that edge. Implemented with a callback ref + scroll/resize
  // listeners (synchronizing with the DOM) rather than React state, so
  // scrolling never triggers re-renders.
  const detachRef = useRef(null);
  const attachScrollShadow = useCallback(el => {
    detachRef.current?.();
    detachRef.current = null;
    if (!el) {
      return;
    }
    const update = () => {
      const {
        hasStart: hs,
        hasEnd: he
      } = stateRef.current;
      const maxScroll = el.scrollWidth - el.clientWidth;
      const hasOverflow = maxScroll > 1;
      // RTL-safe scroll position. Spec-compliant browsers report a NEGATIVE
      // scrollLeft under RTL (0 at the inline-start edge, decreasing toward the
      // inline-end edge), so a raw `scrollLeft > 1` start test would never fire
      // and the end test would be wrong-signed. Math.abs collapses both
      // conventions to a distance-from-inline-start, matching the repo's own
      // useScrollOverflow (overflowStart/overflowEnd use Math.abs, tolerance 1).
      // No-op under LTR where scrollLeft is already >= 0.
      const pos = Math.abs(el.scrollLeft);
      if (hs) {
        el.style.setProperty(SHADOW_VAR_START, hasOverflow && pos > 1 ? '1' : '0');
      }
      if (he) {
        el.style.setProperty(SHADOW_VAR_END, hasOverflow && pos < maxScroll - 1 ? '1' : '0');
      }
    };
    el.addEventListener('scroll', update, {
      passive: true
    });
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    resizeObserver?.observe(el);
    update();
    detachRef.current = () => {
      el.removeEventListener('scroll', update);
      resizeObserver?.disconnect();
    };
  }, []);
  return useMemo(() => ({
    transformHeaderCell(props, column) {
      const {
        start: s,
        end: e
      } = stateRef.current;
      const side = resolveStickySide(props.columns, column.key, s, e);
      if (!side) {
        return props;
      }
      // position/inline-offset are runtime values → set via inline style so
      // they are authoritative regardless of plugin composition order (the
      // resize plugin also writes inline style on header cells).
      const offsetStyle = side.edge === 'start' ? {
        insetInlineStart: `${side.offset}px`
      } : {
        insetInlineEnd: `${side.offset}px`
      };
      return {
        ...props,
        htmlProps: {
          ...props.htmlProps,
          style: {
            ...props.htmlProps.style,
            ...offsetStyle
          }
        },
        xstyle: [...props.xstyle, stickyStyles.cell, stickyStyles.headerCell, side.edge === 'start' ? shadowStyles.start : shadowStyles.end]
      };
    },
    transformBodyCell(props, column) {
      const {
        start: s,
        end: e
      } = stateRef.current;
      const side = resolveStickySide(props.columns, column.key, s, e);
      if (!side) {
        return props;
      }
      const offsetStyle = side.edge === 'start' ? {
        insetInlineStart: `${side.offset}px`
      } : {
        insetInlineEnd: `${side.offset}px`
      };
      return {
        ...props,
        htmlProps: {
          ...props.htmlProps,
          style: {
            ...props.htmlProps.style,
            ...offsetStyle
          }
        },
        xstyle: [...props.xstyle, stickyStyles.cell, stickyStyles.bodyCell, side.edge === 'start' ? shadowStyles.start : shadowStyles.end]
      };
    },
    transformScrollWrapper(props) {
      // No pinned edges → nothing to gate; leave the wrapper untouched.
      if (!stateRef.current.hasStart && !stateRef.current.hasEnd) {
        return props;
      }
      // Compose with any ref a prior plugin (e.g. virtualization) set on the
      // scroll container.
      const existingRef = props.htmlProps.ref;
      const mergedRef = node => {
        attachScrollShadow(node);
        if (typeof existingRef === 'function') {
          existingRef(node);
        } else if (existingRef != null) {
          // RefObject — assign through its writable `.current`.
          existingRef.current = node;
        }
      };
      return {
        ...props,
        htmlProps: {
          ...props.htmlProps,
          ref: mergedRef
        }
      };
    }
  }),
  // The returned plugin's transforms read live config from `stateRef` and
  // `attachScrollShadow` is stable (empty deps), so the plugin object can be
  // computed once and reused across renders.
  [attachScrollShadow]);
}