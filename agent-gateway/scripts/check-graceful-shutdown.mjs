import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { createGracefulShutdown, shutdownTimeout } from "./graceful-shutdown.mjs";

const outfile = path.join(process.cwd(), "node_modules", ".cache", "check-runtime-lifecycle.mjs");
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await esbuild.build({
  entryPoints: ["app/lib/runtime-lifecycle.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "silent",
  packages: "external",
});

globalThis.__chapmanRuntimeLifecycle = undefined;
const lifecycle = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
const registry = lifecycle.runtimeLifecycleRegistry();
let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
};

check("shutdown timeout defaults to 20 seconds", shutdownTimeout(undefined) === 20_000);
check("shutdown timeout accepts bounded configuration", shutdownTimeout("3500") === 3_500);
check("unsafe shutdown timeout falls back", shutdownTimeout("999") === 20_000);

let releaseRequest;
let requestStarted;
const started = new Promise((resolve) => { requestStarted = resolve; });
const events = [];
const shutdown = createGracefulShutdown({
  registry,
  timeoutMs: 2_000,
  log: (level, event, fields) => events.push({ level, event, ...fields }),
  forceExit: () => { throw new Error("clean drain should not force exit"); },
});
const server = http.createServer((req, res) => shutdown.middleware(req, res, () => {
  requestStarted();
  new Promise((resolve) => { releaseRequest = resolve; }).then(() => res.end("done"));
}));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const responsePromise = fetch(`http://127.0.0.1:${port}/slow`);
await started;
check("HTTP middleware counts an in-flight request", shutdown.activeRequests === 1);

let releaseBackground;
const background = new Promise((resolve) => { releaseBackground = resolve; });
lifecycle.trackBackgroundTask(background, "embedding.test");
const drainPromise = shutdown.begin("SIGTERM", server);
check("shutdown immediately enters draining state", shutdown.draining === true);

const lateResponse = new EventEmitter();
lateResponse.statusCode = 0;
lateResponse.headers = {};
lateResponse.status = (status) => { lateResponse.statusCode = status; return lateResponse; };
lateResponse.set = (name, value) => { lateResponse.headers[name] = value; return lateResponse; };
lateResponse.json = (body) => { lateResponse.body = body; lateResponse.emit("finish"); return lateResponse; };
let lateReached = false;
shutdown.middleware({ headers: { "x-request-id": "shutdown-test-1234" } }, lateResponse, () => { lateReached = true; });
check("late keep-alive work receives coded 503", !lateReached && lateResponse.statusCode === 503 && lateResponse.body.error_code === "HTTP_SERVER_SHUTTING_DOWN");
check("late work is told to retry and close", lateResponse.headers["Retry-After"] === "5" && lateResponse.headers.Connection === "close");

let firstTaskRan = false;
let secondTaskRan = false;
lifecycle.registerShutdownTask("test.second", () => { secondTaskRan = firstTaskRan; }, 20);
lifecycle.registerShutdownTask("test.first", () => { firstTaskRan = true; }, 10);

releaseRequest();
const response = await responsePromise;
check("in-flight response is allowed to finish", response.status === 200 && await response.text() === "done");
await new Promise((resolve) => setTimeout(resolve, 10));
check("resource closers wait for background work", !firstTaskRan && registry.backgroundTasks.size === 1);

releaseBackground();
const result = await drainPromise;
check("tracked background work drains", registry.backgroundTasks.size === 0);
check("resource closers run in declared order", firstTaskRan && secondTaskRan);
check("clean shutdown returns success", result.exitCode === 0 && result.forced === false);
check("shutdown stages are structured and complete", [
  "process.shutdown.started",
  "process.shutdown.http_drained",
  "process.shutdown.background_drained",
  "process.shutdown.completed",
].every((event) => events.some((entry) => entry.event === event)));

const timeoutEvents = [];
let forcedCode = null;
let connectionsClosed = false;
const stuckServer = {
  close() {},
  closeIdleConnections() {},
  closeAllConnections() { connectionsClosed = true; },
};
const stuck = createGracefulShutdown({
  registry: { backgroundTasks: new Map(), shutdownTasks: new Map() },
  timeoutMs: 25,
  log: (level, event, fields) => timeoutEvents.push({ level, event, ...fields }),
  forceExit: (code) => { forcedCode = code; },
});
const forced = await stuck.begin("SIGTERM", stuckServer);
check("a stuck drain is forcibly bounded", forced.forced && forcedCode === 1 && connectionsClosed);
check("forced timeout has a stable error code", timeoutEvents.some((entry) => entry.error_code === "PROCESS_SHUTDOWN_TIMEOUT"));

const databaseSource = fs.readFileSync("app/lib/database.server.ts", "utf8");
const prismaSource = fs.readFileSync("app/db.server.ts", "utf8");
const voiceSource = fs.readFileSync("app/routes/voice.turn.$site.$token.tsx", "utf8");
const serverSource = fs.readFileSync("scripts/serve.mjs", "utf8");
check("SQLite checkpoints and closes on shutdown", databaseSource.includes("PRAGMA wal_checkpoint(TRUNCATE)") && databaseSource.includes("sqlite.checkpoint_and_close"));
check("Prisma disconnects before SQLite closes", prismaSource.includes("prisma.disconnect") && prismaSource.includes("$disconnect"));
check("detached voice model/TTS work is tracked", voiceSource.includes("trackBackgroundTask"));
check("production signals use the graceful coordinator", serverSource.includes("shutdown.begin(signal, server)") && serverSource.includes("app.use(shutdown.middleware)"));
check("a repeated signal reaches the forced-shutdown path", serverSource.includes("process.on(signal"));

console.log(failed === 0 ? "\nall graceful shutdown checks passed" : `\n${failed} graceful shutdown check(s) failed`);
if (failed) process.exitCode = 1;
