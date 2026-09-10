/**
 * The narrow SMS handoff used after a recovery call.
 *
 * This is not the generic SMS campaign channel. It accepts no arbitrary body,
 * no arbitrary customer and no arbitrary offer: a caller supplies an existing
 * recovery draft and an existing server-issued grant. The destination is
 * always the draft's phone number and the link is signed for that draft's
 * basket and customer.
 */
import crypto from "node:crypto";
import { database, databasePath, ensureStore, json, parseJson } from "./database.server";
import { checkReply } from "./bounds.server";
import { secret } from "./env.server";
import { featureOn } from "./featureflags.server";
import { record } from "./ledger.server";
import type { Draft } from "./outreach.server";
import type { RecoveryGrant } from "./grants.server";
import {
  quietNow,
  readSettings,
  type MerchantSettings,
} from "./settings.server";
import type { Site } from "./sites.server";

export type MessageLog = { level: "ok" | "error"; message: string };
export type MessageResult =
  | { ok: true; ref: string; message: string; logs: MessageLog[] }
  | { ok: false; error: string; logs: MessageLog[] };

type MessageConfig = {
  accountSid: string;
  authToken: string;
  from: string | null;
  messagingServiceSid: string | null;
};

type TwilioAccountType = "Trial" | "Full" | "unknown";

export type HandoffRow = {
  ts: string;
  shop: string;
  id: string;
  kind:
    | "integration_test"
    | "recovery_discount"
    | "recovery_discount_template";
  status: "attempting" | "queued" | "failed";
  cartId?: string;
  customerId?: string;
  grantId?: string;
  ref?: string;
  error?: string;
};

type Dependencies = {
  now: () => Date;
  id: () => string;
  fetch: typeof fetch;
  config: () => MessageConfig | null;
  accountType: (
    config: MessageConfig,
    fetcher: typeof fetch,
  ) => Promise<TwilioAccountType>;
  publicOrigin: () => string | null;
  testTo: () => string | null;
  read: () => HandoffRow[];
  append: (row: HandoffRow) => boolean;
  feature: (shop: string, feature: "recovery" | "voice") => boolean;
  settings: (shop: string) => MerchantSettings;
  quiet: typeof quietNow;
};

export const TEST_MESSAGE_COOLDOWN_MS = 30_000;
export const TEST_MESSAGE_TEXT =
  "This is a Chapman SMS integration test. Twilio messaging is working. No customer or discount message was sent.";
export const TRIAL_TEST_MESSAGE_TEMPLATE = "sms_customer_support";

export function messageConfig(): MessageConfig | null {
  const accountSid = secret("TWILIO_ACCOUNT_SID");
  const authToken = secret("TWILIO_AUTH_TOKEN");
  const from = secret("TWILIO_MESSAGING_FROM") ?? secret("TWILIO_FROM");
  const messagingServiceSid = secret("TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || (!from && !messagingServiceSid)) return null;
  return { accountSid, authToken, from, messagingServiceSid };
}

export function messageMissing(): string[] {
  const missing: string[] = [];
  if (!secret("TWILIO_ACCOUNT_SID")) missing.push("TWILIO_ACCOUNT_SID");
  if (!secret("TWILIO_AUTH_TOKEN")) missing.push("TWILIO_AUTH_TOKEN");
  if (
    !secret("TWILIO_MESSAGING_FROM") &&
    !secret("TWILIO_FROM") &&
    !secret("TWILIO_MESSAGING_SERVICE_SID")
  ) {
    missing.push(
      "TWILIO_MESSAGING_FROM, TWILIO_FROM, or TWILIO_MESSAGING_SERVICE_SID",
    );
  }
  return missing;
}

export const messageConfigured = () => messageMissing().length === 0;

let accountTypeCache:
  { sid: string; type: TwilioAccountType; expiresAt: number } | undefined;

async function detectAccountType(
  config: MessageConfig,
  fetcher: typeof fetch,
): Promise<TwilioAccountType> {
  if (
    accountTypeCache?.sid === config.accountSid &&
    accountTypeCache.expiresAt > Date.now()
  ) {
    return accountTypeCache.type;
  }
  try {
    const response = await fetcher(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}.json`,
      {
        method: "GET",
        signal: AbortSignal.timeout(3500),
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        },
      },
    );
    const payload = (await response.json()) as { type?: string };
    const type: TwilioAccountType =
      payload.type === "Trial" || payload.type === "Full"
        ? payload.type
        : "unknown";
    if (response.ok) {
      accountTypeCache = {
        sid: config.accountSid,
        type,
        expiresAt: Date.now() + 5 * 60_000,
      };
    }
    return type;
  } catch {
    // Account metadata is an optimization. The Messages request still returns
    // an actionable provider error if this lookup is temporarily unavailable.
    return "unknown";
  }
}

function readRows(): HandoffRow[] {
  return (database().prepare(`
    SELECT payload FROM outreach_attempts
    WHERE channel = 'sms_handoff' ORDER BY id
  `).all() as Array<{ payload: string }>).map((r) =>
    parseJson<HandoffRow>(r.payload, null as never));
}

function appendRow(row: HandoffRow): boolean {
  try {
    database().prepare(`
      INSERT INTO outreach_attempts(
        attempt_key, store_id, draft_id, channel, status, provider_ref,
        attempted_at, payload
      ) VALUES (?, ?, NULL, 'sms_handoff', ?, ?, ?, ?)
    `).run(
      row.id, ensureStore(row.shop), row.status, row.ref ?? null, row.ts, json(row),
    );
    return true;
  } catch {
    return false;
  }
}

const defaults: Dependencies = {
  now: () => new Date(),
  id: () => crypto.randomUUID(),
  fetch,
  config: messageConfig,
  accountType: detectAccountType,
  publicOrigin: () => secret("PUBLIC_ORIGIN")?.replace(/\/+$/, "") ?? null,
  testTo: () => secret("TWILIO_TEST_TO"),
  read: readRows,
  append: appendRow,
  feature: (shop, capability) => featureOn(shop, capability),
  settings: readSettings,
  quiet: quietNow,
};

export function readMessageHandoffs(shop: string, limit = 20): HandoffRow[] {
  const latest = new Map<string, HandoffRow>();
  for (const row of readRows()) {
    if (row.shop === shop) latest.set(row.id, row);
  }
  return [...latest.values()].slice(-limit).reverse();
}

export function messagePhone(input: string): string | null {
  const phone = input.trim().replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

const masked = (phone: string) =>
  `${phone.slice(0, 3)}${"•".repeat(Math.min(6, phone.length - 5))}${phone.slice(-2)}`;

const stopped = (logs: MessageLog[], error: string): MessageResult => ({
  ok: false,
  error,
  logs: [...logs, { level: "error", message: error }],
});

async function deliver(
  to: string,
  body: string,
  deps: Dependencies,
): Promise<
  | { ok: true; sid: string }
  | { ok: false; error: string; trialTemplateRequired: boolean }
> {
  const c = deps.config();
  if (!c)
    return {
      ok: false,
      error: `SMS is not configured: ${messageMissing().join(", ")} unset.`,
      trialTemplateRequired: false,
    };

  const form = new URLSearchParams({ To: to, Body: body });
  if (c.messagingServiceSid)
    form.set("MessagingServiceSid", c.messagingServiceSid);
  else form.set("From", c.from!);

  let response: Response;
  try {
    response = await deps.fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`,
      {
        method: "POST",
        signal: AbortSignal.timeout(3500),
        headers: {
          Authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
    );
  } catch (error) {
    return {
      ok: false,
      error: `Twilio messaging is unreachable: ${(error as Error).message}`,
      trialTemplateRequired: false,
    };
  }

  const text = await response.text();
  let payload: { sid?: string; message?: string } = {};
  try {
    payload = JSON.parse(text) as { sid?: string; message?: string };
  } catch {
    /* the status below is still actionable */
  }
  if (!response.ok || !payload.sid) {
    const providerMessage = payload.message ?? "message was not accepted";
    return {
      ok: false,
      error: `Twilio ${response.status}: ${providerMessage}`,
      trialTemplateRequired:
        /trial accounts? can only use pre-?defined templates|invalid template/i.test(
          providerMessage,
        ),
    };
  }
  return { ok: true, sid: payload.sid };
}

/** Merchant-triggered, fixed-body provider test. */
export async function sendTestMessage(
  site: Site,
  input: string,
  overrides: Partial<Dependencies> = {},
): Promise<MessageResult> {
  const deps = { ...defaults, ...overrides };
  const logs: MessageLog[] = [];
  const phone = messagePhone(input);
  if (!phone) {
    return stopped(
      logs,
      "Enter a complete phone number in international format, for example +919876543210.",
    );
  }
  logs.push({ level: "ok", message: "Destination accepted in E.164 format." });

  if (!deps.config()) {
    return stopped(
      logs,
      `SMS is not configured: ${messageMissing().join(", ")} unset.`,
    );
  }
  logs.push({
    level: "ok",
    message: "Twilio messaging credentials and a sender are configured.",
  });

  const config = deps.config()!;
  const accountType = await deps.accountType(config, deps.fetch);
  const testBody =
    accountType === "Trial" ? TRIAL_TEST_MESSAGE_TEMPLATE : TEST_MESSAGE_TEXT;
  if (accountType === "Trial") {
    logs.push({
      level: "ok",
      message:
        "Twilio reports a Trial account. Using its predefined sms_customer_support template; trial accounts reject custom text.",
    });
  } else if (accountType === "Full") {
    logs.push({ level: "ok", message: "Twilio reports a Full account." });
  } else {
    logs.push({
      level: "ok",
      message:
        "Twilio account type could not be read. Trying the full-account test body first.",
    });
  }

  const now = deps.now();
  const tooSoon = deps
    .read()
    .some(
      (row) =>
        row.shop === site.key &&
        row.kind === "integration_test" &&
        now.getTime() - Date.parse(row.ts) < TEST_MESSAGE_COOLDOWN_MS,
    );
  if (tooSoon)
    return stopped(
      logs,
      "A test message was just attempted. Wait 30 seconds before trying again.",
    );
  logs.push({
    level: "ok",
    message: "The 30-second test-message rate limit passed.",
  });

  if (
    testBody === TEST_MESSAGE_TEXT &&
    checkReply(TEST_MESSAGE_TEXT, {
      groundedStockClaims: [],
      approvedOffers: [],
    }).length
  ) {
    return stopped(
      logs,
      "The fixed test message did not pass Chapman's speech bounds.",
    );
  }
  if (testBody === TEST_MESSAGE_TEXT) {
    logs.push({
      level: "ok",
      message: "The fixed, non-promotional test body passed Chapman's bounds.",
    });
  }

  const id = `message-test-${deps.id()}`;
  if (
    !deps.append({
      ts: now.toISOString(),
      shop: site.key,
      id,
      kind: "integration_test",
      status: "attempting",
    })
  ) {
    return stopped(logs, "The test could not be logged, so nothing was sent.");
  }

  let sent = await deliver(phone, testBody, deps);
  if (!sent.ok && sent.trialTemplateRequired) {
    logs.push({
      level: "ok",
      message:
        "Twilio rejected custom text under trial restrictions. Retrying once with its predefined sms_customer_support template.",
    });
    sent = await deliver(phone, TRIAL_TEST_MESSAGE_TEMPLATE, deps);
  }
  deps.append({
    ts: deps.now().toISOString(),
    shop: site.key,
    id,
    kind: "integration_test",
    status: sent.ok ? "queued" : "failed",
    ref: sent.ok ? sent.sid : undefined,
    error: sent.ok ? undefined : sent.error,
  });
  if (!sent.ok) return stopped(logs, sent.error);

  logs.push({ level: "ok", message: `Twilio accepted the SMS (${sent.sid}).` });
  return {
    ok: true,
    ref: sent.sid,
    message: `Test message queued to ${masked(phone)}.`,
    logs,
  };
}

export type DiscountHandoffResult =
  { ok: true; ref: string; link: string } | { ok: false; error: string };

export const DISCOUNT_FOLLOWUP_TEXT =
  "Chapman: Your approved cart discount is ready. Please use the payment message provided by the store.";

/**
 * Whether a discount call may promise the demo-only post-call template.
 *
 * This is intentionally synchronous and performs no provider call. The
 * terminal callback re-runs the same gates before sending; this check exists
 * only so the voice may mention an SMS when the configured destination and
 * durable grant make that promise truthful.
 */
export function canSendDiscountFollowupTemplate(
  site: Site,
  draft: Draft,
  grant: RecoveryGrant,
  overrides: Partial<Dependencies> = {},
): { ok: true } | { ok: false; error: string } {
  const deps = { ...defaults, ...overrides };
  if (!deps.feature(site.key, "recovery") || !deps.feature(site.key, "voice")) {
    return { ok: false, error: "Recovery and Voice must both be enabled." };
  }

  const testPhone = deps.testTo() ? messagePhone(deps.testTo()!) : null;
  const calledPhone = draft.to.phone ? messagePhone(draft.to.phone) : null;
  if (!testPhone || calledPhone !== testPhone) {
    return {
      ok: false,
      error:
        "The post-call template is demo-only and the call destination must match TWILIO_TEST_TO.",
    };
  }
  if (
    grant.shop !== site.key ||
    grant.cartId !== draft.cartId ||
    grant.customerId !== draft.customerId ||
    Date.parse(grant.expiresAt) <= deps.now().getTime()
  ) {
    return { ok: false, error: "The recovery grant does not match this call." };
  }
  if (!deps.config()) {
    return {
      ok: false,
      error: `SMS is not configured: ${messageMissing().join(", ")} unset.`,
    };
  }
  if (
    deps.read().some(
      (row) =>
        row.shop === site.key &&
        (row.kind === "recovery_discount" ||
          row.kind === "recovery_discount_template") &&
        row.grantId === grant.id,
    )
  ) {
    return { ok: false, error: "A message has already been attempted for this grant." };
  }
  return { ok: true };
}

/**
 * Send one fixed, demo-safe acknowledgement after an offered discount call.
 *
 * This deliberately carries no percentage, coupon or payment URL. On a Trial
 * account Twilio only accepts its predefined body; on a full account the same
 * event gets a fixed confirmation sentence. The destination is pinned to
 * TWILIO_TEST_TO and must also be the number that was called, so this demo path
 * cannot accidentally become a customer campaign.
 */
export async function sendDiscountFollowupTemplate(
  site: Site,
  draft: Draft,
  grant: RecoveryGrant,
  overrides: Partial<Dependencies> = {},
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  const deps = { ...defaults, ...overrides };
  if (!deps.feature(site.key, "recovery") || !deps.feature(site.key, "voice")) {
    return { ok: false, error: "Recovery and Voice must both be enabled." };
  }

  const testPhone = deps.testTo() ? messagePhone(deps.testTo()!) : null;
  const calledPhone = draft.to.phone ? messagePhone(draft.to.phone) : null;
  if (!testPhone || calledPhone !== testPhone) {
    return {
      ok: false,
      error:
        "The post-call template is demo-only and the call destination must match TWILIO_TEST_TO.",
    };
  }
  if (
    grant.shop !== site.key ||
    grant.cartId !== draft.cartId ||
    grant.customerId !== draft.customerId ||
    Date.parse(grant.expiresAt) <= deps.now().getTime()
  ) {
    return { ok: false, error: "The recovery grant does not match this call." };
  }
  if (!deps.config()) {
    return {
      ok: false,
      error: `SMS is not configured: ${messageMissing().join(", ")} unset.`,
    };
  }
  if (
    deps.read().some(
      (row) =>
        row.shop === site.key &&
        (row.kind === "recovery_discount" ||
          row.kind === "recovery_discount_template") &&
        row.grantId === grant.id,
    )
  ) {
    return { ok: false, error: "A message has already been attempted for this grant." };
  }

  const id = `recovery-template-${grant.id}`;
  const base = {
    shop: site.key,
    id,
    kind: "recovery_discount_template" as const,
    cartId: draft.cartId,
    customerId: draft.customerId,
    grantId: grant.id,
  };
  if (!deps.append({ ...base, ts: deps.now().toISOString(), status: "attempting" })) {
    return { ok: false, error: "The follow-up could not be logged, so nothing was sent." };
  }

  const config = deps.config()!;
  const accountType = await deps.accountType(config, deps.fetch);
  const body =
    accountType === "Trial"
      ? TRIAL_TEST_MESSAGE_TEMPLATE
      : DISCOUNT_FOLLOWUP_TEXT;
  let sent = await deliver(testPhone, body, deps);
  if (!sent.ok && sent.trialTemplateRequired) {
    sent = await deliver(testPhone, TRIAL_TEST_MESSAGE_TEMPLATE, deps);
  }

  deps.append({
    ...base,
    ts: deps.now().toISOString(),
    status: sent.ok ? "queued" : "failed",
    ref: sent.ok ? sent.sid : undefined,
    error: sent.ok ? undefined : sent.error,
  });
  record({
    shop: site.key,
    kind: sent.ok ? "reply" : "tool_error",
    message: sent.ok
      ? `post-call discount template queued (${sent.sid})`
      : `post-call discount template failed: ${sent.error}`,
    detail: { cartId: draft.cartId, grantId: grant.id },
  });
  return sent.ok ? { ok: true, ref: sent.sid } : { ok: false, error: sent.error };
}

/**
 * Run every gate that can be checked before a Razorpay order exists. In
 * particular this prevents a Trial Twilio account from creating an order it
 * cannot deliver: trial templates cannot carry the order's unique URL.
 */
export async function canSendDiscountHandoff(
  site: Site,
  draft: Draft,
  grant: RecoveryGrant,
  overrides: Partial<Dependencies> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const deps = { ...defaults, ...overrides };
  const settings = deps.settings(site.key);
  if (!deps.feature(site.key, "recovery") || !deps.feature(site.key, "voice")) {
    return { ok: false, error: "Recovery and Voice must both be enabled." };
  }
  if (settings.outreach.call.mode !== "conversation") {
    return { ok: false, error: "The call is not in conversation mode." };
  }
  if (settings.outreach.call.discountHandoff !== "sms") {
    return {
      ok: false,
      error: "The approved-discount SMS handoff is switched off.",
    };
  }
  const phone = draft.to.phone ? messagePhone(draft.to.phone) : null;
  if (!phone)
    return {
      ok: false,
      error: "The current call has no valid SMS destination.",
    };
  if (
    grant.shop !== site.key ||
    grant.cartId !== draft.cartId ||
    grant.customerId !== draft.customerId ||
    Date.parse(grant.expiresAt) <= deps.now().getTime()
  ) {
    return {
      ok: false,
      error: "The recovery grant does not match this live call.",
    };
  }
  if (
    deps.quiet(settings, deps.now()) &&
    secret("VOICE_QUIET_HOURS_TEST_NUMBER") !== phone
  ) {
    return {
      ok: false,
      error: "Quiet hours prevent the recovery SMS from being sent now.",
    };
  }
  if (
    deps
      .read()
      .some(
        (row) =>
          row.shop === site.key &&
          row.kind === "recovery_discount" &&
          row.grantId === grant.id,
      )
  ) {
    return {
      ok: false,
      error: "A message has already been attempted for this grant.",
    };
  }
  if (!deps.publicOrigin())
    return {
      ok: false,
      error: "PUBLIC_ORIGIN is required for a phone-openable recovery link.",
    };
  const config = deps.config();
  if (!config) {
    return {
      ok: false,
      error: `SMS is not configured: ${messageMissing().join(", ")} unset.`,
    };
  }
  if ((await deps.accountType(config, deps.fetch)) === "Trial") {
    return {
      ok: false,
      error:
        "Twilio Trial accounts allow only predefined SMS templates, which cannot contain this order's unique payment link. Upgrade Twilio before enabling discounted-payment SMS.",
    };
  }
  return { ok: true };
}

/** Send one policy-issued discount link to the number currently on the call. */
export async function sendDiscountHandoff(
  site: Site,
  draft: Draft,
  grant: RecoveryGrant,
  paymentPath: string,
  overrides: Partial<Dependencies> = {},
): Promise<DiscountHandoffResult> {
  const deps = { ...defaults, ...overrides };
  const preflight = await canSendDiscountHandoff(site, draft, grant, deps);
  if (!preflight.ok) return preflight;
  const phone = draft.to.phone ? messagePhone(draft.to.phone) : null;
  const origin = deps.publicOrigin()!;
  if (!/^\/pay\/[a-z0-9_-]+\/order_[a-zA-Z0-9_-]+$/.test(paymentPath)) {
    return { ok: false, error: "The prepared payment path is not valid." };
  }
  const link = `${origin}${paymentPath}`;
  const percent = Math.round(grant.depth * 100);
  const body =
    `${site.name}: aapke ${grant.title} basket par approved ${percent}% off ready hai. ` +
    `Payment page par automatically lagega; code nahi chahiye. Secure checkout: ${link}`;
  const violations = checkReply(body, {
    groundedStockClaims: [],
    approvedOffers: [
      {
        handle: grant.handle,
        title: grant.title,
        percent,
        endsAt: grant.expiresAt.slice(0, 10),
      },
    ],
  });
  if (violations.length)
    return {
      ok: false,
      error: "The recovery SMS did not pass Chapman's bounds.",
    };

  const id = `recovery-message-${grant.id}`;
  const base = {
    shop: site.key,
    id,
    kind: "recovery_discount" as const,
    cartId: draft.cartId,
    customerId: draft.customerId,
    grantId: grant.id,
  };
  if (
    !deps.append({
      ...base,
      ts: deps.now().toISOString(),
      status: "attempting",
    })
  ) {
    return {
      ok: false,
      error: "The handoff could not be logged, so nothing was sent.",
    };
  }

  const sent = await deliver(phone!, body, deps);
  deps.append({
    ...base,
    ts: deps.now().toISOString(),
    status: sent.ok ? "queued" : "failed",
    ref: sent.ok ? sent.sid : undefined,
    error: sent.ok ? undefined : sent.error,
  });
  record({
    shop: site.key,
    kind: sent.ok ? "reply" : "tool_error",
    message: sent.ok
      ? "approved recovery discount link queued by SMS"
      : `approved recovery discount SMS failed: ${sent.error}`,
    detail: { cartId: draft.cartId, grantId: grant.id },
  });
  return sent.ok ? { ok: true, ref: sent.sid, link } : sent;
}

/** Test seam. */
export function _messageFile(): string {
  return databasePath();
}
