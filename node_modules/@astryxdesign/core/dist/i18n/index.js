// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file index.ts
 * @input Imports from InternationalizationProvider, InternationalizationContext,
 *   useTranslator, translator, types
 * @output Public surface for the i18n subpackage
 * @position Component entry point; re-exported by /packages/core/src/index.ts
 *
 * The public API is deliberately small:
 *   - InternationalizationProvider — provider component
 *   - useTranslator               — hook returning a translator function
 *   - useLocale                   — hook returning the provider locale
 *   - useCollator                 — provider-bound locale-aware comparison
 *   - useDirection                — hook returning the ambient text direction
 *   - getLocaleDirection          — server-safe locale → direction helper
 *   - Translator                  — interface for consumer-injected runtimes
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/index.ts
 * - /packages/core/src/i18n/useLocale.ts
 * - /packages/core/src/i18n/useCollator.ts
 * - /packages/core/src/i18n/useDirection.ts
 * - /packages/core/src/i18n/getLocaleDirection.ts
 */

export { InternationalizationProvider } from "./InternationalizationProvider.js";
export { InternationalizationContext } from "./InternationalizationContext.js";
export { useTranslator } from "./useTranslator.js";
export { useLocale } from "./useLocale.js";
export { useCollator } from "./useCollator.js";
export { useDirection } from "./useDirection.js";
export { getLocaleDirection } from "./getLocaleDirection.js";