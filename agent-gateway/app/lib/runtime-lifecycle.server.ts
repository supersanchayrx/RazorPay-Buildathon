/**
 * Process-wide lifecycle registry shared by the bundled application and the
 * production HTTP wrapper. Keeping the registry on globalThis matters because
 * the wrapper cannot import TypeScript source after React Router has bundled
 * the application.
 */
export type ShutdownTask = {
  name: string;
  order: number;
  run: () => void | Promise<void>;
};

export type RuntimeLifecycleRegistry = {
  backgroundTasks: Map<Promise<unknown>, string>;
  shutdownTasks: Map<string, ShutdownTask>;
};

declare global {
  // eslint-disable-next-line no-var
  var __chapmanRuntimeLifecycle: RuntimeLifecycleRegistry | undefined;
}

function registry(): RuntimeLifecycleRegistry {
  globalThis.__chapmanRuntimeLifecycle ??= {
    backgroundTasks: new Map(),
    shutdownTasks: new Map(),
  };
  return globalThis.__chapmanRuntimeLifecycle;
}

/** Mark detached work that must be allowed to settle before databases close. */
export function trackBackgroundTask<T>(promise: Promise<T>, label: string): Promise<T> {
  const tracked = promise as Promise<unknown>;
  registry().backgroundTasks.set(tracked, label);
  const remove = () => registry().backgroundTasks.delete(tracked);
  // Both handlers consume their own branch, so tracking never creates an
  // unhandled rejection or changes the promise returned to the caller.
  void tracked.then(remove, remove);
  return promise;
}

/** Register an idempotent resource closer. Larger order values run later. */
export function registerShutdownTask(
  name: string,
  run: ShutdownTask["run"],
  order = 100,
): () => void {
  registry().shutdownTasks.set(name, { name, order, run });
  return () => registry().shutdownTasks.delete(name);
}

export function runtimeLifecycleRegistry(): RuntimeLifecycleRegistry {
  return registry();
}
