// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file ProgressBarMarkTooltip.tsx
 * @input Uses React, Tooltip, the mark element to wrap, and its label
 * @output Default-exports the lazily-loaded Tooltip wrapper for a labeled mark
 * @position Split out of ProgressBar so the Tooltip only loads when a mark is
 *   actually rendered — a ProgressBar with no marks never bundles the Tooltip
 *   chunk.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/ProgressBar/ProgressBar.tsx (the lazy() + Suspense wrapper)
 * - /packages/core/src/ProgressBar/ProgressBar.test.tsx
 */
import { Tooltip } from "../Tooltip/Tooltip.js";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Wraps a labeled mark in a `Tooltip` that reveals its label on hover and
 * keyboard focus. Placement and focus behavior match the inline usage this
 * split replaced (`placement="above"`, `focusTrigger="always"`), so the
 * rendered result is identical — only the load timing changes.
 */
export default function ProgressBarMarkTooltip({
  content,
  children
}) {
  return /*#__PURE__*/_jsx(Tooltip, {
    content: content,
    placement: "above",
    focusTrigger: "always",
    children: children
  });
}