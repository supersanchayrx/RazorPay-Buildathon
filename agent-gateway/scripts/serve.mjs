import { randomUUID } from "node:crypto";
import path from "node:path";
import compression from "compression";
import express from "express";
import { createRequestHandler } from "@react-router/express";
import * as build from "../build/server/index.js";
import { createGracefulShutdown, lifecycleRegistry, shutdownTimeout } from "./graceful-shutdown.mjs";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || undefined;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const app = express();
const TRUST_PROXY = process.env.CHAPMAN_TRUST_PROXY;

function lifecycleLog(level, event, fields = {}) {
  console.log(JSON.stringify({
    ...fields,
    timestamp: new Date().toISOString(),
    level,
    event,
  }));
}

const shutdown = createGracefulShutdown({
  registry: lifecycleRegistry(),
  timeoutMs: shutdownTimeout(),
  log: lifecycleLog,
});

if (TRUST_PROXY === "1" || TRUST_PROXY === "true") app.set("trust proxy", 1);

function requestId(value) {
  const supplied = typeof value === "string" ? value.trim() : "";
  return SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
}

function infrastructureError(error, request) {
  const id = requestId(request?.headers?.["x-request-id"]);
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    event: "http.server.failed",
    error_code: "HTTP_SERVER_ERROR",
    message: "Production HTTP server failed outside the application handler",
    request_id: id,
    ...(request ? {
      method: request.method,
      path: new URL(request.originalUrl, "http://localhost").pathname,
    } : {}),
    error_type: error instanceof Error ? error.name : "UnknownError",
  }));
  return id;
}

app.disable("x-powered-by");
app.use(compression());
app.use((req, res, next) => {
  const id = requestId(req.headers["x-request-id"]);
  req.headers["x-request-id"] = id;
  // Overwrite any client-supplied value. `req.ip` uses the direct socket unless
  // one reverse-proxy hop was explicitly trusted above.
  req.headers["x-chapman-client-address"] = req.ip;
  res.setHeader("X-Request-ID", id);
  res.setHeader("Access-Control-Expose-Headers", "X-Request-ID");
  next();
});
app.use(shutdown.middleware);
app.use("/assets", express.static(path.resolve("build/client/assets"), {
  immutable: true,
  maxAge: "1y",
}));
app.use(express.static(path.resolve("build/client")));
app.use(express.static(path.resolve("public"), { maxAge: "1h" }));
app.use((_req, res, next) => {
  // Static responses keep the wrapper header. Dynamic responses receive the
  // same ID from root middleware; remove the provisional copy so Express does
  // not append the identical header twice.
  res.removeHeader("X-Request-ID");
  res.removeHeader("Access-Control-Expose-Headers");
  next();
});
app.all("*", createRequestHandler({ build, mode: process.env.NODE_ENV }));
app.use((error, req, res, _next) => {
  const id = infrastructureError(error, req);
  if (!res.headersSent) {
    res.status(500).set("X-Request-ID", id).json({
      error: "Internal server error",
      error_code: "HTTP_SERVER_ERROR",
      request_id: id,
    });
  } else {
    res.end();
  }
});

const server = HOST
  ? app.listen(PORT, HOST, onListen)
  : app.listen(PORT, onListen);

function onListen() {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event: "http.server.listening",
    host: HOST ?? "0.0.0.0",
    port: PORT,
  }));
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    void shutdown.begin(signal, server).then(({ exitCode }) => {
      process.exitCode = exitCode;
    });
  });
}
