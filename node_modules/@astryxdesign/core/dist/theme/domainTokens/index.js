// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file domainTokens/index.ts
 * @input None (re-exports sub-modules)
 * @output domainTokenDefaults, DomainTokenName
 * @position Token aggregator; consumed by defineTheme for validation + autocomplete
 *
 * Merges all domain token defaults into a single map for defineTheme.
 * Actual token definitions live in their own directories (syntax/, dataviz/).
 */

export { syntaxTokenDefaults } from "../syntax/tokens.js";
export { dataTokenDefaults } from "./dataTokens.js";
import { syntaxTokenDefaults } from "../syntax/tokens.js";
import { dataTokenDefaults } from "./dataTokens.js";
/** All domain token defaults merged — used by defineTheme for validation */
export const domainTokenDefaults = {
  ...syntaxTokenDefaults,
  ...dataTokenDefaults
};

/** Union of all domain token names */