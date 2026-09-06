/**
 * Streaming bounds.
 *
 * The property under test is the one the whole feature could quietly break:
 *
 *   NOTHING IS RELEASED THAT HAS NOT PASSED A BOUNDS CHECK.
 *
 * The obvious way to stream — forward tokens, check at the end — passes a naive
 * test suite and fails the only requirement that matters, because by the time
 * the check fails the shopper has read it. So these checks assert on what was
 * RELEASED, not on what was finally reported.
 *
 * Run:  node scripts/check-streaming.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const out = path.join(process.cwd(), "node_modules", ".cache", "bounds-stream.mjs");
fs.mkdirSync(path.dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: ["app/lib/bounds.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "silent",
});
const { createStreamGuard, checkReply } = await import(pathToFileURL(out).href);

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/** Feed text through the guard one word at a time, as a model would. */
function run(text, opts = { groundedStockClaims: [] }) {
  const g = createStreamGuard(opts);
  let released = "";
  let violations = [];
  for (const piece of text.match(/\S+\s*/g) ?? []) {
    const step = g.push(piece);
    if (step.violations.length) {
      violations = step.violations;
      break;
    }
    released += step.release;
  }
  if (!violations.length) {
    const step = g.end();
    if (step.violations.length) violations = step.violations;
    else released += step.release;
  }
  return { released, violations, full: g.text };
}

/* ---- clean text streams through unchanged ------------------------- */
const clean = "We sell single-estate tea. Shipping takes three to six days. Ask me anything.";
const a = run(clean);
check("a clean reply is released in full", a.released === clean && a.violations.length === 0, `${a.released.length} chars`);

/* ---- the property that matters ------------------------------------ */
const bad = "We stock great teas. Take 20% off today. Delivery is quick.";
const b = run(bad);
check("a violation stops the stream", b.violations.length > 0, b.violations.map((v) => v.gate).join(", "));
check(
  "the offending sentence is NEVER released",
  !b.released.includes("20%") && !b.released.includes("off today"),
  `released: ${JSON.stringify(b.released)}`,
);
check(
  "clean text before the violation was already released",
  b.released.startsWith("We stock great teas."),
  "the shopper keeps what was legitimate",
);
check(
  "text after the violation is not released either",
  !b.released.includes("Delivery is quick"),
  "the stream stops rather than skipping the bad sentence and carrying on",
);

/* ---- a violation in the very first sentence ----------------------- */
const first = run("Take 15% off right now. Anything else?");
check(
  "a violation in the first sentence releases nothing at all",
  first.released === "" && first.violations.length > 0,
);

/* ---- a violation with no trailing sentence boundary --------------- */
const noStop = run("Here is a special price just for you");
check(
  "a violation with no closing punctuation is still caught at end()",
  noStop.released === "" && noStop.violations.length > 0,
  "otherwise a model that forgets a full stop bypasses the gate",
);

/* ---- grounded scarcity behaves identically to the blocking path --- */
const stockText = "Only 3 left of the cold brew. Order when you like.";
const grounded = run(stockText, { groundedStockClaims: [3] });
const ungrounded = run(stockText, { groundedStockClaims: [] });
check(
  "a true stock number streams through",
  grounded.released === stockText && grounded.violations.length === 0,
);
check("the same sentence with no grounding is blocked", ungrounded.violations.length > 0);

/* ---- streaming and blocking must never disagree ------------------- */
const CORPUS = [
  clean,
  bad,
  "Only 2 left, hurry!",
  "Only 3 left of the cold brew.",
  "Festive stock is limited, order now.",
  "As a Hindu you'll want the copper kettle.",
  "Cash on delivery is available under 3000 INR.",
  "Everyone's buying this for Diwali.",
  "Our returns window is seven days from delivery.",
];
const disagreements = CORPUS.filter((t) => {
  const opts = { groundedStockClaims: [3] };
  const streamed = run(t, opts).violations.map((v) => v.gate).sort().join(",");
  const blocking = checkReply(t, opts).map((v) => v.gate).sort().join(",");
  return streamed !== blocking;
});
check(
  "streaming and blocking reach the same verdict on every case",
  disagreements.length === 0,
  disagreements.length ? disagreements.join(" | ") : `${CORPUS.length} cases`,
);

/* ---- chunk boundaries must not change the verdict ----------------- */
function runWithChunks(text, size) {
  const g = createStreamGuard({ groundedStockClaims: [] });
  let released = "", violations = [];
  for (let i = 0; i < text.length; i += size) {
    const step = g.push(text.slice(i, i + size));
    if (step.violations.length) { violations = step.violations; break; }
    released += step.release;
  }
  if (!violations.length) {
    const step = g.end();
    if (step.violations.length) violations = step.violations;
    else released += step.release;
  }
  return { released, violations };
}
const sizes = [1, 2, 3, 7, 13, 500];
const verdicts = new Set(sizes.map((n) => runWithChunks(bad, n).violations.length > 0));
const leaks = sizes.filter((n) => runWithChunks(bad, n).released.includes("20%"));
check(
  "the verdict is the same at every chunk size",
  verdicts.size === 1 && verdicts.has(true) && leaks.length === 0,
  `sizes ${sizes.join(",")} — a gate that depends on how the model happens to chunk is not a gate`,
);

/* ---- the real model stream cannot deadlock ------------------------ */
//
// The fallback result settles only after its chunks are consumed. Awaiting that
// result first is a circular wait which still returns HTTP 200, making it look
// exactly like a slow model in the browser. Mock OpenRouter with a tiny valid
// SSE response and exercise the complete assistant pipeline.
const assistantOut = path.join(process.cwd(), "node_modules", ".cache", "assistant-stream.mjs");
await esbuild.build({
  entryPoints: ["app/lib/assistant.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: assistantOut,
  logLevel: "silent",
});

const oldKey = process.env.OPENROUTER_API_KEY;
const oldDataDir = process.env.CHAPMAN_DATA_DIR;
const oldFetch = globalThis.fetch;
const streamDataDir = path.join(process.cwd(), "node_modules", ".cache", "assistant-stream-data");
fs.mkdirSync(streamDataDir, { recursive: true });
process.env.OPENROUTER_API_KEY = "test-only";
process.env.CHAPMAN_DATA_DIR = streamDataDir;
globalThis.fetch = async () =>
  new Response(
    'data: {"choices":[{"delta":{"content":"Hello from the model."}}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

try {
  const { runAssistantStream } = await import(pathToFileURL(assistantOut).href + `?v=${Date.now()}`);
  const product = {
    handle: "tea",
    title: "Tea",
    description: "A tea.",
    productType: "Tea",
    vendor: "Test",
    tags: ["tea"],
    url: "/tea",
    image: null,
    minPrice: "100",
    maxPrice: "100",
    currency: "INR",
    totalInventory: 10,
    variants: [],
  };
  const catalog = {
    kind: "json-feed",
    async search() { return [product]; },
    async get() { return product; },
    async complements() { return []; },
    async policies() { return {}; },
  };
  const events = [];
  const finished = (async () => {
    for await (const event of runAssistantStream({
      catalog,
      shop: "pk_stream_test",
      shopName: "Stream Test",
      message: "hello",
    })) events.push(event);
  })();
  const outcome = await Promise.race([
    finished.then(() => "done"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 1_000)),
  ]);
  check(
    "a model-backed assistant stream cannot wait on its own unconsumed chunks",
    outcome === "done" && events.some((event) => event.type === "delta") && events.at(-1)?.type === "done",
    outcome === "done" ? `${events.length} events` : "the result-before-chunks ordering deadlocked",
  );
} finally {
  globalThis.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = oldKey;
  if (oldDataDir === undefined) delete process.env.CHAPMAN_DATA_DIR;
  else process.env.CHAPMAN_DATA_DIR = oldDataDir;
}

/* ================= the widget's own failure handling ================= */
console.log("\n--- what the shopper sees when things go wrong ---");

/**
 * The widget is browser JavaScript served as a string, so it cannot be imported
 * and exercised here. What CAN be asserted is that its guards are still
 * present — each of these was added because of a specific failure, and losing
 * one silently would put that failure straight back in front of a shopper.
 */
const widget = fs.readFileSync(path.join(process.cwd(), "app/routes/embed[.]js.tsx"), "utf8");

check(
  "A STREAM THAT SAYS NOTHING IS NOT SILENT",
  /if \(!shown\.trim\(\)\)/.test(widget) && /apology\("empty"\)/.test(widget),
  "every model in the chain can be rate-limited at once; before this the shopper saw their own message and then nothing at all, for ever",
);
check(
  "there is a waiting indicator, shown before the request is sent",
  /agw-dots/.test(widget) && widget.indexOf("log.appendChild(dots)") < widget.indexOf("fetch(api"),
  "the tool loop takes seconds, and a blank panel during that time reads as broken",
);
check(
  "the indicator is removed on the first text, on cards, and on failure",
  (widget.match(/clearDots\(\)/g) ?? []).length >= 4,
  "a spinner that never stops is worse than none",
);
check(
  "the indicator announces itself to a screen reader",
  /setAttribute\("role", "status"\)/.test(widget) && /aria-label/.test(widget),
);
check(
  "reduced motion is respected",
  /prefers-reduced-motion/.test(widget),
  "the dots still change opacity, so the state stays visible without the bounce",
);
check(
  "a request that never settles is aborted rather than waited on for ever",
  /AbortController/.test(widget) && /TIMEOUT_MS/.test(widget),
  "otherwise the composer stays disabled and the widget is dead with no explanation",
);
check(
  "the shopper gets an apology, not an exception string",
  /function apology/.test(widget) && /Sorry/.test(widget),
  '"Failed to fetch" tells a shopper nothing they can act on, and it is the merchant\'s brand carrying it',
);
check(
  "...and the real error still reaches the console",
  /console\.error\("\[agent\]"/.test(widget),
  "an apology that also hides the cause from whoever is debugging is only half a fix",
);
check(
  "timeout, offline and server failures say different things",
  /"timeout"/.test(widget) && /"offline"/.test(widget) && /navigator\.onLine/.test(widget),
  "one generic message for three different problems wastes the only chance to tell someone what to do",
);
check(
  "a partial answer is left on screen when the rest fails",
  !/bubble\.remove\(\)[\s\S]{0,200}apology/.test(widget),
  "the shopper already read it; deleting it mid-conversation is more confusing than a note",
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
