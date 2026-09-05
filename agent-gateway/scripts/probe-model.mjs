import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const out = path.join(process.cwd(), "node_modules", ".cache", "or-probe.mjs");
await esbuild.build({
  entryPoints: ["app/lib/openrouter.server.ts"],
  bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "silent",
});
const OR = await import(pathToFileURL(out).href + "?t=" + Date.now());

console.log("configured:", OR.isConfigured());
for (const [k, v] of Object.entries(OR.MODELS)) console.log(`  ${k.padEnd(10)} ${v().join(" -> ")}`);

for (const [job, model] of Object.entries({
  assistant: OR.MODELS.assistant(),
  analyst: OR.MODELS.analyst(),
  grader: OR.MODELS.grader(),
})) {
  const t0 = Date.now();
  const text = await OR.complete({
    model,
    messages: [
      { role: "system", content: "Reply with exactly the word OK and nothing else." },
      { role: "user", content: "ping" },
    ],
    maxTokens: 20,
    timeoutMs: 30000,
  });
  console.log(`${job.padEnd(10)} ${String(Date.now() - t0).padStart(6)}ms  -> ${JSON.stringify(text ?? "").slice(0, 90)}`);
}

console.log("\nstreaming:");
const t0 = Date.now();
let first = 0, n = 0, full = "";
for await (const piece of OR.completeStream({
  model: OR.MODELS.assistant(),
  messages: [{ role: "user", content: "Name three Indian teas, one line each. No preamble." }],
  maxTokens: 80,
})) {
  if (!first) first = Date.now() - t0;
  n++; full += piece;
}
console.log(`  ${n} chunks, first at ${first}ms, total ${Date.now() - t0}ms`);
console.log("  " + full.replace(/\n/g, "\n  ").slice(0, 300));
