// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file InputGroupText.tsx
 * @input Uses React, StyleX, theme tokens
 * @output Exports InputGroupText component
 * @position Text/icon element rendered inside InputGroup
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/InputGroup/InputGroup.doc.mjs
 * - /packages/core/src/InputGroup/index.ts
 * - /packages/cli/assets/templates/blocks/components/InputGroup/
 */
import React from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, spacingVars, radiusVars, typographyVars, typeScaleVars, borderVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
  text: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kg3NbH: "xf314gf",
    kWkggS: "xwmxj5m",
    kMv6JI: "x9ynric",
    kGuDYH: "xjm74w1",
    kLWn49: "xw6l6zx",
    kMwMTN: "xv1l7n4",
    khDVqt: "xuxw1ft",
    kmuXW: "x2lah0s",
    kMzoRj: "x1litavf",
    ksu8eU: "x1y0btm7",
    kVAM5u: "xvy26l8",
    keTefX: "xd10s4z x1pwwqoy",
    krdFHd: "x15mokao x8eehn2",
    kVL7Gh: "xbiv7yw x1xrp5p4",
    kfmiAY: "x1ga7v0g x11xp8u1",
    kT0f0o: "x16uus16 x747jw7",
    $$css: true
  }
};
/**
 * A prefix or suffix text element for use inside InputGroup.
 *
 * @example
 * ```
 * <InputGroup label="URL">
 *   <InputGroupText>https://</InputGroupText>
 *   <TextInput label="URL" isLabelHidden value={url} onChange={setUrl} />
 * </InputGroup>
 * ```
 */
export function InputGroupText({
  ref,
  children,
  xstyle,
  className,
  style,
  ...rest
}) {
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    ...rest,
    ...mergeProps(themeProps('input-group-text'), stylex.props(styles.text, xstyle), className, style),
    children: children
  });
}
InputGroupText.displayName = 'InputGroupText';