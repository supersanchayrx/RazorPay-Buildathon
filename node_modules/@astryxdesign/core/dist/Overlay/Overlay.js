// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Overlay.tsx
 * @input Uses React, useOverlay
 * @output Exports Overlay component
 * @position Overlay system component; thin wrapper over useOverlay
 *
 * Wraps content with an overlay scrim. Same pattern as Tooltip:
 * `children` is the base content, `content` is what appears on top.
 *
 * For applying overlay behavior to an existing container (Card),
 * use the useOverlay hook directly.
 */
import * as stylex from '@stylexjs/stylex';
import { mergeProps } from "../utils/index.js";
import { useOverlay } from "./useOverlay.js";
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect.js";
import { overlayScope, overlayContainerStyles } from "./overlay.markers.stylex.js";
import { themeProps } from "../utils/themeProps.js";
import { useMergedRefs } from "../hooks/useMergedRefs.js";
import { jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Overlay — renders content on top of media with a scrim background
 * and automatic theme inversion.
 *
 * `children` = base content, `content` = what appears on top.
 *
 * @compositionHint Wrap images, video, or media content.
 *
 * @example
 * ```
 * <Overlay
 *   showOn="hover"
 *   content={<Button label="Quick view" variant="ghost" />}>
 *   <AspectRatio ratio={16/9}>
 *     <img src="hero.jpg" style={{objectFit: 'cover', width: '100%', height: '100%'}} />
 *   </AspectRatio>
 * </Overlay>
 * ```
 */
export function Overlay({
  children,
  content,
  showOn,
  isOpen,
  scrim,
  position,
  align,
  xstyle,
  className,
  style,
  ref
}) {
  const overlay = useOverlay({
    content,
    showOn,
    isOpen,
    scrim,
    position,
    align
  });

  // Border radius: mirror first child's radius onto the wrapper.
  // Only the component needs this — hook consumers have their own radius.
  useIsomorphicLayoutEffect(() => {
    const el = overlay.containerRef.current;
    if (!el) {
      return;
    }
    const firstChild = el.firstElementChild;
    if (!firstChild) {
      return;
    }
    const radius = getComputedStyle(firstChild).borderRadius;
    if (radius && radius !== '0px') {
      // eslint-disable-next-line react-compiler/react-compiler -- imperative DOM: syncing border-radius from child
      el.style.borderRadius = radius;
    }
  }, []);
  return /*#__PURE__*/_jsxs("div", {
    ref: useMergedRefs(ref, overlay.containerRef),
    ...mergeProps(themeProps('overlay'), stylex.props(overlayScope, overlayContainerStyles.root, xstyle), className, style),
    onClick: overlay.containerProps.onClick,
    onMouseUp: overlay.containerProps.onMouseUp,
    children: [children, overlay.element]
  });
}
Overlay.displayName = 'Overlay';