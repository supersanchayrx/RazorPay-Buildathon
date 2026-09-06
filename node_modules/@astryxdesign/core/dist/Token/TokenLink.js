// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TokenLink.tsx
 * @input Rendered token pieces (icon, label, endContent, remove button) plus
 *   container/link styling props and the resolved LinkComponent
 * @output Exports TokenLink, the interactive container for the href+onRemove Token variant
 * @position Internal to Token; keeps Token.tsx presentational
 *
 * Token is a presentational component (see
 * /internal/eslint-plugin-astryx/presentational-component.js) and must not use
 * refs or effects. When a Token has both `href` and `onRemove`, the remove
 * <button> must be a sibling of the link (nesting a button inside an anchor is
 * invalid HTML — WCAG 4.1.2), so the surface becomes a clickable container that
 * delegates to an inner link. That delegation needs refs, so it lives here.
 *
 * useClickableContainer gives the container middle-click and cmd/ctrl-click
 * open-in-new-tab behavior for the link, ignores clicks on nested interactive
 * elements (the remove button), and skips activation during text selection.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Token/Token.tsx (renders TokenLink for the href+onRemove case)
 * - /packages/core/src/Token/Token.test.tsx (tests for delegated behavior)
 */
import { useRef } from 'react';
import { useClickableContainer } from "../hooks/useClickableContainer.js";
import { composeEventHandlers } from "../utils/index.js";
import { useMergedRefs } from "../hooks/useMergedRefs.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Interactive container for a Token that is both a link and removable.
 *
 * Renders a `<span>` wrapping an invisible inner link and the remove button as
 * siblings. useClickableContainer delegates clicks on the surface to the link
 * (including middle-click / cmd+click to open in a new tab) while the remove
 * button keeps handling its own clicks.
 */
export function TokenLink({
  ref,
  href,
  isDisabled,
  LinkComponent,
  linkStyleProps,
  labelContent,
  icon,
  endContent,
  removeButton,
  onClick: onClickProp,
  onMouseUp: onMouseUpProp,
  ...containerProps
}) {
  const containerRef = useRef(null);
  const linkRef = useRef(null);
  const {
    onClick,
    onMouseUp
  } = useClickableContainer({
    containerRef,
    interactiveRef: linkRef,
    href,
    disabled: isDisabled
  });
  return /*#__PURE__*/_jsxs("span", {
    ref: useMergedRefs(ref, containerRef),
    ...containerProps,
    onClick: isDisabled ? onClickProp : composeEventHandlers(onClickProp, onClick),
    onMouseUp: isDisabled ? onMouseUpProp : composeEventHandlers(onMouseUpProp, onMouseUp),
    children: [icon, /*#__PURE__*/_jsx(LinkComponent, {
      ref: linkRef,
      href: href,
      "aria-disabled": isDisabled || undefined,
      ...linkStyleProps,
      children: labelContent
    }), endContent, removeButton]
  });
}
TokenLink.displayName = 'TokenLink';