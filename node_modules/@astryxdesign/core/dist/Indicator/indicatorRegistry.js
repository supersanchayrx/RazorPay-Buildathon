// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file indicatorRegistry.ts
 * @input Theme source and indicator name
 * @output Exports the default indicator map and getIndicator resolution
 * @position Server-safe indicator resolver; no 'use client' so it is
 *           importable from RSC
 *
 * Two name spaces meet here, and keeping them apart is the whole design:
 *
 *   - {@link CoreIndicatorName} — the indicators Astryx itself ships. Closed,
 *     and every one of them has a default, so resolving one always yields a
 *     component.
 *   - {@link IndicatorName} — every indicator name that exists, including the
 *     ones other packages add by augmenting `IndicatorMap`. Open, and core has
 *     no default for a name it has never heard of.
 *
 * `getIndicator` is overloaded along that seam: a core name resolves to a
 * component, an augmented name resolves to a component *or* `undefined`, and
 * the caller has to say what to do about it. Typing the map as total over the
 * open union instead — which is what shipped in #4712 — made the compiler
 * promise a component for `getIndicator('brand-star')` and hand back
 * `undefined` at runtime.
 */

import { getRegisteredTheme } from "../theme/themeRegistry.js";
import { CheckboxIndicator } from "./CheckboxIndicator.js";
import { CheckIndicator } from "./CheckIndicator.js";
import { RadioIndicator } from "./RadioIndicator.js";

/**
 * The indicator names Astryx ships a default for.
 *
 * Written out rather than derived from {@link IndicatorMap}, because that
 * interface is open to augmentation and this set is not: it is exactly what is
 * in {@link defaultIndicators} below. `indicatorRegistry.test.tsx` pins the two
 * together in both directions.
 */

/**
 * The indicators Astryx ships. A theme's `indicators` entries override these
 * by name.
 *
 * Typed per family (rather than as one widened component type) so a default
 * declared here has to accept the states its family passes — the same rule
 * {@link IndicatorRegistry} holds replacements to.
 */
export const defaultIndicators = {
  check: CheckIndicator,
  checkbox: CheckboxIndicator,
  radio: RadioIndicator
};
function getTheme(source) {
  if (source == null) {
    return null;
  }
  return typeof source === 'string' ? getRegisteredTheme(source) : source;
}
function getThemeIndicators(source) {
  return getTheme(source)?.indicators ?? null;
}

/**
 * Resolve an indicator component by name, preferring the theme's override and
 * falling back to the built-in indicator.
 *
 * Works in both server and client environments. Client components should use
 * the {@link useIndicator} hook, which resolves against the nearest `<Theme>`.
 *
 * @example
 * ```
 * const Radio = getIndicator('radio', themeName);
 * <Radio state="checked" />
 * ```
 *
 * For a name contributed by augmentation there is no built-in to fall back to,
 * so the result is `undefined` unless a theme supplies one — the package that
 * added the name owns its default:
 *
 * @example
 * ```
 * const Star = getIndicator('brand-star', themeName) ?? BrandStar;
 * ```
 */

export function getIndicator(name, source) {
  const override = getThemeIndicators(source)?.[name];
  return override ??
  // `name` may be an augmented one, which this map has no entry for — hence
  // the `| undefined` the overloads expose to those callers.
  defaultIndicators[name];
}