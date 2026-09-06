// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file DialogContext.ts
 * @input React context
 * @output Internal dialog context for child focus behavior and default labelling
 * @position Dialog internals; consumed by focus-managing children and DialogHeader
 */
import { createContext, use } from 'react';
export const DialogContext = /*#__PURE__*/createContext(null);
DialogContext.displayName = 'DialogContext';
export function useDialogContext() {
  return use(DialogContext);
}