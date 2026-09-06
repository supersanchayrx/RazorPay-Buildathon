// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useIndicator.ts
 * @input Indicator name
 * @output Exports useIndicator hook for theme-aware indicator components
 * @position Client hook used by controls that render a selection visual
 */
import { useThemeName } from "../theme/useTheme.js";
import { getIndicator } from "./indicatorRegistry.js";

/**
 * Resolve an indicator component from the nearest `<Theme>`.
 *
 * A core indicator always resolves. A name contributed by augmentation
 * resolves only if a theme supplies it, so that overload returns
 * `| undefined` — see {@link getIndicator}.
 *
 * @example
 * ```
 * const Checkbox = useIndicator('checkbox');
 * return <Checkbox state={isChecked ? 'checked' : 'unchecked'} size={size} />;
 * ```
 */

export function useIndicator(name) {
  return getIndicator(name, useThemeName());
}