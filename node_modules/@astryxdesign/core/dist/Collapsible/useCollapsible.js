// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useCollapsible.ts
 * @input Uses React useState/use, CollapsibleGroupContext
 * @output Exports useCollapsible hook, CollapsibleConfig (formerly CollapsibleConfig), UseCollapsibleOptions, UseCollapsibleReturn types
 * @position Reusable hook for collapsible behavior — used by Card, Section, etc.
 *
 * Encapsulates the full collapsible state machine:
 * - Parsing boolean | config into normalized config
 * - Checking for CollapsibleGroup context (group-controlled mode)
 * - Managing internal state for uncontrolled mode
 * - Providing a unified toggle handler
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Collapsible/index.ts (exports)
 * - /packages/core/src/Collapsible/Collapsible.doc.mjs
 *
 * NOTE: Public hooks use the `useXDS` prefix per Astryx naming conventions.
 */
import { useState, use } from 'react';
import { CollapsibleGroupContext } from "./CollapsibleGroupContext.js";

/**
 * Configuration for collapsible behavior.
 */

/**
 * Hook that encapsulates collapsible state management.
 *
 * Supports three modes:
 * 1. **Group-controlled**: When inside a CollapsibleGroup with a `value`, defers to group.
 * 2. **Controlled**: When `isOpen` is provided in config, the parent owns state;
 *    `toggle` only calls `onOpenChange` and never mutates internal state.
 * 3. **Uncontrolled**: Self-managed internal state with optional `defaultIsOpen`.
 *    `onOpenChange`, if supplied, is invoked in addition to the internal update —
 *    it is a notification callback, not a signal that the component is controlled.
 *
 * @example
 * ```
 * const {isEnabled, isOpen, toggle} = useCollapsible({
 *   isCollapsible: true,
 *   value: 'section-1',
 * });
 * ```
 */
export function useCollapsible(options) {
  const {
    isCollapsible,
    value
  } = options;

  // Check for CollapsibleGroup context
  const group = use(CollapsibleGroupContext);
  const isControlledByGroup = group != null && value != null;

  // Parse config: true → empty config, object → as-is, false/undefined → null
  const config = isCollapsible === true ? {} : isCollapsible ? isCollapsible : null;
  const isEnabled = config != null;

  // Internal state for uncontrolled mode
  const [internalIsOpen, setInternalIsOpen] = useState(() => {
    if (isControlledByGroup) {
      return true;
    } // group manages this
    if (config?.isOpen !== undefined) {
      return config.isOpen;
    }
    return config?.defaultIsOpen ?? true;
  });

  // Determine open state from the appropriate source
  let isOpen;
  if (isControlledByGroup && value != null) {
    isOpen = group.isOpen(value);
  } else if (config?.isOpen !== undefined) {
    isOpen = config.isOpen;
  } else {
    isOpen = internalIsOpen;
  }

  // Toggle handler dispatches to the appropriate controller.
  //
  // Controlled vs uncontrolled is decided by whether `isOpen` was provided —
  // mirroring how `isOpen` is derived above. `onOpenChange` is a notification
  // callback, not a signal of control: an uncontrolled component may still want
  // to observe changes. So in uncontrolled mode we drive internal state AND
  // fire the callback; only in controlled mode do we defer entirely to the
  // parent via the callback.
  const toggle = () => {
    if (isControlledByGroup && value != null) {
      group.toggle(value);
      return;
    }
    const next = !isOpen;
    // Uncontrolled: internal state is the source of truth, so update it.
    if (config?.isOpen === undefined) {
      setInternalIsOpen(next);
    }
    // Always notify — for both controlled and uncontrolled usage.
    config?.onOpenChange?.(next);
  };
  return {
    isEnabled,
    isOpen,
    toggle
  };
}