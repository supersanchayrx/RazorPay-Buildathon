// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file useInternalConfig.ts
 * @input PowerSearchConfig
 * @output InternalConfig with O(1) lookups
 * @position Hook; consumed by PowerSearch and sub-components
 *
 * SYNC: When modified, update:
 * - /packages/core/src/PowerSearch/index.ts
 */
import { useMemo } from 'react';
export function useInternalConfig(config) {
  return useMemo(() => {
    const fieldMap = new Map();
    const operatorMap = new Map();
    for (const field of config.fields) {
      fieldMap.set(field.key, field);
      const opMap = new Map();
      for (const op of field.operators) {
        opMap.set(op.key, op);
      }
      operatorMap.set(field.key, opMap);
    }
    return {
      config,
      getField(key) {
        return fieldMap.get(key);
      },
      getOperator(fieldKey, operatorKey) {
        return operatorMap.get(fieldKey)?.get(operatorKey);
      },
      getDefaultOperator(fieldKey) {
        const field = fieldMap.get(fieldKey);
        if (!field) {
          return undefined;
        }
        if (field.defaultOperator) {
          return operatorMap.get(fieldKey)?.get(field.defaultOperator);
        }
        return field.operators[0];
      },
      getVisibleFields() {
        return config.fields;
      },
      getVisibleOperators(fieldKey) {
        const field = fieldMap.get(fieldKey);
        return field?.operators ?? [];
      }
    };
  }, [config]);
}