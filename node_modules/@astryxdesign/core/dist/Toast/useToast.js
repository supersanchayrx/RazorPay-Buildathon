// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import { useCallback, use, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { dataAttr } from "../naming.js";
import { ToastContext } from "./ToastContext.js";
import { ToastViewport } from "./ToastViewport.js";
import { warnOnce } from "../utils/devWarning.js";
import { jsx as _jsx } from "react/jsx-runtime";
// Fallback singleton
let fallbackContext = null;
let fallbackRoot = null;
const ROOT_THEME_ATTRS = ['data-theme', dataAttr('theme')];

// The fallback container is a detached tree with no ThemeContext, so this
// mirrors <html>'s theme attributes onto it directly (live via
// MutationObserver) for the theme's @scope'd CSS to reach it. It's a
// lifetime-of-app singleton that's never torn down, so there's nothing to
// disconnect — this returns void.
function syncRootThemeAttrs(container) {
  const sync = () => {
    let mirroredMode = null;
    for (const attr of ROOT_THEME_ATTRS) {
      const value = document.documentElement.getAttribute(attr);
      if (value == null) {
        container.removeAttribute(attr);
      } else {
        container.setAttribute(attr, value);
        if (attr === 'data-theme') {
          mirroredMode = value;
        }
      }
    }
    // Pages whose built theme CSS pins color-scheme unconditionally (#3658)
    // would otherwise resolve light-dark() tokens by OS preference while the
    // mirrored mode above follows the app theme; the inline style wins over
    // that CSS.
    if (mirroredMode === 'light' || mirroredMode === 'dark') {
      container.style.colorScheme = mirroredMode;
    } else {
      container.style.removeProperty('color-scheme');
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [...ROOT_THEME_ATTRS]
  });
}
function getFallbackContext() {
  if (fallbackContext) {
    return fallbackContext;
  }
  if (typeof document === 'undefined') {
    throw new Error('useToast: Cannot create fallback viewport during SSR. ' + 'Wrap your app with <LayerProvider> or <AppShell>.');
  }
  warnOnce('toast-fallback-viewport', 'useToast', 'No LayerProvider found. Using fallback viewport. ' + 'Wrap your app with <LayerProvider> or <AppShell> for full control.');
  const container = document.createElement('div');
  container.setAttribute('data-astryx-toast-fallback', '');
  document.body.appendChild(container);
  syncRootThemeAttrs(container);
  let resolveCtx;
  const ctxReady = new Promise(r => {
    resolveCtx = r;
  });
  const FallbackCapture = () => {
    const ctx = use(ToastContext);
    const doneRef = useRef(false);
    useEffect(() => {
      if (ctx && !doneRef.current) {
        doneRef.current = true;
        fallbackContext = ctx;
        resolveCtx?.(ctx);
      }
    }, [ctx]);
    return null;
  };
  fallbackRoot = createRoot(container);
  fallbackRoot.render(/*#__PURE__*/_jsx(ToastViewport, {
    children: /*#__PURE__*/_jsx(FallbackCapture, {})
  }));

  // Proxy that queues calls until real context is captured
  const pending = [];
  const proxy = {
    addToast: entry => {
      if (fallbackContext && fallbackContext !== proxy) {
        fallbackContext.addToast(entry);
      } else {
        pending.push(entry);
        void ctxReady.then(ctx => {
          for (const e of pending) {
            ctx.addToast(e);
          }
          pending.length = 0;
        });
      }
    },
    removeToast: (id, reason) => {
      if (fallbackContext && fallbackContext !== proxy) {
        fallbackContext.removeToast(id, reason);
      }
    },
    findByUniqueID: uid => {
      if (fallbackContext && fallbackContext !== proxy) {
        return fallbackContext.findByUniqueID(uid);
      }
      return undefined;
    }
  };
  fallbackContext = proxy;
  return proxy;
}
let toastIdCounter = 0;
function generateToastId() {
  return `astryx-toast-${++toastIdCounter}`;
}

/**
 * Hook to show toast notifications.
 *
 * Returns an imperative function that shows a toast and returns a dismiss function.
 * Works with or without a provider — falls back to a self-mounting viewport.
 *
 * @example
 * ```
 * function SaveButton() {
 *   const toast = useToast();
 *   const handleSave = async () => {
 *     try {
 *       await saveData();
 *       toast({ body: 'Saved successfully' });
 *     } catch {
 *       toast({ body: 'Failed to save', type: 'error' });
 *     }
 *   };
 *   return <Button label="Save" onClick={handleSave} />;
 * }
 * ```
 */
export function useToast() {
  const contextFromProvider = use(ToastContext);
  const showToast = useCallback(options => {
    const ctx = contextFromProvider ?? getFallbackContext();
    const id = generateToastId();
    const entry = {
      id,
      options,
      createdAt: Date.now()
    };
    ctx.addToast(entry);
    return () => ctx.removeToast(id, 'manual');
  }, [contextFromProvider]);
  return showToast;
}