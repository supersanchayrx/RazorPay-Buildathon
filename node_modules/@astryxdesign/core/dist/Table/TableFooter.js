// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import * as stylex from '@stylexjs/stylex';
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx } from "react/jsx-runtime";
export function TableFooter({
  ref,
  children,
  xstyle,
  className,
  style,
  ...rest
}) {
  return /*#__PURE__*/_jsx("tfoot", {
    ref: ref,
    ...mergeProps(themeProps('table-footer'), stylex.props(xstyle), className, style),
    ...rest,
    children: children
  });
}
TableFooter.displayName = 'TableFooter';