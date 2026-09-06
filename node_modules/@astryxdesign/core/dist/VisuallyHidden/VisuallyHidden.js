// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file VisuallyHidden.tsx
 * @input Uses React createElement/ElementType, stylex
 * @output Exports VisuallyHidden component and VisuallyHiddenProps
 * @position Accessibility primitive; renders content in the a11y tree while
 *   hiding it visually (icon-only labels, aria-live regions, SR-only context)
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/VisuallyHidden/VisuallyHidden.doc.mjs
 * - /packages/core/src/VisuallyHidden/VisuallyHidden.test.tsx
 * - /apps/storybook/stories/VisuallyHidden.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/VisuallyHidden/ (showcase blocks)
 */

import { createElement } from 'react';
import * as stylex from '@stylexjs/stylex';

/**
 * VisuallyHidden is deliberately styling-free: it exists to *not* be seen, so it
 * intentionally omits `xstyle`/`className`/`style`. The clip block is fixed and
 * non-overridable — styling a visually-hidden node is always a mistake. The
 * accessibility pass-throughs from `BaseProps` (`aria-*`, `role`, `id`,
 * `data-*`, event handlers) remain, since the live-region use case needs them.
 */

/**
 * Renders its children in the accessibility tree while hiding them visually.
 *
 * Use for content that assistive technology must perceive but sighted users
 * should not see: accessible names for icon-only controls, `aria-live`
 * announcement regions, and supplementary screen-reader context.
 *
 * @example
 * ```
 * <IconButton icon="trash" label="">
 *   <VisuallyHidden>Delete incident</VisuallyHidden>
 * </IconButton>
 * <VisuallyHidden as="div" aria-live="polite">
 *   {`Moved ${task} to ${column}`}
 * </VisuallyHidden>
 * ```
 */
export function VisuallyHidden({
  children,
  as: element = 'span',
  ref,
  ...props
}) {
  return /*#__PURE__*/createElement(element, {
    ref: ref,
    // Spread consumer props (aria-*, role, id, data-*, handlers) first, then
    // the fixed clip styles, so the visually-hidden class can never be
    // displaced. There is no consumer className/style to merge — by design.
    ...props,
    ...{
      className: "x10l6tqk x1i1rx1s xjm9jq1 xkdpibf x1717udv xb3r6kr xzpqnlu xuxw1ft xng3xce x13vifvy x1o0tod x47corl x87ps6o"
    }
  }, children);
}
VisuallyHidden.displayName = 'VisuallyHidden';