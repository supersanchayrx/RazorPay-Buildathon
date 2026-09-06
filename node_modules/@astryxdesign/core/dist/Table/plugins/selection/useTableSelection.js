// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useTableSelection.tsx
 * @input React, types, CheckboxInput, theme tokens
 * @output Exports useTableSelection hook and UseTableSelectionConfig type
 * @position Selection plugin; consumed by Table via plugins prop
 *
 * ## Architecture (v2 — transformColumns + ref-based row styling)
 *
 * Selection checkboxes are implemented as a synthetic column prepended via
 * `transformColumns`. The checkbox column flows through the normal cell
 * component pipeline, so it automatically respects component overrides
 * (components prop on BaseTable).
 *
 * Selection state is managed via an external store (SelectionStore) for
 * fine-grained row subscriptions. Each row's checkbox subscribes
 * independently — when selection changes, only that row's checkbox
 * re-renders, not the entire table body.
 *
 * Row-level styling (aria-selected, background) uses imperative DOM
 * updates via a ref callback on each <tr>. The ref subscribes to the
 * store and applies/removes styles when selection changes — no extra
 * DOM elements and no central element tracking. Each subscription
 * self-cleans when the row disconnects.
 *
 * Because the background is an inline style, it outranks anything
 * userland can layer on with StyleX. `hasRowHighlight: false` is the
 * supported way to reclaim the row background; `aria-selected` is
 * unaffected by it.
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Table/useTableSelection.doc.mjs (config prop table)
 * - /packages/core/src/Table/Table.doc.mjs (selection documentation)
 * - /packages/core/src/Table/index.ts (exports)
 */
import { createContext, use, useCallback, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import * as stylex from '@stylexjs/stylex';
import { colorVars } from "../../../theme/tokens.stylex.js";
import { CheckboxInput } from "../../../CheckboxInput/index.js";
import { mergeRefs } from "../../../utils/index.js";
import { pixel } from "../../columnUtils.js";
import { useTranslator } from "../../../i18n/index.js";

// =============================================================================
// Config Type
// =============================================================================

// =============================================================================
// Selection Store (external store for fine-grained row subscriptions)
// =============================================================================

/**
 * Lightweight external store that lets each row subscribe to selection
 * changes independently. Row styling is handled by per-row ref callbacks
 * that subscribe to this store — the store itself holds no DOM references.
 */
import { jsx as _jsx } from "react/jsx-runtime";
function createSelectionStore(configRef) {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      for (const listener of listeners) {
        listener();
      }
    },
    getConfig() {
      return configRef.current;
    }
  };
}

/**
 * Apply or remove selection styling on a <tr> element.
 *
 * `aria-selected` tracks selection on its own: it is the semantic half of
 * the state and stays correct whether or not the row is painted.
 */
function applyRowSelectionStyle(el, isSelected, hasRowHighlight) {
  if (isSelected) {
    el.setAttribute('aria-selected', 'true');
  } else {
    el.removeAttribute('aria-selected');
  }
  // Written on every pass, not just when painting: the flag can flip while a
  // row is already selected, and the wash has to come back off.
  const wash = isSelected && hasRowHighlight ? selectedBgColor : '';
  if (el.style.backgroundColor !== wash) {
    el.style.backgroundColor = wash;
  }
  // A pinned column paints its own opaque background over the row, so the
  // wash alone stops at the freeze line. Publishing it as the row overlay is
  // what lets useTableStickyColumns replay it on those cells — the same
  // contract TableRow honours for striping and hover.
  const currentOverlay = el.style.getPropertyValue(ROW_OVERLAY_VAR);
  if (wash === '') {
    if (currentOverlay !== '') {
      el.style.removeProperty(ROW_OVERLAY_VAR);
    }
  } else {
    if (currentOverlay !== wash) {
      el.style.setProperty(ROW_OVERLAY_VAR, wash);
    }
  }
}

// =============================================================================
// Selection Context
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SelectionStoreContext = /*#__PURE__*/createContext(null);
SelectionStoreContext.displayName = 'SelectionStoreContext';

// =============================================================================
// Hooks for subscribing to selection state
// =============================================================================

function useIsItemSelected(store, item) {
  const getSnapshot = useCallback(() => store.getConfig().getIsItemSelected(item), [store, item]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

// =============================================================================
// Checkbox Components
// =============================================================================

function SelectAllCheckbox() {
  const store = use(SelectionStoreContext);
  if (!store) {
    return null;
  }
  return /*#__PURE__*/_jsx(SelectAllCheckboxInner, {
    store: store
  });
}

/**
 * Encode select-all state as a number for useSyncExternalStore.
 * Avoids string encoding + splitting — the snapshot is a cheap numeric
 * comparison. Values: 0 = none, 1 = indeterminate, 2 = all selected.
 */
const SELECT_NONE = 0;
const SELECT_INDETERMINATE = 1;
const SELECT_ALL = 2;

/**
 * Inner component that subscribes to all-selected/indeterminate state.
 * Separated so the useCallback/useSyncExternalStore hooks are not
 * called conditionally (after the null guard).
 */
function SelectAllCheckboxInner({
  store
}) {
  const t = useTranslator();
  const getSnapshot = useCallback(() => {
    const config = store.getConfig();
    const allSelected = config.getIsAllSelected();
    if (allSelected) {
      return SELECT_ALL;
    }
    const indeterminate = config.getIsIndeterminate?.() ?? false;
    return indeterminate ? SELECT_INDETERMINATE : SELECT_NONE;
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  const allSelected = state === SELECT_ALL;
  const indeterminate = state === SELECT_INDETERMINATE;
  return /*#__PURE__*/_jsx(CheckboxInput, {
    label: t('@astryx.table.selection.selectAllRows'),
    isLabelHidden: true,
    value: allSelected ? true : indeterminate ? 'indeterminate' : false,
    onChange: () => store.getConfig().onSelectAll({
      isAllSelected: !allSelected
    }),
    size: "sm"
  });
}

/**
 * Row checkbox component — used as renderCell for the synthetic selection column.
 * Subscribes to this item's selection state independently.
 */
function SelectionCellContent({
  item
}) {
  const store = use(SelectionStoreContext);
  if (!store) {
    return null;
  }
  return /*#__PURE__*/_jsx(SelectionCellContentInner, {
    store: store,
    item: item
  });
}
function SelectionCellContentInner({
  store,
  item
}) {
  const t = useTranslator();
  const config = store.getConfig();
  const isSelected = useIsItemSelected(store, item);
  const selectable = config.getIsItemSelectable?.(item) ?? true;
  const enabled = config.getIsItemEnabled?.(item) ?? true;
  const rowLabel = config.getRowLabel?.(item);
  if (!selectable) {
    return null;
  }
  return /*#__PURE__*/_jsx(CheckboxInput, {
    label: rowLabel != null ? t('@astryx.table.selection.selectRowNamed', {
      label: rowLabel
    }) : t('@astryx.table.selection.selectRow'),
    isLabelHidden: true,
    value: isSelected,
    onChange: () => store.getConfig().onSelectItem({
      item,
      isSelected: !isSelected
    }),
    isDisabled: !enabled,
    size: "sm"
  });
}

// =============================================================================
// Styles
// =============================================================================

const selectedBgColor = colorVars['--color-accent-muted'];

/**
 * The row's current fill, republished for pinned cells to read. Declared as a
 * literal rather than imported because StyleX needs the same name as a static
 * key on the reading side, so there is no one constant both ends can share.
 */
const ROW_OVERLAY_VAR = '--table-row-overlay';
/** Selection column key — prefixed to avoid collisions with user columns. */
const SELECTION_COLUMN_KEY = '__xds_selection';

/** Fixed width for the selection column. Content is centered with no horizontal padding. */
const SELECTION_COLUMN_WIDTH = pixel(36);

// =============================================================================
// Hook
// =============================================================================

export function useTableSelection(config) {
  const configRef = useRef(config);
  configRef.current = config;
  const storeRef = useRef(null);
  if (storeRef.current == null) {
    storeRef.current = createSelectionStore(configRef);
  }
  const store = storeRef.current;

  // Notify subscribers on every render — useSyncExternalStore will only
  // re-render components whose snapshot actually changed. Row ref
  // subscribers apply imperative styling independently.
  useEffect(() => {
    store.notify();
  });

  // Synthetic selection column — uses renderCell with a subscribing
  // component so each row's checkbox re-renders independently.
  const selectionColumn = useMemo(() => ({
    key: SELECTION_COLUMN_KEY,
    header: /*#__PURE__*/_jsx("div", {
      ...{
        className: "x78zum5 x6s0dn4 xl56j7k"
      },
      children: /*#__PURE__*/_jsx(SelectAllCheckbox, {})
    }),
    width: SELECTION_COLUMN_WIDTH,
    resizable: false,
    renderCell: item => /*#__PURE__*/_jsx("div", {
      ...{
        className: "x78zum5 x6s0dn4 xl56j7k"
      },
      children: /*#__PURE__*/_jsx(SelectionCellContent, {
        item: item
      })
    })
  }), []);
  return useMemo(() => ({
    transformTableContext(children) {
      return /*#__PURE__*/_jsx(SelectionStoreContext, {
        value: store,
        children: children
      });
    },
    transformColumns(columns) {
      return [selectionColumn, ...columns];
    },
    transformBodyRow(props, item) {
      // Attach a ref to the <tr> that subscribes to the store for
      // imperative row styling. Each row manages its own subscription
      // and self-cleans when disconnected — no central element tracking.
      const selectionRef = el => {
        if (!el) {
          return;
        }
        const applyStyle = () => {
          const config = store.getConfig();
          applyRowSelectionStyle(el, config.getIsItemSelected(item), config.hasRowHighlight ?? true);
        };
        // Apply initial style
        applyStyle();
        // Subscribe for future changes
        const unsub = store.subscribe(() => {
          if (!el.isConnected) {
            unsub();
            return;
          }
          applyStyle();
        });
        return () => {
          unsub();
        };
      };
      return {
        ...props,
        ref: props.ref ? mergeRefs(props.ref, selectionRef) : selectionRef
      };
    }
  }), [store, selectionColumn]);
}