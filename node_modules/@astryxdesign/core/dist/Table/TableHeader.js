// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import * as stylex from '@stylexjs/stylex';
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx } from "react/jsx-runtime";
export function TableHeader({
  ref,
  children,
  xstyle,
  className,
  style,
  ...rest
}) {
  return /*#__PURE__*/_jsx("thead", {
    ref: ref,
    ...mergeProps(themeProps('table-header'), stylex.props(xstyle), className, style),
    ...rest,
    children: children
  });
}
TableHeader.displayName = 'TableHeader';