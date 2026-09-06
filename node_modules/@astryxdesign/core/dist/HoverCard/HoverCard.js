// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file HoverCard.tsx
 * @input Uses React, useHoverCard hook
 * @output Exports HoverCard component for hover/focus triggered layers
 * @position Layer component; inline-safe trigger wrapper, floating layer hosted by useLayer
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/HoverCard/HoverCard.test.tsx
 * - /packages/core/src/HoverCard/index.ts
 * - /apps/storybook/stories/HoverCard.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/HoverCard/ (showcase blocks)
 */
import { useCallback, useRef } from 'react';
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect.js";
import * as stylex from '@stylexjs/stylex';
import { useHoverCard } from "./useHoverCard.js";
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars } from "../theme/tokens.stylex.js";
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// `aria-haspopup` and `aria-controls` are global, so any trigger may carry
// them. `aria-expanded` is not. This is the ARIA 1.2 "Supported States and
// Properties" list for it — deliberately the narrow reading: axe accepts the
// attribute on rather more roles, since it also allows every subclass of these,
// so a role outside this set is not necessarily a violation. Widening it is
// safe; the set is a floor, not the spec's ceiling. The same rule is applied in
// Chat/useTriggerMenu.tsx, which only emits the combobox attributes once the
// element is actually a combobox.
const EXPANDABLE_ROLES = new Set(['application', 'button', 'checkbox', 'columnheader', 'combobox', 'gridcell', 'link', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'row', 'rowheader', 'switch', 'tab', 'treeitem']);
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);

// Deliberately partial, and unlisted elements are read as role-less: dropping
// aria-expanded where it might have been legal costs an AT user a state they
// can still infer, whereas emitting it where it is illegal is a critical
// aria-allowed-attr defect.
function supportsAriaExpanded(el) {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) {
    return EXPANDABLE_ROLES.has(explicit);
  }
  switch (el.tagName) {
    case 'BUTTON':
    case 'SUMMARY':
      return true;
    case 'A':
    case 'AREA':
      return el.hasAttribute('href');
    case 'INPUT':
      // The button-flavoured input types map to role="button"; every other
      // type maps to a textbox-family role, which does not take it.
      return BUTTON_INPUT_TYPES.has(el.type?.toLowerCase());
    case 'SELECT':
      // combobox when it is a single-line picker, listbox otherwise; both
      // support aria-expanded.
      return true;
    default:
      return false;
  }
}
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
 * HoverCard component for displaying interactive content on hover/focus.
 *
 * Uses a display:contents wrapper so children refs are preserved.
 * Uses CSS anchor positioning and the Popover API for optimal performance.
 *
 * @example
 * ```
 * <HoverCard
 *   content={<ProfileCard user={user} />}
 *   placement="above">
 *   <Button>Hover me</Button>
 * </HoverCard>
 * ```
 */
export function HoverCard({
  children,
  content,
  placement = 'above',
  alignment = 'center',
  delay = 300,
  hideDelay = 200,
  focusTrigger = 'auto',
  touchTrigger = 'auto',
  isEnabled = true,
  label,
  onOpenChange,
  hasHoverIndication = 'auto',
  isOpen,
  isDefaultOpen,
  xstyle,
  className,
  style
}) {
  const wrapperRef = useRef(null);
  const textOnly = isTextOnly(children);

  // Determine if hover indication should be shown
  const showHoverIndication = hasHoverIndication === true || hasHoverIndication === 'auto' && textOnly;
  const handleShow = useCallback(() => {
    onOpenChange?.(true);
  }, [onOpenChange]);
  const handleHide = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  // Use the hook for all hover card behavior
  const hoverCard = useHoverCard({
    placement,
    alignment,
    delay,
    hideDelay,
    focusTrigger,
    touchTrigger,
    isEnabled,
    label,
    isOpen,
    isDefaultOpen,
    onShow: handleShow,
    onHide: handleHide
  });

  // For element children with display:contents, attach ref to first child
  useIsomorphicLayoutEffect(() => {
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
    hoverCard.ref(firstChild);
    if (label) {
      // When named, the hover card is a dialog. The trigger should advertise the
      // popup relationship with aria-haspopup/aria-expanded, not describe the
      // trigger with the dialog's content (aria-describedby is for plain-text
      // descriptions, not navigable regions). See #5049.
      //
      // aria-expanded only goes on a trigger whose role permits it. A role-less
      // trigger (Timestamp's <time>/<span>) gets haspopup + controls, which are
      // global, and no expanded state.
      //
      // Merge rather than overwrite: the trigger may already carry its own
      // popup semantics (e.g. a menu button wrapped in a labelled HoverCard),
      // so preserve the existing values and restore them on cleanup.
      const existingHaspopup = firstChild.getAttribute('aria-haspopup');
      const existingControls = firstChild.getAttribute('aria-controls');
      const existingExpanded = firstChild.getAttribute('aria-expanded');
      const canExpand = supportsAriaExpanded(firstChild);
      firstChild.setAttribute('aria-haspopup', 'dialog');
      // Only point aria-controls at the layer while it is open and in the DOM.
      // While closed, useLayer leaves only an inert <template> marker, so the
      // id would reference nothing. DateInput gates it the same way. The
      // trigger's own aria-controls (if any) is preserved either way.
      if (hoverCard.isOpen) {
        firstChild.setAttribute('aria-controls', mergeIds(existingControls, hoverCard.id) ?? '');
      } else if (existingControls) {
        firstChild.setAttribute('aria-controls', existingControls);
      } else {
        firstChild.removeAttribute('aria-controls');
      }
      if (canExpand) {
        firstChild.setAttribute('aria-expanded', String(hoverCard.isOpen));
      } else if (existingExpanded) {
        firstChild.setAttribute('aria-expanded', existingExpanded);
      } else {
        firstChild.removeAttribute('aria-expanded');
      }
      return () => {
        hoverCard.ref(null);
        if (existingHaspopup) {
          firstChild.setAttribute('aria-haspopup', existingHaspopup);
        } else {
          firstChild.removeAttribute('aria-haspopup');
        }
        if (existingControls) {
          firstChild.setAttribute('aria-controls', existingControls);
        } else {
          firstChild.removeAttribute('aria-controls');
        }
        if (existingExpanded) {
          firstChild.setAttribute('aria-expanded', existingExpanded);
        } else {
          firstChild.removeAttribute('aria-expanded');
        }
      };
    }

    // Unnamed fallback: the popup remains role="group", which is not a dialog,
    // so keep the previous description relationship until a naming decision is
    // made for the no-label case (tracked in #5049).
    const existingDescribedBy = firstChild.getAttribute('aria-describedby');
    firstChild.setAttribute('aria-describedby', mergeIds(existingDescribedBy, hoverCard.describedBy) ?? '');
    return () => {
      hoverCard.ref(null);
      if (existingDescribedBy) {
        firstChild.setAttribute('aria-describedby', existingDescribedBy);
      } else {
        firstChild.removeAttribute('aria-describedby');
      }
    };
  }, [textOnly, label, hoverCard.ref, hoverCard.id, hoverCard.isOpen, hoverCard.describedBy]);

  // While closed, useLayer leaves only an inert <template> marker at this JSX
  // position. When the card needs to open, it uses that marker to keep the
  // final layer inline when the parent is safe or portal it outside a <p>,
  // link, or other ancestor that cannot contain it safely.
  const renderedHoverCard = hoverCard.renderHoverCard(content, {
    xstyle,
    className,
    style
  });

  // For text-only children: use inline span with ref on wrapper
  if (textOnly) {
    return /*#__PURE__*/_jsxs(_Fragment, {
      children: [/*#__PURE__*/_jsx("span", {
        ref: hoverCard.ref,
        tabIndex: 0,
        "aria-haspopup": label ? 'dialog' : undefined,
        "aria-controls": label && hoverCard.isOpen ? hoverCard.id : undefined
        // No aria-expanded: this wrapper is a role-less <span>, and
        // aria-expanded is invalid on it (see EXPANDABLE_ROLES above).
        ,
        "aria-describedby": label ? undefined : hoverCard.describedBy,
        ...{
          0: {
            className: "xt0psk2"
          },
          1: {
            className: "xt0psk2 xujl8zx xev0dqp xycaml9 x11b3rvo"
          }
        }[!!showHoverIndication << 0],
        children: children
      }), renderedHoverCard]
    });
  }

  // For element children: use inline-safe display:contents, ref on first child
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [/*#__PURE__*/_jsx("span", {
      ref: wrapperRef,
      ...{
        className: "xjp7ctv"
      },
      children: children
    }), renderedHoverCard]
  });
}
HoverCard.displayName = 'HoverCard';