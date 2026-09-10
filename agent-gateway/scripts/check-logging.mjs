import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const outfile = path.join(process.cwd(), "node_modules", ".cache", "check-logging.mjs");
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await esbuild.build({
  entryPoints: ["app/lib/logging.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "silent",
  packages: "external",
});

const logging = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const productionServer = fs.readFileSync("scripts/serve.mjs", "utf8");
let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

const captured = [];
const originalLog = console.log;
console.log = (line) => captured.push(String(line));
let response;
try {
  response = await logging.requestLoggingMiddleware(
    {
      request: new Request(
        "https://gateway.example/chat?token=should-never-appear&email=shopper@example.com",
        { method: "POST", headers: { "X-Request-ID": "demo-request-1234" } },
      ),
      params: {},
      context: {},
    },
    async () => new Response("ok", { status: 201 }),
  );
} finally {
  console.log = originalLog;
}

const completed = JSON.parse(captured.at(-1));
check("safe incoming request ID is returned", response.headers.get("X-Request-ID") === "demo-request-1234");
check("request ID is browser-visible", response.headers.get("Access-Control-Expose-Headers")?.includes("X-Request-ID"));
check("completion log is structured JSON", completed.event === "http.request.completed" && completed.level === "info");
check("completion log correlates the request", completed.request_id === "demo-request-1234");
check("method, path, status, and duration are present", completed.method === "POST" && completed.path === "/chat" && completed.status === 201 && Number.isInteger(completed.duration_ms));
check("query strings are not logged", !captured.join("\n").includes("should-never-appear") && !captured.join("\n").includes("shopper@example.com"));

const unsafeId = logging.requestIdFor(new Request("https://gateway.example/", {
  headers: { "X-Request-ID": "bad id with spaces" },
}));
check("unsafe incoming request IDs are replaced", unsafeId !== "bad id with spaces" && /^[0-9a-f-]{36}$/.test(unsafeId));

const redacted = logging.redactLogValue({
  password: "hunter2",
  nested: { authorization: "Bearer abc", note: "email shopper@example.com phone 9876543210" },
});
const redactedText = JSON.stringify(redacted);
check("secret-named fields are redacted", redacted.password === "[redacted]" && redacted.nested.authorization === "[redacted]");
check("contact data inside messages is redacted", !redactedText.includes("shopper@example.com") && !redactedText.includes("9876543210"));

const failedLines = [];
console.log = (line) => failedLines.push(String(line));
try {
  await logging.requestLoggingMiddleware(
    { request: new Request("https://gateway.example/pay"), params: {}, context: {} },
    async () => { throw new Error("provider failed for buyer@example.com with Bearer very-secret"); },
  );
} catch {
  // Expected: middleware observes and rethrows application errors.
} finally {
  console.log = originalLog;
}
const failure = JSON.parse(failedLines.at(-1));
check("failures are structured, coded, and correlated", failure.event === "http.request.failed" && failure.error_code === "HTTP_UNHANDLED_ERROR" && failure.status === 500 && /^[0-9a-f-]{36}$/.test(failure.request_id));
check("failure messages are redacted", !failedLines.join("\n").includes("buyer@example.com") && !failedLines.join("\n").includes("very-secret"));

const statusLines = [];
console.log = (line) => statusLines.push(String(line));
let missing;
try {
  missing = await logging.requestLoggingMiddleware(
    { request: new Request("https://gateway.example/missing"), params: {}, context: {} },
    async () => new Response("not found", { status: 404 }),
  );
} finally {
  console.log = originalLog;
}
const statusError = JSON.parse(statusLines.at(-1));
check("HTTP error responses carry stable codes", missing.status === 404 && statusError.level === "error" && statusError.error_code === "HTTP_404");
check("production start uses Chapman's server wrapper", packageJson.scripts.start === "node scripts/serve.mjs");
check("production server does not enable the unredacted morgan logger", !productionServer.includes("morgan"));
check("server-wrapper failures also have a stable code", productionServer.includes('error_code: "HTTP_SERVER_ERROR"'));

console.log(failed === 0 ? "\nall logging checks passed" : `\n${failed} logging check(s) failed`);
if (failed) process.exitCode = 1;
