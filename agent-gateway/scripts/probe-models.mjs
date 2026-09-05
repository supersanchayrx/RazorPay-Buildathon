/**
 * Which free models are actually answering right now.
 *
 * Free tiers are rate-limited upstream and go in and out of service, so the
 * right default is not "the best model" but "a chain of models that are
 * currently up". This measures that rather than assuming it.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const out = path.join(process.cwd(), "node_modules", ".cache", "or-probe2.mjs");
await esbuild.build({
  entryPoints: ["app/lib/openrouter.server.ts"],
  bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "silent",
});
const OR = await import(pathToFileURL(out).href + "?t=" + Date.now());

const CANDIDATES = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "z-ai/glm-5.2:free",
  "minimax/minimax-m2.7:free",
  "minimax/minimax-m3:free",
  "liquid/lfm-2.5-2.6b:free",
  "thinkingmachines/inkling-small:free",
  "inclusionai/ling-3.0-flash-sante:free",
  "openrouter/free",
];

const results = [];
for (const model of CANDIDATES) {
  const t0 = Date.now();
  const text = await OR.complete({
    model,
    messages: [
      { role: "system", content: "You reply with exactly one word." },
      { role: "user", content: "Say OK." },
    ],
    maxTokens: 16,
    timeoutMs: 20000,
  });
  const ms = Date.now() - t0;
  results.push({ model, ok: text !== null, ms, text });
  console.log(`${text !== null ? "UP  " : "down"}  ${String(ms).padStart(6)}ms  ${model.padEnd(38)} ${JSON.stringify(text ?? "").slice(0, 40)}`);
}

const up = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
console.log(`\n${up.length} of ${results.length} answering.`);
if (up.length) console.log("fastest first:\n  " + up.map((r) => `${r.model} (${r.ms}ms)`).join("\n  "));
