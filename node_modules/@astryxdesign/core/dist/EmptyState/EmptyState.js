// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file EmptyState.tsx
 * @input Uses React, HTMLAttributes
 * @output Exports EmptyState component, EmptyStateProps type
 * @position Core implementation; consumed by index.ts
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/EmptyState/EmptyState.doc.mjs (props table, features, implementation notes)
 * - /packages/core/src/EmptyState/EmptyState.test.tsx (tests for new/changed behavior)
 * - /packages/core/src/EmptyState/index.ts (exports if types change)
 * - /apps/storybook/stories/EmptyState.stories.tsx (storybook stories)
 * - /packages/cli/assets/templates/blocks/components/EmptyState/ (showcase blocks)
 */

import { createElement } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, fontWeightVars, typeScaleVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  container: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    k9WMMc: "x2b8uid",
    kOIVth: "x18g69wz",
    k8WAf4: "xmfvnks",
    kg3NbH: "xm7rs69",
    $$css: true
  },
  containerCompact: {
    kOIVth: "x1txdalj",
    k8WAf4: "x1na6nto",
    kg3NbH: "x1pzlopt",
    $$css: true
  }
};
/**
 * An empty state placeholder for content areas with no data.
 * Displays an icon or illustration, title, optional description, and action buttons.
 *
 * Uses `role="status"` to announce content to screen readers.
 * Styles use Astryx theme tokens via StyleX. Wrap your app in <Theme> to apply a theme.
 *
 * @example
 * ```
 * <EmptyState
 *   title="No results found"
 *   description="Try adjusting your search or filters."
 * />
 * <EmptyState
 *   icon={<Icon icon={InboxIcon} size="lg" />}
 *   title="No messages"
 *   description="You're all caught up!"
 *   actions={<Button label="Compose" variant="primary" />}
 * />
 * ```
 */
export function EmptyState({
  title,
  description,
  icon,
  actions,
  headingLevel = 3,
  isCompact = false,
  xstyle,
  className,
  style,
  ref,
  ...props
}) {
  const HeadingTag = `h${headingLevel}`;
  return /*#__PURE__*/_jsxs("div", {
    ref: ref,
    ...props,
    role: "status",
    ...mergeProps(themeProps('empty-state', {
      variant: isCompact ? 'compact' : null
    }), stylex.props(styles.container, isCompact && styles.containerCompact, xstyle), className, style),
    children: [icon != null && /*#__PURE__*/_jsx("div", {
      "aria-hidden": "true",
      children: icon
    }), /*#__PURE__*/_jsxs("div", {
      ...{
        className: "x78zum5 xdt5ytf x6s0dn4 xxc7z9f"
      },
      children: [/*#__PURE__*/createElement(HeadingTag, mergeProps(themeProps('empty-state-title', {
        variant: isCompact ? 'compact' : null
      }), {
        0: {
          className: "x1ghz6dp xjb2p0i x18juvz8 x2mo6ok xf74fhv x1tgivj0"
        },
        1: {
          className: "x1ghz6dp xjb2p0i x2mo6ok xf74fhv x1tgivj0 xcr08ib"
        }
      }[!!isCompact << 0]), title), description != null &&
      /*#__PURE__*/
      // Rendered as <div> (not <p>): description accepts ReactNode and a
      // <p> cannot legally contain block children, which causes hydration
      // mismatches. The StyleX style sets margin: 0, so appearance is
      // unchanged.
      _jsx("div", {
        ...mergeProps(themeProps('empty-state-description', {
          variant: isCompact ? 'compact' : null
        }), {
          0: {
            className: "x1ghz6dp xjb2p0i xjm74w1 x1sodnla xw6l6zx xv1l7n4"
          },
          1: {
            className: "x1ghz6dp xjb2p0i x1sodnla xw6l6zx xv1l7n4 x141an7d"
          }
        }[!!isCompact << 0]),
        children: description
      })]
    }), actions != null && /*#__PURE__*/_jsx("div", {
      ...{
        0: {
          className: "x78zum5 x1q0g3np x6s0dn4 x1txdalj xcsaf9d"
        },
        1: {
          className: "x78zum5 x6s0dn4 x1txdalj xcsaf9d xdt5ytf"
        }
      }[!!isCompact << 0],
      children: actions
    })]
  });
}
EmptyState.displayName = 'EmptyState';