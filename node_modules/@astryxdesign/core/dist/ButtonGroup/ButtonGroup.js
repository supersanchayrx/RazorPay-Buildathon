// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file ButtonGroup.tsx
 * @input Uses React, StyleX, Button/IconButton children
 * @output Exports ButtonGroup component, context, and types
 * @position Groups buttons with connected styling; consumed by index.ts
 *
 * Children (Button, IconButton) consume the ButtonGroup context to apply
 * position-aware styles in pure CSS — no cloneElement or wrapper divs needed.
 * The end-cap radius rules live in Button.tsx; see IS_LAST_ITEM there for why
 * the trailing edge cannot use :last-child (#2508).
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/ButtonGroup/ButtonGroup.doc.mjs (props table, features)
 * - /packages/core/src/ButtonGroup/ButtonGroup.test.tsx (tests)
 * - /packages/core/src/ButtonGroup/index.ts (exports if types change)
 * - /apps/storybook/stories/ButtonGroup.stories.tsx (storybook stories)
 * - /packages/cli/assets/templates/blocks/components/ButtonGroup/ (showcase blocks)
 */
import { useMemo } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { radiusVars, shadowVars } from "../theme/tokens.stylex.js";
import { SizeProvider, useSize } from "../SizeContext/SizeContext.js";
import { useListFocus } from "../hooks/useListFocus.js";
import { mergeProps, composeEventHandlers } from "../utils/index.js";
import { ButtonGroupContext } from "./ButtonGroupContext.js";
import { themeProps } from "../utils/themeProps.js";
import { useMergedRefs } from "../hooks/useMergedRefs.js";
// =============================================================================
// Props
// =============================================================================
import { jsx as _jsx } from "react/jsx-runtime";
// =============================================================================
// Styles
// =============================================================================

const styles = {
  group: {
    k1xSpc: "x3nfvp2",
    kGNEyG: "x1qjc9v5",
    $$css: true
  },
  vertical: {
    kXwgrk: "xdt5ytf",
    $$css: true
  }
};

// Resting elevation for the whole group — the connected buttons share one
// surface, so the shadow sits on the group wrapper and lifts them as a unit.
// The wrapper takes the element radius so the shadow follows the group's
// rounded outer corners rather than a bare rectangle. 'none' is the default.
const elevationStyles = {
  none: {
    kGVxlE: "x1gnnqk1",
    $$css: true
  },
  low: {
    kGVxlE: "x1i5ehqx",
    kaIpWk: "xh6dtrn",
    $$css: true
  },
  med: {
    kGVxlE: "x14hfi27",
    kaIpWk: "xh6dtrn",
    $$css: true
  },
  high: {
    kGVxlE: "x1kcpxr7",
    kaIpWk: "xh6dtrn",
    $$css: true
  }
};

// =============================================================================
// Component
// =============================================================================

/**
 * Groups buttons with connected styling — shared borders, proper border-radius
 * handling (only on outer edges), and horizontal or vertical orientation.
 *
 * Children automatically detect the group via context and apply position-aware
 * styles in pure CSS.
 *
 * The group is a single tab stop: arrow keys move between members along the
 * orientation, Home/End jump to the ends, focus wraps, and disabled members are
 * skipped (the APG roving tabindex technique, via `useListFocus`).
 *
 * Members that render their own layer — a Button with a `tooltip`, or a
 * DropdownMenu — compose correctly, including as the trailing member.
 *
 * @example
 * ```
 * <ButtonGroup label="Actions">
 *   <Button label="Copy" />
 *   <Button label="Cut" />
 *   <Button label="Paste" />
 * </ButtonGroup>
 * ```
 *
 * @example
 * ```
 * <ButtonGroup label="Approve action">
 *   <Button label="Allow once" variant="primary" />
 *   <DropdownMenu
 *     button={{label: 'Allow options', variant: 'primary', isIconOnly: true, icon: <Icon icon="chevronDown" />}}
 *     items={[{label: 'Allow for 30 minutes'}, {label: 'Always allow'}]}
 *   />
 * </ButtonGroup>
 * ```
 */
export function ButtonGroup({
  children,
  label,
  orientation = 'horizontal',
  size: sizeProp,
  isDisabled = false,
  elevation = 'none',
  xstyle,
  className,
  style,
  ref,
  'data-testid': testId,
  onKeyDown,
  onFocus,
  ...props
}) {
  const size = useSize(sizeProp, 'md');
  const {
    listRef,
    handleKeyDown,
    handleFocus
  } = useListFocus({
    // Roving rewrites `tabindex` on every item, so the selector cannot key off
    // a value: `[tabindex="0"]` would drop each member the moment it is
    // stamped -1. `a[href]` catches a Button rendered with `href`.
    itemSelector: 'button, a[href], [tabindex]',
    // A member's layer renders inline inside the group (useLayer does not
    // portal it), so a key pressed in an open DropdownMenu bubbles here. The
    // boundary is the group's own root or any layer, whichever is nearer to
    // the target. Naming the group's own root is what keeps a group rendered
    // inside a Popover or Toast working: bailing on any [popover] ancestor
    // instead would swallow every arrow key it owns.
    boundarySelector: '[role="group"], [popover]',
    orientation,
    hasRovingTabIndex: true
  });
  const contextValue = useMemo(() => ({
    orientation,
    isDisabled
  }), [orientation, isDisabled]);
  return /*#__PURE__*/_jsx(ButtonGroupContext, {
    value: contextValue,
    children: /*#__PURE__*/_jsx(SizeProvider, {
      value: size,
      children: /*#__PURE__*/_jsx("div", {
        ref: useMergedRefs(ref, listRef),
        ...props,
        ...mergeProps(themeProps('button-group', {
          size,
          orientation,
          elevation
        }), stylex.props(styles.group, orientation === 'vertical' && styles.vertical, elevationStyles[elevation], xstyle), className, style),
        role: "group",
        "aria-label": label,
        onKeyDown: composeEventHandlers(onKeyDown, handleKeyDown),
        onFocus: composeEventHandlers(onFocus, handleFocus),
        "aria-disabled": isDisabled || undefined,
        "data-testid": testId,
        children: children
      })
    })
  });
}
ButtonGroup.displayName = 'ButtonGroup';