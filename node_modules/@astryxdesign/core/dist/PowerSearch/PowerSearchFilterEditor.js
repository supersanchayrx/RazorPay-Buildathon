// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file PowerSearchFilterEditor.tsx
 * @input PowerSearchEditorProps
 * @output Default editor popover content for PowerSearch filters
 * @position Public component; used internally by PowerSearch and available for consumer composition
 */
import React from 'react';
import { PowerSearchEditPopover } from "./PowerSearchEditPopover.js";
import { useInternalConfig } from "./useInternalConfig.js";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Default filter editor for PowerSearch.
 *
 * Renders the full editing experience: field selector, operator selector,
 * value editor, and save/cancel buttons. This is the built-in implementation
 * used by PowerSearch — exported so consumers can use it as a base when
 * providing custom `components.Editor` overrides.
 */
export function PowerSearchFilterEditor({
  config: configProp,
  filter,
  mode,
  onSave,
  onCancel,
  saveButtonLabel,
  isReadOnly
}) {
  const config = useInternalConfig(configProp);
  return /*#__PURE__*/_jsx(PowerSearchEditPopover, {
    config: config,
    filter: filter,
    mode: mode,
    onSave: onSave,
    onCancel: onCancel,
    saveButtonLabel: saveButtonLabel,
    isReadOnly: isReadOnly
  }, filter.field);
}
PowerSearchFilterEditor.displayName = 'PowerSearchFilterEditor';