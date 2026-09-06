// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useLightbox.tsx
 * @input Uses React, Lightbox
 * @output Exports useLightbox hook
 * @position Utility hook; wraps Lightbox with trigger props + state management
 *
 * Eliminates boilerplate for lightbox usage. Instead of managing isOpen state
 * and index separately, call open() and the hook handles the rest.
 *
 * @example
 * ```
 * const lightbox = useLightbox({ media: photos });
 * <img onClick={() => lightbox.open(2)} />
 * {lightbox.element}
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Lightbox } from "./Lightbox.js";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Hook for lightbox with trigger props and state management.
 *
 * @example
 * ```
 * const lightbox = useLightbox({ media: photos });
 * {photos.map((photo, i) => (
 *   <img
 *     key={photo.src}
 *     src={photo.src}
 *     alt={photo.alt}
 *     {...lightbox.getTriggerProps(i)}
 *   />
 * ))}
 * {lightbox.element}
 * ```
 */
export function useLightbox(options) {
  const {
    media,
    ...lightboxProps
  } = options;
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const open = useCallback((i = 0) => {
    setIndex(i);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);
  const triggerProps = useMemo(() => ({
    role: 'button',
    tabIndex: 0,
    'aria-haspopup': 'dialog',
    onClick: () => open(),
    onKeyDown: e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    }
  }), [open]);
  const getTriggerProps = useCallback(i => ({
    role: 'button',
    tabIndex: 0,
    'aria-haspopup': 'dialog',
    onClick: () => open(i),
    onKeyDown: e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(i);
      }
    }
  }), [open]);
  const element = useMemo(() => /*#__PURE__*/_jsx(Lightbox, {
    isOpen: isOpen,
    onOpenChange: nextOpen => {
      if (!nextOpen) {
        setIsOpen(false);
      }
    },
    media: media,
    index: index,
    onIndexChange: setIndex,
    ...lightboxProps
  }), [isOpen, media, index, lightboxProps]);
  return {
    open,
    close,
    isOpen,
    index,
    element,
    triggerProps,
    getTriggerProps
  };
}