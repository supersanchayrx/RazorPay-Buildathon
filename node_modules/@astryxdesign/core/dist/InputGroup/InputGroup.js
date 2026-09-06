// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file InputGroup.tsx
 * @input Uses React, StyleX, theme tokens, InputGroupContext, Field
 * @output Exports InputGroup component with group label/description ARIA wiring
 * @position Groups input with prefix/suffix addons; consumed by index.ts
 *
 * Children (TextInput, NumberInput, TimeInput, DateInput, Typeahead,
 * Selector, MultiSelector) consume the InputGroup context
 * to remove their own border/radius so the group container provides
 * the unified border treatment.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/InputGroup/InputGroup.doc.mjs
 * - /packages/core/src/InputGroup/InputGroup.test.tsx
 * - /packages/core/src/InputGroup/index.ts
 * - /apps/storybook/stories/InputGroup.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/InputGroup/
 */
import { useId, useMemo } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { sizeVars } from "../theme/tokens.stylex.js";
import { Field } from "../Field/index.js";
import { SizeProvider, useSize } from "../SizeContext/SizeContext.js";
import { mergeProps } from "../utils/index.js";
import { InputGroupContext } from "./InputGroupContext.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  group: {
    k1xSpc: "x3nfvp2",
    kGNEyG: "x1qjc9v5",
    kWkggS: "xjbqb8w",
    $$css: true
  },
  disabled: {
    kkrTdU: "xt0e3qv",
    kSiTet: "xbyyjgo",
    $$css: true
  }
};
const sizeStyles = {
  sm: {
    kZKoxP: "x6k0iem",
    $$css: true
  },
  md: {
    kZKoxP: "x1ueg155",
    $$css: true
  },
  lg: {
    kZKoxP: "xssyfek",
    $$css: true
  }
};
/**
 * Groups an input with prefix/suffix addons in a visually connected
 * container with shared border and focus ring.
 *
 * @example
 * ```
 * <InputGroup label="Price">
 *   <InputGroupText>$</InputGroupText>
 *   <TextInput label="Price" isLabelHidden value={price} onChange={setPrice} />
 * </InputGroup>
 * ```
 */
export function InputGroup({
  children,
  label,
  isLabelHidden = false,
  description,
  isDisabled = false,
  isOptional = false,
  isRequired = false,
  size: sizeProp,
  status,
  labelTooltip,
  xstyle,
  className,
  style,
  ref,
  'data-testid': testId,
  ...rest
}) {
  const size = useSize(sizeProp, 'md');
  const inputId = useId();
  const labelID = useId();
  const descriptionID = useId();
  const statusMessageId = useId();
  const describedByIDs = [description ? descriptionID : null, status?.message ? statusMessageId : null].filter(Boolean).join(' ') || undefined;
  const contextValue = useMemo(() => ({
    isInGroup: true,
    labelID,
    describedByIDs
  }), [labelID, describedByIDs]);
  return /*#__PURE__*/_jsx(InputGroupContext, {
    value: contextValue,
    children: /*#__PURE__*/_jsx(SizeProvider, {
      value: size,
      children: /*#__PURE__*/_jsx(Field, {
        label: label,
        isLabelHidden: isLabelHidden,
        description: description,
        inputID: inputId,
        labelID: labelID,
        descriptionID: description ? descriptionID : undefined,
        isGroupLabel: true,
        isOptional: isOptional,
        isRequired: isRequired,
        isDisabled: isDisabled,
        status: status ? {
          type: status.type,
          message: status.message,
          messageID: status.message ? statusMessageId : undefined
        } : undefined,
        statusVariant: "detached",
        labelTooltip: labelTooltip,
        children: /*#__PURE__*/_jsx("div", {
          ref: ref,
          "data-testid": testId,
          ...rest,
          role: "group",
          "aria-labelledby": labelID,
          "aria-describedby": describedByIDs,
          ...mergeProps(themeProps('input-group', {
            size,
            status: status?.type ?? null
          }), stylex.props(styles.group, sizeStyles[size], isDisabled && styles.disabled, xstyle), className, style),
          children: children
        })
      })
    })
  });
}
InputGroup.displayName = 'InputGroup';