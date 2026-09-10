import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const outfile = path.join(process.cwd(), "node_modules", ".cache", "check-http-security.mjs");
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await esbuild.build({
  entryPoints: ["app/lib/http-security.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "silent",
  packages: "external",
});

const security = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
};
const context = (request) => ({ request, params: {}, context: {} });
const address = { "x-chapman-client-address": "203.0.113.10" };

security.resetPublicRateLimits();
let reached = false;
const unrelated = await security.publicRequestGuardMiddleware(
  context(new Request("https://gateway.example/dashboard", { method: "POST" })),
  async () => { reached = true; return new Response("ok"); },
);
check("merchant-only routes are outside the public limiter", reached && unrelated.status === 200);

const oversized = await security.publicRequestGuardMiddleware(
  context(new Request("https://gateway.example/embed/chat", {
    method: "POST",
    headers: { ...address, "content-length": String(security.PUBLIC_BODY_LIMITS.chat + 1) },
  })),
  async () => new Response("should not run"),
);
check("declared oversized chat bodies are rejected before routing", oversized.status === 413);
check("oversized response has a stable code", (await oversized.json()).error_code === "HTTP_BODY_TOO_LARGE");

const chunks = [new Uint8Array(40_000), new Uint8Array(40_000)];
const chunked = new Request("https://gateway.example/embed/chat", {
  method: "POST",
  body: new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  }),
  duplex: "half",
});
let chunkFailure;
try {
  await security.readPublicJson(chunked, "chat");
} catch (error) {
  chunkFailure = security.publicBodyFailure(error);
}
check("chunked bodies are bounded while streaming", chunkFailure?.status === 413 && chunkFailure.code === "HTTP_BODY_TOO_LARGE");

const parsed = await security.readPublicJson(
  new Request("https://gateway.example/embed/chat", { method: "POST", body: JSON.stringify({ message: "hello" }) }),
  "chat",
);
check("ordinary bounded JSON still parses", parsed.message === "hello");

let malformed;
try {
  await security.readPublicJson(new Request("https://gateway.example/embed/chat", { method: "POST", body: "{" }), "chat");
} catch (error) {
  malformed = security.publicBodyFailure(error);
}
check("malformed JSON has a stable input code", malformed?.status === 400 && malformed.code === "HTTP_BODY_INVALID");

security.resetPublicRateLimits();
const originalLog = console.log;
console.log = () => {};
let limited;
try {
  for (let n = 0; n < 13; n++) {
    limited = await security.publicRequestGuardMiddleware(
      context(new Request("https://gateway.example/embed/chat", { method: "POST", headers: address })),
      async () => new Response("ok"),
    );
  }
} finally {
  console.log = originalLog;
}
check("chat bursts are rate limited", limited?.status === 429);
check("rate-limit responses tell callers when to retry", Number(limited?.headers.get("retry-after")) >= 1);
check("rate-limit responses have a stable code", (await limited.json()).error_code === "HTTP_RATE_LIMITED");

const differentAddress = await security.publicRequestGuardMiddleware(
  context(new Request("https://gateway.example/embed/chat", {
    method: "POST",
    headers: { "x-chapman-client-address": "203.0.113.11" },
  })),
  async () => new Response("ok"),
);
check("one client does not consume another client's bucket", differentAddress.status === 200);

security.resetPublicRateLimits();
let agentRead;
console.log = () => {};
try {
  for (let n = 0; n < 31; n++) {
    agentRead = await security.publicRequestGuardMiddleware(
      context(new Request("https://gateway.example/ucp/pk_demo/profile", { headers: address })),
      async () => new Response("ok"),
    );
  }
} finally {
  console.log = originalLog;
}
check("public agent discovery reads are rate limited too", agentRead?.status === 429);

const productionServer = fs.readFileSync("scripts/serve.mjs", "utf8");
const compose = fs.readFileSync("../docker-compose.yml", "utf8");
check("the production wrapper overwrites the internal client address", productionServer.includes('req.headers["x-chapman-client-address"] = req.ip'));
check("forwarded addresses require an explicit trusted-proxy switch", productionServer.includes('process.env.CHAPMAN_TRUST_PROXY'));
check(
  "Docker passes the explicit one-hop proxy switch to the production server",
  compose.includes("CHAPMAN_TRUST_PROXY: ${CHAPMAN_TRUST_PROXY:-}"),
);

console.log(failed === 0 ? "\nall HTTP security checks passed" : `\n${failed} HTTP security check(s) failed`);
if (failed) process.exitCode = 1;
