const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ShutdownTimeoutError extends Error {}

function withDeadline(work, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ShutdownTimeoutError("shutdown deadline exceeded")), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export function lifecycleRegistry() {
  globalThis.__chapmanRuntimeLifecycle ??= {
    backgroundTasks: new Map(),
    shutdownTasks: new Map(),
  };
  return globalThis.__chapmanRuntimeLifecycle;
}

function timeoutValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 120_000
    ? Math.floor(parsed)
    : 20_000;
}

export function shutdownTimeout(value = process.env.CHAPMAN_SHUTDOWN_TIMEOUT_MS) {
  return timeoutValue(value);
}

export function createGracefulShutdown({
  registry = lifecycleRegistry(),
  timeoutMs = shutdownTimeout(),
  log = () => {},
  forceExit = (code) => process.exit(code),
} = {}) {
  let activeRequests = 0;
  let draining = false;
  let shutdownPromise = null;
  const activeWaiters = new Set();

  const settleRequest = () => {
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0) {
      for (const resolve of activeWaiters) resolve();
      activeWaiters.clear();
    }
  };

  function middleware(req, res, next) {
    if (draining) {
      const requestId = req.headers?.["x-request-id"];
      log("warn", "http.request.rejected_during_shutdown", {
        error_code: "HTTP_SERVER_SHUTTING_DOWN",
        ...(requestId ? { request_id: requestId } : {}),
      });
      res.status(503);
      res.set("Connection", "close");
      res.set("Retry-After", "5");
      res.json({
        error: "Server is restarting",
        error_code: "HTTP_SERVER_SHUTTING_DOWN",
        ...(requestId ? { request_id: requestId } : {}),
      });
      return;
    }

    activeRequests++;
    let settled = false;
    const settleOnce = () => {
      if (settled) return;
      settled = true;
      settleRequest();
    };
    res.once("finish", settleOnce);
    res.once("close", settleOnce);
    next();
  }

  const waitForRequests = () => activeRequests === 0
    ? Promise.resolve()
    : new Promise((resolve) => activeWaiters.add(resolve));

  async function waitForBackgroundTasks() {
    // A completing task may enqueue its final child task, so re-check until a
    // whole turn observes an empty registry.
    while (registry.backgroundTasks.size > 0) {
      await Promise.allSettled([...registry.backgroundTasks.keys()]);
      await delay(0);
    }
  }

  async function runShutdownTasks() {
    let failed = false;
    const tasks = [...registry.shutdownTasks.values()]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    for (const task of tasks) {
      try {
        await task.run();
        log("info", "process.shutdown.task_completed", { task: task.name });
      } catch (error) {
        failed = true;
        log("error", "process.shutdown.task_failed", {
          error_code: "PROCESS_SHUTDOWN_TASK_FAILED",
          task: task.name,
          error_type: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    return failed;
  }

  async function drain(signal, server) {
    draining = true;
    log("info", "process.shutdown.started", {
      signal,
      active_requests: activeRequests,
      background_tasks: registry.backgroundTasks.size,
      timeout_ms: timeoutMs,
    });

    let closeError = null;
    const serverClosed = new Promise((resolve) => {
      server.close((error) => {
        closeError = error ?? null;
        resolve();
      });
      server.closeIdleConnections?.();
    });

    await waitForRequests();
    // Connections carrying active responses were not idle when close() began.
    // Close them now that their responses have flushed so keep-alive sockets do
    // not consume the rest of the graceful-shutdown budget.
    server.closeIdleConnections?.();
    await serverClosed;
    if (closeError) throw closeError;
    log("info", "process.shutdown.http_drained", { active_requests: 0 });

    await waitForBackgroundTasks();
    log("info", "process.shutdown.background_drained", { background_tasks: 0 });

    const taskFailed = await runShutdownTasks();
    log(taskFailed ? "error" : "info", "process.shutdown.completed", {
      ...(taskFailed ? { error_code: "PROCESS_SHUTDOWN_INCOMPLETE" } : {}),
      exit_code: taskFailed ? 1 : 0,
    });
    return { exitCode: taskFailed ? 1 : 0, forced: false };
  }

  function begin(signal, server) {
    if (shutdownPromise) {
      log("error", "process.shutdown.forced", {
        error_code: "PROCESS_SHUTDOWN_FORCED",
        signal,
      });
      server.closeAllConnections?.();
      forceExit(1);
      return shutdownPromise;
    }

    const work = drain(signal, server);
    shutdownPromise = withDeadline(work, timeoutMs).catch((error) => {
      const timedOut = error instanceof ShutdownTimeoutError;
      log("error", timedOut ? "process.shutdown.timed_out" : "process.shutdown.failed", {
        error_code: timedOut ? "PROCESS_SHUTDOWN_TIMEOUT" : "PROCESS_SHUTDOWN_FAILED",
        active_requests: activeRequests,
        background_tasks: registry.backgroundTasks.size,
        timeout_ms: timeoutMs,
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
      server.closeAllConnections?.();
      forceExit(1);
      return { exitCode: 1, forced: true };
    });
    return shutdownPromise;
  }

  return {
    begin,
    middleware,
    get activeRequests() { return activeRequests; },
    get draining() { return draining; },
  };
}
