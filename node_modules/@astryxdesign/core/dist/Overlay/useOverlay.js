// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useOverlay.tsx
 * @input Overlay options (showOn, scrim, position, content, etc.)
 * @output containerRef, containerProps, element, renderOverlay
 * @position Core hook for overlay system — same pattern as useTooltip
 *
 * For applying overlay behavior to an existing container (Card,
 * custom elements) without a wrapper. Returns props to spread on the
 * container and the scrim to render inside it.
 *
 * Handles: marker, positioning, touch toggle (via useClickableContainer),
 * and scrim rendering.
 */
import { useState, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import * as stylex from '@stylexjs/stylex';
import { useClickableContainer } from "../hooks/useClickableContainer.js";
import { overlayScope, overlayContainerStyles } from "./overlay.markers.stylex.js";
import { OverlayScrim } from "./OverlayScrim.js";
import { jsx as _jsx } from "react/jsx-runtime";
// =============================================================================
// Touch detection
// =============================================================================

function getIsTouchDevice() {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(hover: none)').matches;
}
function subscribeToHoverChange(callback) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const mql = window.matchMedia('(hover: none)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}
function getServerSnapshot() {
  return false;
}

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for overlay behavior on an existing container.
 * Returns containerRef, containerProps, and scrim element/render function.
 *
 * @example
 * ```
 * const overlay = useOverlay({
 *   showOn: 'hover',
 *   content: <Button label="Quick view" variant="ghost" />,
 * });
 * <Card ref={overlay.containerRef} {...overlay.containerProps}>
 *   <Layout content={...} />
 *   {overlay.element}
 * </Card>
 * ```
 *
 * @example
 * ```
 * const overlay = useOverlay({ showOn: 'hover' });
 * <div ref={overlay.containerRef} {...overlay.containerProps}>
 *   <img src={src} />
 *   {overlay.renderOverlay(<Button label="Quick view" />)}
 * </div>
 * ```
 */
export function useOverlay({
  content,
  showOn = 'always',
  isOpen: isOpenProp,
  scrim = 'dark',
  position = 'fill',
  align = 'end'
} = {}) {
  const containerRef = useRef(null);
  const isTouchDevice = useSyncExternalStore(subscribeToHoverChange, getIsTouchDevice, getServerSnapshot);
  const [touchOpen, setTouchOpen] = useState(false);
  const isHoverMode = showOn === 'hover' || showOn === 'hover-or-focus';
  const needsTouchToggle = isTouchDevice && isHoverMode;
  const handleToggle = useCallback(() => {
    setTouchOpen(prev => !prev);
  }, []);
  const {
    onClick,
    onMouseUp
  } = useClickableContainer({
    containerRef,
    onClick: needsTouchToggle ? handleToggle : undefined,
    disabled: !needsTouchToggle
  });

  // Resolve isOpen: consumer prop > touch toggle > undefined (CSS)
  const effectiveIsOpen = isOpenProp !== undefined ? isOpenProp : needsTouchToggle ? touchOpen : undefined;

  // Container styles (marker + positioning)
  const resolved = stylex.props(overlayScope, overlayContainerStyles.root);
  const containerProps = useMemo(() => ({
    className: resolved.className ?? undefined,
    style: resolved.style ?? undefined,
    onClick: needsTouchToggle ? onClick : undefined,
    onMouseUp: needsTouchToggle ? onMouseUp : undefined
  }), [resolved.className, resolved.style, needsTouchToggle, onClick, onMouseUp]);

  // Render function — matches tooltip's renderTooltip pattern
  const renderOverlay = useCallback(children => /*#__PURE__*/_jsx(OverlayScrim, {
    scrim: scrim,
    position: position,
    align: align,
    showOn: showOn,
    isOpen: effectiveIsOpen,
    children: children
  }), [scrim, position, align, showOn, effectiveIsOpen]);

  // Pre-rendered element when content is provided
  const element = content != null ? renderOverlay(content) : null;
  return {
    containerRef,
    containerProps,
    element,
    renderOverlay
  };
}