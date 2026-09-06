// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file PowerSearchToken.tsx
 * @input PowerSearchTokenProps
 * @output Default token pill for PowerSearch filters
 * @position Public component; used internally by PowerSearch and available for consumer composition
 */
import React from 'react';
import * as stylex from '@stylexjs/stylex';
import { Token } from "../Token/index.js";
import { useTranslator } from "../i18n/index.js";
import { useLocale } from "../i18n/useLocale.js";
import "../theme/tokens.stylex.js";
import { fontWeightVars } from "../theme/tokens.stylex.js";
import { formatFilterValue } from "./formatFilterValue.js";
import { resolveOperatorLabel } from "./resolveOperatorLabel.js";
import { useInternalConfig } from "./useInternalConfig.js";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Default token pill for PowerSearch filters.
 *
 * Renders a field label, operator label, and formatted value inside an Token.
 * This is the built-in implementation used by PowerSearch — exported so consumers
 * can use it as a base when providing custom `components.Token` overrides.
 */
export function PowerSearchToken({
  config: configProp,
  filter,
  field,
  operator,
  maxLength,
  onClick,
  onRemove,
  isDisabled
}) {
  const config = useInternalConfig(configProp);
  const t = useTranslator();
  const locale = useLocale();
  const fieldLabel = field.label;
  const resolvedOperatorLabel = resolveOperatorLabel(operator, t);
  const operatorLabel = resolvedOperatorLabel ? `: ${resolvedOperatorLabel}` : '';
  const tokenLabel = `${fieldLabel}${operatorLabel}`;
  const adjustedMaxLength = Math.max(maxLength - fieldLabel.length - resolvedOperatorLabel.length, 10);
  const valueStr = formatFilterValue(config, operator.value, filter.value, adjustedMaxLength, t, locale);
  const valueContent = valueStr ? /*#__PURE__*/_jsx("span", {
    ...{
      className: "x1lvx875"
    },
    children: valueStr
  }) : undefined;
  return /*#__PURE__*/_jsx(Token, {
    label: tokenLabel,
    endContent: valueContent,
    onClick: onClick ? e => {
      e.stopPropagation();
      onClick();
    } : undefined,
    onRemove: onRemove,
    isDisabled: isDisabled
  });
}
PowerSearchToken.displayName = 'PowerSearchToken';