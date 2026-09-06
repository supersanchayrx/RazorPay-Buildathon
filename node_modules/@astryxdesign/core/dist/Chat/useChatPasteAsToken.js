// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useChatPasteAsToken.ts
 * @input Uses React refs, callbacks
 * @output Exports useChatPasteAsToken hook
 * @position Utility hook — composable paste behavior for ChatComposerInput
 *
 * Intercepts paste events and converts long text into a token chip
 * instead of inserting raw text into the contentEditable. Short
 * pastes pass through normally.
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Chat/index.ts (exports)
 */
import { useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Default token factory
// =============================================================================

function defaultToToken(text) {
  const lines = text.split('\n').length;
  const chars = text.length;
  const label = lines > 1 ? `${lines} lines, ${chars} chars` : `${chars} chars`;
  return {
    value: text,
    label,
    variant: 'neutral'
  };
}

// =============================================================================
// Hook
// =============================================================================

export function useChatPasteAsToken({
  inputRef,
  threshold = 200,
  toToken = defaultToToken
}) {
  const onPaste = useCallback((_event, text) => {
    if (text.length <= threshold) {
      return false;
    }
    const token = toToken(text);
    inputRef.current?.insertToken(token);
    return true;
  }, [inputRef, threshold, toToken]);
  return {
    onPaste
  };
}