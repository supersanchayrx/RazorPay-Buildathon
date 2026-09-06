// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file inputAria.ts
 * @input Receives input label/description IDs and optional InputGroup context
 * @output Exports helpers for consistent input ARIA composition
 * @position Internal utility; used by inputs that compose labels/descriptions
 */

function joinAriaIDs(...values) {
  const ids = values.flatMap(value => typeof value === 'string' ? value.trim().split(/\s+/) : []).filter(Boolean);
  if (ids.length === 0) {
    return undefined;
  }
  return Array.from(new Set(ids)).join(' ');
}

/**
 * Builds ARIA label/description wiring for an input.
 *
 * Standalone inputs keep their normal native label association. Grouped inputs
 * are named by the visible InputGroup label plus their own input label, and
 * inherit group description/status text in addition to input-local text.
 */
export function getInputARIA(labelID, describedByIDs = [], inputGroup) {
  return {
    ariaLabelledBy: inputGroup ? joinAriaIDs(inputGroup.labelID, labelID) : undefined,
    ariaDescribedBy: joinAriaIDs(inputGroup?.describedByIDs, ...describedByIDs)
  };
}