// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file TypeaheadItem.tsx
 * @input Uses React, StyleX, SearchableItem
 * @output Exports TypeaheadItem component for rendering dropdown items
 * @position Presentational component; used as default renderItem in BaseTypeahead
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Typeahead/index.ts
 * - /packages/cli/assets/templates/blocks/components/Typeahead/ (showcase blocks)
 */

import React from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, fontWeightVars, typeScaleVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

// =============================================================================
// Types
// =============================================================================
import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// =============================================================================
// Styles
// =============================================================================

const styles = {
  container: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kOIVth: "x1txdalj",
    kAzted: "x2lwn1j",
    $$css: true
  },
  disabled: {
    kSiTet: "xbyyjgo",
    $$css: true
  }
};

// =============================================================================
// Component
// =============================================================================

/**
 * Default item component for typeahead dropdown results.
 *
 * Renders a label with optional icon and description.
 * Exported for use in custom `renderItem` implementations.
 *
 * @example
 * ```
 * <Typeahead searchSource={source} value={v} onChange={setV} label="Search" />
 * <Typeahead
 *   searchSource={source}
 *   value={v}
 *   onChange={setV}
 *   label="Search"
 *   renderItem={(item) => (
 *     <TypeaheadItem
 *       item={item}
 *       icon={<Avatar src={item.auxiliaryData.avatar} size="sm" />}
 *       description={item.auxiliaryData.role}
 *     />
 *   )}
 * />
 * ```
 */
export function TypeaheadItem({
  ref,
  item,
  icon,
  description,
  isDisabled = false,
  group: _group,
  xstyle,
  className,
  style,
  ...rest
}) {
  // If item has a pre-rendered element, use it
  if (item.element) {
    return /*#__PURE__*/_jsx(_Fragment, {
      children: item.element
    });
  }
  return /*#__PURE__*/_jsxs("div", {
    ref: ref,
    ...mergeProps(themeProps('typeahead-item'), stylex.props(styles.container, isDisabled && styles.disabled, xstyle), className, style),
    ...rest,
    children: [icon, /*#__PURE__*/_jsxs("div", {
      ...{
        className: "x78zum5 xdt5ytf x98rzlu xeuugli"
      },
      children: [/*#__PURE__*/_jsx("span", {
        ...{
          className: "xcr08ib x1kq96og x1sodnla x1tgivj0 xb3r6kr xlyipyv xuxw1ft"
        },
        children: item.label
      }), description && /*#__PURE__*/_jsx("span", {
        ...{
          className: "x141an7d x1ltkj2j xv1l7n4 xb3r6kr xlyipyv xuxw1ft"
        },
        children: description
      })]
    })]
  });
}
TypeaheadItem.displayName = 'TypeaheadItem';