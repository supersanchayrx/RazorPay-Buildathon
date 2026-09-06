// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Wheel.tsx
 * @input Option list, selected value, change callback
 * @output Exports Wheel — a snap-scrolling picker column
 * @position Internal component; consumed by MonthYearWheels.tsx
 *
 * A wheel is a scroll container, not a custom gesture surface. Momentum,
 * rubber-banding, and the settle animation are the platform's; all this adds
 * is `scroll-snap-align: center` on each option, half a viewport of padding at
 * each end so the first and last option can reach the middle, and a commit
 * when the scrolling stops.
 *
 * The falloff (rows fading and tipping away from the centre) is a CSS
 * scroll-driven animation on a `view()` timeline — the browser interpolates it
 * against each row's own position in the scrollport, so it stays glued to the
 * finger with no JS in the frame loop. It is guarded by `@supports`, because a
 * browser that does not understand `animation-timeline` would otherwise run
 * the same keyframes on the document timeline and simply play them once.
 *
 * Accessibility: this is a listbox, not a novel widget. It is one tab stop
 * with arrow/Home/End/PageUp/PageDown keys, `aria-activedescendant` tracking
 * the active row, and every row reachable by tap — none of which depends on
 * the scroll-driven decoration.
 *
 * SYNC: When modified, update:
 * - /packages/core/src/DateInput/TouchDateField.tsx
 * - /packages/core/src/DateTimeInput/TouchDateTimeField.tsx
 * - /packages/core/src/DateInput/DateInput.doc.mjs
 * - /packages/core/src/DateInput/DateInputTouch.test.tsx
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, radiusVars, fontWeightVars, typeScaleVars, spacingVars, durationVars } from "../theme/tokens.stylex.js";
import { focusOutlineStyles } from "../utils/index.js";
import "./tokens.stylex.js";
import { dateInputTouchSizes, dateInputTouchGeometry } from "./tokens.stylex.js";
import { useOwnScrollGesture } from "./useOwnScrollGesture.js";
import { usePointerDragScroll } from "./usePointerDragScroll.js";
import { useScrollSettle } from "./useScrollSettle.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const ITEM_BLOCK_SIZE = dateInputTouchSizes.wheelItemSize;

/**
 * Rows tip away from the centre of the wheel. 0% is a row just entering at the
 * bottom of the scrollport, 50% is a row centred in it, 100% is a row leaving
 * at the top — which is what a `view()` timeline over the `cover` range means,
 * and why this reads as a cylinder rotating under the finger.
 */
const falloff = "x1tut0r7-B";

/** Motion-free equivalent: the depth cue survives as opacity alone. */
const fadeOnly = "xuvekqa-B";
const styles = {
  scroller: {
    kZKoxP: "xm8gem",
    kB7OPa: "x9f619",
    kORKVm: "x1odjw0f",
    kXHlph: "x6ikm8r",
    kc424l: "x168l2et",
    kZeWKH: "xish69e",
    k8WAf4: "x1uameg1",
    kwFjlL: "x201tam",
    kmaZ5I: "x1oyok0e",
    k5wCbM: "x1rohswg",
    kI3sdo: "x1a2a7pz",
    kFalU9: "xx69xxh",
    $$css: true
  }
};
/**
 * One snap-scrolling picker column.
 *
 * @example
 * ```
 * <Wheel
 *   label="Month"
 *   options={monthOptions}
 *   value={month}
 *   onChange={setMonth}
 * />
 * ```
 */
export function Wheel({
  label,
  options,
  value,
  onChange,
  isActive = true
}) {
  const id = useId();
  const scrollerRef = useRef(null);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  // Which row is under the band right now. Tracks the finger during a scroll;
  // `selectedIndex` only catches up when the wheel settles.
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  // Row height in px, read from layout rather than assumed, so a theme that
  // retunes --date-input-touch-wheel-item-size still lands on the right row.
  const itemBlockSize = useCallback(() => {
    const first = scrollerRef.current?.firstElementChild;
    return first instanceof HTMLElement && first.offsetHeight > 0 ? first.offsetHeight : 0;
  }, []);
  const scrollToIndex = useCallback((index, behavior) => {
    const scroller = scrollerRef.current;
    const size = itemBlockSize();
    if (scroller == null || size === 0) {
      return;
    }
    scroller.scrollTo({
      top: index * size,
      behavior
    });
  }, [itemBlockSize]);

  // Commit on rest. A disabled row is bounced back to the committed one
  // rather than silently keeping a value the wheel is not showing.
  //
  // Declared here, above the park effect, because that effect consults the
  // `isAtRestRef` this returns before it repositions anything.
  const {
    isAtRestRef
  } = useScrollSettle(scrollerRef, scroller => {
    const size = itemBlockSize();
    if (size === 0) {
      return;
    }
    const index = Math.min(options.length - 1, Math.max(0, Math.round(scroller.scrollTop / size)));
    const option = options[index];
    if (option == null || option.isDisabled) {
      scrollToIndex(selectedIndex, 'smooth');
      return;
    }
    if (option.value !== value) {
      onChange(option.value);
    }
  }, isActive);

  // Park the committed row under the band whenever the wheel is shown, or the
  // value is changed from outside (the calendar scrolled to another month).
  //
  // NEVER while the wheel is still moving. A scroller that is mid-gesture or
  // still carrying momentum is the user's, and repositioning it does not stop
  // the momentum — on iOS it feeds a cycle where the scroll this causes reads
  // as a new settle, commits the next row along, and parks again. See
  // useScrollSettle. The settle handler re-checks the position afterwards, so
  // a correction that is genuinely needed still happens, just at rest.
  useEffect(() => {
    if (!isActive || !isAtRestRef.current) {
      return;
    }
    const size = itemBlockSize();
    const scroller = scrollerRef.current;
    if (scroller == null || size === 0) {
      return;
    }
    if (Math.round(scroller.scrollTop / size) !== selectedIndex) {
      scroller.scrollTo({
        top: selectedIndex * size,
        behavior: 'auto'
      });
    }
    // eslint-disable-next-line @eslint-react/set-state-in-effect -- the highlight follows a scroll position, which only exists after layout
    setActiveIndex(selectedIndex);
  }, [isActive, selectedIndex, itemBlockSize, isAtRestRef]);

  // Highlight follows the finger. rAF-throttled: a scroll can fire far more
  // often than the display refreshes, and this only feeds a repaint.
  const frameRef = useRef(undefined);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller == null || !isActive) {
      return;
    }
    const onScroll = () => {
      if (frameRef.current != null) {
        return;
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = undefined;
        const size = itemBlockSize();
        if (size === 0) {
          return;
        }
        const index = Math.min(options.length - 1, Math.max(0, Math.round(scroller.scrollTop / size)));
        setActiveIndex(index);
      });
    };
    scroller.addEventListener('scroll', onScroll, {
      passive: true
    });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
    };
  }, [isActive, options.length, itemBlockSize]);

  // Keep the finger. Inside a BottomSheet the sheet would otherwise read a
  // downward drag here as swipe-to-dismiss; see useOwnScrollGesture. Gated on
  // isActive because the hidden panel keeps its layout box.
  // 'all': a wheel scrolls vertically, the same axis the sheet wants, so
  // there is no way to share — it takes every touch that lands on it.
  useOwnScrollGesture(scrollerRef, 'all', {
    isEnabled: isActive
  });

  // A mouse cannot drag a scroll container, so without this the wheel ignores
  // the one gesture its shape invites. Touch is untouched — it pans natively,
  // with momentum this could not match. See usePointerDragScroll.
  usePointerDragScroll(scrollerRef, isActive);
  const moveBy = useCallback(delta => {
    const next = Math.min(options.length - 1, Math.max(0, activeIndex + delta));
    const option = options[next];
    if (option == null || option.isDisabled) {
      return;
    }
    setActiveIndex(next);
    scrollToIndex(next, 'smooth');
    if (option.value !== value) {
      onChange(option.value);
    }
  }, [activeIndex, options, scrollToIndex, value, onChange]);
  const handleKeyDown = useCallback(event => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveBy(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveBy(-1);
        break;
      case 'PageDown':
        event.preventDefault();
        moveBy(10);
        break;
      case 'PageUp':
        event.preventDefault();
        moveBy(-10);
        break;
      case 'Home':
        event.preventDefault();
        moveBy(-activeIndex);
        break;
      case 'End':
        event.preventDefault();
        moveBy(options.length - 1 - activeIndex);
        break;
      default:
        break;
    }
  }, [moveBy, activeIndex, options.length]);
  return /*#__PURE__*/_jsxs("div", {
    ...{
      className: "x1n2onr6 x1cqoux5 xeuugli"
    },
    children: [/*#__PURE__*/_jsx("div", {
      "aria-hidden": "true",
      ...{
        className: "x10l6tqk x17y0mx6 x7rbydg x6hpsvf xh6dtrn x17x4s8c x47corl"
      }
    }), /*#__PURE__*/_jsx("div", {
      ref: scrollerRef,
      role: "listbox",
      "aria-label": label,
      "aria-activedescendant": `${id}-${options[activeIndex]?.value}`,
      tabIndex: 0,
      onKeyDown: handleKeyDown,
      ...stylex.props(styles.scroller, focusOutlineStyles.focusVisible),
      children: options.map((option, index) => /*#__PURE__*/_jsx("div", {
        id: `${id}-${option.value}`,
        role: "option",
        "aria-selected": option.value === value,
        "aria-disabled": option.isDisabled || undefined,
        onClick: () => {
          if (option.isDisabled) {
            return;
          }
          setActiveIndex(index);
          scrollToIndex(index, 'smooth');
          if (option.value !== value) {
            onChange(option.value);
          }
        },
        ...{
          0: {
            className: "x78zum5 x6s0dn4 xl56j7k x6hpsvf xf314gf x1hdbdi8 xc342km xng3xce xjbqb8w x18juvz8 x1sodnla x1tgivj0 xuxw1ft x1ypdohk x16khyan x87ps6o x1jbe559 xuedmi6"
          },
          2: {
            className: "x78zum5 x6s0dn4 xl56j7k x6hpsvf xf314gf x1hdbdi8 xc342km xng3xce xjbqb8w x18juvz8 xuxw1ft x1ypdohk x16khyan x87ps6o x1jbe559 xuedmi6 xjse4m1 x2mo6ok"
          },
          1: {
            className: "x78zum5 x6s0dn4 xl56j7k x6hpsvf xf314gf x1hdbdi8 xc342km xng3xce xjbqb8w x18juvz8 x1sodnla xuxw1ft x87ps6o x1jbe559 xuedmi6 xnbbluu xt0e3qv"
          },
          3: {
            className: "x78zum5 x6s0dn4 xl56j7k x6hpsvf xf314gf x1hdbdi8 xc342km xng3xce xjbqb8w x18juvz8 xuxw1ft x87ps6o x1jbe559 xuedmi6 x2mo6ok xnbbluu xt0e3qv"
          }
        }[!!(index === activeIndex) << 1 | !!option.isDisabled << 0],
        children: /*#__PURE__*/_jsx("span", {
          ...{
            className: "x78zum5 x6s0dn4 xl56j7k xh8yej3 x5yr21d xb3r6kr xlyipyv x1iu2jvn xk3h8ob x190lv1 xg8s4dl x1u6ievf xwms9i0 x1esw782 xlp1x4z"
          },
          children: option.label
        })
      }, option.value))
    })]
  });
}
Wheel.displayName = 'Wheel';