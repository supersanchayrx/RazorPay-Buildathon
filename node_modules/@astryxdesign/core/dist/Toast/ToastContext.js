// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import { createContext } from 'react';

/** Internal context value for toast state management. */

/**
 * React context for toast state. Default is null — the hook
 * falls back to a self-mounting viewport when no provider exists.
 */
export const ToastContext = /*#__PURE__*/createContext(null);
ToastContext.displayName = 'ToastContext';