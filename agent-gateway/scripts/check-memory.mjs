/**
 * Shopper memory, and the two boundaries it exists to hold.
 *
 * This is the first store in CHAPMAN that holds a PERSON, so the suite is
 * mostly adversarial: it tries to write things that must not be writable, tries
 * to read one shopper's memories as another, and tries to get a memory into the
 * shop cortex — which has no type that can carry one and must stay that way.
 *
 * Five properties:
 *
 *   1. NO IDENTITY, NO MEMORY. Anonymous produces nothing, on every path.
 *   2. NOTHING THAT EXPIRES. A memory carrying a price, a stock level, an
 *      offer, an order state or a delivery date is refused when WRITTEN — the
 *      only place it can be refused, because it will be read back in March.
 *   3. THE PRE-FILTER IS REAL. Questions about the shop are discarded before
 *      any model would be involved, with a reason.
 *   4. ISOLATION. Per (shop, shopper), both ways, and deletable.
 *   5. THE CORTEX STAYS PERSON-FREE. Even with memories on file, no shopper
 *      sentence appears anywhere in either cortex projection.
 *
 * Run:  node scripts/check-memory.mjs
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

const SANDBOX = path.join(process.cwd(), "node_modules", ".cache", "memory-sandbox");
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(SANDBOX, { recursive: true });
process.env.CHAPMAN_DATA_DIR = SANDBOX;
process.env.CHAPMAN_DATABASE_PATH = path.join(SANDBOX, "chapman.sqlite");

const DBS = await load("app/lib/database.server.ts", "memory-db-check.mjs");
const MEM = await load("app/lib/memory.server.ts", "mem-check.mjs");
const CTX = await load("app/lib/cortex.server.ts", "ctx3-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const SHOP = "pk_memcheck_dev";
const OTHER = "pk_memcheck_other";
const A = "cus_memcheck_a";
const B = "cus_memcheck_b";

/** Wipe only the rows this suite wrote inside its scratch database. */
function cleanup() {
  for (const shop of [SHOP, OTHER]) {
    for (const sub of [A, B]) MEM.forget(shop, sub);
  }
}
cleanup();

/* ------------------------------------------------------------------ *
 * 1. No identity, no memory
 * ------------------------------------------------------------------ */

console.log("\n— identity —");

const anon = MEM.remember({ shop: SHOP, sub: null, kind: "preference", text: "Prefers oolong.", source: "chat" });
check(
  "an anonymous shopper is not remembered",
  !anon.ok,
  "no identity means no way to honour a deletion request later, so collecting would be taking something we could never give back",
);

const anonLearn = MEM.learn({ shop: SHOP, sub: null, said: "I only ever drink it black", source: "chat" });
check("...and `learn` refuses on the same grounds", anonLearn.stored.length === 0);

check(
  "recall for an anonymous shopper returns nothing rather than everything",
  MEM.recall({ shop: SHOP, sub: null, query: "tea" }).length === 0,
  "the failure to avoid is a missing filter returning the whole store, which is how /customers?contact= behaves",
);

/* ------------------------------------------------------------------ *
 * 2. Nothing that expires
 * ------------------------------------------------------------------ */

console.log("\n— what a memory may not contain —");

const FORBIDDEN = [
  ["a price", "Usually spends ₹500 on tea.", "price"],
  ["a price in words", "Happy to pay 800 rupees for a good kettle.", "price"],
  ["a stock level", "Wanted the kettle when only 3 left.", "stock"],
  ["an offer", "Was promised 10% off last time.", "offer"],
  ["a coupon", "Has a discount code for the chai.", "offer"],
  ["an order state", "Their order was shipped in March.", "order_state"],
  ["a payment detail", "Their card ending 4444 was declined.", "payment"],
  ["a delivery date", "Needs it before 14 March.", "expiring_fact"],
  ["a floating deadline", "Wants it delivered this week.", "expiring_fact"],
];

for (const [label, text, gate] of FORBIDDEN) {
  const v = MEM.checkMemory(text);
  check(`refused: ${label}`, v.some((x) => x.gate === gate), text);
}

const priced = MEM.remember({ shop: SHOP, sub: A, kind: "habit", text: "Usually spends ₹500.", source: "chat" });
check(
  "the gate is enforced on the WRITE, not just exposed as a function",
  !priced.ok && Boolean(priced.violations?.length),
  "a check nothing calls is documentation",
);

check(
  "a durable preference is allowed",
  MEM.checkMemory("Prefers low-caffeine teas and drinks them black.").length === 0,
);

check(
  "a memory longer than a sentence or two is refused",
  MEM.checkMemory("x".repeat(400)).some((v) => v.gate === "too_long"),
  "a transcript in a memory is a transcript that gets rendered into a reply",
);

/* ------------------------------------------------------------------ *
 * 3. The deterministic pre-filter
 * ------------------------------------------------------------------ */

console.log("\n— the pre-filter, which runs before any model —");

const catalogueQuestion = MEM.worthLearning(
  { text: "do you have cold brew in stock", route: "catalog_query" },
  { identified: true },
);
check(
  "a catalogue question teaches us nothing about a person",
  !catalogueQuestion.ok,
  catalogueQuestion.because,
);

const policyQuestion = MEM.worthLearning(
  { text: "what is your returns policy exactly", route: "policy_returns" },
  { identified: true },
);
check("a policy question is about the shop, not the shopper", !policyQuestion.ok, policyQuestion.because);

check(
  "no first-person statement is discarded",
  !MEM.worthLearning({ text: "that kettle looks nice enough", route: "open" }, { identified: true }).ok,
);

check(
  "a first-person statement on an open route survives to the extractor",
  MEM.worthLearning({ text: "I only ever drink it black, no sugar", route: "open" }, { identified: true }).ok,
);

check(
  "declining always says WHY",
  Boolean(catalogueQuestion.because && policyQuestion.because),
  "a merchant reading 'nothing learned' needs the reason, or the feature looks broken",
);

/* ------------------------------------------------------------------ *
 * Extraction, with no model at all
 * ------------------------------------------------------------------ */

console.log("\n— extraction —");

const learned = MEM.learn({
  shop: SHOP,
  sub: A,
  said: "I don't like smoky teas at all, and it's a gift for my father",
  route: "open",
  source: "chat",
});
check(
  "two durable facts come out of one sentence, with no model",
  learned.stored.length === 2,
  learned.stored.map((m) => m.text).join(" / "),
);
check(
  "a dislike is stored as a preference and a recipient as context",
  learned.stored.some((m) => m.kind === "preference") && learned.stored.some((m) => m.kind === "context"),
);

const priceyTalk = MEM.learn({
  shop: SHOP,
  sub: A,
  said: "I usually spend about 800 rupees a month on coffee",
  route: "open",
  source: "chat",
});
check(
  "an extracted candidate carrying a price is stopped by our OWN gate",
  priceyTalk.stored.length === 0 && priceyTalk.skipped.length > 0,
  "a rule that widens by one word and starts capturing figures is exactly what this catches",
);

/*
 * Sentences taken from an actual run, not invented for the test.
 *
 * Every one of these was extracted WRONGLY by a version that passed the checks
 * above it — the pattern work is fine on short tidy input and falls apart on
 * how people really answer. Two defects came out of a single live reply:
 * a length cap that made any long sentence look truncated and threw it away,
 * and a capture that ran straight through "and" into the next clause.
 */
const REAL = [
  [
    "I only ever drink it black and the delivery charge was too much",
    "Prefers it black.",
    "stacked hedges — 'only ever' — and a second clause that belongs to the recovery loop, not to memory",
  ],
  [
    "I usually prefer low caffeine blends and it is a gift for my father",
    "Prefers low caffeine blends.",
    "cut at the clause boundary; the gift half is found independently by its own rule, and the habit-phrased near-duplicate is deduped away",
  ],
  [
    "please dont call me about this again",
    "Asked not to be contacted about baskets they leave behind.",
    "a rule with no capture group — silently discarded by the first version of the length guard, and the one whose loss matters most",
  ],
];
for (const [said, expected, why] of REAL) {
  const got = MEM.extract(said).map((e) => e.text);
  check(`real answer: “${said.slice(0, 42)}…”`, got.includes(expected), why);
}
check(
  "a long sentence is not silently discarded",
  MEM.extract("I usually prefer low caffeine blends and it is a gift for my father").length === 2,
  "a length cap that reads as truncation loses exactly the most informative answers, and loses them quietly",
);

const twice = MEM.learn({ shop: SHOP, sub: A, said: "I don't like smoky teas at all", route: "open", source: "chat" });
check("the same fact is not stored twice", twice.stored.length === 0, twice.skipped[0]?.because);

const boundary = MEM.learn({
  shop: SHOP,
  sub: A,
  said: "please don't call me about this again",
  route: "open",
  source: "voice",
});
check("being asked not to be contacted is remembered as a boundary", boundary.stored.some((m) => m.kind === "boundary"));

check(
  "a boundary outranks everything on recall",
  MEM.recall({ shop: SHOP, sub: A, query: "tea" })[0]?.kind === "boundary",
  "the one memory that must never be missed because a query did not happen to match its words",
);

/* ------------------------------------------------------------------ *
 * Condensing the pile
 * ------------------------------------------------------------------ */

console.log("\n— the summariser, and what it is not allowed to get away with —");

const C = "cus_memcheck_c";

/*
 * A REALISTIC pile: twelve DISTINCT facts.
 *
 * The first version of this fixture used near-duplicates ("Prefers oolong" /
 * "Prefers oolong tea in the mornings") and only nine of eleven ever landed —
 * `remember` already refuses a near-duplicate at write time, so the pile a real
 * shop accumulates is not made of restatements. It is made of a dozen separate
 * small truths that are individually fine and collectively unreadable, and that
 * is the thing worth condensing.
 */
const PILE = [
  ["preference", "Prefers oolong."],
  ["preference", "Dislikes anything smoky."],
  ["preference", "Drinks it black."],
  ["preference", "Prefers loose leaf to bags."],
  ["preference", "Likes a floral finish."],
  ["context", "Buys gifts for their father."],
  ["context", "Buys for a small office."],
  ["habit", "Usually shops at the weekend."],
  ["habit", "Usually orders two packets."],
  ["habit", "Usually reorders every six weeks."],
  ["preference", "Avoids caffeine after lunch."],
  ["preference", "Brews in a French press."],
];
const seedPile = () => {
  MEM.forget(SHOP, C);
  for (const [kind, text] of PILE) MEM.remember({ shop: SHOP, sub: C, kind, text, source: "chat" });
  MEM.remember({
    shop: SHOP,
    sub: C,
    kind: "boundary",
    text: "Asked not to be contacted about baskets they leave behind.",
    source: "voice",
  });
};

seedPile();
check(
  "a pile accumulates one line per fact",
  MEM.memories(SHOP, C).length === PILE.length + 1,
  `${MEM.memories(SHOP, C).length} lines about one person, of which RECALL_LIMIT means at most ${MEM.RECALL_LIMIT} are ever used`,
);

/* ---- with no model at all ---- */

const byRule = await MEM.consolidate({ shop: SHOP, sub: C });
check(
  "with no summariser configured, nothing is lost",
  byRule.by === "rules" && MEM.memories(SHOP, C).length === PILE.length + 1,
  "the rule pass merges only near-duplicates, and write-time dedupe has usually taken those already — the model is an improvement on the rules, never a dependency of them",
);
check(
  "and it says WHY nothing happened",
  Boolean(byRule.because),
  "otherwise a merchant pressing the button sees no change and no explanation",
);

/* ---- a well-behaved summariser ---- */

seedPile();
const good = await MEM.consolidate({
  shop: SHOP,
  sub: C,
  ask: async () =>
    [
      "Prefers oolong, loose leaf, drunk black.",
      "Dislikes smoky or peaty teas.",
      "Buys gifts for family.",
      "Usually buys two packets at the weekend.",
    ].join(String.fromCharCode(10)),
});
check("a good summary is applied", good.by === "model" && good.after < good.before, `${good.before} -> ${good.after}`);

const afterGood = MEM.memories(SHOP, C).map((m) => m.text);
check(
  "THE BOUNDARY SURVIVES UNTOUCHED",
  afterGood.includes("Asked not to be contacted about baskets they leave behind."),
  "the one memory whose loss actually harms somebody — it is held out of the prompt entirely, so there is nothing to soften",
);

/* ---- the three ways it must be refused ---- */

/*
 * Each attempt names the OFFENDING line explicitly, and the rejection is
 * checked against that line rather than against the whole reply.
 *
 * The first version asserted "none of the reply's lines are in the store", and
 * one attempt paired its bad line with "Prefers oolong." — which is in the seed
 * pile, so the check failed while the code was behaving perfectly. A control
 * that a legitimate pre-existing row can break is not testing what it claims
 * to; it has to isolate the one variable, which here is the bad line and the
 * count.
 */
const attempts = [
  {
    label: "invents a fact nobody said",
    reply: ["Prefers Assam and Darjeeling.", "Buys gifts for family."],
    bad: "Prefers Assam and Darjeeling.",
    expect: "wrote something nobody said",
  },
  {
    label: "smuggles in a price",
    reply: ["Prefers oolong and usually spends ₹800.", "Dislikes smoky teas."],
    bad: "Prefers oolong and usually spends ₹800.",
    expect: "may not contain",
  },
  {
    label: "smuggles in a delivery date",
    reply: ["Prefers oolong, black.", "Wants the next order before 14 March."],
    bad: "Wants the next order before 14 March.",
    expect: "may not contain",
  },
];

for (const { label, reply, bad, expect } of attempts) {
  seedPile();
  const before = MEM.memories(SHOP, C).length;
  const res = await MEM.consolidate({ shop: SHOP, sub: C, ask: async () => reply.join(String.fromCharCode(10)) });
  check(`refused: a summariser that ${label}`, res.by === "rules" && Boolean(res.because?.includes(expect)), res.because);
  const after = MEM.memories(SHOP, C);
  check(
    `...the offending line is nowhere in the store`,
    !after.some((m) => m.text === bad),
  );
  check(
    `...and the pile is untouched, not half-merged`,
    after.length === before,
    "one bad line abandons the whole merge — a partly-merged pile is worse than an untidy one",
  );
}

seedPile();
const noGain = await MEM.consolidate({
  shop: SHOP,
  sub: C,
  ask: async () => PILE.map(([, t]) => t).join(String.fromCharCode(10)),
});
check(
  "refused: a summary that reduces nothing",
  noGain.by === "rules",
  "no gain to weigh against the risk of letting a model rewrite what the shop believes about somebody",
);

seedPile();
const silent = await MEM.consolidate({ shop: SHOP, sub: C, ask: async () => "" });
check("a summariser that says nothing changes nothing", silent.by === "rules", silent.because);

const shortList = await MEM.consolidate({ shop: SHOP, sub: B, ask: async () => "should never be called" });
check(
  "a short list is left alone entirely",
  shortList.before === shortList.after,
  "condensing four lines into three is a model call spent on nothing",
);

MEM.forget(SHOP, C);

/* ------------------------------------------------------------------ *
 * 4. Isolation and deletion
 * ------------------------------------------------------------------ */

console.log("\n— isolation —");

MEM.remember({ shop: OTHER, sub: A, kind: "preference", text: "Prefers oolong.", source: "chat" });

check(
  "the same person at another shop has a separate memory",
  !MEM.memories(SHOP, A).some((m) => m.text === "Prefers oolong.") &&
    MEM.memories(OTHER, A).some((m) => m.text === "Prefers oolong."),
  "first-party only — the DPDP position, and the only version a merchant would accept",
);

check("another shopper at the same shop reads nothing of theirs", MEM.memories(SHOP, B).length === 0);

const one = MEM.memories(SHOP, A)[0];
MEM.forget(SHOP, A, one.id);
check("one memory can be deleted", !MEM.memories(SHOP, A).some((m) => m.id === one.id));

MEM.forget(SHOP, A);
check("everything about one person can be deleted", MEM.memories(SHOP, A).length === 0);
check(
  "...and deleting at one shop does not delete at another",
  MEM.memories(OTHER, A).length === 1,
  "a tombstone that leaked across shops would make one merchant's delete button destroy another's data",
);

/* ------------------------------------------------------------------ *
 * Expiry
 * ------------------------------------------------------------------ */

console.log("\n— ageing —");

const long_ago = new Date(Date.now() - 200 * 86_400_000);
MEM.remember({ shop: SHOP, sub: B, kind: "preference", text: "Prefers jasmine.", source: "chat", now: long_ago });
check(
  "a memory past its TTL is invisible, with no sweeper having run",
  MEM.memories(SHOP, B).length === 0,
  "expiry applied on READ, so a forgotten cron cannot keep a profile alive for years",
);

const fresh = MEM.remember({ shop: SHOP, sub: B, kind: "preference", text: "Prefers jasmine tea.", source: "chat" });
const before = fresh.memory.expiresAt;
MEM.recall({ shop: SHOP, sub: B, query: "jasmine", now: new Date(Date.now() + 86_400_000) });
check(
  "using a memory extends it",
  MEM.memories(SHOP, B)[0].expiresAt > before,
  "what survives should be what the shop actually finds useful, not what happened to be written first",
);

/* ------------------------------------------------------------------ *
 * The prompt block
 * ------------------------------------------------------------------ */

console.log("\n— how it reaches a model —");

const block = MEM.memoryBlock([{ text: "Prefers low-caffeine teas." }]);
check("the block says the memories may be wrong", /may be out of date/i.test(block));
check(
  "the block tells the model to say so when it uses one",
  /say so openly|still\?/i.test(block),
  "stated memory is correctable; silent memory is spooky and, when wrong, invisible",
);
check(
  "the block forbids treating a memory as a price, stock, offer or order fact",
  /Never treat one as a fact about price/i.test(block),
  "memory supplies the question; tools supply the answer",
);
check("no memories means no block at all", MEM.memoryBlock([]) === null);

/* ------------------------------------------------------------------ *
 * 5. The cortex stays person-free
 * ------------------------------------------------------------------ */

console.log("\n— the boundary with the shop cortex —");

const cortex = await CTX.buildCortex({
  site: { key: SHOP, name: "Memcheck Teas" },
  catalog: {
    kind: "json-feed",
    search: async () => [],
    get: async () => null,
    complements: async () => [],
    policies: async () => ({ returns: null, shipping: null, cod: null }),
  },
});

const serialised = JSON.stringify(cortex) + JSON.stringify(CTX.shopperView(cortex)) + JSON.stringify(CTX.merchantView(cortex));

check(
  "no shopper's sentence appears in the cortex, in either projection",
  !serialised.includes("jasmine") && !serialised.includes("smoky"),
  "shop knowledge is merchant-owned and shared by every tool; knowledge about a person belongs in its own store",
);
check(
  "no shopper id appears in the cortex either",
  !serialised.includes(A) && !serialised.includes(B),
  "there is no field in ShopCortex that could carry one, and this asserts it rather than trusting it",
);

/* ------------------------------------------------------------------ */

cleanup();
check(
  "the suite cleans up after itself",
  MEM.memories(SHOP, A).length === 0 &&
    MEM.memories(OTHER, A).length === 0 &&
    DBS.databasePath() === path.join(SANDBOX, "chapman.sqlite"),
  "no test memories remain, and the real gateway database was never opened",
);

console.log(failed === 0 ? "\nAll checks passed. Memory holds people; the cortex still cannot." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
