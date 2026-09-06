// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file TimestampHoverCard.tsx
 * @input Uses React, HoverCard, IconButton, Icon, formatted lines
 * @output Default-exports the lazily-loaded copyable hover card for Timestamp
 * @position Split out of Timestamp so the overlay (HoverCard) and the copy
 *   affordance's Icon/IconButton load only when a card is actually shown — the
 *   default, card-less Timestamp never bundles this chunk.
 *
 * Layout: a semantic `<dl>` laid out as a grid. Labelled cards use three
 *   columns — label, value, and a trailing action column for copy buttons —
 *   so the buttons align down a single column no matter how wide each value
 *   is. The action column is only added when at least one row is copyable, so
 *   a fully read-only card carries no dangling gutter. Label-less cards drop
 *   the label column and stack to whatever columns remain.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Timestamp/Timestamp.tsx (the lazy() + Suspense wrapper)
 * - /packages/core/src/Timestamp/Timestamp.doc.mjs (theming.targets)
 * - /packages/core/src/Timestamp/Timestamp.test.tsx
 */
import { useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import { HoverCard } from "../HoverCard/index.js";
import { IconButton } from "../IconButton/index.js";
import { Icon } from "../Icon/index.js";
import { useClipboard } from "../hooks/useClipboard.js";
import { useTranslator } from "../i18n/index.js";
import { themeProps } from "../utils/themeProps.js";
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, typeScaleVars, fontWeightVars } from "../theme/tokens.stylex.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const styles = {
  dl: {
    k1xSpc: "xrvj5dj",
    kGNEyG: "x6s0dn4",
    k1C7PZ: "xty4p9g",
    khm7nJ: "x1x7z4sm",
    kogj98: "x1ghz6dp",
    kmVPX3: "x1717udv",
    $$css: true
  }
};

// Grid templates, selected per-card by which columns are present.
// - hasAnyLabel + hasAnyCopyable → label | value | action
// - hasAnyLabel only             → label | value
// - hasAnyCopyable only          → value | action
// - neither                      → value
const gridTemplates = {
  labelValueAction: {
    kumcoG: "x1g3yg12",
    $$css: true
  },
  labelValue: {
    kumcoG: "x1pmbctz",
    $$css: true
  },
  valueAction: {
    kumcoG: "x52fmzj",
    $$css: true
  },
  value: {
    kumcoG: "x1y6fwsi",
    $$css: true
  }
};

/** How long the copied checkmark stays before reverting to the copy icon. */
const COPY_FEEDBACK_MS = 1500;

/**
 * The per-row copy affordance: a compact ghost `IconButton` that writes the
 * row's value to the clipboard, flips `copy` → `check` for a moment, and
 * announces the copy to a polite live region (a swapped aria-label alone
 * isn't reliably announced). A clipboard rejection is a silent no-op. The
 * clipboard write, copied flag, reset timer, and announcement are owned by
 * `useClipboard` — shared with CodeBlock's built-in copy button.
 *
 * Kept as its own component so its state/timer/effect only exist for rows that
 * actually opt into copying — read-only rows render no button and carry none
 * of this machinery.
 */
function CopyButton({
  value
}) {
  const t = useTranslator();
  const {
    copy,
    isCopied: copied
  } = useClipboard({
    announce: t('@astryx.timestamp.copied'),
    resetAfterMs: COPY_FEEDBACK_MS
  });
  const handleCopy = useCallback(() => {
    void copy(value);
  }, [copy, value]);
  return /*#__PURE__*/_jsx(IconButton, {
    variant: "ghost",
    size: "sm",
    icon: /*#__PURE__*/_jsx(Icon, {
      icon: copied ? 'check' : 'copy',
      size: "sm",
      color: "inherit"
    })
    // Visible hover/focus hint via Button's built-in tooltip: 'Copy',
    // flipping to 'Copied' after a successful copy in step with the icon.
    // The full 'Copy <value>' string stays the aria-label for assistive tech.
    ,
    tooltip: t(copied ? '@astryx.timestamp.copied' : '@astryx.timestamp.copy'),
    label: copied ? t('@astryx.timestamp.copied') : t('@astryx.timestamp.copyValue', {
      value
    }),
    onClick: handleCopy,
    ...themeProps('timestamp-copy-button')
  });
}

/**
 * One row of the hover card: an optional label, the formatted instant, and —
 * when the card reserves an action column — a trailing action cell holding the
 * copy button (for a copyable row) or nothing (for a read-only row, so the
 * columns stay aligned). Pure presentation: the copy state lives in
 * {@link CopyButton}, which only copyable rows render.
 */
function EntryRow({
  line,
  hasLabelColumn,
  hasActionColumn
}) {
  return /*#__PURE__*/_jsxs("div", {
    ...{
      className: "xjp7ctv"
    },
    children: [hasLabelColumn && /*#__PURE__*/_jsx("dt", {
      ...{
        className: "xv1l7n4 x141an7d x1ltkj2j x1sodnla x1ghz6dp x1717udv xuxw1ft"
      },
      children: line.label ?? ''
    }), /*#__PURE__*/_jsx("dd", {
      ...{
        className: "x1tgivj0 xjm74w1 xw6l6zx x1sodnla x1ghz6dp x1717udv xuxw1ft"
      },
      children: line.value
    }), hasActionColumn && /*#__PURE__*/_jsx("div", {
      ...{
        className: "x78zum5 x13a6bvl x6s0dn4"
      },
      children: line.isCopyable && /*#__PURE__*/_jsx(CopyButton, {
        value: line.value
      })
    })]
  });
}
function gridTemplateFor(hasLabelColumn, hasActionColumn) {
  if (hasLabelColumn && hasActionColumn) {
    return gridTemplates.labelValueAction;
  }
  if (hasLabelColumn) {
    return gridTemplates.labelValue;
  }
  if (hasActionColumn) {
    return gridTemplates.valueAction;
  }
  return gridTemplates.value;
}

/**
 * The copyable hover card for Timestamp. Renders a semantic `<dl>` as a grid:
 * an optional label column, the value, and — when any row is copyable — a
 * trailing action column carrying that row's copy button, so buttons align
 * down one column. With a single default line this is a one-row card carrying
 * the full absolute time, copyable. Opens on hover and on keyboard focus (the
 * anchor's tab stop), with a dashed-underline affordance signalling it is
 * interactive.
 */
export default function TimestampHoverCard({
  lines,
  label,
  children
}) {
  // A label column is only reserved when some row is labelled; otherwise the
  // value sits flush at the card's leading edge. An action column is only
  // reserved when some row is copyable (option B), so a fully read-only card
  // has no trailing gutter.
  const hasLabelColumn = lines.some(line => line.label != null && line.label !== '');
  const hasActionColumn = lines.some(line => line.isCopyable);
  const cardContent = /*#__PURE__*/_jsx("dl", {
    ...stylex.props(styles.dl, gridTemplateFor(hasLabelColumn, hasActionColumn)),
    children: lines.map((line, index) => /*#__PURE__*/_jsx(EntryRow
    // eslint-disable-next-line @eslint-react/no-array-index-key -- rows are fixed positional slots and two entries may legitimately be identical
    , {
      line: line,
      hasLabelColumn: hasLabelColumn,
      hasActionColumn: hasActionColumn
    }, index))
  });
  return /*#__PURE__*/_jsx(HoverCard, {
    content: cardContent,
    placement: "above",
    focusTrigger: "always",
    hasHoverIndication: true,
    label: label,
    children: children
  });
}
TimestampHoverCard.displayName = 'TimestampHoverCard';