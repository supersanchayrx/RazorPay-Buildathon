// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file BottomSheetSwitcherContext.ts
 * @input Uses React context
 * @output Internal phase and lifecycle context shared by BottomSheetSwitcher and BottomSheet
 * @position Private coordination layer for mutually exclusive BottomSheets
 */
import { createContext } from 'react';
export const BottomSheetSwitcherContext = /*#__PURE__*/createContext(null);
BottomSheetSwitcherContext.displayName = 'BottomSheetSwitcherContext';