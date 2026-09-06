// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file LinkProvider.tsx
 * @input React, LinkContext, LinkComponentType
 * @output Exports LinkProvider component and LinkProviderProps
 * @position Provider component for polymorphic link support
 *
 * Sets the default link component for all Astryx components in the subtree.
 * Individual components can still override via the `as` prop.
 *
 * @example
 * ```
 * import Link from 'next/link';
 * <LinkProvider component={Link}>
 *   <App />
 * </LinkProvider>
 * ```
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Link/index.ts
 * - /packages/core/src/Link/Link.doc.mjs
 * - /packages/cli/assets/templates/blocks/components/Link/ (showcase blocks)
 * - /packages/cli/assets/templates/blocks/components/LinkProvider/ (example blocks)
 */
import { useMemo } from 'react';
import { LinkContext } from "./LinkContext.js";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Provides a custom link component to all Astryx components in the subtree.
 *
 * Wrap your app (or a section of it) in LinkProvider to replace
 * native `<a>` elements with your framework's link component
 * (e.g., Next.js Link, React Router Link).
 */
export function LinkProvider({
  component,
  children
}) {
  const value = useMemo(() => ({
    component
  }), [component]);
  return /*#__PURE__*/_jsx(LinkContext, {
    value: value,
    children: children
  });
}
LinkProvider.displayName = 'LinkProvider';