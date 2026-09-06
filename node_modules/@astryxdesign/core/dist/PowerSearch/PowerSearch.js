// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file PowerSearch.tsx
 * @input PowerSearchConfig, filters, onChange
 * @output Structured filter bar with token-based filter management
 * @position Main component; forwards DOM ref and exposes tokenizer control via
 *   handleRef
 *
 * SYNC: When modified, update:
 * - /packages/core/src/PowerSearch/index.ts
 * - /packages/cli/assets/templates/blocks/components/PowerSearch/ (showcase blocks)
 */
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Tokenizer } from "../Tokenizer/index.js";
import { TypeaheadItem } from "../Typeahead/TypeaheadItem.js";
import { Token } from "../Token/index.js";
import { Avatar } from "../Avatar/index.js";
import { layerAnimations } from "../Layer/layerAnimations.stylex.js";
import { Icon } from "../Icon/index.js";
import { usePopover } from "../Popover/usePopover.js";
import { useAnnounce } from "../hooks/useAnnounce.js";
import "../theme/tokens.stylex.js";
import { spacingVars, colorVars, typeScaleVars, fontWeightVars } from "../theme/tokens.stylex.js";
import { useSize } from "../SizeContext/SizeContext.js";
import { useInternalConfig } from "./useInternalConfig.js";
import { usePowerSearchSource } from "./usePowerSearchSource.js";
import { formatFilterValue, formatDateAbsoluteCompact } from "./formatFilterValue.js";
import { PowerSearchEditPopover } from "./PowerSearchEditPopover.js";
import { resolveOperatorLabel } from "./resolveOperatorLabel.js";
import { themeProps } from "../utils/themeProps.js";
import { truncateCharacters } from "../utils/characters.js";
import { useTranslator } from "../i18n/index.js";
import { useLocale } from "../i18n/useLocale.js";
import { useMergedRefs } from "../hooks/useMergedRefs.js";
// =============================================================================
// Icon mapping for typeahead entries
// =============================================================================

// Ranked suggestions shown for a non-empty query. The field list itself is
// never capped -- see the maxSearchResults prop.
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
const DEFAULT_MAX_SEARCH_RESULTS = 10;

// Empty-query browsing gets a high safety ceiling, matching XDS. This shows
// every practical field list without allowing an accidental unbounded DOM.
const MAX_BROWSE_MENU_ITEMS = 1000;
const OPERATOR_VALUE_TYPE_TO_ICON = {
  string: 'search',
  string_list: 'search',
  integer: 'search',
  float: 'search',
  date_absolute: 'calendar',
  date_range: 'calendar',
  date_relative: 'calendar',
  time: 'clock',
  enum: 'menu',
  enum_list: 'menu',
  entity_list: 'search',
  custom: 'search',
  empty: 'search',
  nested: 'search'
};

// =============================================================================
// Token value rendering
// =============================================================================

const popoverLayerStyles = {
  layer: {
    kzqmXN: "x1xgy17j",
    k7Eaqz: "x15mybvi",
    $$css: true
  }
};
function truncateString(value, limit) {
  // Same semantics as before — strings within limit + 3 pass through, longer
  // ones cut to limit + '...' — but counted in characters, not code units.
  return truncateCharacters(value, limit + 3, '...');
}
function getEnumLabel(values, value) {
  return values.find(v => v.value === value)?.label ?? value;
}
function PowerSearchTokenValue({
  operatorValue,
  filterValue,
  maxLength,
  locale
}) {
  switch (filterValue.type) {
    case 'empty':
      return null;
    case 'string':
      return /*#__PURE__*/_jsx("span", {
        ...{
          className: "x1lvx875"
        },
        children: truncateString(filterValue.value, maxLength)
      });
    case 'integer':
    case 'float':
      return /*#__PURE__*/_jsx("span", {
        ...{
          className: "x1lvx875"
        },
        children: filterValue.value
      });
    case 'enum':
      if (operatorValue.type === 'enum') {
        return /*#__PURE__*/_jsx("span", {
          ...{
            className: "x1lvx875"
          },
          children: truncateString(getEnumLabel(operatorValue.values, filterValue.value), maxLength)
        });
      }
      return /*#__PURE__*/_jsx("span", {
        ...{
          className: "x1lvx875"
        },
        children: truncateString(filterValue.value, maxLength)
      });
    case 'string_list':
      {
        const items = filterValue.value;
        if (items.length === 0) {
          return null;
        }
        if (items.length === 1) {
          return /*#__PURE__*/_jsx("span", {
            ...{
              className: "x1lvx875"
            },
            children: truncateString(items[0], maxLength)
          });
        }
        const totalLength = items.reduce((sum, s) => sum + s.length, 0);
        if (totalLength > maxLength) {
          return /*#__PURE__*/_jsxs("span", {
            ...{
              className: "x1lvx875"
            },
            children: [items.length, " items"]
          });
        }
        return /*#__PURE__*/_jsx("span", {
          ...{
            className: "x1lvx875"
          },
          children: items.join(', ')
        });
      }
    case 'enum_list':
      {
        const items = filterValue.value;
        if (items.length === 0) {
          return null;
        }
        if (operatorValue.type === 'enum_list') {
          const labels = items.map(v => getEnumLabel(operatorValue.values, v));
          if (labels.length === 1) {
            return /*#__PURE__*/_jsx("span", {
              ...{
                className: "x1lvx875"
              },
              children: truncateString(labels[0], maxLength)
            });
          }
          const totalLength = labels.reduce((sum, s) => sum + s.length, 0);
          if (totalLength > maxLength) {
            return /*#__PURE__*/_jsxs("span", {
              ...{
                className: "x1lvx875"
              },
              children: [labels.length, " items"]
            });
          }
          return /*#__PURE__*/_jsx("span", {
            ...{
              className: "x1lvx875"
            },
            children: labels.join(', ')
          });
        }
        if (items.length === 1) {
          return /*#__PURE__*/_jsx("span", {
            ...{
              className: "x1lvx875"
            },
            children: truncateString(items[0], maxLength)
          });
        }
        return /*#__PURE__*/_jsxs("span", {
          ...{
            className: "x1lvx875"
          },
          children: [items.length, " items"]
        });
      }
    case 'entity_list':
      {
        const entities = filterValue.value;
        if (entities.length === 0) {
          return null;
        }
        if (entities.length === 1) {
          return /*#__PURE__*/_jsx("span", {
            ...{
              className: "x1lvx875"
            },
            children: truncateString(entities[0].label, maxLength)
          });
        }
        const totalLength = entities.reduce((sum, e) => sum + e.label.length, 0);
        if (totalLength > maxLength) {
          return /*#__PURE__*/_jsxs("span", {
            ...{
              className: "x1lvx875"
            },
            children: [entities.length, " items"]
          });
        }
        return /*#__PURE__*/_jsx("span", {
          ...{
            className: "x1lvx875"
          },
          children: entities.map(e => e.label).join(', ')
        });
      }
    case 'time':
      return /*#__PURE__*/_jsx("span", {
        ...{
          className: "x1lvx875"
        },
        children: filterValue.value
      });
    case 'date_absolute':
      {
        const formatted = formatDateAbsoluteCompact(filterValue.unixSeconds, locale);
        return /*#__PURE__*/_jsx("span", {
          ...{
            className: "x1lvx875"
          },
          children: truncateString(formatted, maxLength)
        });
      }
    case 'date_relative':
      return /*#__PURE__*/_jsx("span", {
        ...{
          className: "x1lvx875"
        },
        children: truncateString(filterValue.value, maxLength)
      });
    case 'date_range':
      return /*#__PURE__*/_jsx("span", {
        ...{
          className: "x1lvx875"
        },
        children: "date range"
      });
    case 'custom':
      if (operatorValue.type === 'custom') {
        return /*#__PURE__*/_jsx("span", {
          ...{
            className: "x1lvx875"
          },
          children: truncateString(operatorValue.getString(filterValue.value), maxLength)
        });
      }
      return /*#__PURE__*/_jsx("span", {
        ...{
          className: "x1lvx875"
        },
        children: filterValue.value
      });
    case 'nested':
      {
        const count = filterValue.value.length;
        return /*#__PURE__*/_jsx("span", {
          ...{
            className: "x1lvx875"
          },
          children: count === 1 ? '1 filter' : `${count} filters`
        });
      }
    default:
      return null;
  }
}

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// State
// =============================================================================

// =============================================================================
// Component
// =============================================================================

/**
 * Structured filter bar where each token represents a filter (field + operator + value).
 *
 * Users select a field from a typeahead dropdown, then configure the operator
 * and value in an edit popover. Filters appear as tokens that can be clicked
 * to edit or removed individually.
 *
 * @example
 * ```
 * const config = {
 *   name: 'MySearch',
 *   fields: [
 *     {
 *       key: 'status',
 *       label: 'Status',
 *       operators: [
 *         {
 *           key: 'is',
 *           label: 'is',
 *           value: {
 *             type: 'enum',
 *             values: [
 *               { value: 'open', label: 'Open' },
 *               { value: 'closed', label: 'Closed' },
 *             ],
 *           },
 *         },
 *       ],
 *     },
 *   ],
 * };
 * const [filters, setFilters] = useState([]);
 * <PowerSearch
 *   config={config}
 *   filters={filters}
 *   onChange={(newFilters) => setFilters(newFilters)}
 * />
 * ```
 *
 * Use contentSearchFieldKey to designate a field for free-text search.
 * When set, unstructured text input is routed to that field.
 *
 * @example
 * ```
 * const config = {
 *   name: 'IssueSearch',
 *   contentSearchFieldKey: 'title',
 *   fields: [
 *     {
 *       key: 'title',
 *       label: 'Title',
 *       operators: [
 *         { key: 'contains', label: 'contains', value: { type: 'string' } },
 *       ],
 *     },
 *     {
 *       key: 'status',
 *       label: 'Status',
 *       operators: [
 *         { key: 'is', label: 'is', value: { type: 'enum', values: [...] } },
 *       ],
 *     },
 *   ],
 * };
 * ```
 */
export function PowerSearch({
  config: configProp,
  filters,
  onChange,
  label: labelFromProps,
  isLabelHidden = true,
  placeholder: placeholderFromProps,
  hasAutoFocus = false,
  hasClear = true,
  isReadOnly = false,
  isDisabled = false,
  disabledMessage,
  startIcon,
  onFocus,
  onBlur,
  status,
  statusVariant = 'attached',
  menuWidth,
  maxTokenLength = 40,
  maxOperatorMenuItems,
  maxSearchResults = DEFAULT_MAX_SEARCH_RESULTS,
  popoverSaveButtonLabel: popoverSaveButtonLabelFromProps,
  timezoneID,
  tokenOverflowBehavior,
  endContent,
  resultCount,
  ref,
  handleRef,
  size: sizeProp,
  'data-testid': testId,
  xstyle,
  className,
  style,
  components: componentOverrides
}) {
  const size = useSize(sizeProp, 'md');
  const config = useInternalConfig(configProp);
  const searchSource = usePowerSearchSource(config, maxSearchResults);
  const t = useTranslator();
  const locale = useLocale();
  const label = labelFromProps ?? t('@astryx.powersearch.label');
  const placeholder = placeholderFromProps ?? t('@astryx.powersearch.placeholder');
  const popoverSaveButtonLabel = popoverSaveButtonLabelFromProps ?? t('@astryx.powersearch.editor.apply');
  const tokenizerRef = useRef(null);
  const [popoverState, setPopoverStateRaw] = useState({
    type: 'idle'
  });

  // Layer for positioning the edit popover anchored to the tokenizer
  const handleLayerHide = useCallback(() => {
    setPopoverStateRaw({
      type: 'idle'
    });
  }, []);
  const popover = usePopover({
    onHide: handleLayerHide,
    hasLightDismiss: true,
    hasCloseButton: false,
    hasAutoFocus: false,
    // The popup's own listbox/menu content is the exposed semantics; focus
    // stays on the tokenizer input, so a modal dialog wrapper is incorrect.
    role: 'none'
  });

  // Wrapper that manages layer visibility and tokenizer focus alongside state
  const setPopoverState = useCallback(state => {
    setPopoverStateRaw(state);
    if (state.type !== 'idle') {
      // Schedule after the current frame so React can render the popover
      // content and the typeahead's synchronous focus() has completed
      requestAnimationFrame(() => {
        popover.show();
        tokenizerRef.current?.blur();
      });
    } else {
      popover.hide();
      tokenizerRef.current?.focus();
    }
  }, [popover]);

  // Expose imperative handle
  useImperativeHandle(handleRef, () => ({
    focusTypeahead() {
      tokenizerRef.current?.focus();
    },
    blurTypeahead() {
      tokenizerRef.current?.blur();
    }
  }));

  // Convert filters to tokenizer items
  const tokenizerValue = useMemo(() => {
    return filters.map((filter, index) => {
      const field = config.getField(filter.field);
      const operator = config.getOperator(filter.field, filter.operator);
      const resolvedOp = operator ? resolveOperatorLabel(operator, t) : '';
      const operatorLabel = resolvedOp ? `: ${resolvedOp}` : '';
      const valueStr = operator ? formatFilterValue(config, operator.value, filter.value, maxTokenLength, t, locale, timezoneID) : '';
      const displayLabel = valueStr ? `${field?.label ?? filter.field}${operatorLabel} ${valueStr}` : `${field?.label ?? filter.field}${operatorLabel}`;
      return {
        id: `filter-${index}-${filter.field}-${filter.operator}`,
        label: displayLabel,
        auxiliaryData: {
          fieldKey: filter.field,
          operatorKey: filter.operator,
          filterValue: filter.value,
          filterIndex: index
        }
      };
    });
  }, [filters, config, maxTokenLength, timezoneID, t, locale]);

  // Handle tokenizer onChange (field selected from typeahead)
  const handleTokenizerChange = useCallback((_items, change) => {
    if (change.type === 'add' && change.item) {
      const auxData = change.item.auxiliaryData;
      if (!auxData) {
        return;
      }
      const field = config.getField(auxData.fieldKey);
      if (!field) {
        return;
      }
      const operator = auxData.operatorKey ? config.getOperator(auxData.fieldKey, auxData.operatorKey) : config.getDefaultOperator(auxData.fieldKey);

      // If the item already has a filter value (e.g. content search), add immediately
      if (auxData.filterValue && operator) {
        const newFilter = {
          field: auxData.fieldKey,
          operator: operator.key,
          value: auxData.filterValue
        };
        onChange([...filters, newFilter], 'add', filters.length);
        return;
      }

      // For "empty" type operators, add the filter immediately
      if (operator?.value.type === 'empty') {
        const newFilter = {
          field: auxData.fieldKey,
          operator: operator.key,
          value: {
            type: 'empty'
          }
        };
        onChange([...filters, newFilter], 'add', filters.length);
        return;
      }

      // Open the edit popover for the new filter
      setPopoverState({
        type: 'adding',
        partialFilter: {
          field: auxData.fieldKey,
          operator: operator?.key,
          value: undefined
        }
      });
    } else if (change.type === 'remove' && change.item) {
      const auxData = change.item.auxiliaryData;
      if (auxData?.filterIndex != null) {
        const newFilters = filters.filter((_, i) => i !== auxData.filterIndex);
        onChange(newFilters, 'remove', auxData.filterIndex);
      }
    }
  }, [config, filters, onChange, setPopoverState]);

  // Handle clicking a token to edit
  const handleTokenClick = useCallback(index => {
    if (isReadOnly || isDisabled) {
      return;
    }
    const filter = filters[index];
    if (filter.isReadOnly) {
      return;
    }
    setPopoverState({
      type: 'editing',
      filterIndex: index,
      partialFilter: {
        field: filter.field,
        operator: filter.operator,
        value: filter.value
      }
    });
  }, [filters, isReadOnly, isDisabled, setPopoverState]);

  // Handle popover save
  const handlePopoverSave = useCallback(savedFilter => {
    if (popoverState.type === 'adding') {
      if (savedFilter) {
        onChange([...filters, savedFilter], 'add', filters.length);
      }
    } else if (popoverState.type === 'editing') {
      if (savedFilter) {
        const newFilters = [...filters];
        newFilters[popoverState.filterIndex] = savedFilter;
        onChange(newFilters, 'edit', popoverState.filterIndex);
      } else {
        // Delete
        const newFilters = filters.filter((_, i) => i !== popoverState.filterIndex);
        onChange(newFilters, 'remove', popoverState.filterIndex);
      }
    }
    setPopoverState({
      type: 'idle'
    });
  }, [popoverState, filters, onChange, setPopoverState]);

  // Handle popover cancel
  const handlePopoverCancel = useCallback(() => {
    setPopoverState({
      type: 'idle'
    });
  }, [setPopoverState]);

  // Custom token renderer
  // Custom token renderer
  const renderToken = useCallback((item, onRemove) => {
    const auxData = item.auxiliaryData;
    const filterIndex = auxData?.filterIndex ?? -1;
    const filter = filterIndex >= 0 ? filters[filterIndex] : undefined;
    const field = auxData ? config.getField(auxData.fieldKey) : undefined;
    const operator = auxData?.operatorKey ? config.getOperator(auxData.fieldKey, auxData.operatorKey) : undefined;
    const canInteract = !isReadOnly && !isDisabled && !filter?.isReadOnly;
    const handleClick = canInteract ? () => handleTokenClick(filterIndex) : undefined;
    const handleRemove = canInteract ? onRemove : undefined;

    // Check for full Token override
    const TokenOverride = operator ? componentOverrides?.[operator.value.type]?.Token : undefined;
    if (TokenOverride && filter && field && operator) {
      return /*#__PURE__*/_jsx(TokenOverride, {
        config: configProp,
        filter: filter,
        field: field,
        operator: operator,
        maxLength: maxTokenLength,
        onClick: handleClick,
        onRemove: handleRemove,
        isDisabled: isDisabled
      });
    }

    // Default token rendering
    const fieldLabel = field?.label ?? '';
    const operatorLabel = operator ? resolveOperatorLabel(operator, t) : '';
    const tokenLabel = `${fieldLabel}: ${operatorLabel}`.trim();
    const adjustedMaxLength = Math.max(maxTokenLength - fieldLabel.length - operatorLabel.length, 10);
    const valueContent = operator && filter ? /*#__PURE__*/_jsx(PowerSearchTokenValue, {
      operatorValue: operator.value,
      filterValue: filter.value,
      maxLength: adjustedMaxLength,
      locale: locale
    }) : undefined;

    // Show entity photo as token icon for single-entity filters
    let tokenIcon;
    if (filter?.value.type === 'entity_list' && filter.value.value.length === 1 && filter.value.value[0].photo) {
      const entity = filter.value.value[0];
      tokenIcon = /*#__PURE__*/_jsx(Avatar, {
        src: entity.photo,
        name: entity.label,
        size: 16
      });
    }
    return /*#__PURE__*/_jsx(Token, {
      label: tokenLabel,
      size: size,
      icon: tokenIcon,
      endContent: valueContent,
      onClick: handleClick ? e => {
        e.stopPropagation();
        handleClick();
      } : undefined,
      onRemove: handleRemove,
      isDisabled: isDisabled
    });
  }, [filters, config, configProp, maxTokenLength, locale, size, isReadOnly, isDisabled, handleTokenClick, componentOverrides, t]);

  // Custom typeahead item renderer — adds field icon and description
  const renderItem = useCallback(item => {
    const auxData = item.auxiliaryData;
    if (!auxData) {
      return /*#__PURE__*/_jsx(TypeaheadItem, {
        item: item
      });
    }
    const field = config.getField(auxData.fieldKey);
    let icon = null;
    if (field?.icon) {
      icon = field.icon;
    } else if (field) {
      const operator = auxData.operatorKey ? config.getOperator(auxData.fieldKey, auxData.operatorKey) : config.getDefaultOperator(auxData.fieldKey);
      const iconName = OPERATOR_VALUE_TYPE_TO_ICON[operator?.value.type ?? ''] ?? 'search';
      icon = /*#__PURE__*/_jsx(Icon, {
        icon: iconName,
        size: "sm",
        color: "secondary"
      });
    }
    return /*#__PURE__*/_jsx(TypeaheadItem, {
      item: item,
      icon: icon,
      description: field?.description
    });
  }, [config]);

  // The partial filter for the popover
  const popoverPartialFilter = popoverState.type !== 'idle' ? popoverState.partialFilter : null;

  // Resolve custom Editor override for the current popover filter
  const EditorOverride = useMemo(() => {
    if (!popoverPartialFilter?.field || !popoverPartialFilter?.operator) {
      return undefined;
    }
    const op = config.getOperator(popoverPartialFilter.field, popoverPartialFilter.operator);
    return op ? componentOverrides?.[op.value.type]?.Editor : undefined;
  }, [popoverPartialFilter, config, componentOverrides]);

  // Render popover content — either custom Editor or default
  const popoverContent = useMemo(() => {
    if (!popoverPartialFilter) {
      return null;
    }
    const mode = popoverState.type === 'editing' ? 'edit' : 'create';
    const popoverKey = popoverState.type === 'editing' ? `edit-${popoverState.filterIndex}-${popoverPartialFilter.field}` : `add-${popoverPartialFilter.field}`;
    if (EditorOverride) {
      return /*#__PURE__*/_jsx(EditorOverride, {
        config: configProp,
        filter: popoverPartialFilter,
        mode: mode,
        onSave: handlePopoverSave,
        onCancel: handlePopoverCancel,
        saveButtonLabel: popoverSaveButtonLabel,
        isReadOnly: isReadOnly
      }, popoverKey);
    }
    return /*#__PURE__*/_jsx(PowerSearchEditPopover, {
      config: config,
      filter: popoverPartialFilter,
      mode: mode,
      onSave: handlePopoverSave,
      onCancel: handlePopoverCancel,
      saveButtonLabel: popoverSaveButtonLabel,
      maxMenuItems: maxOperatorMenuItems,
      isReadOnly: isReadOnly
    }, popoverKey);
  }, [popoverPartialFilter, popoverState, EditorOverride, configProp, config, handlePopoverSave, handlePopoverCancel, popoverSaveButtonLabel, maxOperatorMenuItems, isReadOnly]);

  // Plain-text form of the result count, shared by the visible label and the
  // screen-reader announcement so the two never drift. The ICU plural handles
  // the number formatting + `result` vs `results` in one message so translators
  // can match the locale's plural rules.
  const resultCountText = useMemo(() => {
    if (resultCount == null) {
      return null;
    }
    if (typeof resultCount === 'number') {
      return t('@astryx.powersearch.resultCount', {
        count: resultCount
      });
    }
    return resultCount;
  }, [resultCount, t]);

  // Announce result-count changes to screen readers through a polite live
  // region, mirroring the way Typeahead announces its dropdown result count.
  // The count is otherwise only shown visually and stays silent to assistive
  // tech. Skip the first run so the count already present on mount isn't
  // announced unprompted — only user-driven changes are spoken.
  const announce = useAnnounce();
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (resultCountText != null) {
      announce(resultCountText);
    }
  }, [resultCountText, announce]);

  // Build combined endContent from resultCount + endContent props
  const combinedEndContent = useMemo(() => {
    const resultCountNode = resultCountText != null ? /*#__PURE__*/_jsx("span", {
      ...{
        className: "x141an7d x1ltkj2j xv1l7n4 xuxw1ft"
      },
      children: resultCountText
    }) : null;
    if (resultCountNode && endContent) {
      return /*#__PURE__*/_jsxs(_Fragment, {
        children: [resultCountNode, endContent]
      });
    }
    return resultCountNode || endContent || undefined;
  }, [resultCountText, endContent]);
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [/*#__PURE__*/_jsx("div", {
      ref: useMergedRefs(ref, popover.triggerRef),
      ...themeProps('power-search'),
      children: /*#__PURE__*/_jsx(Tokenizer, {
        handleRef: tokenizerRef,
        label: label,
        isLabelHidden: isLabelHidden,
        searchSource: searchSource,
        value: tokenizerValue,
        onChange: handleTokenizerChange,
        renderToken: renderToken,
        renderItem: renderItem,
        maxMenuItems: MAX_BROWSE_MENU_ITEMS,
        menuWidth: menuWidth,
        placeholder: filters.length === 0 ? placeholder : '',
        hasAutoFocus: hasAutoFocus,
        hasClear: hasClear && !isReadOnly,
        startIcon: startIcon,
        endContent: combinedEndContent,
        isDisabled: isDisabled,
        disabledMessage: disabledMessage,
        size: size,
        tokenOverflowBehavior: tokenOverflowBehavior,
        hasEntriesOnFocus: true,
        debounceMs: 0,
        status: status,
        statusVariant: statusVariant,
        onFocus: onFocus,
        onBlur: onBlur,
        xstyle: xstyle,
        className: className,
        style: style,
        "data-testid": testId
      })
    }), popover.render(popoverContent, {
      placement: 'below',
      alignment: 'start',
      offset: spacingVars['--spacing-1'],
      xstyle: [popoverLayerStyles.layer, layerAnimations.below]
    })]
  });
}
PowerSearch.displayName = 'PowerSearch';