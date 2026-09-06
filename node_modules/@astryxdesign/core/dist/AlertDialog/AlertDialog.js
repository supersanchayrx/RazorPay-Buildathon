// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file AlertDialog.tsx
 * @input Uses React, StyleX, Dialog, Layout, Heading, Text, Button
 * @output Exports AlertDialog component, AlertDialogProps type
 * @position Core implementation; consumed by index.ts, tested by AlertDialog.test.tsx
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/AlertDialog/AlertDialog.doc.mjs (props table, features, examples)
 * - /packages/core/src/AlertDialog/AlertDialog.test.tsx (tests for new/changed behavior)
 * - /packages/core/src/AlertDialog/index.ts (exports if types change)
 * - /apps/storybook/stories/AlertDialog.stories.tsx (storybook stories)
 * - /packages/cli/assets/templates/blocks/components/AlertDialog/ (showcase blocks)
 */
import React, { useId, useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Dialog } from "../Dialog/index.js";
import { Layout } from "../Layout/Layout.js";
import { LayoutContent } from "../Layout/LayoutContent.js";
import { LayoutFooter } from "../Layout/LayoutFooter.js";
import { Stack } from "../Stack/index.js";
import { Heading } from "../Heading/Heading.js";
import { Text } from "../Text/Text.js";
import { Button } from "../Button/index.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { useTranslator } from "../i18n/index.js";
import { useMediaQuery } from "../hooks/index.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const SMALL_SCREEN_QUERY = '(max-width: 640px)';
const styles = {
  action: {
    ks0D6T: "x193iq5w",
    k7Eaqz: "xeuugli",
    $$css: true
  },
  stackedAction: {
    kzqmXN: "xh8yej3",
    $$css: true
  }
};
/**
 * A confirmation dialog for destructive or irreversible actions.
 *
 * Implements the WAI-ARIA APG Alert Dialog pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/
 *
 * Uses `role="alertdialog"` and requires explicit user action to dismiss.
 * Cannot be dismissed by clicking outside. Escape key triggers cancel.
 * Initial focus goes to the cancel button (least destructive action), pinned
 * with `data-autofocus` so it survives any change to the footer's order.
 *
 * The `isInline` preview path is not modal, so it renders `role="group"`
 * instead — the alertdialog role would promise modality it does not have.
 *
 * @example
 * ```
 * <AlertDialog
 *   isOpen={isOpen}
 *   onOpenChange={setIsOpen}
 *   title="Delete item?"
 *   description="This action cannot be undone."
 *   actionLabel="Delete"
 *   onAction={async () => { await deleteItem(); setIsOpen(false); }}
 * />
 * ```
 */
export function AlertDialog({
  ref,
  isOpen,
  isInline,
  onOpenChange,
  title,
  description,
  cancelLabel: cancelLabelFromProps,
  actionLabel,
  actionVariant = 'destructive',
  isActionLoading,
  onAction,
  width = 400,
  xstyle,
  className,
  style,
  'data-testid': testId,
  ...rest
}) {
  const t = useTranslator();
  const cancelLabel = cancelLabelFromProps ?? t('@astryx.alertDialog.cancel');
  const titleId = useId();
  const descriptionId = useId();
  // Width stays delegated to Dialog: this query exists only so AlertDialog can
  // keep narrow visual, DOM, and tab order aligned for its destructive/cancel
  // semantics without coupling action order to pointer or hover capability.
  const isSmallScreen = useMediaQuery(SMALL_SCREEN_QUERY);
  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  const buttonActionStyle = [styles.action, isSmallScreen && styles.stackedAction];
  const cancelButton = /*#__PURE__*/_jsx(Button, {
    variant: "ghost",
    label: cancelLabel,
    onClick: handleCancel,
    xstyle: buttonActionStyle
    // Dialog focuses [data-autofocus] itself after showModal(), because
    // React's autoFocus runs during commit while the dialog is invisible.
    // Cancel is least destructive, so it remains the autofocus target even
    // when small-screen visual order places the destructive action above it.
    ,
    "data-autofocus": true
  }, "cancel");
  const actionButton = /*#__PURE__*/_jsx(Button, {
    variant: actionVariant,
    label: actionLabel,
    onClick: onAction,
    isLoading: isActionLoading,
    xstyle: buttonActionStyle
  }, "action");
  return /*#__PURE__*/_jsx(Dialog, {
    ...rest,
    ref: ref,
    isOpen: isOpen,
    isInline: isInline,
    onOpenChange: onOpenChange,
    width: width,
    purpose: "form"
    // `alertdialog` is a modal role: it promises an interruption the user
    // has to deal with, a focus trap, and an inert page behind it. The
    // inline path renders a plain always-present div with none of that, so
    // the role would misdescribe it. `group` keeps the title and
    // description associated with a container without claiming a dialog.
    ,
    role: isInline ? 'group' : 'alertdialog',
    "aria-labelledby": titleId,
    "aria-describedby": descriptionId,
    ...mergeProps(themeProps('alert-dialog'), {
      className,
      style
    }),
    xstyle: xstyle,
    "data-testid": testId,
    children: /*#__PURE__*/_jsx(Layout, {
      content: /*#__PURE__*/_jsxs(LayoutContent, {
        children: [/*#__PURE__*/_jsx(Heading, {
          level: 2,
          id: titleId,
          children: title
        }), /*#__PURE__*/_jsx(Text, {
          type: "body",
          color: "secondary",
          id: descriptionId,
          children: description
        })]
      }),
      footer: /*#__PURE__*/_jsx(LayoutFooter, {
        children: /*#__PURE__*/_jsx(Stack, {
          direction: isSmallScreen ? 'vertical' : 'horizontal',
          gap: 2,
          hAlign: isSmallScreen ? 'stretch' : 'end',
          wrap: isSmallScreen ? 'nowrap' : 'wrap',
          children: isSmallScreen ? [actionButton, cancelButton] : [cancelButton, actionButton]
        })
      })
    })
  });
}
AlertDialog.displayName = 'AlertDialog';