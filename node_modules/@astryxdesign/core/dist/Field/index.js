// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file index.ts
 * @input Imports Field component and types from Field.tsx, FieldLabel from FieldLabel.tsx, FieldStatus from FieldStatus.tsx
 * @output Exports Field, FieldProps, FieldStatusInput, FieldStatusType, FieldLabel, FieldLabelProps, FieldStatus component
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * SYNC: When modified, update this header and /packages/core/src/Field/Field.doc.mjs
 */
export { Field } from "./Field.js";
export { FieldLabel } from "./FieldLabel.js";
export { FieldStatus } from "../FieldStatus/index.js";

// Shared input types

// Shared input styles
export { inputWrapperStyles, inputStatusBorderStyles, inputStatusHoverShadowStyles, inputStatusFocusWithinStyles, inputStatusFocusStyles } from "./inputStyles.stylex.js";

// Shared input components
export { InputClearButton } from "./InputClearButton.js";