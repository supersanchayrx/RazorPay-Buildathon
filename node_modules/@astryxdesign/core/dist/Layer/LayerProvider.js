// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import { useMemo } from 'react';
import { LayerContext, useLayerContext } from "./LayerContext.js";
import { ToastViewport } from "../Toast/ToastViewport.js";
import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
/**
 * App-level provider for layer systems (toast, sheet, imperative modals).
 *
 * Optional — hooks fall back to a lazy self-mounting viewport when no
 * provider exists. Nested providers are no-ops.
 *
 * @example
 * ```
 * <LayerProvider toast={{ position: 'topEnd', maxVisible: 3 }}>
 *   <App />
 * </LayerProvider>
 * ```
 */
const DEFAULT_TOAST_CONFIG = {};
export function LayerProvider({
  children,
  toast: toastConfig = DEFAULT_TOAST_CONFIG
}) {
  const existingContext = useLayerContext();
  const contextValue = useMemo(() => ({
    toastConfig,
    isProvider: true
  }), [toastConfig]);

  // Nested provider — pass through
  if (existingContext) {
    return /*#__PURE__*/_jsx(_Fragment, {
      children: children
    });
  }
  return /*#__PURE__*/_jsx(LayerContext, {
    value: contextValue,
    children: /*#__PURE__*/_jsx(ToastViewport, {
      position: toastConfig.position,
      maxVisible: toastConfig.maxVisible,
      inset: toastConfig.inset,
      children: children
    })
  });
}
LayerProvider.displayName = 'LayerProvider';