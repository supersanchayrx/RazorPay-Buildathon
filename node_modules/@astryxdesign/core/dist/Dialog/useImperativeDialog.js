// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useImperativeDialog.tsx
 * @input Uses React, Dialog
 * @output Exports useImperativeDialog hook
 * @position Utility hook; wraps Dialog with imperative show/hide API
 *
 * Eliminates boilerplate for dialogs that don't need controlled state.
 * Instead of managing isOpen + content state, call show() with content
 * and the dialog handles the rest.
 *
 * @example
 * ```
 * const dialog = useImperativeDialog();
 * <button onClick={() => dialog.show(<MyContent />)}>Open</button>
 * {dialog.element}
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Dialog } from "./Dialog.js";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Imperative dialog — show/hide without managing state.
 *
 * @example
 * ```
 * const dialog = useImperativeDialog();
 * onClick={() => dialog.show(
 *   <CodeBlock code={output} language="bash" />
 * )}
 * return <>{dialog.element}</>;
 * ```
 */
export function useImperativeDialog(defaultOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState(null);
  const [options, setOptions] = useState(defaultOptions);
  const show = useCallback((newContent, newOptions) => {
    setContent(newContent);
    if (newOptions) {
      setOptions(prev => ({
        ...prev,
        ...newOptions
      }));
    }
    setIsOpen(true);
  }, []);
  const hide = useCallback(() => {
    setIsOpen(false);
  }, []);
  const element = useMemo(() => /*#__PURE__*/_jsx(Dialog, {
    isOpen: isOpen,
    onOpenChange: open => {
      if (!open) {
        setIsOpen(false);
      }
    },
    ...(defaultOptions ?? {}),
    ...(options ?? {}),
    children: content
  }), [isOpen, content, options, defaultOptions]);
  return {
    show,
    hide,
    isOpen,
    element
  };
}