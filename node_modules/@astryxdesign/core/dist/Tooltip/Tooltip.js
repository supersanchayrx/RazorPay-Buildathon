// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Tooltip.tsx
 * @input Uses React, useTooltip hook
 * @output Exports Tooltip component for hover/focus triggered tooltips
 * @position Layer component; uses display:contents wrapper to avoid cloneElement
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Tooltip/index.ts
 * - /apps/storybook/stories/Tooltip.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Tooltip/ (showcase blocks)
 */
import React, { useCallback, useRef } from 'react';
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect.js";
import * as stylex from '@stylexjs/stylex';
import { useTooltip } from "./useTooltip.js";
import "../theme/tokens.stylex.js";
import { colorVars } from "../theme/tokens.stylex.js";
import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Check if children are text-only (no React elements)
 */
function isTextOnly(children) {
  return typeof children === 'string' || typeof children === 'number';
}

/**
 * Utility to merge ARIA ID strings
 */
function mergeIds(...ids) {
  const filtered = ids.filter(Boolean);
  return filtered.length > 0 ? filtered.join(' ') : undefined;
}

/**
 * Tooltip component for displaying informative text on hover/focus.
 *
 * Uses inverted colors (dark background, light text) for high contrast.
 * Uses a display:contents wrapper so children refs are preserved.
 * Uses CSS anchor positioning and the Popover API for optimal performance.
 *
 * @example
 * ```
 * <Tooltip content="Helpful tooltip text" placement="above">
 *   <Button>Hover me</Button>
 * </Tooltip>
 * ```
 */
export function Tooltip({
  children,
  anchorRef,
  content,
  placement = 'above',
  alignment = 'center',
  delay = 200,
  hideDelay = 0,
  focusTrigger = 'auto',
  touchTrigger = 'auto',
  isEnabled = true,
  onOpenChange,
  hasHoverIndication = 'auto',
  isOpen,
  isDefaultOpen
}) {
  const wrapperRef = useRef(null);
  const textOnly = children != null ? isTextOnly(children) : false;

  // Determine if hover indication should be shown
  const showHoverIndication = hasHoverIndication === true || hasHoverIndication === 'auto' && textOnly;
  const handleShow = useCallback(() => {
    onOpenChange?.(true);
  }, [onOpenChange]);
  const handleHide = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  // Use the hook for all tooltip behavior
  const tooltip = useTooltip({
    placement,
    alignment,
    delay,
    hideDelay,
    focusTrigger,
    touchTrigger,
    isEnabled,
    isOpen,
    isDefaultOpen,
    onShow: handleShow,
    onHide: handleHide
  });

  // Sibling mode: attach to external anchorRef
  useIsomorphicLayoutEffect(() => {
    if (!anchorRef) {
      return;
    }
    const el = anchorRef.current;
    if (!el) {
      return;
    }

    // Use combined ref for position + interaction
    tooltip.ref(el);

    // Set aria-describedby, merging with existing
    const existingDescribedBy = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', mergeIds(existingDescribedBy, tooltip.describedBy) ?? '');
    return () => {
      tooltip.ref(null);
      if (existingDescribedBy) {
        el.setAttribute('aria-describedby', existingDescribedBy);
      } else {
        el.removeAttribute('aria-describedby');
      }
    };
  }, [anchorRef, tooltip.ref, tooltip.describedBy]);

  // For element children with display:contents, attach ref to first child
  useIsomorphicLayoutEffect(() => {
    if (anchorRef) {
      return;
    } // Skip if using anchorRef mode
    if (textOnly) {
      return;
    } // Skip for text-only (ref is on wrapper)

    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const firstChild = wrapper.firstElementChild;
    if (!firstChild) {
      return;
    }

    // Use combined ref for position + interaction
    tooltip.ref(firstChild);

    // Set aria-describedby, merging with existing
    const existingDescribedBy = firstChild.getAttribute('aria-describedby');
    firstChild.setAttribute('aria-describedby', mergeIds(existingDescribedBy, tooltip.describedBy) ?? '');
    return () => {
      tooltip.ref(null);
      if (existingDescribedBy) {
        firstChild.setAttribute('aria-describedby', existingDescribedBy);
      } else {
        firstChild.removeAttribute('aria-describedby');
      }
    };
  }, [anchorRef, textOnly, tooltip.ref, tooltip.describedBy]);

  // Sibling mode: render only the tooltip (no wrapper needed)
  if (anchorRef && children == null) {
    return /*#__PURE__*/_jsx(_Fragment, {
      children: tooltip.renderTooltip(content)
    });
  }

  // For text-only children: use inline span with ref on wrapper
  if (textOnly) {
    return /*#__PURE__*/_jsxs(_Fragment, {
      children: [/*#__PURE__*/_jsx("span", {
        ref: tooltip.ref,
        tabIndex: 0,
        "aria-describedby": tooltip.describedBy,
        ...{
          0: {
            className: "xt0psk2"
          },
          1: {
            className: "xt0psk2 xujl8zx xev0dqp xycaml9 xrys4gj"
          }
        }[!!showHoverIndication << 0],
        children: children
      }), tooltip.renderTooltip(content)]
    });
  }

  // For element children: use display:contents, ref on first child
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [/*#__PURE__*/_jsx("div", {
      ref: wrapperRef,
      ...{
        className: "xjp7ctv"
      },
      children: children
    }), tooltip.renderTooltip(content)]
  });
}
Tooltip.displayName = 'Tooltip';