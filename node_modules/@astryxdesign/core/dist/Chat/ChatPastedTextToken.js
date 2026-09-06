// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file ChatPastedTextToken.tsx
 * @input Uses React, StyleX, Badge, HoverCard, Button, CodeBlock
 * @output Exports ChatPastedTextToken component
 * @position Inline token for pasted text with hover card preview + expand
 *
 * Hover: card with truncated text preview and "Expand" button.
 * Expand replaces the token with the full text in the contentEditable.
 *
 * SYNC: When modified, update:
 * - /packages/core/src/Chat/index.ts (exports)
 */
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars, typographyVars } from "../theme/tokens.stylex.js";
import { Badge } from "../Badge/index.js";
import { Button } from "../Button/index.js";
import { HoverCard } from "../HoverCard/index.js";
import { useTranslator } from "../i18n/index.js";

// =============================================================================
// Types
// =============================================================================
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime"; // =============================================================================
// Styles
// =============================================================================
// =============================================================================
// Helpers
// =============================================================================

function formatLabel(text) {
  const lines = text.split('\n').length;
  const chars = text.length;
  return lines > 1 ? `${lines} lines, ${chars} chars` : `${chars} chars`;
}

// =============================================================================
// Component
// =============================================================================

export function ChatPastedTextToken({
  text,
  onExpand
}) {
  const t = useTranslator();
  const label = formatLabel(text);
  const cardContent = /*#__PURE__*/_jsxs("div", {
    ...{
      className: "x78zum5 xdt5ytf x1txdalj x17fpy1y"
    },
    children: [/*#__PURE__*/_jsx("div", {
      ...{
        className: "x9m5x89 x141an7d x1ltkj2j x1tgivj0 x126k92a x13faqbe x1xiyphd x1odjw0f"
      },
      children: text
    }), /*#__PURE__*/_jsxs("div", {
      ...{
        className: "x78zum5 x6s0dn4 x1qughib x1txdalj"
      },
      children: [/*#__PURE__*/_jsx("span", {
        ...{
          className: "x141an7d xv1l7n4"
        },
        children: label
      }), onExpand && /*#__PURE__*/_jsx(Button, {
        label: t('@astryx.chat.pastedText.expand'),
        variant: "ghost",
        size: "sm",
        onClick: onExpand
      })]
    })]
  });
  return /*#__PURE__*/_jsx(HoverCard, {
    content: cardContent,
    placement: "above",
    alignment: "start",
    hasHoverIndication: false,
    children: /*#__PURE__*/_jsx(Badge, {
      label: label,
      variant: "neutral"
    })
  });
}
ChatPastedTextToken.displayName = 'ChatPastedTextToken';