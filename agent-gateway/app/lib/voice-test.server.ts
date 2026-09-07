/**
 * One deliberately boring call for proving the voice integration.
 *
 * The phone number chooses only where the fixed test sentence goes. It never
 * becomes model input or spoken text. The ordinary voice channel still owns
 * delivery, auditing, feature switches and quiet hours; this helper adds input
 * validation, pre-renders the audio, and rate-limits the button.
 */
import crypto from "node:crypto";
import { checkReply } from "./bounds.server";
import {
  readSends,
  send,
  type Draft,
  type SendRecord,
} from "./outreach.server";
import type { Site } from "./sites.server";
import {
  config as voiceConfig,
  missing as voiceMissing,
  render,
  type VoiceConfig,
} from "./voice.server";

export const TEST_CALL_TEXT =
  "This is a Chapman voice integration test. If you can hear this, your Sarvam and Twilio setup is working. No customer message was sent.";
export const TEST_CALL_COOLDOWN_MS = 30_000;

export type TestCallLog = {
  level: "ok" | "error";
  message: string;
};

export type TestCallResult =
  | { ok: true; message: string; ref: string; logs: TestCallLog[] }
  | { ok: false; error: string; logs: TestCallLog[] };

type Dependencies = {
  now: () => number;
  id: () => string;
  config: () => VoiceConfig | null;
  missing: () => string[];
  render: typeof render;
  readSends: (shop: string) => SendRecord[];
  send: (draft: Draft) => Promise<SendRecord>;
};

const defaults: Dependencies = {
  now: Date.now,
  id: () => crypto.randomUUID(),
  config: voiceConfig,
  missing: voiceMissing,
  render,
  readSends,
  send,
};

/** Accept familiar formatting, then require the result to be E.164. */
export function testPhone(input: string): string | null {
  const phone = input.trim().replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

const masked = (phone: string) =>
  phone.length < 7
    ? phone
    : `${phone.slice(0, 3)}${"•".repeat(Math.min(6, phone.length - 5))}${phone.slice(-2)}`;

const stopped = (logs: TestCallLog[], error: string): TestCallResult => ({
  ok: false,
  error,
  logs: [...logs, { level: "error", message: error }],
});

export async function placeVoiceTestCall(
  site: Site,
  input: string,
  overrides: Partial<Dependencies> = {},
): Promise<TestCallResult> {
  const deps = { ...defaults, ...overrides };
  const logs: TestCallLog[] = [];
  const phone = testPhone(input);
  if (!phone) {
    return stopped(
      logs,
      "Enter a complete phone number in international format, for example +919876543210.",
    );
  }
  logs.push({
    level: "ok",
    message: "Destination accepted in international E.164 format.",
  });

  const c = deps.config();
  if (!c) {
    return stopped(
      logs,
      `Voice is not configured: ${deps.missing().join(", ")} unset.`,
    );
  }
  logs.push({
    level: "ok",
    message: "Sarvam, Twilio and the public callback origin are configured.",
  });

  const now = deps.now();
  const tooSoon = deps
    .readSends(site.key)
    .some(
      (entry) =>
        entry.treatment === "integration_test" &&
        now - Date.parse(entry.ts) < TEST_CALL_COOLDOWN_MS,
    );
  if (tooSoon) {
    return stopped(
      logs,
      "A test call was just attempted. Wait 30 seconds before placing another.",
    );
  }
  logs.push({
    level: "ok",
    message: "The 30-second test-call rate limit passed.",
  });

  // This should stay impossible unless somebody edits the fixed sentence. The
  // check makes that edit fail closed instead of turning the test button into
  // a special path around the same bounds every real draft passes.
  const violations = checkReply(TEST_CALL_TEXT, {
    groundedStockClaims: [],
    approvedOffers: [],
  });
  if (violations.length > 0) {
    return stopped(
      logs,
      "The fixed test-call script did not pass Chapman's speech bounds.",
    );
  }
  logs.push({
    level: "ok",
    message: "The fixed test script passed Chapman's speech bounds.",
  });

  // Render first. A Sarvam failure should not spend a Twilio call or make a
  // phone ring only to hear an error tone.
  const audio = await deps.render(TEST_CALL_TEXT, c);
  if (!audio.ok)
    return stopped(logs, `Sarvam could not render the test: ${audio.error}`);
  logs.push({
    level: "ok",
    message: "Sarvam rendered and cached the fixed test audio.",
  });

  const id = `integration-test-${deps.id()}`;
  const result = await deps.send({
    id,
    shop: site.key,
    cartId: id,
    customerId: "integration-test",
    to: { phone, email: null },
    channel: "voice",
    text: TEST_CALL_TEXT,
    link: "",
    treatment: "integration_test",
    facts: [],
    marginAtStake: 0,
  });
  if (!result.ok || !result.ref) {
    return stopped(logs, result.error ?? "Twilio did not queue the test call.");
  }

  logs.push({
    level: "ok",
    message: `Twilio accepted the outbound call (${result.ref}).`,
  });

  return {
    ok: true,
    ref: result.ref,
    message: `Test call queued to ${masked(phone)}. Twilio reference: ${result.ref}.`,
    logs,
  };
}
