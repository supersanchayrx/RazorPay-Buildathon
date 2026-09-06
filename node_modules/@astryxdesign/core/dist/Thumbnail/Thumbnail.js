// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file Thumbnail.tsx
 * @input Uses React, stylex, Button, Skeleton, Spinner
 * @output Exports Thumbnail component, ThumbnailProps
 * @position Core implementation; consumed by index.ts
 *
 * Square preview card for image attachments. Shows a skeleton shimmer while
 * the image loads, the image on success, or a placeholder on failure.
 * The overlaid remove button sits on a fixed --color-overlay scrim with an
 * --color-on-dark icon so it always has sufficient contrast against the image.
 *
 * Images without `alt` are explicitly decorative (alt="" +
 * role="presentation" + aria-hidden, matching Avatar). A dev-time warning
 * fires once when `src` is set with no `alt` and no other name source.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Thumbnail/Thumbnail.doc.mjs
 * - /packages/core/src/Thumbnail/Thumbnail.test.tsx
 * - /packages/core/src/Thumbnail/index.ts
 * - /apps/storybook/stories/Thumbnail.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Thumbnail/ (showcase blocks)
 */
import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { colorVars, radiusVars, spacingVars, durationVars, easeVars } from "../theme/tokens.stylex.js";
import { Button } from "../Button/index.js";
import { Icon } from "../Icon/index.js";
import { Skeleton } from "../Skeleton/index.js";
import { Spinner } from "../Spinner/index.js";
import { Tooltip } from "../Tooltip/Tooltip.js";
import { useDevWarning } from "../hooks/useDevWarning.js";
import { useContainerReveal } from "../hooks/useContainerReveal.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";
import { focusOutlineProps } from "../utils/focusOutline.stylex.js";
import { useTranslator } from "../i18n/index.js";
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// =============================================================================
// Styles
// =============================================================================

const styles = {
  root: {
    kVAEAm: "x1n2onr6",
    k1xSpc: "x3nfvp2",
    kXwgrk: "xdt5ytf",
    kzqmXN: "x1fu8urw",
    kmuXW: "x2lah0s",
    kHBbk8: "xc8icb0",
    $$css: true
  },
  imageContainer: {
    kVAEAm: "x1n2onr6",
    kzqmXN: "xh8yej3",
    kOBAk4: "x1plog1",
    kaIpWk: "xh6dtrn",
    kVQacm: "xb3r6kr",
    kWkggS: "x17x4s8c",
    $$css: true
  },
  interactive: {
    kkrTdU: "x1ypdohk x16khyan",
    $$css: true
  },
  overlay: {
    k5JduY: "x1s928wv",
    kwXMNM: "x1j6awrg",
    kv0HGH: "xarstr8",
    kUfP38: "x1k48kgn",
    kloYau: "x2q1x1w",
    kRicXK: "x1ywzrc5",
    kPNhGg: "x97pup0",
    kA8PQs: "x1dlmc9c",
    ks3ayO: "xyhc2n1",
    kAcZsS: "x1k7wiig",
    $$css: true
  },
  hoverOnPointer: {
    k8t4tK: "x1912f9e",
    $$css: true
  },
  removeButtonOverrides: {
    "--_button-radius": "xh8ntw8",
    kVAEAm: "x1n2onr6",
    kZKoxP: "x1qx5ct2",
    k7Eaqz: "xt4ypqs",
    kWkggS: "x1u4601x",
    kMwMTN: "x9e3rv5",
    "--_thumbnail-hit-inset": "x1ur4yav x1h9khjt",
    k5JduY: "x1s928wv",
    kwXMNM: "x1j6awrg",
    kv0HGH: "xeu5z55",
    $$css: true
  },
  disabled: {
    kSiTet: "xbyyjgo",
    kfzvcC: "x47corl",
    $$css: true
  }
};

// =============================================================================
// Placeholder icon — a simple image silhouette
// =============================================================================

function ImagePlaceholder() {
  return /*#__PURE__*/_jsx("svg", {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": "true",
    children: /*#__PURE__*/_jsx("path", {
      d: "M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2M8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-5.5z"
    })
  });
}

// =============================================================================
// Component
// =============================================================================

/**
 * A square thumbnail preview for image attachments.
 *
 * Shows a skeleton shimmer while the image loads, the image on success, or
 * a placeholder icon on failure / when no src is provided. An overlaid
 * remove button appears when `onRemove` is set — revealed on hover or
 * keyboard focus by default (`showRemoveOn`), or always shown.
 *
 * The remove button uses a fixed `--color-overlay` scrim with an
 * `--color-on-dark` icon so it stays legible on any image without sampling
 * the image's luminance.
 *
 * @example
 * ```
 * <Thumbnail src="/photo.jpg" alt="Vacation photo" onRemove={() => {}} />
 * <Thumbnail src="/preview.png" alt="Preview" onClick={() => {}} label="preview.png" />
 * <Thumbnail src="/logo.png" alt="Logo" onRemove={() => {}} showRemoveOn="always" />
 * ```
 */
export function Thumbnail({
  src,
  alt,
  label,
  onRemove,
  onClick,
  isLoading = false,
  isDisabled = false,
  showRemoveOn = 'hover',
  xstyle,
  className,
  style,
  'data-testid': testId,
  ref,
  ...props
}) {
  const t = useTranslator();

  // Track the exact src that failed (rather than a boolean) so a changed src
  // gets a fresh load attempt instead of the stale error.
  const [erroredSrc, setErroredSrc] = useState(undefined);
  const hasSrc = src != null;
  const hasError = hasSrc && erroredSrc === src;
  const showSkeleton = isLoading && !hasSrc;
  const showImage = hasSrc && !showSkeleton && !hasError;
  const showUploadOverlay = isLoading && hasSrc;
  const showPlaceholder = !isLoading && !hasSrc || hasError;
  const isInteractive = onClick != null && !isDisabled && !isLoading;
  const hasRemove = onRemove != null && !isDisabled;
  const isHoverReveal = hasRemove && showRemoveOn === 'hover';
  const {
    getContainerProps,
    getContentRevealProps
  } = useContainerReveal({
    isEnabled: isHoverReveal
  });
  const accessibleName = label && alt ? `${label} — ${alt}` : label ?? alt ?? t('@astryx.thumbnail.fallbackName');

  // Without `alt`, the image is explicitly decorative rather than silently
  // empty-alt, matching Avatar's handling of unnamed images.
  const isImageDecorative = !alt;

  // Dev-time guardrail: `src` with no `alt` hides the image from assistive
  // technology. That is fine when the thumbnail is otherwise named — `label`
  // (or a consumer-provided aria name) becomes the group's accessible name —
  // but with no name source at all the group falls back to a generic
  // "thumbnail".
  const hasNameSource = alt != null || label != null || props['aria-label'] != null || props['aria-labelledby'] != null;
  useDevWarning('Thumbnail', '`src` is set without `alt` or `label`. The image is ' + 'treated as decorative and hidden from assistive technology, and ' + 'the thumbnail falls back to a generic "thumbnail" name. Pass ' + '`alt` to describe the image content, or `label` (file name) to ' + 'name the thumbnail.', hasSrc && !hasNameSource);
  const imageContent = /*#__PURE__*/_jsxs(_Fragment, {
    children: [showImage && /*#__PURE__*/_jsx("img", {
      src: src,
      alt: alt ?? '',
      role: isImageDecorative ? 'presentation' : undefined,
      "aria-hidden": isImageDecorative || undefined,
      onError: () => setErroredSrc(src),
      ...{
        className: "xh8yej3 x5yr21d xl1xv1r x1lliihq"
      }
    }), showSkeleton && /*#__PURE__*/_jsx(Skeleton, {
      radius: 2
    }), showPlaceholder && /*#__PURE__*/_jsx("div", {
      ...{
        className: "x78zum5 x6s0dn4 xl56j7k xh8yej3 x5yr21d xv9yike"
      },
      children: /*#__PURE__*/_jsx(ImagePlaceholder, {})
    })]
  });
  const removeButtonEl = hasRemove ? /*#__PURE__*/_jsx("div", {
    ...mergeProps({
      className: "x10l6tqk x8d4r5l xy3asu9 x1vjfegm x14ju556"
    },
    // The remove button is absolutely positioned in the corner, so it is
    // already out of flow — an opacity-only reveal (layout preserved)
    // matches its overlay placement instead of the clip recipe.
    isHoverReveal ? getContentRevealProps({
      isLayoutPreserved: true
    }) : {}),
    children: /*#__PURE__*/_jsx(Button, {
      icon: /*#__PURE__*/_jsx(Icon, {
        icon: "close",
        size: "xsm"
      }),
      label: t('@astryx.thumbnail.remove', {
        accessibleName
      }),
      variant: "secondary",
      size: "sm",
      isIconOnly: true,
      onClick: e => {
        e.stopPropagation();
        onRemove(e);
      },
      xstyle: styles.removeButtonOverrides
    })
  }) : null;
  const thumbnail = /*#__PURE__*/_jsx("div", {
    ref: ref,
    "data-testid": testId,
    role: "group",
    "aria-label": accessibleName,
    ...mergeProps(themeProps('thumbnail'), stylex.props(styles.root, isDisabled && styles.disabled, xstyle), className, style),
    ...props,
    children: /*#__PURE__*/_jsxs("div", {
      ...mergeProps(focusOutlineProps.focusWithin(styles.imageContainer, isInteractive && styles.interactive, isInteractive && styles.overlay, isInteractive && styles.hoverOnPointer), isHoverReveal ? getContainerProps() : {}),
      children: [isInteractive ? /*#__PURE__*/_jsx("button", {
        type: "button",
        onClick: onClick,
        "aria-label": t('@astryx.thumbnail.open', {
          accessibleName
        }),
        ...{
          className: "x1ypdohk x16khyan x1lliihq xh8yej3 x5yr21d xh6dtrn xb3r6kr"
        },
        children: imageContent
      }) : imageContent, showImage && /*#__PURE__*/_jsx("div", {
        ...{
          className: "x10l6tqk x10a8y8t x1pjcqnp x1er153n x47corl"
        }
      }), showUploadOverlay && /*#__PURE__*/_jsx("div", {
        ...{
          className: "x10l6tqk x10a8y8t x78zum5 x6s0dn4 xl56j7k x1u4601x x1pjcqnp x1vjfegm x14ju556"
        },
        children: /*#__PURE__*/_jsx(Spinner, {
          size: "sm",
          shade: "onMedia"
        })
      }), removeButtonEl]
    })
  });
  if (label != null) {
    return /*#__PURE__*/_jsx(Tooltip, {
      content: label,
      children: thumbnail
    });
  }
  return thumbnail;
}
Thumbnail.displayName = 'Thumbnail';