import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

async function load(entry, name) {
  const out = path.join(process.cwd(), "node_modules", ".cache", name);
  await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "silent" });
  return import(pathToFileURL(out).href + "?t=" + Date.now());
}
const H = await load("app/lib/harness.server.ts", "pa-h.mjs");
const M = await load("app/lib/merchanttools.server.ts", "pa-m.mjs");
const C = await load("app/lib/catalog.server.ts", "pa-c.mjs");
const OR = await load("app/lib/openrouter.server.ts", "pa-or.mjs");
const P = await load("app/lib/analyst-presenter.server.ts", "pa-p.mjs");
const R = await load("app/lib/analyst-router.server.ts", "pa-r.mjs");
const A = await load("app/lib/analyst-reasoner.server.ts", "pa-a.mjs");

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? String(args[at + 1] ?? "").trim() || fallback : fallback;
};
const positional = args.filter(
  (value, index) =>
    !value.startsWith("--") &&
    args[index - 1] !== "--shop" &&
    args[index - 1] !== "--name" &&
    args[index - 1] !== "--catalog",
);
const shop = valueAfter("--shop", "pk_nilgiripost_dev");
const shopName = valueAfter("--name", "Nilgiri Post");
const catalogUrl = valueAfter(
  "--catalog",
  "http://127.0.0.1:4000/catalog.json",
);
const q = positional.join(" ") || "Which two products are most worth cross-selling, and how much is it worth a month?";
const t0 = Date.now();
const toolContext = {
  shop,
  shopName,
  catalog: C.jsonFeedCatalog(catalogUrl),
  cache: {},
};
let steps = await R.deterministicAnalystSteps(q, toolContext);
const out = steps.length ? {
  reply: "",
  steps,
  model: "deterministic-router",
} : await H.runHarness({
  shop,
  tools: M.MERCHANT_TOOLS,
  toolContext,
  system: `You are an analyst for ${shopName}. Answer using the tools only. Never compute a statistic yourself.`,
  message: q,
  model: OR.MODELS.orchestrator(),
  maxSteps: 5,
  maxMs: 45000,
  reasoningEffort: "minimal",
  keyRole: "orchestrator",
});
steps = out.steps;
const reasonedAnswer = await A.reasonAboutAnalystResults({ shop, question: q, steps });
const reply = await P.presentAnalystAnswer({
  shop,
  question: q,
  steps,
  reasonedAnswer,
});
console.log(`\n${Date.now() - t0}ms | model ${out.model} | stoppedBy ${out.stoppedBy ?? "-"} | ${steps.length} steps`);
for (const s of steps) console.log(`  ${s.tool}(${JSON.stringify(s.args)}) ${s.ms}ms${s.error ? " ERROR " + s.error : ""}\n     ${s.result.slice(0, 200).replace(/\n/g, "\n     ")}`);
console.log("\nANSWER:\n" + (reply || "(none)"));
