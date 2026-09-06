/**
 * The feature switches, and whether "off" is true.
 *
 * A switch is the easiest thing in a product to get wrong in a way nobody
 * notices, because the failure is silent in both directions. A switch that does
 * not reach far enough leaves the merchant believing something false about
 * their own shop — memory off, still recording. A switch that reaches too far
 * refuses a Razorpay webhook and loses an order that has already been paid for.
 *
 * Two of the checks below are the ones that actually earn their keep:
 *
 *   - every tool name a switch claims to withdraw must EXIST. A typo makes the
 *     switch a no-op with no error anywhere, and the dashboard would keep
 *     promising the tool was gone.
 *   - the in-flight surfaces must NOT be gated. That is the money property, and
 *     it is the kind of thing a later refactor tidies into consistency.
 *
 * Run:  node scripts/check-features.mjs
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
  return import(pathToFileURL(out).href);
}

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const REAL = process.cwd();
const SANDBOX = path.join(REAL, "node_modules", ".cache", "features-sandbox");
fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(SANDBOX, { recursive: true });
process.env.CHAPMAN_DATA_DIR = SANDBOX;

const F = await load("app/lib/featureflags.server.ts", "flags-check.mjs");
const U = await load("app/lib/ucptools.ts", "ucptools-check.mjs");
const T = await load("app/lib/tools.server.ts", "shoppertools-check.mjs");
const I = await load("app/lib/integration-setup.server.ts", "integration-setup-check.mjs");
const VT = await load("app/lib/voice-test.server.ts", "voice-test-call-check.mjs");

const SITE = "pk_flagcheck";

/* ================================================================== *
 * Feature-page integration instructions
 * ================================================================== */
console.log("\n-- feature pages explain their own provider setup ----------\n");

{
  const sentinel = "must-never-cross-a-loader-boundary";
  process.env.OPENROUTER_API_KEY = sentinel;
  delete process.env.OPENROUTER_MODEL_ASSISTANT;
  const assistant = I.openRouterSetup("assistant");
  check(
    "the assistant guide detects OpenRouter by variable name",
    assistant.variables[0].name === "OPENROUTER_API_KEY" && assistant.variables[0].configured,
  );
  check(
    "the assistant guide never serialises the key value",
    !JSON.stringify(assistant).includes(sentinel),
    "only names, placeholders and configured/missing booleans may reach the browser",
  );

  delete process.env.OPENROUTER_API_KEY;
  const fallback = I.openRouterSetup("assistant");
  const analyst = I.openRouterSetup("analyst");
  check(
    "assistant without a key is labelled as a safe fallback, not broken",
    fallback.status === "fallback" && fallback.statusLabel.includes("fallback"),
  );
  check(
    "analyst without a key says the key is required",
    analyst.status === "attention" && analyst.variables[0].requirement === "required",
  );
}

{
  process.env.CHECK_RAZORPAY_ID = "rzp_test_private-check";
  process.env.CHECK_RAZORPAY_SECRET = "never-render-this-secret";
  delete process.env.CHECK_RAZORPAY_WEBHOOK;
  const payment = I.razorpaySetup({
    key: "pk_setupcheck",
    name: "Setup Check",
    origins: ["https://shop.example"],
    catalogFeedUrl: "https://shop.example/catalog.json",
    greeting: "Hello",
    accent: "#123456",
    secret: "site-secret-that-must-not-matter",
    razorpay: {
      keyIdEnv: "CHECK_RAZORPAY_ID",
      keySecretEnv: "CHECK_RAZORPAY_SECRET",
      webhookSecretEnv: "CHECK_RAZORPAY_WEBHOOK",
    },
  });
  check(
    "Razorpay instructions follow the variable names linked to this storefront",
    payment.variables[0].name === "CHECK_RAZORPAY_ID" &&
      payment.variables[1].name === "CHECK_RAZORPAY_SECRET" &&
      payment.status === "ready",
  );
  check(
    "Razorpay instructions contain neither payment nor site secret values",
    !JSON.stringify(payment).includes("never-render-this-secret") &&
      !JSON.stringify(payment).includes("site-secret-that-must-not-matter"),
  );
  check(
    "the generated webhook instruction is site-scoped",
    payment.steps.some((step) => step.includes("/webhooks/razorpay/pk_setupcheck")),
  );
}

{
  for (const name of [
    "SARVAM_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM",
    "PUBLIC_ORIGIN",
  ]) {
    delete process.env[name];
  }
  const voice = I.voiceSetup();
  const required = voice.variables
    .filter((entry) => entry.requirement === "required")
    .map((entry) => entry.name);
  check(
    "voice setup names all five runtime requirements",
    [
      "SARVAM_API_KEY",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM",
      "PUBLIC_ORIGIN",
    ].every((name) => required.includes(name)),
  );
  check("an incomplete voice setup is not labelled live", voice.status === "attention");

  const discovery = I.agentDiscoverySetup(false);
  check(
    "agent discovery explicitly says it needs no provider credential",
    discovery.variables.length === 0 && discovery.status === "attention",
  );
}

{
  const site = {
    key: "pk_callcheck",
    name: "Call Check",
    origins: ["https://shop.example"],
    catalogFeedUrl: "https://shop.example/catalog.json",
    greeting: "Hello",
    accent: "#123456",
    secret: "test-site-secret",
  };
  const config = {
    sarvamKey: "test",
    twilioSid: "ACtest",
    twilioToken: "test",
    twilioFrom: "+10000000000",
    origin: "https://voice.example",
    voice: "priya",
    language: "en-IN",
    pace: 1,
  };
  let rendered = 0;
  let sent = null;
  const deps = {
    now: () => Date.parse("2026-09-07T12:00:00Z"),
    id: () => "fixed-id",
    config: () => config,
    missing: () => [],
    readSends: () => [],
    render: async () => {
      rendered++;
      return { ok: true, file: "test.mp3", bytes: 100, cached: false };
    },
    send: async (draft) => {
      sent = draft;
      return {
        ts: "2026-09-07T12:00:00Z",
        shop: draft.shop,
        draftId: draft.id,
        cartId: draft.cartId,
        customerId: draft.customerId,
        channel: draft.channel,
        treatment: draft.treatment,
        ok: true,
        ref: "CAtest",
      };
    },
  };

  const bad = await VT.placeVoiceTestCall(site, "9876543210", deps);
  check(
    "a test call requires an international phone number",
    !bad.ok && rendered === 0,
    "invalid input must fail before spending Sarvam or Twilio credit",
  );

  const placed = await VT.placeVoiceTestCall(site, "+91 98765-43210", deps);
  check(
    "a valid test pre-renders audio and then queues one voice draft",
    placed.ok && rendered === 1 && sent?.channel === "voice",
  );
  check(
    "the entered number chooses only the destination",
    sent?.to.phone === "+919876543210" &&
      sent?.treatment === "integration_test" &&
      sent?.text === VT.TEST_CALL_TEXT &&
      !sent?.text.includes("9876543210"),
    "the number must never become model input or spoken copy",
  );
  check(
    "the test call is clearly identified and cannot enter conversation mode",
    VT.TEST_CALL_TEXT.includes("integration test") &&
      fs
        .readFileSync(
          path.join(REAL, "app/routes/voice.twiml.$site.$token.tsx"),
          "utf8",
        )
        .includes(
        'draft.treatment === "integration_test"',
      ),
  );

  const limited = await VT.placeVoiceTestCall(site, "+919876543210", {
    ...deps,
    readSends: () => [
      {
        ts: "2026-09-07T11:59:50Z",
        shop: site.key,
        draftId: "prior",
        cartId: "prior",
        customerId: "integration-test",
        channel: "voice",
        treatment: "integration_test",
        ok: true,
      },
    ],
  });
  check(
    "the dashboard cannot hammer the call provider",
    !limited.ok && limited.error.includes("30 seconds"),
  );
}

/* ================================================================== *
 * Defaults
 * ================================================================== */
console.log("\n-- a shop that has never touched this ----------------------\n");

{
  const flags = F.readFlags(SITE);
  check(
    "everything is on before anything is written",
    F.SWITCHES.every((s) => flags[s.key] === true),
    "a switch that arrived already off would change an existing install the moment it updated",
  );
  check("and there is no file until something is changed", !fs.existsSync(F._file(SITE)));
}

{
  // A file written by an older build, missing keys added since.
  const stale = path.join(SANDBOX, "features-pk_stale.json");
  fs.writeFileSync(stale, JSON.stringify({ flags: { orders: false } }));
  const flags = F.readFlags("pk_stale");
  check(
    "a key absent from an older file reads as ON",
    flags.memory === true && flags.payments === true,
    "the alternative switches off every feature we ship after the file was written",
  );
  check("and an explicit false is still honoured", flags.orders === false);
}

{
  const junk = path.join(SANDBOX, "features-pk_junk.json");
  fs.writeFileSync(junk, JSON.stringify({ flags: { orders: "no", memory: null, offers: 0 } }));
  const flags = F.readFlags("pk_junk");
  check(
    "only a real boolean false switches anything off",
    flags.orders === true && flags.memory === true && flags.offers === true,
    "a hand-edited file must fail safe, not fail off",
  );
}

/* ================================================================== *
 * Writing
 * ================================================================== */
console.log("\n-- flipping a switch ---------------------------------------\n");

{
  const saved = F.writeFlags(SITE, { memory: false }, "someone@example.com");
  check("the switch persists", F.readFlags(SITE).memory === false);
  check("and nothing else moved", F.readFlags(SITE).orders === true);
  check("who did it is recorded", saved.updatedBy === "someone@example.com" && Boolean(saved.updatedAt));
  check(
    "and it is in the history",
    saved.history.length === 1 && saved.history[0].key === "memory" && saved.history[0].to === false,
    "so a merchant can answer 'when did this stop working'",
  );

  const before = fs.readFileSync(F._file(SITE), "utf8");
  F.writeFlags(SITE, { memory: false }, "someone-else@example.com");
  check(
    "writing the same value again changes nothing",
    fs.readFileSync(F._file(SITE), "utf8") === before,
    "otherwise every page save would add a history row saying nothing happened",
  );

  F.writeFlags(SITE, { memory: true }, "someone@example.com");
  check("and it switches back on", F.readFlags(SITE).memory === true);
}

/* ================================================================== *
 * The tool names — the typo guard
 * ================================================================== */
console.log("\n-- the switches name tools that exist ----------------------\n");

{
  const ucpNames = new Set(U.TOOLS.map((t) => t.name));
  const shopperNames = new Set(T.SHOPPER_TOOLS.map((t) => t.name));

  const badUcp = [];
  const badShopper = [];
  for (const s of F.SWITCHES) {
    for (const t of s.ucpTools) if (!ucpNames.has(t)) badUcp.push(`${s.key}:${t}`);
    for (const t of s.shopperTools) if (!shopperNames.has(t)) badShopper.push(`${s.key}:${t}`);
  }

  check(
    "every UCP tool a switch withdraws is a real tool",
    badUcp.length === 0,
    badUcp.length ? badUcp.join(", ") : `${ucpNames.size} tools on the agent surface`,
  );
  check(
    "every shopper tool a switch withdraws is a real tool",
    badShopper.length === 0,
    badShopper.length ? badShopper.join(", ") : `${shopperNames.size} tools in the assistant`,
  );
  check(
    "no tool is claimed by two switches",
    (() => {
      const seen = new Set();
      for (const s of F.SWITCHES) {
        for (const t of [...s.ucpTools, ...s.shopperTools]) {
          if (seen.has(t)) return false;
          seen.add(t);
        }
      }
      return true;
    })(),
    "two owners means turning one off and the other on leaves the result undefined",
  );
}

/* ================================================================== *
 * Filtering
 * ================================================================== */
console.log("\n-- what an agent is actually offered -----------------------\n");

{
  const all = U.TOOLS.length;
  check("with everything on, the full surface is offered", F.filterUcpTools(SITE, U.TOOLS).length === all);

  F.writeFlags(SITE, { payments: false }, "t");
  const noPay = F.filterUcpTools(SITE, U.TOOLS).map((t) => t.name);
  check(
    "payments off withdraws all five checkout tools",
    !noPay.some((n) => n.includes("checkout")),
    `${all - noPay.length} withdrawn`,
  );
  check(
    "...and leaves browsing alone",
    noPay.includes("search_catalog") && noPay.includes("get_product"),
    "a shop that stopped taking payment is still a shop worth reading",
  );

  F.writeFlags(SITE, { payments: true, orders: false, offers: false }, "t");
  const trimmed = F.filterUcpTools(SITE, U.TOOLS).map((t) => t.name);
  check(
    "orders off withdraws get_order",
    !trimmed.includes("get_order") && trimmed.includes("create_checkout"),
  );
  check("offers off withdraws get_promotions", !trimmed.includes("get_promotions"));

  const shopper = F.filterShopperTools(SITE, T.SHOPPER_TOOLS).map((t) => t.name);
  check(
    "and the assistant loses its twins of both",
    !shopper.includes("get_my_orders") && !shopper.includes("get_live_offers"),
    "the shopper surface and the agent surface must agree, or off means off for agents only",
  );
  check(
    "while keeping the rest",
    shopper.includes("search_products") && shopper.includes("get_policies"),
  );

  F.writeFlags(SITE, { orders: true, offers: true, agent_front: false }, "t");
  check(
    "the agent surface off empties the list entirely",
    F.filterUcpTools(SITE, U.TOOLS).length === 0,
    "the surface is gone, not reduced",
  );
  check(
    "...but the shopper's assistant is untouched by it",
    F.filterShopperTools(SITE, T.SHOPPER_TOOLS).length === T.SHOPPER_TOOLS.length,
    "an agent surface and a chat widget are two different front doors",
  );
  F.writeFlags(SITE, { agent_front: true }, "t");
}

{
  check("featureForUcpTool maps a governed tool", F.featureForUcpTool("get_order") === "orders");
  check("...and returns null for an ungoverned one", F.featureForUcpTool("search_catalog") === null);
  check("...and null for a tool that does not exist", F.featureForUcpTool("nonsense") === null);
}

{
  F.writeFlags(SITE, { memory: false }, "t");
  let status = 0;
  try {
    F.requireFeature(SITE, "memory");
  } catch (e) {
    status = e instanceof Response ? e.status : -1;
  }
  check(
    "requireFeature throws a 404, not a 403",
    status === 404,
    "a switched-off surface should look absent; 403 says it exists and invites a retry",
  );
  let threw = false;
  try {
    F.requireFeature(SITE, "orders");
  } catch {
    threw = true;
  }
  check("and passes silently when the feature is on", !threw);
  F.writeFlags(SITE, { memory: true }, "t");
}

/* ================================================================== *
 * The surfaces, read from source
 * ================================================================== */
console.log("\n-- off reaches the surfaces, and stops short of the rest ---\n");

const src = (p) => fs.readFileSync(path.join(REAL, p), "utf8");

{
  const gated = [
    ["app/routes/ucp.$site.mcp.tsx", "agent_front"],
    ["app/routes/ucp.$site.profile.tsx", "agent_front"],
    ["app/routes/ucp.$site.agentview.tsx", "agent_front"],
    ["app/routes/ucp.$site.llms[.]txt.tsx", "agent_front"],
    ["app/routes/embed.chat.tsx", "assistant"],
    ["app/routes/proxy.chat.tsx", "assistant"],
    ["app/routes/embed.checkout.tsx", "payments"],
    ["app/routes/embed.memory.tsx", "memory"],
  ];
  for (const [f, key] of gated) {
    const s = src(f);
    check(
      `${f.replace("app/routes/", "")} checks ${key}`,
      s.includes("featureOn(") && s.includes(`"${key}"`),
    );
  }
}

{
  /* The money property. These complete something already begun and must never
     consult a switch that was flipped after it began. */
  const inflight = [
    "app/routes/webhooks.razorpay.$site.tsx",
    "app/routes/pay.$site.$orderId.tsx",
    "app/routes/recover.$site.$token.tsx",
    "app/routes/restore.$site.$token.tsx",
    "app/routes/voice.twiml.$site.$token.tsx",
    "app/routes/voice.turn.$site.$token.tsx",
    "app/routes/voice.reply.$site.$token.tsx",
  ];
  const wrongly = inflight.filter((f) => src(f).includes("featureOn("));
  check(
    "no in-flight surface is gated",
    wrongly.length === 0,
    wrongly.length
      ? `GATED, and must not be: ${wrongly.join(", ")}`
      : "a webhook refused after the buyer paid loses the order rather than preventing it",
  );
}

{
  const s = src("app/routes/embed.checkout.tsx");
  check(
    "the payments gate is scoped to `start`",
    /body\.op === "start" && !featureOn/.test(s),
    "gating the whole route would refuse `confirm` and strand a payment that already went through",
  );
}

{
  const s = src("app/routes/embed.memory.tsx");
  const forgetAt = s.indexOf('body.op === "forget"');
  const gateAt = s.indexOf('featureOn(site.key, "memory")');
  check(
    "deletion is reachable even with memory switched off",
    forgetAt > 0 && gateAt > forgetAt,
    "off stops collection; a shopper asking to be forgotten does not depend on a merchant's switch",
  );
}

{
  /* The bubble. A widget that still appears and then declines the first thing
     anyone types is worse than no widget: it advertises a conversation the
     shop has decided not to have. */
  const w = src("app/routes/embed[.]js.tsx");
  check(
    "the widget hides itself until it has confirmed the assistant is on",
    w.includes('root.style.display = "none"') && w.includes("fetch(probeUrl") && w.includes("root.remove()"),
    "the script is one cached file for every store, so this cannot be decided on the server",
  );
  check(
    "a network failure shows the bubble rather than hiding it",
    /\.catch\(function \(\) \{ root\.style\.display = ""; \}\)/.test(w),
    "a dropped packet must not be indistinguishable from a merchant's decision",
  );

  const c = src("app/routes/embed.chat.tsx");
  check(
    "and the endpoint it asks reports the switch",
    /enabled: featureOn\(site\.key, "assistant"\)/.test(c),
    "inferring it from a failed POST would mean the bubble appears first and fails after",
  );
}

{
  const s = src("app/lib/assistant.server.ts");
  check(
    "the assistant filters its own tool set",
    s.includes("filterShopperTools(opts.shop, SHOPPER_TOOLS)"),
    "given a tool, a model will call it — the refusal has to be an absence, not an error",
  );
  check(
    "and memory is gated on both read and write",
    /featureOn\(opts\.shop, "memory"\)/.test(s) && s.split('featureOn(opts.shop, "memory")').length === 3,
    "recall without learn would withhold memories while still collecting them",
  );
}

{
  const s = src("app/lib/outreach.server.ts");
  check(
    "sending checks recovery, at the point of delivery",
    /featureOn\(d\.shop, "recovery"\)/.test(s),
    "enforced in the console page alone, a script or a cron walks straight past it",
  );
  check("and the voice channel checks voice", /d\.channel === "voice" && !featureOn\(d\.shop, "voice"\)/.test(s));
}

/* ================================================================== *
 * The claims on screen
 * ================================================================== */
console.log("\n-- what the console promises -------------------------------\n");

{
  check(
    "every switch says what actually stops",
    F.SWITCHES.every((s) => typeof s.offMeans === "string" && s.offMeans.length > 60),
    "a toggle with no consequence written next to it is a toggle nobody can safely flip",
  );
  check(
    "every always-on entry says why it has no switch",
    F.ALWAYS_ON.every((f) => typeof f.why === "string" && f.why.length > 40),
    "so a merchant is not left hunting for a control that was never there",
  );
  check(
    "the ledger is one of them",
    F.ALWAYS_ON.some((f) => f.key === "ledger"),
    "a switch that turns off your own audit trail is not a feature",
  );

  const page = src("app/routes/dashboard.features.tsx");
  check(
    "the console page does not import the registry into the component",
    page.includes("switches: SWITCHES.map("),
    "a component importing a .server module keeps node:fs in the client bundle and fails the build",
  );
  check(
    "the switch page is named for its actual job",
    page.includes('title="Feature controls"') &&
      src("app/routes/dashboard.tsx").includes('label="Feature controls"'),
    "provider setup belongs on dedicated feature pages, not on a policy toggle list",
  );

  const setupPages = [
    "app/routes/dashboard.chatbot.tsx",
    "app/routes/dashboard.agentfront.tsx",
    "app/routes/dashboard.analyst.tsx",
    "app/routes/dashboard.memory.tsx",
    "app/routes/dashboard.recovery.tsx",
  ];
  const withoutGuide = setupPages.filter(
    (file) => !src(file).includes("<IntegrationSetup guide="),
  );
  check(
    "provider instructions live on the feature pages that consume them",
    withoutGuide.length === 0,
    withoutGuide.length ? withoutGuide.join(", ") : `${setupPages.length} dedicated pages`,
  );

  const assistantPage = src("app/routes/dashboard.chatbot.tsx");
  check(
    "the Assistant page tests the same pipeline as the storefront",
    assistantPage.includes('label={testing ? "Generating response…" : "Test chat assistant"}') &&
      assistantPage.includes("await runAssistant({") &&
      assistantPage.includes("jsonFeedCatalog(site.catalogFeedUrl)"),
    "a canned preview would prove only the preview",
  );
  const recoveryPage = src("app/routes/dashboard.recovery.tsx");
  check(
    "the Recovery page requires destination and consent before a test call",
    recoveryPage.includes('label={busy ? "Queueing test call…" : "Place test call"}') &&
      recoveryPage.includes('form.get("confirmExpected") !== "on"') &&
      recoveryPage.includes("placeVoiceTestCall(site"),
    "the number is supplied for this explicit call and never read from customer records",
  );

  const compose = src("../docker-compose.yml");
  check(
    "every documented OpenRouter model override reaches Docker",
    [
      "OPENROUTER_MODEL_ASSISTANT",
      "OPENROUTER_MODEL_ANALYST",
      "OPENROUTER_MODEL_SUMMARISER",
      "OPENROUTER_MODEL_GRADER",
    ].every((name) => compose.includes(`${name}:`)),
  );

  const index = src("app/routes/dashboard._index.tsx");
  check(
    "the overview reports switched-off features as their own state",
    index.includes("switchedOff") && index.includes('title="Switched off"'),
    "counting one as live would have the console assert something untrue about the shop",
  );
}

fs.rmSync(SANDBOX, { recursive: true, force: true });
console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
