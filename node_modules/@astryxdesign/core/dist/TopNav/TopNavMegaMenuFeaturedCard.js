// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TopNavMegaMenuFeaturedCard.tsx
 * @input Uses React, StyleX, theme tokens
 * @output Exports TopNavMegaMenuFeaturedCard component
 * @position Standard featured card for the TopNavMegaMenu featured slot.
 *
 * Provides a consistent appearance for promotional/featured content in mega menus.
 * The `featured` slot on TopNavMegaMenu is still open ReactNode — this component
 * is the standard card, but consumers can pass anything.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/TopNav/TopNav.doc.mjs
 * - /packages/core/src/TopNav/index.ts
 * - /packages/cli/assets/templates/blocks/components/TopNav/ (showcase blocks)
 */
import React from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars, fontWeightVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { useLinkComponent } from "../Link/useLinkComponent.js";
import { themeProps } from "../utils/themeProps.js";

// =============================================================================
// Styles
// =============================================================================
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  root: {
    k1xSpc: "x78zum5",
    kXwgrk: "xdt5ytf",
    $$css: true
  }
};

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Component
// =============================================================================

/**
 * Standard featured card for the TopNavMegaMenu `featured` slot.
 *
 * Provides a consistent card with optional image, title, description,
 * and CTA link. For fully custom content, pass any ReactNode directly
 * to the `featured` slot instead.
 *
 * @example
 * ```
 * <TopNavMegaMenu
 *   label="Products"
 *   items={...}
 *   featured={
 *     <TopNavMegaMenuFeaturedCard
 *       title="What's new in v4.0"
 *       description="AI-powered analytics and real-time collaboration."
 *       image="https://example.com/promo.jpg"
 *       imageAlt="Team collaboration"
 *       linkLabel="Read the announcement"
 *       linkHref="/blog/v4"
 *     />
 *   }
 * />
 * ```
 */
export function TopNavMegaMenuFeaturedCard({
  ref,
  title,
  description,
  image,
  imageAlt,
  linkLabel,
  linkHref,
  children,
  xstyle,
  className,
  style,
  ...rest
}) {
  const LinkComponent = useLinkComponent();
  return /*#__PURE__*/_jsxs("div", {
    ref: ref,
    ...mergeProps(themeProps('top-nav-mega-menu-featured-card'), stylex.props(styles.root, xstyle), className, style),
    ...rest,
    children: [image &&
    /*#__PURE__*/
    // Without `imageAlt`, the image is explicitly decorative rather than
    // silently empty-alt, matching Avatar's handling of unnamed images.
    // Usually correct here: the card already has a visible title.
    _jsx("img", {
      src: image,
      alt: imageAlt ?? '',
      role: imageAlt ? undefined : 'presentation',
      "aria-hidden": imageAlt ? undefined : true,
      ...{
        className: "xh8yej3 xhjk10j xl1xv1r x1lliihq"
      }
    }), /*#__PURE__*/_jsxs("div", {
      ...{
        className: "x78zum5 xdt5ytf x1txdalj x1shk3sm"
      },
      children: [/*#__PURE__*/_jsx("span", {
        ...{
          className: "xcr08ib x2mo6ok x1kq96og x1tgivj0"
        },
        children: title
      }), description && /*#__PURE__*/_jsx("span", {
        ...{
          className: "x141an7d x1ltkj2j xv1l7n4"
        },
        children: description
      }), linkLabel && linkHref && /*#__PURE__*/_jsxs(LinkComponent, {
        href: linkHref,
        ...{
          className: "x141an7d x2mo6ok x1ltkj2j xjse4m1 x1hl2dhg"
        },
        children: [linkLabel, " \u2192"]
      }), children]
    })]
  });
}
TopNavMegaMenuFeaturedCard.displayName = 'TopNavMegaMenuFeaturedCard';