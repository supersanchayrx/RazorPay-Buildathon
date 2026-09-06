// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Pagination.tsx
 * @input Uses React, StyleX, Button, Icon, Selector, Text; page number buttons delegate to Button.
 *   Prev/next and first/last chevrons mirror under RTL via the shared rtlStyles.mirror
 *   (CSS scaleX), not a JS direction read. The input variant uses the chevronsLeft/chevronsRight
 *   (first/last) icons.
 * @output Exports Pagination component, PaginationProps, PaginationVariant, PaginationSize types
 * @position Core implementation; consumed by index.ts, tested by Pagination.test.tsx
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Pagination/Pagination.test.tsx (tests for new/changed behavior)
 * - /packages/core/src/Pagination/index.ts (exports if types change)
 * - /apps/storybook/stories/Pagination.stories.tsx (storybook stories)
 * - /packages/cli/assets/templates/blocks/components/Pagination/ (showcase blocks)
 *
 * Last synced props: page, onChange, changeAction, totalItems, totalPages, hasMore,
 *   pageSize, pageSizeOptions, onPageSizeChange, variant, pageLabel,
 *   hasFirstLast, step, siblingCount, size, isDisabled, label, data-testid, xstyle
 */
import { useOptimistic, useTransition } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, fontWeightVars, sizeVars, spacingVars, durationVars, easeVars, typeScaleVars } from "../theme/tokens.stylex.js";
import { Button } from "../Button/index.js";
import { Icon } from "../Icon/index.js";
import { NumberInput } from "../NumberInput/index.js";
import { Selector } from "../Selector/index.js";
import { Text } from "../Text/index.js";
import { useAnnounce } from "../hooks/useAnnounce.js";
import { useListFocus } from "../hooks/useListFocus.js";
import { mergeProps, rtlStyles } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { focusOutlineProps } from "../utils/focusOutline.stylex.js";
import { useTranslator } from "../i18n/useTranslator.js";

// =============================================================================
// Types
// =============================================================================

/** Visual variant controlling what appears between prev/next buttons.
 * Extensible via module augmentation of PaginationVariantMap.
 */

/** Size of the pagination controls. */
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// =============================================================================
// Styles
// =============================================================================

/** Width (px) of the page-size Selector field. */
const PAGE_SIZE_SELECTOR_WIDTH = 80;
const styles = {
  root: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "x1qughib",
    kOIVth: "x18g69wz",
    $$css: true
  },
  dot: {
    kzqmXN: "x1f0dxl5",
    kZKoxP: "xoqw5ej",
    kMzoRj: "xc342km",
    ksu8eU: "xng3xce",
    kmVPX3: "x1717udv",
    kaIpWk: "x16rqkct",
    kWkggS: "x17x4s8c",
    kkrTdU: "x1ypdohk x16khyan",
    k1ekBW: "x15406qy",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    $$css: true
  },
  dotSm: {
    kzqmXN: "x1wu31ai",
    kZKoxP: "xcenk2v",
    $$css: true
  },
  dotActive: {
    kWkggS: "x1ewilqj",
    $$css: true
  },
  dotDisabled: {
    kkrTdU: "xt0e3qv",
    kSiTet: "xbyyjgo",
    $$css: true
  },
  activePage: {
    kWkggS: "x17x4s8c",
    k63SB2: "x1e4wzip",
    $$css: true
  }
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generates the range of page numbers to display, including ellipsis markers.
 * Returns an array of page numbers and '...' strings.
 *
 * @example
 * ```
 * generatePageRange(5, 10, 1) → [1, '...', 4, 5, 6, '...', 10]
 * generatePageRange(1, 10, 1) → [1, 2, 3, '...', 10]
 * generatePageRange(1, 5, 1)  → [1, 2, 3, 4, 5]
 * ```
 */
export function generatePageRange(currentPage, totalPages, siblingCount) {
  // Total page number slots (excluding ellipses):
  // first + last + current + 2*siblings = 3 + 2*siblings
  // With 2 potential ellipsis slots: 5 + 2*siblings
  const totalSlots = 5 + 2 * siblingCount;

  // If total pages fit within slots, show all pages
  if (totalPages <= totalSlots) {
    return Array.from({
      length: totalPages
    }, (_, i) => i + 1);
  }
  const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
  const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);
  const showLeftEllipsis = leftSiblingIndex > 2;
  const showRightEllipsis = rightSiblingIndex < totalPages - 1;
  if (!showLeftEllipsis && showRightEllipsis) {
    // Near the start: show more pages on the left
    const leftRange = 3 + 2 * siblingCount;
    const pages = Array.from({
      length: leftRange
    }, (_, i) => i + 1);
    pages.push('...', totalPages);
    return pages;
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    // Near the end: show more pages on the right
    const rightRange = 3 + 2 * siblingCount;
    const pages = [1, '...'];
    for (let i = totalPages - rightRange + 1; i <= totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }

  // In the middle: show ellipsis on both sides
  const pages = [1, '...'];
  for (let i = leftSiblingIndex; i <= rightSiblingIndex; i++) {
    pages.push(i);
  }
  pages.push('...', totalPages);
  return pages;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Standalone pagination controls for navigating through pages of content.
 *
 * Supports multiple display variants: page numbers, count text, compact text,
 * dot indicators, or minimal prev/next navigation. Works with known totals
 * or cursor-based pagination.
 *
 * @example
 * ```
 * <Pagination
 *   page={page}
 *   onChange={setPage}
 *   totalItems={200}
 *   pageSize={20}
 * />
 * ```
 */
export function Pagination({
  page,
  onChange,
  changeAction,
  totalItems,
  totalPages: totalPagesProp,
  hasMore,
  pageSize: pageSizeProp = 10,
  pageSizeOptions,
  onPageSizeChange,
  variant = 'pages',
  pageLabel,
  hasFirstLast = true,
  step: stepProp = 1,
  siblingCount = 1,
  size = 'md',
  isDisabled = false,
  label: labelFromProps,
  'data-testid': testId,
  xstyle,
  className,
  style,
  ref,
  ...rest
}) {
  const [, startTransition] = useTransition();

  // Resolve system strings once per render. Prop overrides win.
  const t = useTranslator();
  const label = labelFromProps ?? t('@astryx.pagination.label');
  const firstLabel = t('@astryx.pagination.first');
  const lastLabel = t('@astryx.pagination.last');
  const pageIndicatorsLabel = t('@astryx.pagination.pageIndicators');
  const itemsPerPageLabel = t('@astryx.pagination.itemsPerPage');
  const goToPageLabel = t('@astryx.pagination.goToPageInput');
  const inputLabelText = pageLabel ?? t('@astryx.pagination.pageLabel');

  // pageSize is typed as number, so 0, NaN, and negatives are valid at the
  // type level but yield Infinity/NaN page counts, and
  // Array.from({length: Infinity}) crashes the dots variant. Coerce to a
  // positive integer; non-finite values fall back to the default.
  const pageSize = Number.isFinite(pageSizeProp) ? Math.max(1, Math.floor(pageSizeProp)) : 10;

  // Prev/next stride. Same guard as pageSize: non-integer or < 1 falls back to
  // a single-page step so a bad value never freezes or reverses navigation.
  const step = Number.isInteger(stepProp) && stepProp >= 1 ? stepProp : 1;

  // The prev/next buttons advance `step` pages, so their accessible names must
  // reflect the stride: a plain "previous/next page" for the default single
  // step, or an explicit "back/forward N pages" so a screen reader never
  // announces a single-page move for a multi-page jump.
  const previousLabel = step > 1 ? t('@astryx.pagination.previousBy', {
    step
  }) : t('@astryx.pagination.previous');
  const nextLabel = step > 1 ? t('@astryx.pagination.nextBy', {
    step
  }) : t('@astryx.pagination.next');

  // Announce page changes politely (navigation-10). The controls carry no
  // live region, so page transitions were previously silent to screen readers.
  // Only user-driven changes go through handlePageChange, so initial mount is
  // never announced.
  const announce = useAnnounce();

  // Track the page optimistically so rapid prev/next clicks advance from the
  // in-flight target instead of stalling on the last committed page.
  const [optimisticPage, setOptimisticPage] = useOptimistic(page);

  // Roving-tabindex + arrow/Home/End keyboard nav for the dots variant, owned
  // by the shared useListFocus primitive (mirrors SegmentedControl). It stamps a
  // single tab stop across the dots and moves focus horizontally; selection
  // follows focus via handleDotsFocus so arrow keys move the active page.
  const {
    listRef: dotsListRef,
    handleKeyDown: handleDotsKeyDown,
    handleFocus: handleDotsRovingFocus
  } = useListFocus({
    itemSelector: 'button',
    hasRovingTabIndex: true,
    wrap: true,
    orientation: 'horizontal'
  });
  const computedTotalPages = totalPagesProp ?? (totalItems != null ? Math.ceil(totalItems / pageSize) : undefined);
  const hasPrevious = optimisticPage > 1;
  const hasNext = computedTotalPages != null ? optimisticPage < computedTotalPages : hasMore ?? false;
  if (totalItems != null && totalItems <= 0) {
    return null;
  }
  if (computedTotalPages != null && computedTotalPages <= 0) {
    return null;
  }

  // Interruptible: re-clicking before the transition settles starts a fresh one
  // with the next optimistic page rather than being dropped, so there is no
  // re-entry guard.
  const handlePageChange = newPage => {
    if (isDisabled) {
      return;
    }
    // Keep onChange urgent so controlled page state updates in the same commit
    // as the click; only the optimistic indicator and changeAction defer.
    onChange(newPage);
    announce(computedTotalPages != null ? t('@astryx.pagination.pageOfTotal', {
      current: newPage,
      total: computedTotalPages
    }) : t('@astryx.pagination.pageAnnounce', {
      current: newPage
    }));
    startTransition(async () => {
      setOptimisticPage(newPage);
      await changeAction?.(newPage);
    });
  };

  // Selection-follows-focus for the dots (APG radiogroup pattern): useListFocus
  // only *moves* focus, so when focus lands on a dot -- via arrow/Home/End, or a
  // click that focuses it -- we select that dot's page. handleDotsRovingFocus
  // keeps the roving tab stop in sync. The current page is skipped so tabbing
  // into the group is a no-op.
  const handleDotsFocus = e => {
    handleDotsRovingFocus(e);
    if (isDisabled) {
      return;
    }
    const focused = e.target?.closest('button[data-page]');
    if (!focused) {
      return;
    }
    const nextPage = Number(focused.dataset.page);
    if (Number.isFinite(nextPage) && nextPage !== optimisticPage) {
      handlePageChange(nextPage);
    }
  };

  // Clamp a target page into the valid range. The lower bound is always 1; the
  // upper bound only exists when the page count is known (cursor/hasMore mode
  // leaves it open-ended).
  const clampPage = target => {
    const lower = Math.max(target, 1);
    return computedTotalPages != null ? Math.min(lower, computedTotalPages) : lower;
  };
  const handlePrevious = () => {
    if (hasPrevious) {
      handlePageChange(clampPage(optimisticPage - step));
    }
  };
  const handleNext = () => {
    if (hasNext) {
      handlePageChange(clampPage(optimisticPage + step));
    }
  };
  const handleFirst = () => {
    if (hasPrevious) {
      handlePageChange(1);
    }
  };
  const handleLast = () => {
    if (hasNext && computedTotalPages != null) {
      handlePageChange(computedTotalPages);
    }
  };
  const handlePageSizeChange = value => {
    const newSize = Number(value);
    onPageSizeChange?.(newSize);
    // Reset to page 1 when page size changes.
    handlePageChange(1);
  };

  // The value currently shown in the input box is the committed page number.
  const inputCommittedValue = optimisticPage;

  // NumberInput owns the typing/pending state and clamps to [min, max] with
  // integer-only semantics, so it only ever hands back a valid page here.
  // Navigation is page-based via onChange.
  const handleInputCommit = nextPage => {
    if (isDisabled || nextPage === optimisticPage) {
      return;
    }
    handlePageChange(nextPage);
  };

  // Item range for count display
  const rangeStart = (optimisticPage - 1) * pageSize + 1;
  const rangeEnd = totalItems != null ? Math.min(optimisticPage * pageSize, totalItems) : optimisticPage * pageSize;
  const buttonSize = size === 'sm' ? 'sm' : 'md';
  const isSm = size === 'sm';

  // First/last buttons only exist in the input variant, and only when the page
  // count is known (they'd have no target otherwise).
  const showFirstLast = hasFirstLast && variant === 'input' && computedTotalPages != null;
  const renderIndicator = () => {
    switch (variant) {
      case 'pages':
        {
          if (computedTotalPages == null) {
            return null;
          }
          const pageRange = generatePageRange(optimisticPage, computedTotalPages, siblingCount);
          return /*#__PURE__*/_jsx(_Fragment, {
            children: pageRange.map((item, index) => {
              if (item === '...') {
                const previousPage = pageRange[index - 1];
                const nextPage = pageRange[index + 1];
                return /*#__PURE__*/_jsx("span", {
                  "aria-hidden": "true",
                  ...{
                    0: {
                      className: "x3nfvp2 x6s0dn4 xl56j7k x17ydmr0 x1ueg155 xv1l7n4 xcr08ib x87ps6o"
                    },
                    1: {
                      className: "x3nfvp2 x6s0dn4 xl56j7k xv1l7n4 x87ps6o x1nkkqge x6k0iem x141an7d"
                    }
                  }[!!isSm << 0],
                  children: "\u2026"
                }, `ellipsis-${previousPage}-${nextPage}`);
              }
              const isActive = item === optimisticPage;
              return /*#__PURE__*/_jsx(Button, {
                label: t('@astryx.pagination.goToPage', {
                  page: item
                }),
                "aria-label": t('@astryx.pagination.goToPage', {
                  page: item
                }),
                variant: "ghost",
                size: buttonSize,
                onClick: () => handlePageChange(item),
                isDisabled: isDisabled,
                "aria-current": isActive ? 'page' : undefined,
                xstyle: isActive && styles.activePage,
                children: item
              }, item);
            })
          });
        }
      case 'count':
        {
          if (totalItems == null) {
            return null;
          }
          return /*#__PURE__*/_jsx("span", {
            ...{
              className: "x78zum5 x6s0dn4 xuxw1ft"
            },
            children: /*#__PURE__*/_jsx(Text, {
              type: "body",
              size: "sm",
              color: "secondary",
              children: t('@astryx.pagination.count', {
                from: rangeStart,
                to: rangeEnd,
                total: totalItems
              })
            })
          });
        }
      case 'compact':
        {
          if (computedTotalPages == null) {
            return null;
          }
          return /*#__PURE__*/_jsx("span", {
            ...{
              className: "x78zum5 x6s0dn4 xuxw1ft"
            },
            children: /*#__PURE__*/_jsx(Text, {
              type: "body",
              size: "sm",
              color: "secondary",
              children: t('@astryx.pagination.pageOfTotal', {
                current: optimisticPage,
                total: computedTotalPages
              })
            })
          });
        }
      case 'dots':
        {
          if (computedTotalPages == null) {
            return null;
          }
          return /*#__PURE__*/_jsx("div", {
            ref: dotsListRef,
            ...{
              className: "x78zum5 x6s0dn4 xzye2dw"
            },
            role: "group",
            "aria-label": pageIndicatorsLabel,
            onKeyDown: handleDotsKeyDown,
            onFocus: handleDotsFocus,
            children: Array.from({
              length: computedTotalPages
            }, (_, i) => {
              const isActive = i + 1 === optimisticPage;
              return /*#__PURE__*/_jsx("button", {
                type: "button",
                "data-page": i + 1,
                "aria-label": t('@astryx.pagination.goToPage', {
                  page: i + 1
                }),
                "aria-current": isActive ? 'page' : undefined
                // The active dot is the single roving tab stop; useListFocus
                // maintains it as focus and the active page move.
                ,
                tabIndex: isActive ? 0 : -1
                // Selection is driven by focus (handleDotsFocus); clicking only
                // needs to focus the dot, which some browsers (Safari) skip for
                // buttons, so focus it explicitly.
                ,
                onClick: e => e.currentTarget.focus(),
                disabled: isDisabled,
                ...mergeProps(themeProps('pagination-dot', {
                  active: isActive ? 'active' : null,
                  size
                }), focusOutlineProps.focusVisible(styles.dot, isSm && styles.dotSm, isActive && styles.dotActive, isDisabled && styles.dotDisabled))
              }, i + 1);
            })
          });
        }
      case 'input':
        {
          // The editable box needs a known page count to clamp against; in
          // cursor/hasMore mode (no total) there is no valid range, so the box is
          // disabled rather than accepting entries it can't resolve — matching the
          // convention that a typeable page box requires a known total.
          const isInputDisabled = isDisabled || computedTotalPages == null;
          const inputNode = /*#__PURE__*/_jsx(NumberInput, {
            label: goToPageLabel,
            isLabelHidden: true,
            value: inputCommittedValue,
            onChange: handleInputCommit,
            min: 1,
            max: computedTotalPages ?? undefined,
            isIntegerOnly: true,
            size: size,
            width: isSm ? sizeVars['--size-element-sm'] : sizeVars['--size-element-md'],
            isDisabled: isInputDisabled,
            "data-testid": testId != null ? `${testId}-input` : undefined
          });

          // Label wording: "Page [ n ] / N". The leading noun comes from
          // `pageLabel`; the trailing "/ N" total is omitted when unknown.
          return /*#__PURE__*/_jsxs("span", {
            ...{
              className: "x3nfvp2 x6s0dn4 xzye2dw xuxw1ft"
            },
            children: [/*#__PURE__*/_jsx("span", {
              "aria-hidden": "true",
              ...mergeProps(themeProps('pagination-input-label', {
                size
              }), {
                0: {
                  className: "xv1l7n4 xcr08ib x87ps6o"
                },
                1: {
                  className: "xv1l7n4 x87ps6o x141an7d"
                }
              }[!!isSm << 0]),
              children: inputLabelText
            }), inputNode, computedTotalPages != null && /*#__PURE__*/_jsx("span", {
              ...mergeProps(themeProps('pagination-input-total', {
                size
              }), {
                0: {
                  className: "xv1l7n4 xcr08ib x87ps6o"
                },
                1: {
                  className: "xv1l7n4 x87ps6o x141an7d"
                }
              }[!!isSm << 0]),
              children: t('@astryx.pagination.ofTotalPages', {
                total: computedTotalPages
              })
            })]
          });
        }
      case 'none':
      default:
        return null;
    }
  };
  return /*#__PURE__*/_jsxs("nav", {
    ref: ref,
    ...mergeProps(themeProps('pagination', {
      variant,
      size
    }), stylex.props(styles.root, xstyle), className, style),
    ...rest,
    "aria-label": label,
    "data-testid": testId,
    children: [pageSizeOptions != null && pageSizeOptions.length > 0 && /*#__PURE__*/_jsx("div", {
      ...{
        className: "x78zum5 x6s0dn4 x1txdalj"
      },
      children: /*#__PURE__*/_jsx(Selector, {
        label: itemsPerPageLabel,
        isLabelHidden: true,
        options: pageSizeOptions.map(opt => String(opt)),
        value: String(pageSize),
        onChange: handlePageSizeChange,
        size: buttonSize,
        isDisabled: isDisabled
        // `width`, not `xstyle`: Selector's xstyle lands on the trigger
        // box, while `width` sizes the whole field — which is what the
        // removed wrapper did.
        ,
        width: PAGE_SIZE_SELECTOR_WIDTH
      })
    }), /*#__PURE__*/_jsxs("div", {
      ...{
        className: "x78zum5 x6s0dn4 xzye2dw"
      },
      children: [showFirstLast && /*#__PURE__*/_jsx(Button, {
        label: firstLabel,
        tooltip: isDisabled || !hasPrevious ? undefined : firstLabel,
        variant: "ghost",
        size: buttonSize,
        icon: /*#__PURE__*/_jsx(Icon, {
          icon: "chevronsLeft",
          size: isSm ? 'sm' : 'md',
          xstyle: rtlStyles.mirror
        }),
        onClick: handleFirst,
        isDisabled: isDisabled || !hasPrevious,
        isIconOnly: true
      }), /*#__PURE__*/_jsx(Button, {
        label: previousLabel,
        tooltip: isDisabled || !hasPrevious ? undefined : previousLabel,
        variant: "ghost",
        size: buttonSize,
        icon: /*#__PURE__*/_jsx(Icon, {
          icon: "chevronLeft",
          size: isSm ? 'sm' : 'md',
          xstyle: rtlStyles.mirror
        }),
        onClick: handlePrevious,
        isDisabled: isDisabled || !hasPrevious,
        isIconOnly: true
      }), renderIndicator(), /*#__PURE__*/_jsx(Button, {
        label: nextLabel,
        tooltip: isDisabled || !hasNext ? undefined : nextLabel,
        variant: "ghost",
        size: buttonSize,
        icon: /*#__PURE__*/_jsx(Icon, {
          icon: "chevronRight",
          size: isSm ? 'sm' : 'md',
          xstyle: rtlStyles.mirror
        }),
        onClick: handleNext,
        isDisabled: isDisabled || !hasNext,
        isIconOnly: true
      }), showFirstLast && /*#__PURE__*/_jsx(Button, {
        label: lastLabel,
        tooltip: isDisabled || !hasNext ? undefined : lastLabel,
        variant: "ghost",
        size: buttonSize,
        icon: /*#__PURE__*/_jsx(Icon, {
          icon: "chevronsRight",
          size: isSm ? 'sm' : 'md',
          xstyle: rtlStyles.mirror
        }),
        onClick: handleLast,
        isDisabled: isDisabled || !hasNext,
        isIconOnly: true
      })]
    })]
  });
}
Pagination.displayName = 'Pagination';