// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useContainerReveal.ts
 * @input Uses the containerReveal styles
 * @output Exports useContainerReveal — a headless hover/focus reveal primitive
 * @position Core hook. Consumed by any component that reveals (or conceals)
 *   content when its container is hovered or focused — e.g. Thumbnail's remove
 *   button, TreeList row actions.
 *
 * Gives a container a scoped hover/focus-within trigger that reveals or
 * conceals content inside it, entirely in CSS (no hover state in JS, no
 * re-render on hover). The caller authors NO StyleX: the hook hands out the
 * container style and the matching content styles.
 *
 * Scoping is by inheritance: the container publishes its reveal state as
 * custom properties on itself and the content reads them, so a nested
 * container shadows its ancestor's state for its own subtree. See
 * containerReveal.stylex.ts.
 *
 * Two levers sit on top of the pointer, both still CSS-only. On the container:
 * `hoverDelay` (dwell before the reveal starts — the Tooltip / HoverCard
 * intent gate applied to a reveal) and `forceState` (pin the trigger state a
 * caller owns: a motion gate, a scroll, an open menu). On a single piece of
 * content: `forceVisibility`, which pins how THAT element looks. State belongs
 * to the container because one container feeds children whose looks are
 * opposite; appearance belongs to the element, where it is unambiguous.
 * Neither lever can hide content from a keyboard user — see ACCESSIBILITY.
 *
 * ACCESSIBILITY (WCAG 2.2 by construction):
 * - Revealed content is visually hidden at rest via position + opacity, so it
 *   stays in the accessibility tree and tab order — never display:none.
 * - Keyboard: revealed on :focus-within, so tabbing in shows it — with no dwell
 *   to wait through, and neither an inactive container nor a forced-hidden
 *   element can keep it dark.
 * - Touch: always visible on coarse pointers; never gated behind hover.
 * - Concealed (inverted) content is a mouse-only visual swap: it ignores
 *   :focus-within (a keyboard user must never watch content vanish) and stays
 *   visible on touch and in the a11y tree.
 * - Motion: honors prefers-reduced-motion.
 *
 * SYNC: When modified, update:
 * - /packages/core/src/hooks/index.ts (export)
 * - containerReveal.stylex.ts (if the style blocks change)
 */
import { useMemo } from 'react';
import * as stylex from '@stylexjs/stylex';
import { styles } from "./containerReveal.stylex.js";
const EMPTY = Object.freeze({});

/**
 * Scoped, CSS-only hover/focus reveal for content inside a container.
 *
 * @example
 * ```
 * const {getContainerProps, getContentRevealProps} = useContainerReveal({
 *   isEnabled: revealOn === 'hover',
 * });
 *
 * <div
 *   {...mergeProps(
 *     getContainerProps({hoverDelay: 120, forceState: gateState}),
 *     stylex.props(styles.row),
 *   )}>
 *   {label}
 *   <span {...mergeProps(getContentRevealProps(), stylex.props(styles.actions))}>
 *     {actions}
 *   </span>
 * </div>
 * ```
 */
export function useContainerReveal(options = {}) {
  const {
    isEnabled = true
  } = options;
  return useMemo(() => {
    if (!isEnabled) {
      return {
        getContainerProps: () => EMPTY,
        getContentRevealProps: () => EMPTY
      };
    }
    return {
      getContainerProps: (containerOptions = {}) => {
        const {
          forceState,
          hoverDelay = 0
        } = containerOptions;
        return stylex.props(styles.container, hoverDelay > 0 && styles.hoverDelay(`${hoverDelay}ms`), forceState === 'inactive' && styles.stateInactive, forceState === 'active' && styles.stateActive);
      },
      getContentRevealProps: (contentOptions = {}) => {
        const {
          isRevealInverted = false,
          isLayoutPreserved = false,
          forceVisibility
        } = contentOptions;
        const style = isRevealInverted ? isLayoutPreserved ? styles.concealLayoutPreserved : styles.conceal : isLayoutPreserved ? styles.revealLayoutPreserved : styles.reveal;
        return stylex.props(style, forceVisibility === 'shown' && styles.contentShown, forceVisibility === 'hidden' && (isLayoutPreserved ? styles.contentHiddenLayoutPreserved : styles.contentHidden));
      }
    };
  }, [isEnabled]);
}