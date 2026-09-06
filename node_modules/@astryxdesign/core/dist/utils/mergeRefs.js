// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file mergeRefs.ts
 * @input Multiple React refs (callback, object, or undefined)
 * @output A single callback ref that forwards to all inputs
 * @position Utility; used by components that need to merge an external ref
 *   with an internal ref (e.g., popover trigger + consumer ref).
 */

export function mergeRefs(...refs) {
  return value => {
    const cleanups = [];
    for (const ref of refs) {
      if (typeof ref === 'function') {
        const cleanup = ref(value);
        cleanups.push(typeof cleanup === 'function' ? cleanup : () => ref(null));
      } else if (ref != null) {
        const mutableRef = ref;
        mutableRef.current = value;
        cleanups.push(() => {
          mutableRef.current = null;
        });
      }
    }
    if (value != null && cleanups.length > 0) {
      return () => {
        for (const cleanup of cleanups) {
          cleanup();
        }
      };
    }
  };
}