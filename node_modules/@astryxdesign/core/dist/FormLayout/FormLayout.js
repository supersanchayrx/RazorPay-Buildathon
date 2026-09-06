// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file FormLayout.tsx
 * @input Uses React, FormLayoutContext, StyleX
 * @output Exports FormLayout component and FormLayoutProps
 * @position Core implementation; consumed by index.ts, tested by FormLayout.test.tsx
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/FormLayout/FormLayout.test.tsx (tests for new/changed behavior)
 * - /packages/core/src/FormLayout/FormLayoutContext.ts (context value shape)
 * - /packages/core/src/FormLayout/FormLayout.doc.mjs (props table)
 * - /packages/core/src/FormLayout/index.ts (exports if types change)
 * - /packages/core/src/Field/FieldLabel.tsx (defaultOptionality indicator resolution)
 * - /apps/storybook/stories/FormLayout.stories.tsx (storybook stories)
 * - /packages/cli/assets/templates/blocks/components/FormLayout/ (showcase blocks)
 */
import { useMemo } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import { FormLayoutContext } from "./FormLayoutContext.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

// =============================================================================
// Responsive breakpoint for horizontal-labels collapse
// =============================================================================
import { jsx as _jsx } from "react/jsx-runtime";
const HORIZONTAL_LABELS_COLLAPSE = '@media (max-width: 480px)';

// =============================================================================
// Styles
// =============================================================================

const styles = {
  base: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    kOIVth: "x18g69wz",
    $$css: true
  },
  horizontal: {
    k1xSpc: "xrvj5dj",
    kprqdN: "x1mt1orb",
    klIVar: "xu6a5m6",
    $$css: true
  },
  horizontalLabels: {
    k1xSpc: "xrvj5dj",
    kumcoG: "x1pmbctz",
    kOIVth: "xlaq8a2",
    kGNEyG: "x7a106z",
    k41HbU: "xedohl4",
    kUxVDj: "x1rpgqan",
    k3RL8M: "x1a1jff",
    $$css: true
  }
};

// =============================================================================
// Props
// =============================================================================

// =============================================================================
// Component
// =============================================================================

/**
 * Spatial layout container for form fields.
 *
 * Arranges form fields with consistent spacing and direction. Renders a `<div>`
 * (not a `<form>` — form submission is a separate concern). For label wrapping
 * of custom controls, use `Field` directly.
 *
 * Provides direction context to children via `FormLayoutContext`.
 * Supports nesting — a horizontal layout inside a vertical layout works naturally.
 *
 * @example
 * ```
 * <FormLayout>
 *   <TextInput label="Name" value={name} onChange={setName} />
 *   <TextInput label="Email" value={email} onChange={setEmail} />
 * </FormLayout>
 * ```
 */
export function FormLayout({
  children,
  direction = 'vertical',
  defaultOptionality,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  const contextValue = useMemo(() => ({
    direction,
    defaultOptionality
  }), [direction, defaultOptionality]);
  return /*#__PURE__*/_jsx(FormLayoutContext, {
    value: contextValue,
    children: /*#__PURE__*/_jsx("div", {
      ref: ref,
      ...mergeProps(themeProps('form-layout', {
        direction
      }), stylex.props(styles.base, direction === 'horizontal' && styles.horizontal, direction === 'horizontal-labels' && styles.horizontalLabels, xstyle), className, style),
      ...props,
      children: children
    })
  });
}
FormLayout.displayName = 'FormLayout';