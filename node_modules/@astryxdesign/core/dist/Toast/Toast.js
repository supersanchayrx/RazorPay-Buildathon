// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Toast.tsx
 * @input Uses React timers, touch/pen gesture events, Toast options, Button/Icon,
 *   MediaTheme, tokens, and placement motion inherited from ToastViewport
 * @output Exports the rendered Toast surface and its pause/swipe/dismiss behavior
 * @position Core implementation; rendered by ToastViewport and documented by Toast.doc.mjs
 *
 * SYNC: When Toast layout, timer pause, media theme, or dismissal behavior changes,
 *   update these files to stay in sync:
 * - /packages/core/src/Toast/ToastViewport.test.tsx
 * - /packages/core/src/Toast/Toast.doc.mjs
 * - /apps/storybook/stories/Toast.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Toast/ (showcase blocks)
 */
import { useCallback, useEffect, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Button } from "../Button/index.js";
import { Icon } from "../Icon/index.js";
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, radiusVars, durationVars, easeVars, shadowVars, typographyVars, typeScaleDefaults } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { INTERACTIVE_SELECTORS } from "../hooks/useClickableContainer.js";
import { useTheme } from "../theme/index.js";
import { MediaTheme } from "../theme/MediaTheme.js";
import { themeProps } from "../utils/themeProps.js";
import { useTranslator } from "../i18n/index.js";
import { useToastGesture } from "./useToastGesture.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const SWIPE_INTERACTIVE_TARGET_SELECTOR = `${INTERACTIVE_SELECTORS},[tabindex],[contenteditable]:not([contenteditable="false"])`;
function isInteractiveTarget(target, root) {
  if (!(target instanceof Element)) {
    return false;
  }
  let current = target;
  while (current != null && current !== root && current !== document.body) {
    if (current.matches(SWIPE_INTERACTIVE_TARGET_SELECTOR)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}
const TOAST_EDGE_DRIFT = spacingVars['--spacing-2'];
/**
 * Individual toast notification.
 *
 * Renders with inverted surface colors for the default variant,
 * and error-inverted for the error variant. Applies MediaTheme for that
 * surface, unless the painted colors make the chosen side unreadable —
 * a theme is free to define an "inverted" background that is not.
 * Pauses auto-dismiss on hover and focus.
 *
 * @example
 * ```
 * <Toast
 *   type="info"
 *   body="Saved successfully"
 *   isAutoHide={true}
 *   autoHideDuration={5000}
 *   onDismiss={(reason) => removeToast(id, reason)}
 * />
 * ```
 */
export function Toast(props) {
  return /*#__PURE__*/_jsx(ToastSurface, {
    ...props,
    gestureDirection: 1
  });
}
export function ToastSurface({
  type,
  body,
  endContent,
  isAutoHide,
  autoHideDuration,
  isExiting = false,
  onDismiss,
  renderContent,
  gestureDirection
}) {
  const t = useTranslator();
  const timerRef = useRef(null);
  const isPausedRef = useRef(false);
  const remainingRef = useRef(autoHideDuration);
  // Will be initialized by startTimer when actually used
  const startTimeRef = useRef(null);

  // Read onDismiss through a ref: the viewport re-creates it on every render
  // (another toast arriving/exiting), and a startTimer that depends on it
  // would restart — and un-pause — this toast's timer on unrelated renders.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const startTimer = useCallback(() => {
    if (!isAutoHide || isPausedRef.current) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismissRef.current('auto');
    }, remainingRef.current);
  }, [isAutoHide]);
  const pauseTimer = useCallback(() => {
    if (!isAutoHide || isPausedRef.current) {
      return;
    }
    isPausedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (startTimeRef.current != null) {
      const elapsed = Date.now() - startTimeRef.current;
      remainingRef.current = Math.max(remainingRef.current - elapsed, 1000);
    }
  }, [isAutoHide]);
  const resumeTimer = useCallback(() => {
    if (!isAutoHide || !isPausedRef.current) {
      return;
    }
    isPausedRef.current = false;
    startTimer();
  }, [isAutoHide, startTimer]);
  useEffect(() => {
    remainingRef.current = autoHideDuration;
    startTimer();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
    // startTimer's identity is stable per isAutoHide, so this runs on mount
    // and on a genuine duration change — not on unrelated viewport renders.
  }, [autoHideDuration, startTimer]);

  // Pause the auto-hide timer while the window is not focused, so a toast
  // doesn't silently expire while the user is in another window or tab.
  useEffect(() => {
    if (!isAutoHide) {
      return;
    }
    window.addEventListener('blur', pauseTimer);
    window.addEventListener('focus', resumeTimer);
    return () => {
      window.removeEventListener('blur', pauseTimer);
      window.removeEventListener('focus', resumeTimer);
    };
  }, [isAutoHide, pauseTimer, resumeTimer]);
  const isTimerPaused = useCallback(() => isPausedRef.current, []);
  const dismissFromGesture = useCallback(() => {
    onDismissRef.current('manual');
  }, []);
  const {
    rootRef,
    bindings: gestureBindings
  } = useToastGesture({
    direction: gestureDirection,
    enabled: !isExiting,
    canPauseTimer: isAutoHide,
    isTimerPaused,
    pauseTimer,
    resumeTimer,
    dismiss: dismissFromGesture,
    shouldIgnoreTarget: isInteractiveTarget
  });
  const handleDismiss = useCallback(() => {
    onDismiss('manual');
  }, [onDismiss]);
  const isError = type === 'error';
  // The surface is *usually* dark in light mode and light in dark mode, but a
  // theme can define --color-background-inverted as anything — so the mode is
  // measured, not assumed. This is only the pre-measurement fallback.
  const {
    mode
  } = useTheme();
  const fallbackMediaMode = isError || mode === 'light' ? 'dark' : 'light';
  return /*#__PURE__*/_jsx("div", {
    ref: rootRef,
    role: isError ? 'alert' : 'status',
    "aria-live": isError ? 'assertive' : 'polite',
    "aria-atomic": "true",
    onMouseEnter: pauseTimer,
    onMouseLeave: resumeTimer,
    onFocusCapture: pauseTimer,
    onBlurCapture: resumeTimer,
    ...gestureBindings,
    ...mergeProps(themeProps('toast', {
      type
    }), {
      0: {
        className: "x1na6nto x1pzlopt x1hviunn x9f619 x1l2rt3b x193iq5w x14hfi27 x1i7u4iq x9ynric xjm74w1 xw6l6zx x1qk3xlt x6o7n8i xuedmi6 xsagj69 xlr8y92 x4itv7f x6s140c xenstv7"
      },
      2: {
        className: "x1na6nto x1pzlopt x1hviunn x9f619 x1l2rt3b x193iq5w x14hfi27 x1i7u4iq x9ynric xjm74w1 xw6l6zx x1qk3xlt x6o7n8i xuedmi6 xsagj69 xlr8y92 x4itv7f x6s140c x1l5t2a3"
      },
      1: {
        className: "x1na6nto x1pzlopt x1hviunn x9f619 x1l2rt3b x193iq5w x14hfi27 x9ynric xjm74w1 xw6l6zx x6o7n8i xuedmi6 xsagj69 xlr8y92 x4itv7f x6s140c xenstv7 xg01cxk x149p1fo"
      },
      3: {
        className: "x1na6nto x1pzlopt x1hviunn x9f619 x1l2rt3b x193iq5w x14hfi27 x9ynric xjm74w1 xw6l6zx x6o7n8i xuedmi6 xsagj69 xlr8y92 x4itv7f x6s140c x1l5t2a3 xg01cxk x149p1fo"
      }
    }[!!isError << 1 | !!isExiting << 0]),
    children: /*#__PURE__*/_jsx(MediaTheme, {
      mode: "auto",
      fallback: fallbackMediaMode,
      children: renderContent ? renderContent({
        body,
        endContent,
        type,
        isAutoHide,
        autoHideDuration,
        dismiss: handleDismiss
      }) : /*#__PURE__*/_jsxs("div", {
        ...{
          className: "x78zum5 x1cy8zhl xozqiw3 xjcht0a xh8yej3"
        },
        children: [/*#__PURE__*/_jsx("div", {
          ...{
            className: "x98rzlu xeuugli xj0a0fe"
          },
          children: body
        }), /*#__PURE__*/_jsxs("div", {
          ...{
            className: "x2lah0s x78zum5 x6s0dn4 x1txdalj x1q370uo xmequkd"
          },
          children: [endContent, /*#__PURE__*/_jsx(Button, {
            variant: "ghost",
            size: "sm",
            icon: /*#__PURE__*/_jsx(Icon, {
              icon: "close",
              size: "sm",
              color: "inherit"
            }),
            label: t('@astryx.toast.dismiss'),
            onClick: handleDismiss,
            isIconOnly: true
          })]
        })]
      })
    })
  });
}
Toast.displayName = 'Toast';
ToastSurface.displayName = 'ToastSurface';