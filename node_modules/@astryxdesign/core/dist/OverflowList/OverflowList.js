// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file OverflowList.tsx
 * @input Uses React, StyleX, useOverflow hook
 * @output Exports OverflowList component and OverflowListProps type
 * @position Core implementation; consumed by index.ts
 *
 * Renders a horizontal list of items, hiding those that don't fit in the
 * available width and optionally showing an overflow indicator. Supports an
 * optional item cap (`maxVisibleItems`) and bounded multi-row wrapping
 * (`maxRows`). Uses a hidden measurement container to avoid flickering.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/OverflowList/index.ts (exports if types change)
 * - /packages/cli/assets/templates/blocks/components/OverflowList/ (showcase blocks)
 */
import { Children, useCallback, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { mergeProps } from "../utils/index.js";
import { useOverflow } from "../hooks/useOverflow.js";
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect.js";
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import { themeProps } from "../utils/themeProps.js";
import { useMergedRefs } from "../hooks/useMergedRefs.js";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
const styles = {
  container: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kVQacm: "xb3r6kr",
    khDVqt: "xuxw1ft",
    k7Eaqz: "xeuugli",
    $$css: true
  },
  containerMultiRow: {
    k1xSpc: "x78zum5",
    kwnvtZ: "x1a02dak",
    kfiyM8: "x8gbvx8",
    kVQacm: "xb3r6kr",
    khDVqt: "xeaf4i8",
    k7Eaqz: "xeuugli",
    $$css: true
  },
  fillParent: {
    kzqmXN: "xh8yej3",
    $$css: true
  },
  measureContainer: {
    kVAEAm: "x10l6tqk",
    k33iCy: "xlshs6z",
    kZKoxP: "xqtp20y",
    kVQacm: "xb3r6kr",
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    khDVqt: "xuxw1ft",
    kfzvcC: "x47corl",
    $$css: true
  }
};
const _temp = {
  kskxy: "x1jols5v",
  "$$css": true
};
const multiRowHeight = {
  height: (maxRows, rowHeight, gapPx) => [_temp, {
    "--x-maxHeight": (val => typeof val === "number" ? val + "px" : val != null ? val : undefined)(`calc(${rowHeight}px * ${maxRows} + ${gapPx}px * ${maxRows - 1})`)
  }]
};
const gapStyles = {
  "0": {
    kOIVth: "xsn7fz1",
    $$css: true
  },
  "1": {
    kOIVth: "xzye2dw",
    $$css: true
  },
  "2": {
    kOIVth: "x1txdalj",
    $$css: true
  },
  "3": {
    kOIVth: "xjcht0a",
    $$css: true
  },
  "4": {
    kOIVth: "x18g69wz",
    $$css: true
  },
  "5": {
    kOIVth: "x9mgr7n",
    $$css: true
  },
  "6": {
    kOIVth: "x1qh66ti",
    $$css: true
  },
  "8": {
    kOIVth: "x4t41sb",
    $$css: true
  },
  "10": {
    kOIVth: "x3hoi3v",
    $$css: true
  },
  "0.5": {
    kOIVth: "x1lsbc85",
    $$css: true
  },
  "1.5": {
    kOIVth: "x1s4dlld",
    $$css: true
  }
};

/**
 * Maps spacing token steps to pixel values for overflow calculations.
 */
const spacingToPx = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40
};
/**
 * A horizontal list that hides items that don't fit and shows an overflow indicator.
 *
 * Uses a hidden measurement container to determine which items fit without
 * causing visual flickering. The overflow indicator is also measured
 * automatically so no manual width value is needed.
 *
 * @example
 * ```
 * <OverflowList
 *   gap={2}
 *   overflowRenderer={(items) => (
 *     <Button label={`+${items.length} more`} variant="ghost" />
 *   )}>
 *   <Button label="Action 1" />
 *   <Button label="Action 2" />
 *   <Button label="Action 3" />
 *   <Button label="Action 4" />
 * </OverflowList>
 * ```
 */
export function OverflowList({
  children,
  gap = 2,
  minVisibleItems = 0,
  maxVisibleItems,
  maxRows,
  collapseFrom = 'end',
  behavior = 'observeSelf',
  overflowRenderer,
  onOverflowChange,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  const childArray = Children.toArray(children);
  const itemCount = childArray.length;
  const gapPx = spacingToPx[gap];
  const observeParent = behavior === 'observeParent';
  const isMultiRow = maxRows != null && maxRows > 1;
  const {
    containerRef,
    measureRef,
    visibleCount,
    hasOverflow,
    rowHeight
  } = useOverflow(itemCount, {
    gap: gapPx,
    minVisibleItems,
    maxVisibleItems,
    maxRows,
    collapseFrom,
    behavior
  });
  const allItems = childArray.map((child, index) => ({
    child,
    index
  }));
  let visibleItems;
  let overflowItems;
  if (collapseFrom === 'end') {
    visibleItems = allItems.slice(0, visibleCount);
    overflowItems = allItems.slice(visibleCount);
  } else {
    visibleItems = allItems.slice(itemCount - visibleCount);
    overflowItems = allItems.slice(0, itemCount - visibleCount);
  }

  // Render a placeholder for measurement — uses all items as overflow
  // so the indicator renders at its maximum possible width.
  const measureIndicator = overflowRenderer?.(allItems);

  // Re-run measurement when keyed children change without resizing the row.
  // The measured key delays reporting until that measurement has committed.
  // Lists without the callback skip all identity work.
  const measurementKey = onOverflowChange ? JSON.stringify({
    children: childArray.map((child, index) => [index, child.key]),
    gap,
    minVisibleItems,
    maxVisibleItems,
    maxRows,
    collapseFrom,
    behavior
  }) : '';
  const [measuredKey, setMeasuredKey] = useState(measurementKey);
  const reportMeasureRef = useCallback(element => {
    measureRef(element);
    if (element) {
      setMeasuredKey(measurementKey);
    }
  }, [measureRef, measurementKey]);

  // Report after measurement, before paint, so a standing menu updates in the
  // same frame as the visible row. Keys distinguish membership and order while
  // suppressing callback-only or unrelated re-renders. The initial empty key
  // suppresses the optimistic pre-measurement render.
  const overflowKey = onOverflowChange ? JSON.stringify(overflowItems.map(({
    child,
    index
  }) => [index, child.key])) : '[]';
  const reportedKeyRef = useRef('[]');
  const overflowItemsRef = useRef(overflowItems);
  overflowItemsRef.current = overflowItems;
  useIsomorphicLayoutEffect(() => {
    if (!onOverflowChange || measuredKey !== measurementKey || reportedKeyRef.current === overflowKey) {
      return;
    }
    reportedKeyRef.current = overflowKey;
    onOverflowChange(overflowItemsRef.current);
  }, [measuredKey, measurementKey, overflowKey, onOverflowChange]);
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [/*#__PURE__*/_jsxs("div", {
      ref: reportMeasureRef,
      "aria-hidden": "true",
      inert: true,
      ...stylex.props(styles.measureContainer, gapStyles[gap]),
      children: [childArray, measureIndicator != null && /*#__PURE__*/_jsx("div", {
        ...{
          className: "x3nfvp2"
        },
        children: measureIndicator
      })]
    }), /*#__PURE__*/_jsxs("div", {
      ref: useMergedRefs(ref, containerRef),
      ...mergeProps(themeProps('overflow-list'), stylex.props(isMultiRow ? styles.containerMultiRow : styles.container, gapStyles[gap], isMultiRow && rowHeight > 0 && maxRows != null && multiRowHeight.height(maxRows, rowHeight, gapPx), observeParent && hasOverflow && styles.fillParent, xstyle), className, style),
      ...props,
      children: [collapseFrom === 'start' && hasOverflow && overflowRenderer?.(overflowItems), visibleItems.map(({
        child
      }) => child), collapseFrom === 'end' && hasOverflow && overflowRenderer?.(overflowItems)]
    })]
  });
}
OverflowList.displayName = 'OverflowList';