/**
 * One-shot recovery-call harness for recording a demo without starting Chapman.
 *
 * It deliberately has no catalog, site, customer database, recovery run, or
 * arbitrary destination. The only handset it can dial or message is the
 * verified demo number in TWILIO_TEST_TO. Twilio still needs public webhooks
 * for speech turns, so run the small recording-only ngrok compose file first.
 *
 * Preview: npm run demo:recording-call -- --origin https://example.ngrok-free.app
 * Call:    npm run demo:recording-call -- --origin https://... --call
 * Check:   node scripts/recording-recovery-call.mjs --self-test
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const PORT = 3010;
const TRIAL_TEST_MESSAGE_TEMPLATE = "sms_customer_support";
const FULL_ACCOUNT_MESSAGE =
  "Chapman: Your approved cart discount is ready. Please use the payment message provided by the store.";

const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

const normalise = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const includesAny = (value, phrases) => {
  const padded = ` ${value} `;
  return phrases.some((phrase) => padded.includes(` ${phrase} `));
};

export function classifyReason(speech, digit = "") {
  if (digit === "9") return "stop";
  const heard = normalise(speech);
  if (
    includesAny(heard, [
      "delivery",
      "shipping",
      "delivery price",
      "delivery charge",
      "shipping charge",
      "too much",
      "too expensive",
      "costly",
      "price",
      "mehenga",
      "mahenga",
    ])
  ) {
    return "delivery_cost";
  }
  return heard ? "other" : "silence";
}

export function classifyConfirmation(speech, digit = "") {
  if (digit === "9") return "stop";
  if (digit === "1") return "yes";
  if (digit === "2") return "no";
  const heard = normalise(speech);
  if (
    includesAny(heard, [
      "yes",
      "yeah",
      "yep",
      "sure",
      "okay",
      "ok",
      "alright",
      "that works",
      "sounds good",
      "haan",
      "han",
    ])
  ) {
    return "yes";
  }
  if (
    includesAny(heard, [
      "no",
      "nope",
      "not interested",
      "do not",
      "don't",
      "nahin",
      "nahi",
    ])
  ) {
    return "no";
  }
  return heard ? "other" : "silence";
}

export function validTwilioSignature({ signature, url, params, authToken }) {
  if (!signature) return false;
  const signed =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(signed, "utf8"))
    .digest("base64");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(actualBytes, expectedBytes)
  );
}

function selfTest() {
  assert.equal(classifyReason("The delivery price is too much"), "delivery_cost");
  assert.equal(classifyReason("Shipping is costly"), "delivery_cost");
  assert.equal(classifyConfirmation("Yes, that sounds good"), "yes");
  assert.equal(classifyConfirmation("No thanks"), "no");
  assert.equal(classifyConfirmation("", "1"), "yes");
  assert.equal(xmlEscape("Fieldnote & <Home>"), "Fieldnote &amp; &lt;Home&gt;");
  const signatureInput = {
    url: "https://example.test/voice?token=abc",
    params: { CallSid: "CA123", SpeechResult: "yes" },
    authToken: "test-token",
  };
  const signed =
    signatureInput.url +
    Object.keys(signatureInput.params)
      .sort()
      .map((key) => key + signatureInput.params[key])
      .join("");
  const signature = crypto
    .createHmac("sha1", signatureInput.authToken)
    .update(Buffer.from(signed, "utf8"))
    .digest("base64");
  assert.equal(validTwilioSignature({ ...signatureInput, signature }), true);
  assert.equal(
    validTwilioSignature({ ...signatureInput, signature: Buffer.from("wrong").toString("base64") }),
    false,
  );
  console.log("recording recovery call self-test passed");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] ?? "").trim() : "";
};

const callRequested = args.includes("--call");
const publicOrigin = (valueAfter("--origin") || process.env.PUBLIC_ORIGIN || "")
  .replace(/\/+$/, "");
const to = String(process.env.TWILIO_TEST_TO ?? "").trim();
const from = String(process.env.TWILIO_FROM ?? "").trim();
const accountSid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
const authToken = String(process.env.TWILIO_AUTH_TOKEN ?? "").trim();
const sarvamKey = String(process.env.SARVAM_API_KEY ?? "").trim();
const messagingFrom = String(process.env.TWILIO_MESSAGING_FROM ?? from).trim();
const messagingServiceSid = String(process.env.TWILIO_MESSAGING_SERVICE_SID ?? "").trim();
const customerName = String(process.env.USERNAME ?? "there")
  .replace(/[^\p{L}\p{N} .'-]/gu, "")
  .trim()
  .slice(0, 60) || "there";

const e164 = /^\+[1-9]\d{7,14}$/;
const gaps = [
  ["--origin/PUBLIC_ORIGIN", /^https:\/\/[^/]+$/i.test(publicOrigin)],
  ["TWILIO_TEST_TO", e164.test(to)],
  ["TWILIO_FROM", e164.test(from)],
  ["TWILIO_ACCOUNT_SID", Boolean(accountSid)],
  ["TWILIO_AUTH_TOKEN", Boolean(authToken)],
  ["SARVAM_API_KEY", Boolean(sarvamKey)],
  ["SMS sender", Boolean(messagingServiceSid || e164.test(messagingFrom))],
].filter(([, ready]) => !ready);

if (gaps.length) {
  console.error(`Recording call is not configured: ${gaps.map(([name]) => name).join(", ")}.`);
  process.exit(1);
}

const maskedPhone = (phone) =>
  phone.length > 5
    ? `${phone.slice(0, 3)}${"*".repeat(Math.max(3, phone.length - 5))}${phone.slice(-2)}`
    : "configured";

const lines = {
  opening:
    `Hi ${customerName}, this is Priya from Fieldnote Home. ` +
    "You left a Sola Cane Table Lamp in your basket. It is still saved on our website. " +
    "May I ask what stopped you from checking out?",
  discount:
    "Thanks for telling me. Aap hamare regular shopper hain, isliye is basket par 8 percent off approve hua hai. " +
    "Kya yeh aapke liye theek rahega?",
  accept:
    "Perfect. The 8 percent discount is approved. " +
    "Call khatam hone ke baad aapko discount confirmation SMS aayega. Thank you.",
  decline:
    "Bilkul theek, batane ke liye thank you. Hum is basket ke baare mein aapko dobara contact nahi karenge.",
  clarifyReason:
    "I did not quite catch that. Please tell me if the delivery charge or product price stopped you.",
  clarifyConfirmation:
    "Sorry, I did not catch that. Please say yes if the 8 percent discount works for you, or no to finish.",
};

console.log("Standalone Chapman recording call");
console.log(`origin    ${publicOrigin}`);
console.log(`from      ${maskedPhone(from)}`);
console.log(`to        ${maskedPhone(to)} (TWILIO_TEST_TO only)`);
console.log("voice     Sarvam Priya / en-IN");
console.log("");
console.log("Conversation:");
console.log(`1. ${lines.opening}`);
console.log(`2. [You say the delivery price is too much]`);
console.log(`3. ${lines.discount}`);
console.log(`4. [You say yes]`);
console.log(`5. ${lines.accept}`);
console.log(`6. Call completes; then Twilio sends its trial template SMS.`);

if (!callRequested) {
  console.log("");
  console.log("Preview only: no provider was contacted and no call or SMS was sent.");
  console.log("Add --call only when the test handset owner is ready and has consented.");
  process.exit(0);
}

const sessionToken = crypto.randomBytes(24).toString("base64url");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "chapman-recording-call-"));
const audioFiles = new Map();
const acceptedCalls = new Set();
const smsAttempted = new Set();

const twiml = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

const callbackUrl = (route) => {
  const url = new URL(route, publicOrigin);
  url.searchParams.set("token", sessionToken);
  return url.toString();
};

const playOrSay = (name, text) => {
  const file = audioFiles.get(name);
  return file
    ? `<Play>${xmlEscape(`${publicOrigin}/audio/${name}.mp3?token=${sessionToken}`)}</Play>`
    : `<Say>${xmlEscape(text)}</Say>`;
};

const gather = (actionPath, promptName, promptText) =>
  `<Gather input="speech dtmf" numDigits="1" language="en-IN" speechTimeout="auto" timeout="7" ` +
  `actionOnEmptyResult="true" action="${xmlEscape(callbackUrl(actionPath))}" method="POST">` +
  `${playOrSay(promptName, promptText)}</Gather>`;

async function renderSpeech(name, text) {
  let response;
  try {
    response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "api-subscription-key": sarvamKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        language_code: "en-IN",
        model: "bulbul:v3",
        speaker: "priya",
        pace: 1.15,
        output_audio_codec: "mp3",
        speech_sample_rate: 8000,
      }),
    });
  } catch (error) {
    throw new Error(`Sarvam was unreachable: ${error.message}`);
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`Sarvam ${response.status}: ${body.slice(0, 240)}`);
  let audio;
  try {
    audio = JSON.parse(body)?.audios?.[0];
  } catch {
    throw new Error("Sarvam returned invalid JSON.");
  }
  if (!audio) throw new Error("Sarvam returned no audio.");
  const file = path.join(workDir, `${name}.mp3`);
  fs.writeFileSync(file, Buffer.from(audio, "base64"));
  audioFiles.set(name, file);
}

async function readForm(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return Object.fromEntries(form.entries());
}

const sendXml = (response, body, status = 200) => {
  response.writeHead(status, {
    "Content-Type": "text/xml; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(twiml(body));
};

function callbackIsValid(request, params) {
  const signature = request.headers["x-twilio-signature"];
  // Twilio's first Url= fetch can arrive without the signature on the trial
  // account used for this demo. Chapman makes the same narrow fallback: the
  // callback must still carry this process's random, short-lived URL token.
  // If Twilio does present a signature, it must verify.
  if (!signature) return true;
  const expectedUrl = `${publicOrigin}${request.url}`;
  return validTwilioSignature({
    signature,
    url: expectedUrl,
    params,
    authToken,
  });
}

async function twilioRequest(resource, form) {
  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/${resource}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );
  const body = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`Twilio ${response.status}: ${body.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(
      `Twilio ${response.status}${payload.code ? ` [${payload.code}]` : ""}: ${payload.message ?? body.slice(0, 200)}`,
    );
  }
  return payload;
}

async function accountType() {
  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
      {
        signal: AbortSignal.timeout(8_000),
        headers: { Authorization: `Basic ${authorization}` },
      },
    );
    const payload = await response.json();
    return response.ok && ["Trial", "Full"].includes(payload.type)
      ? payload.type
      : "unknown";
  } catch {
    return "unknown";
  }
}

async function sendFollowupSms(type) {
  const form = new URLSearchParams({
    To: to,
    Body: type === "Trial" ? TRIAL_TEST_MESSAGE_TEMPLATE : FULL_ACCOUNT_MESSAGE,
  });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", messagingFrom);
  const message = await twilioRequest("Messages.json", form);
  return message.sid;
}

async function waitForDialConfirmation() {
  console.log("");
  console.log("ARMED: no call or SMS has been sent.");
  console.log('Type CALL and press Enter only when the test handset owner is recording.');
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  for await (const chunk of process.stdin) {
    if (String(chunk).trim() === "CALL") {
      process.stdin.pause();
      return;
    }
    console.log('Still armed. Type exactly CALL to dial, or press Ctrl+C to stop.');
  }
  throw new Error("Dial confirmation input closed; nothing was called.");
}

let closeTimer;
let server;
const finishSoon = () => {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => server.close(), 1500);
};

server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ok: true, mode: "recording-recovery-call" }));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/audio/")) {
      if (url.searchParams.get("token") !== sessionToken) {
        response.writeHead(403).end();
        return;
      }
      const name = path.basename(url.pathname, ".mp3").replace(/[^a-zA-Z]/g, "");
      const file = audioFiles.get(name);
      if (!file) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" });
      fs.createReadStream(file).pipe(response);
      return;
    }

    if (request.method !== "POST" || url.searchParams.get("token") !== sessionToken) {
      response.writeHead(404).end();
      return;
    }

    const params = await readForm(request);
    if (!callbackIsValid(request, params)) {
      console.error(`Rejected unsigned Twilio callback at ${url.pathname}.`);
      response.writeHead(403).end();
      return;
    }

    if (url.pathname === "/voice/start") {
      sendXml(
        response,
        gather("/voice/reason", "opening", lines.opening) +
          `<Redirect method="POST">${xmlEscape(`${publicOrigin}/voice/start?token=${sessionToken}`)}</Redirect>`,
      );
      return;
    }

    if (url.pathname === "/voice/reason") {
      const reason = classifyReason(params.SpeechResult, params.Digits);
      if (reason === "stop") {
        sendXml(response, `${playOrSay("decline", lines.decline)}<Hangup/>`);
      } else if (reason === "silence" && url.searchParams.get("retry") === "1") {
        sendXml(response, `${playOrSay("decline", lines.decline)}<Hangup/>`);
      } else if (reason === "silence") {
        sendXml(
          response,
          gather("/voice/reason?retry=1", "clarifyReason", lines.clarifyReason),
        );
      } else {
        sendXml(
          response,
          gather("/voice/confirm", "discount", lines.discount),
        );
      }
      return;
    }

    if (url.pathname === "/voice/confirm") {
      const decision = classifyConfirmation(params.SpeechResult, params.Digits);
      if (decision === "yes") {
        if (params.CallSid) acceptedCalls.add(params.CallSid);
        sendXml(response, `${playOrSay("accept", lines.accept)}<Hangup/>`);
      } else if (decision === "no" || decision === "stop") {
        sendXml(response, `${playOrSay("decline", lines.decline)}<Hangup/>`);
      } else if (url.searchParams.get("retry") === "1") {
        sendXml(response, `${playOrSay("decline", lines.decline)}<Hangup/>`);
      } else {
        sendXml(
          response,
          gather("/voice/confirm?retry=1", "clarifyConfirmation", lines.clarifyConfirmation),
        );
      }
      return;
    }

    if (url.pathname === "/voice/status") {
      response.writeHead(204).end();
      const callSid = params.CallSid ?? "";
      if (
        params.CallStatus === "completed" &&
        acceptedCalls.has(callSid) &&
        !smsAttempted.has(callSid)
      ) {
        smsAttempted.add(callSid);
        try {
          const type = await accountType();
          const messageSid = await sendFollowupSms(type);
          console.log(
            `Call completed after acceptance; ${type === "Trial" ? "Twilio trial template" : "fixed confirmation"} SMS queued (${messageSid}).`,
          );
        } catch (error) {
          console.error(`Post-call SMS failed: ${error.message}`);
        } finally {
          finishSoon();
        }
      } else if (params.CallStatus === "completed") {
        console.log("Call completed without acceptance; no SMS was sent.");
        finishSoon();
      }
      return;
    }

    response.writeHead(404).end();
  } catch (error) {
    console.error(`Callback error: ${error.message}`);
    if (!response.headersSent) response.writeHead(500).end();
  }
});

const cleanup = () => {
  clearTimeout(closeTimer);
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // The OS temp directory will clean up a file still held by a late stream.
  }
};

process.once("SIGINT", () => server.close());
process.once("SIGTERM", () => server.close());
server.once("close", () => {
  cleanup();
  console.log("Recording-call server stopped.");
});

try {
  console.log("");
  console.log("Preparing Priya's fixed audio...");
  for (const [name, text] of Object.entries(lines)) {
    await renderSpeech(name, text);
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // The recording-only ngrok container reaches this through
    // host.docker.internal, which requires a host-visible bind.
    server.listen(PORT, "0.0.0.0", resolve);
  });
  const health = await fetch(`${publicOrigin}/health`, {
    signal: AbortSignal.timeout(8_000),
    headers: { "ngrok-skip-browser-warning": "1" },
  });
  if (!health.ok) throw new Error(`Public tunnel health check returned ${health.status}.`);

  await waitForDialConfirmation();

  const call = await twilioRequest(
    "Calls.json",
    new URLSearchParams({
      To: to,
      From: from,
      Url: `${publicOrigin}/voice/start?token=${sessionToken}`,
      StatusCallback: `${publicOrigin}/voice/status?token=${sessionToken}`,
    }),
  );
  console.log(`Call queued (${call.sid}). Waiting for the conversation to finish...`);
  closeTimer = setTimeout(() => {
    console.error("Timed out waiting for the completed-call callback.");
    server.close();
  }, 10 * 60_000);
} catch (error) {
  console.error(`Recording call stopped: ${error.message}`);
  server.close();
  process.exitCode = 1;
}
