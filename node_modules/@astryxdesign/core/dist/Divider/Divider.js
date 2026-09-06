// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Divider.tsx
 * @input Uses React, stylex, spacing and color tokens
 * @output Exports Divider component and DividerProps
 * @position Divider component; provides visual separation with optional label
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Divider/Divider.doc.mjs
 * - /packages/core/src/Divider/Divider.test.tsx
 * - /apps/storybook/stories/Divider.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Divider/ (showcase blocks)
 */
import { useId } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars, borderVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

/**
 * Divider variant type. Extensible via module augmentation of DividerVariantMap.
 */
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const baseStyles = {
  horizontal: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kzqmXN: "xh8yej3",
    $$css: true
  },
  vertical: {
    k1xSpc: "x3nfvp2",
    kXwgrk: "xdt5ytf",
    kGNEyG: "x6s0dn4",
    kZKoxP: "x5yr21d",
    $$css: true
  }
};
const lineStyles = {
  horizontalLine: {
    kZKoxP: "xsyqizj",
    kzQI83: "x1iyjqo2",
    kmuXW: "xs83m0k",
    $$css: true
  },
  verticalLine: {
    kzqmXN: "xjk4fl7",
    kzQI83: "x1iyjqo2",
    kmuXW: "xs83m0k",
    $$css: true
  },
  subtle: {
    kWkggS: "x1m4xfpy",
    $$css: true
  },
  strong: {
    kWkggS: "x7njt3n",
    $$css: true
  }
};
const fullBleedStyles = {
  horizontal: {
    keTefX: "xojxgvx",
    k71WvV: "x1fcf3bl",
    kzqmXN: "xx6qvi6",
    $$css: true
  },
  vertical: {
    keoZOQ: "x1sa9bsh",
    k1K539: "x6h7pi7",
    kZKoxP: "x12qplqi",
    $$css: true
  }
};

/**
 * Divider component for visual separation of content.
 *
 * Provides horizontal and vertical dividers with optional labels.
 * Uses Astryx design tokens for colors and spacing.
 *
 * @example
 * ```
 * <Divider label="or" />
 * ```
 */
export function Divider({
  orientation = 'horizontal',
  label,
  variant = 'subtle',
  isFullBleed = false,
  xstyle,
  className,
  style,
  ref,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}) {
  const isHorizontal = orientation === 'horizontal';
  const labelId = useId();

  // A separator does not derive its accessible name from its content, so the
  // rendered label must be referenced explicitly via aria-labelledby to be
  // exposed as the separator's name (WCAG 1.3.1). An explicit aria-label or
  // aria-labelledby from the consumer takes precedence.
  const resolvedLabelledBy = ariaLabelledBy ?? (label && ariaLabel == null ? labelId : undefined);
  return /*#__PURE__*/_jsxs("div", {
    ref: ref,
    ...props,
    role: "separator",
    "aria-orientation": orientation,
    "aria-label": ariaLabel,
    "aria-labelledby": resolvedLabelledBy,
    ...mergeProps(themeProps('divider', {
      variant,
      orientation
    }), stylex.props(isHorizontal ? baseStyles.horizontal : baseStyles.vertical, isFullBleed && (isHorizontal ? fullBleedStyles.horizontal : fullBleedStyles.vertical), xstyle), className, style),
    children: [/*#__PURE__*/_jsx("div", {
      ...stylex.props(isHorizontal ? lineStyles.horizontalLine : lineStyles.verticalLine, lineStyles[variant])
    }), label && /*#__PURE__*/_jsx("div", {
      id: labelId,
      ...{
        0: {
          className: "x2lah0s xrrkdod x141an7d x1ltkj2j xv1l7n4"
        },
        1: {
          className: "x2lah0s x141an7d x1ltkj2j xv1l7n4 xnjsko4 x8o8v82"
        }
      }[!!!isHorizontal << 0],
      children: label
    }), label && /*#__PURE__*/_jsx("div", {
      ...stylex.props(isHorizontal ? lineStyles.horizontalLine : lineStyles.verticalLine, lineStyles[variant])
    })]
  });
}
Divider.displayName = 'Divider';