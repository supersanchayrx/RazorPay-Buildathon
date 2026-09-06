// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file Grid.tsx
 * @input Uses React, stylex, spacing tokens
 * @output Exports Grid component, GridProps, and GridColumns
 * @position Grid component; provides CSS Grid-based layout
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Grid/Grid.doc.mjs
 * - /packages/core/src/Grid/Grid.test.tsx
 * - /apps/storybook/stories/Grid.stories.tsx
 * - /packages/cli/assets/templates/blocks/components/Grid/ (showcase blocks)
 */

import * as stylex from '@stylexjs/stylex';
import "../theme/tokens.stylex.js";
import { spacingVars } from "../theme/tokens.stylex.js";
import { mergeProps } from "../utils/index.js";
import { themeProps } from "../utils/themeProps.js";

/**
 * Grid alignment options for align-items and justify-items.
 */

/**
 * Column configuration for Grid.
 *
 * - `number` — fixed equal-width columns (e.g. `columns={3}`)
 * - `object` — responsive columns based on minimum child width:
 *   - `minWidth` — minimum width (px) for each column track
 *   - `repeat` — `'fill'` (default) preserves empty tracks for consistent widths;
 *     `'fit'` collapses empty tracks so items stretch to fill
 *   - `max` — caps the maximum number of columns. The grid stretches to 100%
 *     of its parent and the columns that are present always fill the row, so a
 *     layout collapsing to a single column on mobile stretches to full width
 *     (no dead space on the right).
 */
import { jsx as _jsx } from "react/jsx-runtime";
const baseStyles = {
  grid: {
    k1xSpc: "xrvj5dj",
    $$css: true
  }
};

// Dynamic track values compile to CSS variables + a class-level declaration
// (grid-template-columns: var(--x)) instead of a raw inline style, so
// consumer `xstyle` overrides — including ones inside @media queries — can
// still win. A raw inline `grid-template-columns` would beat any class.
const _temp = {
  kJBjZk: "xhij9v2",
  "$$css": true
};
const dynamicStyles = {
  templateColumns: value => [{
    kumcoG: value != null ? "xqketvx" : value,
    $$css: true
  }, {
    "--x-gridTemplateColumns": value != null ? value : undefined
  }],
  autoRows: value => [_temp, {
    "--x-gridAutoRows": `${value}px` != null ? `${value}px` : undefined
  }]
};
const alignStyles = {
  start: {
    kGNEyG: "x7a106z",
    $$css: true
  },
  center: {
    kGNEyG: "x6s0dn4",
    $$css: true
  },
  end: {
    kGNEyG: "xpqajaz",
    $$css: true
  },
  stretch: {
    kGNEyG: "x1qjc9v5",
    $$css: true
  }
};
const justifyStyles = {
  start: {
    kAPf3g: "x619ttb",
    $$css: true
  },
  center: {
    kAPf3g: "x1o2pa38",
    $$css: true
  },
  end: {
    kAPf3g: "x4xo5sw",
    $$css: true
  },
  stretch: {
    kAPf3g: "xl4xnwh",
    $$css: true
  }
};
const gapStyles = {
  "0": {
    kOIVth: "xsn7fz1",
    $$css: true
  },
  "1": {
    kOIVth: "xzye2dw",
    $$css: true
  },
  "2": {
    kOIVth: "x1txdalj",
    $$css: true
  },
  "3": {
    kOIVth: "xjcht0a",
    $$css: true
  },
  "4": {
    kOIVth: "x18g69wz",
    $$css: true
  },
  "5": {
    kOIVth: "x9mgr7n",
    $$css: true
  },
  "6": {
    kOIVth: "x1qh66ti",
    $$css: true
  },
  "8": {
    kOIVth: "x4t41sb",
    $$css: true
  },
  "10": {
    kOIVth: "x3hoi3v",
    $$css: true
  },
  "0.5": {
    kOIVth: "x1lsbc85",
    $$css: true
  },
  "1.5": {
    kOIVth: "x1s4dlld",
    $$css: true
  }
};
const rowGapStyles = {
  "0": {
    khm7nJ: "x6yxi7o",
    $$css: true
  },
  "1": {
    khm7nJ: "x1ngg2t4",
    $$css: true
  },
  "2": {
    khm7nJ: "x1x7z4sm",
    $$css: true
  },
  "3": {
    khm7nJ: "x4olc9o",
    $$css: true
  },
  "4": {
    khm7nJ: "xtx9w7w",
    $$css: true
  },
  "5": {
    khm7nJ: "x1iu6piu",
    $$css: true
  },
  "6": {
    khm7nJ: "xczp1bk",
    $$css: true
  },
  "8": {
    khm7nJ: "xgx0vcf",
    $$css: true
  },
  "10": {
    khm7nJ: "x1xpicb7",
    $$css: true
  },
  "0.5": {
    khm7nJ: "x1tw44j4",
    $$css: true
  },
  "1.5": {
    khm7nJ: "xhq53yo",
    $$css: true
  }
};
const columnGapStyles = {
  "0": {
    k1C7PZ: "x1o57wo1",
    $$css: true
  },
  "1": {
    k1C7PZ: "x1lfs0n9",
    $$css: true
  },
  "2": {
    k1C7PZ: "xak3so",
    $$css: true
  },
  "3": {
    k1C7PZ: "xewh9hi",
    $$css: true
  },
  "4": {
    k1C7PZ: "xty4p9g",
    $$css: true
  },
  "5": {
    k1C7PZ: "x1eqhezk",
    $$css: true
  },
  "6": {
    k1C7PZ: "x3qlgwd",
    $$css: true
  },
  "8": {
    k1C7PZ: "xicv188",
    $$css: true
  },
  "10": {
    k1C7PZ: "x1p37tyl",
    $$css: true
  },
  "0.5": {
    k1C7PZ: "x1kihgfc",
    $$css: true
  },
  "1.5": {
    k1C7PZ: "x1thn6ci",
    $$css: true
  }
};

/**
 * Spacing token CSS var names for gap calculation in track-max expressions.
 */
const spacingVarNames = {
  0: '--spacing-0',
  0.5: '--spacing-0-5',
  1: '--spacing-1',
  1.5: '--spacing-1-5',
  2: '--spacing-2',
  3: '--spacing-3',
  4: '--spacing-4',
  5: '--spacing-5',
  6: '--spacing-6',
  8: '--spacing-8',
  10: '--spacing-10'
};

/**
 * Build a grid-template-columns value that caps the column *count* at `max`
 * while still letting the columns that are actually present stretch to fill
 * the row.
 *
 * The cap lives on the track's **min** size, not its max: each track is at
 * least `perColumn = (100% - (max-1) * gap) / max`, so more than `max` columns
 * can never fit. The track **max** stays `1fr`, so whenever fewer than `max`
 * columns fit (most importantly a lone column on mobile) they still grow to
 * fill the whole row — no dead space on the right.
 *
 * The track min is `max(minWidth, perColumn)` so an explicit `minWidth` is
 * still honored, wrapped in `min(100%, …)` so a single column on a viewport
 * narrower than `minWidth`/`perColumn` shrinks to the container instead of
 * overflowing it.
 */
function buildCappedTemplate(minWidth, maxCols, repeatMode, gap, columnGap) {
  const gapVar = columnGap != null ? spacingVarNames[columnGap] : gap != null ? spacingVarNames[gap] : null;

  // perColumn = (100% - (maxCols - 1) * gap) / maxCols — the width a track
  // would have if exactly `maxCols` columns were present. Used as a floor so
  // the grid never fits more than `maxCols` columns.
  const perColumn = gapVar ? `calc((100% - ${maxCols - 1} * var(${gapVar})) / ${maxCols})` : `calc(100% / ${maxCols})`;

  // Track min caps the count; track max stays 1fr so present columns fill.
  const trackMin = `min(100%, max(${minWidth}px, ${perColumn}))`;
  return `repeat(${repeatMode}, minmax(${trackMin}, 1fr))`;
}

/**
 * Grid component for CSS Grid-based layouts.
 *
 * Supports fixed-column and responsive layouts via the `columns` prop:
 * - `columns={3}` — fixed 3-column grid
 * - `columns={{minWidth: 280}}` — responsive auto-fill (consistent widths)
 * - `columns={{minWidth: 280, repeat: 'fit'}}` — responsive auto-fit (stretch)
 * - `columns={{minWidth: 280, max: 4}}` — responsive, capped at 4 columns
 *
 * @example
 * ```
 * <Grid columns={3} gap={4}>
 *   <Item />
 *   <Item />
 *   <Item />
 * </Grid>
 * ```
 */
export function Grid({
  columns,
  rowHeight,
  width,
  height,
  maxWidth,
  minHeight,
  gap,
  rowGap,
  columnGap,
  align,
  justify,
  xstyle,
  className,
  style,
  children,
  ref,
  ...props
}) {
  // Determine grid-template-columns value
  let gridTemplateColumns;
  if (typeof columns === 'object' && columns != null) {
    // Responsive API: columns={{minWidth, max?, repeat?}}
    const repeatMode = columns.repeat === 'fit' ? 'auto-fit' : 'auto-fill';
    if (columns.max != null && columns.max > 0) {
      // Cap column count by limiting each track's max size
      gridTemplateColumns = buildCappedTemplate(columns.minWidth, columns.max, repeatMode, gap, columnGap);
    } else {
      gridTemplateColumns = `repeat(${repeatMode}, minmax(${columns.minWidth}px, 1fr))`;
    }
  } else if (typeof columns === 'number' && columns > 0) {
    // Fixed columns mode
    gridTemplateColumns = `repeat(${columns}, 1fr)`;
  } else {
    // Default to 1 column if nothing specified
    gridTemplateColumns = '1fr';
  }

  // Build inline style for dynamic values. Track templates go through
  // dynamicStyles (CSS-var indirection) so xstyle/@media overrides work;
  // width/height stay inline as explicit caller-set dimensions.
  const inlineStyle = {
    ...(width != null && {
      width: typeof width === 'number' ? `${width}px` : width
    }),
    ...(height != null && {
      height: typeof height === 'number' ? `${height}px` : height
    }),
    ...(maxWidth != null && {
      maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth
    }),
    ...(minHeight != null && {
      minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight
    })
  };

  // For themeProps, extract numeric columns value for variant tracking
  const columnsVariant = typeof columns === 'number' ? columns : typeof columns === 'object' ? undefined : undefined;
  return /*#__PURE__*/_jsx("div", {
    ref: ref,
    ...mergeProps(themeProps('grid', {
      columns: columnsVariant,
      gap,
      align,
      justify
    }), stylex.props(baseStyles.grid, dynamicStyles.templateColumns(gridTemplateColumns), rowHeight != null && dynamicStyles.autoRows(rowHeight), gap != null && gapStyles[gap], rowGap != null && rowGapStyles[rowGap], columnGap != null && columnGapStyles[columnGap], align != null && alignStyles[align], justify != null && justifyStyles[justify], xstyle), className, {
      ...style,
      ...inlineStyle
    }),
    ...props,
    children: children
  });
}
Grid.displayName = 'Grid';