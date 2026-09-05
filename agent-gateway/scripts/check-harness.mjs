/**
 * The tool-calling harness.
 *
 * The parser is the part worth testing hardest, because when it fails it fails
 * SILENTLY. The first version used a regex, which stopped at the brace closing
 * the nested `args` object — so `JSON.parse` threw, every tool call was quietly
 * ignored, and the raw JSON was handed to a shopper as the assistant's answer.
 * Nothing errored. Nothing logged. It simply did not work.
 *
 * The second half asserts the property that actually makes a tool loop safe:
 * not the loop, but what the loop can reach.
 *
 * Run:  node scripts/check-harness.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

async function load(entry, name) {
  const out = path.join(process.cwd(), "node_modules", ".cache", name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href + "?t=" + Date.now());
}

const H = await load("app/lib/harness.server.ts", "harness-check.mjs");
const T = await load("app/lib/tools.server.ts", "tools-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/* ================= the parser ================= */
console.log("--- extracting a tool call ---");

const call = (t) => { const e = H.extractEmission(t); return e && e.kind === 'call' ? e : null; };
const nameOf = (t) => (call(t) ? call(t).tool : null);
const answerOf = (t) => { const e = H.extractEmission(t); return e && e.kind === 'answer' ? e.text : null; };

check(
  "A NESTED ARGS OBJECT PARSES",
  nameOf('{"tool": "search_products", "args": {"query": "chai", "limit": 6}}') === "search_products",
  "the regex version stopped at the brace closing `args` and silently dropped every call",
);
check("and so does a deeply nested one", nameOf('{"tool":"b","args":{"x":{"y":{"z":1}}}}') === "b");
check(
  "a brace inside a string does not unbalance the count",
  nameOf('{"tool":"a","args":{"q":"a } brace"}}') === "a",
  "product names and descriptions contain all sorts of characters",
);
check(
  "an escaped quote does not end the string early",
  nameOf('{"tool":"a","args":{"q":"say \\" then }"}}') === "a",
);
check(
  "a fenced code block is unwrapped",
  nameOf("Sure!\n```json\n{\"tool\":\"get_policies\",\"args\":{}}\n```") === "get_policies",
  "models wrap JSON in markdown constantly, even when told not to",
);
check(
  "a non-call object is skipped and the real call found after it",
  nameOf('{"notatool":1} then {"tool":"c","args":{}}') === "c",
);
check(
  "arguments are optional",
  nameOf('{"tool":"get_live_offers"}') === "get_live_offers" &&
    JSON.stringify(call('{"tool":"get_live_offers"}').args) === "{}",
);
check(
  "an array where args should be is replaced, not passed through",
  JSON.stringify(call('{"tool":"a","args":[1,2]}').args) === "{}",
  "a tool reading args.handle off an array gets undefined and behaves oddly instead of failing",
);
check("ordinary prose is not a call", call("Here are the teas you asked about.") === null);
check("an empty string is not a call", call("") === null);
check("unbalanced JSON is not a call", call('{"tool":"a","args":{') === null);
check(
  "the first of several calls is taken",
  nameOf('{"tool":"first","args":{}}\n{"tool":"second","args":{}}') === "first",
  "models emit several at once; the rest are re-offered on the next turn",
);
check(
  "looksLikeToolCall agrees with the extractor",
  H.looksLikeToolCall('{"tool":"x","args":{}}') === true && H.looksLikeToolCall("A normal answer.") === false,
  "this is what stops a line of JSON reaching a shopper as the answer",
);

check(
  'a structured answer is recognised as an answer',
  answerOf('{"answer": "We have two green teas."}') === 'We have two green teas.',
);
check(
  'A MONOLOGUE IS NOT AN ANSWER',
  H.extractEmission('We need to answer: which two products? Maybe list_proposals? Not about cross-sell. Let me think.') === null,
  'a reasoning model given a prose escape hatch wrote nine paragraphs and called nothing — requiring JSON makes that invalid rather than merely ugly',
);
check(
  'an empty answer string is not an answer',
  H.extractEmission('{"answer": "   "}') === null,
);
check(
  'a call still wins over an answer key when both are present',
  H.extractEmission('{"tool":"store_scale","args":{},"answer":"guessing"}').kind === 'call',
  'a model hedging with both must not have its guess shown',
);

/* ================= the registry is the boundary ================= */
console.log("\n--- what the shopper harness can reach ---");

const names = T.SHOPPER_TOOLS.map((t) => t.name);
console.log("      " + names.join(", "));

check("the shopper registry is not empty", names.length > 0, `${names.length} tools`);
check(
  "EVERY SHOPPER TOOL IS A READ",
  !names.some((n) =>
    /checkout|^pay|approve|publish|refund|cancel|delete|write|update|create|set_/i.test(n),
  ),
  "nothing here can move money or speak unmediated — that is the architecture, not an oversight",
);
check(
  "no tool offers unit cost or margin",
  T.SHOPPER_TOOLS.every((t) => !/unit ?cost|margin|wholesale|what we pay/i.test(t.description)),
  "a merchant's cost is their negotiating position, and there is no shopper-side path to it",
);
check(
  "every tool has what a model needs to choose it",
  T.SHOPPER_TOOLS.every((t) => t.description.length > 40 && t.parameters && typeof t.run === "function"),
);
check(
  "tool names are unique",
  new Set(names).size === names.length,
  "a duplicate name means one of them is unreachable",
);

const tool = (n) => T.SHOPPER_TOOLS.find((t) => t.name === n);
const noCatalog = { shop: "s", shopName: "S", catalog: null };

check(
  "the order tool refuses when nobody is signed in",
  (
    await tool("get_my_orders").run(
      { ...noCatalog, orders: { available: true, identified: false, source: null, sub: null } },
      {},
    )
  ).includes("NOT signed in"),
  "and says so rather than asking for an email, because anyone can type one",
);
check(
  "...and says the feature is off when the merchant connected no source",
  (
    await tool("get_my_orders").run(
      { ...noCatalog, orders: { available: false, identified: true, source: null, sub: "cus_1" } },
      {},
    )
  ).includes("not connected"),
  "two different situations, two different answers — collapsing them misleads the merchant",
);
check(
  "an identified shopper with a source reads only their own rows",
  await (async () => {
    let askedFor = null;
    const source = {
      kind: "test",
      async forShopper(sub) {
        askedFor = sub;
        return [];
      },
      async get() {
        return null;
      },
    };
    await tool("get_my_orders").run(
      { ...noCatalog, orders: { available: true, identified: true, source, sub: "cus_me" } },
      // An argument trying to name someone else. There is no parameter for it,
      // and the sub comes from the context, so it cannot take effect.
      { customer: "cus_someone_else", sub: "cus_someone_else" },
    );
    return askedFor === "cus_me";
  })(),
  "the scope came from the verified session, not from anything the model passed",
);
check(
  "the offers tool is explicit when there are none",
  (await tool("get_live_offers").run({ shop: "pk_nothing_here" }, {})).includes("no approved offers"),
  "silence would let a model infer it simply failed to find them",
);
check(
  "the registry can be printed for a merchant to read",
  T.describeRegistry(T.SHOPPER_TOOLS).every((r) => r.name && r.description.endsWith(".")),
  "an enumerable capability list beats any sentence promising good behaviour",
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
