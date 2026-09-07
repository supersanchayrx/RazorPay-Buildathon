/** Recovery SMS is a one-grant handoff, never a generic send-text endpoint. */
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

const MSG = await load(
  "app/lib/recovery-message.server.ts",
  "recovery-message-check.mjs",
);
const SET = await load(
  "app/lib/settings.server.ts",
  "message-settings-check.mjs",
);

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

const site = {
  key: "pk_message_check",
  name: "Message Check",
  origins: ["https://shop.example"],
  catalogFeedUrl: "https://shop.example/catalog.json",
  greeting: "Hello",
  accent: "#123456",
  secret: "site-secret",
};
const config = {
  accountSid: "AC_test",
  authToken: "auth-secret",
  from: "+17372212163",
  messagingServiceSid: null,
};

console.log("--- fixed integration message ---");
let fetches = 0;
let request = null;
const testRows = [];
const test = await MSG.sendTestMessage(site, "+91 98765 43210", {
  now: () => new Date("2026-09-07T10:00:00Z"),
  id: () => "fixed",
  config: () => config,
  accountType: async () => "Full",
  read: () => testRows,
  append: (row) => (testRows.push(row), true),
  fetch: async (url, options) => {
    fetches++;
    request = { url, options };
    return new Response(JSON.stringify({ sid: "SM_test" }), { status: 201 });
  },
});
const testForm = new URLSearchParams(String(request?.options?.body ?? ""));
check("a valid manual test reaches Twilio once", test.ok && fetches === 1);
check(
  "the provider request uses the same E.164 number and fixed body",
  testForm.get("To") === "+919876543210" &&
    testForm.get("Body") === MSG.TEST_MESSAGE_TEXT,
);
check(
  "a From number is supplied server-side",
  testForm.get("From") === config.from,
);
check(
  "the durable log stores neither phone, body nor credentials",
  !/9876543210|integration test|auth-secret|17372212163/i.test(
    JSON.stringify(testRows),
  ),
);

const invalid = await MSG.sendTestMessage(site, "not-a-phone", {
  config: () => config,
  fetch: async () => {
    fetches++;
    return new Response("{}", { status: 500 });
  },
});
check(
  "an invalid destination never reaches the provider",
  !invalid.ok && fetches === 1,
);

let trialRequest = null;
const trialRows = [];
const trialTest = await MSG.sendTestMessage(
  { ...site, key: "pk_message_trial" },
  "+91 98765 43210",
  {
    now: () => new Date("2026-09-07T10:00:00Z"),
    id: () => "trial-fixed",
    config: () => config,
    accountType: async () => "Trial",
    read: () => trialRows,
    append: (row) => (trialRows.push(row), true),
    fetch: async (url, options) => {
      trialRequest = { url, options };
      return new Response(JSON.stringify({ sid: "SM_trial" }), { status: 201 });
    },
  },
);
const trialForm = new URLSearchParams(
  String(trialRequest?.options?.body ?? ""),
);
check(
  "a Trial account uses Twilio's predefined customer-support template",
  trialTest.ok &&
    trialForm.get("Body") === MSG.TRIAL_TEST_MESSAGE_TEMPLATE &&
    trialForm.get("Body") !== MSG.TEST_MESSAGE_TEXT,
);

let fallbackFetches = 0;
const fallbackRequests = [];
const fallbackRows = [];
const fallbackTest = await MSG.sendTestMessage(
  { ...site, key: "pk_message_trial_fallback" },
  "+91 98765 43210",
  {
    now: () => new Date("2026-09-07T10:00:00Z"),
    id: () => "fallback-fixed",
    config: () => config,
    accountType: async () => "unknown",
    read: () => fallbackRows,
    append: (row) => (fallbackRows.push(row), true),
    fetch: async (url, options) => {
      fallbackFetches++;
      fallbackRequests.push({ url, options });
      return fallbackFetches === 1
        ? new Response(
            JSON.stringify({
              message:
                "Invalid template. Trial accounts can only use pre-defined templates",
            }),
            { status: 400 },
          )
        : new Response(JSON.stringify({ sid: "SM_trial_retry" }), {
            status: 201,
          });
    },
  },
);
const fallbackForm = new URLSearchParams(
  String(fallbackRequests[1]?.options?.body ?? ""),
);
check(
  "the exact trial-template rejection retries once with the predefined template",
  fallbackTest.ok &&
    fallbackFetches === 2 &&
    fallbackForm.get("Body") === MSG.TRIAL_TEST_MESSAGE_TEMPLATE,
);

console.log("\n--- policy-issued discounted payment handoff ---");
const rows = [];
let recoveryFetches = 0;
let recoveryRequest = null;
const settings = structuredClone(SET.DEFAULTS);
settings.outreach.call.mode = "conversation";
settings.outreach.call.discountHandoff = "sms";
const draft = {
  id: "draft_1",
  shop: site.key,
  cartId: "cart_1",
  customerId: "customer_1",
  to: { phone: "+919876543210", email: null },
  channel: "voice",
  text: "Basket recovery call",
  link: "",
  treatment: "reminder",
  facts: [],
  marginAtStake: 200,
};
const grant = {
  id: "grant_1",
  shop: site.key,
  cartId: draft.cartId,
  customerId: draft.customerId,
  handle: "tea",
  title: "Good Tea",
  depth: 0.08,
  qtyCap: 1,
  marginCost: 30,
  reason: "price_too_high",
  tier: "returning",
  issuedAt: "2026-09-07T09:59:00Z",
  expiresAt: "2026-09-09T10:00:00Z",
  under: { maxDepthPct: 8, requiresTier: "returning" },
};
const deps = {
  now: () => new Date("2026-09-07T10:00:00Z"),
  config: () => config,
  accountType: async () => "Full",
  publicOrigin: () => "https://gateway.example",
  read: () => rows,
  append: (row) => (rows.push(row), true),
  feature: () => true,
  settings: () => settings,
  quiet: () => false,
  fetch: async (url, options) => {
    recoveryFetches++;
    recoveryRequest = { url, options };
    return new Response(JSON.stringify({ sid: "SM_recovery" }), {
      status: 201,
    });
  },
};
const handoff = await MSG.sendDiscountHandoff(
  site,
  draft,
  grant,
  `/pay/${site.key}/order_test123`,
  deps,
);
const recoveryForm = new URLSearchParams(
  String(recoveryRequest?.options?.body ?? ""),
);
check(
  "one real grant queues one recovery message",
  handoff.ok && recoveryFetches === 1,
);
check(
  "the SMS carries the exact approved depth and prepared Razorpay payment link",
  recoveryForm.get("Body")?.includes("approved 8% off") &&
    recoveryForm
      .get("Body")
      ?.includes("https://gateway.example/pay/pk_message_check/order_test123"),
);
check(
  "the recovery message goes only to the number on the current call",
  recoveryForm.get("To") === draft.to.phone,
);
check(
  "the recovery log contains ids and state but no destination or body",
  rows.some((row) => row.grantId === grant.id && row.status === "queued") &&
    !JSON.stringify(rows).includes(draft.to.phone) &&
    !JSON.stringify(rows).includes("8%"),
);

const duplicate = await MSG.sendDiscountHandoff(
  site,
  draft,
  grant,
  `/pay/${site.key}/order_test123`,
  deps,
);
check(
  "a second attempt for the same grant is refused before Twilio",
  !duplicate.ok && recoveryFetches === 1,
);

const wrongGrant = { ...grant, id: "grant_wrong", customerId: "someone_else" };
const mismatch = await MSG.sendDiscountHandoff(
  site,
  draft,
  wrongGrant,
  `/pay/${site.key}/order_test123`,
  { ...deps, read: () => [] },
);
check(
  "a grant for another person cannot be messaged",
  !mismatch.ok && recoveryFetches === 1,
);

const trialHandoff = await MSG.canSendDiscountHandoff(
  site,
  draft,
  { ...grant, id: "grant_trial" },
  {
    ...deps,
    read: () => [],
    accountType: async () => "Trial",
  },
);
check(
  "a Trial account is stopped before a discounted Razorpay order is needed",
  !trialHandoff.ok &&
    /unique payment link|upgrade twilio/i.test(trialHandoff.error),
);

console.log("\n--- post-call trial template ---");
const templateRows = [];
let templateFetches = 0;
let templateRequest = null;
const template = await MSG.sendDiscountFollowupTemplate(site, draft, grant, {
  ...deps,
  read: () => templateRows,
  append: (row) => (templateRows.push(row), true),
  testTo: () => draft.to.phone,
  accountType: async () => "Trial",
  fetch: async (url, options) => {
    templateFetches++;
    templateRequest = { url, options };
    return new Response(JSON.stringify({ sid: "SM_post_call" }), {
      status: 201,
    });
  },
});
const templateForm = new URLSearchParams(
  String(templateRequest?.options?.body ?? ""),
);
check(
  "a completed discount call can queue the predefined Trial SMS once",
  template.ok &&
    templateFetches === 1 &&
    templateForm.get("Body") === MSG.TRIAL_TEST_MESSAGE_TEMPLATE &&
    templateForm.get("To") === draft.to.phone,
);
check(
  "the template log stores the grant but no phone or message body",
  templateRows.some(
    (row) =>
      row.kind === "recovery_discount_template" &&
      row.grantId === grant.id &&
      row.status === "queued",
  ) &&
    !JSON.stringify(templateRows).includes(draft.to.phone) &&
    !JSON.stringify(templateRows).includes(MSG.TRIAL_TEST_MESSAGE_TEMPLATE),
);
const repeatedTemplate = await MSG.sendDiscountFollowupTemplate(
  site,
  draft,
  grant,
  {
    ...deps,
    read: () => templateRows,
    append: (row) => (templateRows.push(row), true),
    testTo: () => draft.to.phone,
    accountType: async () => "Trial",
  },
);
check(
  "a retried terminal callback cannot send the template twice",
  !repeatedTemplate.ok && templateFetches === 1,
);

console.log(
  failed === 0
    ? "\nAll checks passed. SMS can carry one prepared payment link and nothing broader."
    : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
