/**
 * Place one real voice call, for one real recovery draft.
 *
 * This is the rung-1 harness: it takes a target the recovery agent actually
 * produced — chosen by the same suppression rules, carrying text the same
 * bounds layer passed — swaps the destination number for the tester's own, and
 * sends it down the `voice` channel.
 *
 * WHY IT OVERRIDES THE NUMBER AND NOTHING ELSE. The one thing that must not be
 * real in a test is who picks up. Everything else — the treatment, the
 * sentence, the facts it is allowed to state, the margin at stake — stays
 * exactly as the agent computed it, because a test that also invents the
 * message is testing a message nobody will ever send. The number is the only
 * variable held fixed; that is the point of a control.
 *
 * It deliberately routes through `send()` rather than calling the channel, so
 * the quiet-hours gate, the send log and the ledger all see this call. A test
 * that bypasses the safety rails is a test of code that will not run in
 * production.
 *
 * Run:  node --env-file=../.env scripts/voice-call.mjs [--local-preview] [--dry] [--index N] [--cart CART_ID]
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

const RCV = await load("app/lib/recovery.server.ts", "rcv-voice.mjs");
const OUT = await load("app/lib/outreach.server.ts", "out-voice.mjs");
const VOI = await load("app/lib/voice.server.ts", "voi-voice.mjs");
const SIT = await load("app/lib/sites.server.ts", "sit-voice.mjs");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const localPreview = args.includes("--local-preview");
const index = Number(args[args.indexOf("--index") + 1]) || 0;
const cartAt = args.indexOf("--cart");
const cartId = cartAt >= 0 ? String(args[cartAt + 1] ?? "").trim() : "";

/**
 * `--replay` speaks a draft that already exists, instead of planning a run.
 *
 * Needed because the agent is correctly refusing to produce new targets: every
 * eligible basket has now been called, and `already_messaged_cart` suppresses
 * each one. That is the feature working. Loosening a merchant setting to get
 * around it — widening the cart age window, say — would be changing a POLICY to
 * suit a test, which is how a codebase acquires settings nobody chose.
 *
 * So this replays a draft that was already planned, already bounds-checked and
 * already written down. It skips target SELECTION, which is the one stage this
 * flag cannot test and which the suite covers anyway. Everything downstream —
 * quiet hours, the send log, the token, the audio — still runs for real.
 */
const replay = args.includes("--replay");

const to = process.env.TWILIO_TEST_TO;
const shopKey = process.env.VOICE_TEST_SHOP ?? SIT.allSites()[0]?.key;
const site = SIT.findSite(shopKey ?? null);
if (!site) {
  console.error(`no such site: ${shopKey}`);
  process.exit(1);
}
const shop = site.key;

/* ---- 1. is the channel actually available? ---------------------- */

const gaps = VOI.missing();
if (gaps.length) {
  console.error(`voice is not configured — unset: ${gaps.join(", ")}`);
  console.error("PUBLIC_ORIGIN is the ngrok URL, with no trailing slash.");
  process.exit(1);
}
if (!to) {
  console.error("TWILIO_TEST_TO is unset. That is the number that will ring.");
  process.exit(1);
}

const c = VOI.config();
const maskedPhone = (phone) =>
  phone && phone.length > 5
    ? `${phone.slice(0, 3)}${"*".repeat(Math.max(3, phone.length - 5))}${phone.slice(-2)}`
    : "configured";
console.log(`shop      ${shop}`);
console.log(`origin    ${c.origin}`);
console.log(`voice     ${c.voice} / ${c.language}`);
console.log(`from      ${maskedPhone(c.twilioFrom)}`);
console.log(`to        ${maskedPhone(to)}   (configured test handset)`);
console.log("");

/* ---- 2. a real target from a real run --------------------------- */

/**
 * `gatewayOrigin` is the ngrok URL, not localhost.
 *
 * The recovery link inside the spoken message has to resolve on the shopper's
 * phone, and a link to 127.0.0.1 resolves to the shopper's own handset. The
 * dashboard takes this from the incoming request for exactly this reason; a
 * script has no request, so it takes the origin Twilio was given.
 */
let draft;

if (replay) {
  const prior = OUT.readDrafts(shop, 50).filter((d) => d.text?.trim());
  if (!prior.length) {
    console.error("no drafts on file to replay — run once without --replay first.");
    process.exit(1);
  }
  draft = prior[Math.min(index, prior.length - 1)];
  console.log(`replaying draft ${draft.id} (${prior.length} on file)`);
}

const run = draft
  ? null
  : RCV.runRecovery({
      shop,
      shopName: site.name,
      storefrontOrigin: site.origins[0],
      productUrlTemplate: site.productUrlTemplate,
      gatewayOrigin: c.origin,
      siteSecret: site.secret,
      channel: "voice",
    });

if (run && !run.targets.length) {
  console.error(`the recovery agent chose nobody to write to${run.emptyReason ? `: ${run.emptyReason}` : "."}`);
  console.error("");
  console.error("Suppression is the interesting output here, not a failure:");
  for (const s of run.suppressedBy ?? []) console.error(`  ${String(s.count).padStart(4)}  ${s.label}`);
  process.exit(1);
}

if (run) {
  console.log(`${run.targets.length} targets, ${run.suppressed.length} suppressed`);
  const picked = cartId
    ? run.targets.find((target) => target.cartId === cartId)
    : run.targets[Math.min(index, run.targets.length - 1)];
  if (!picked) {
    console.error(
      cartId
        ? `cart ${cartId} is not an eligible recovery target`
        : `target index ${index} is out of range`,
    );
    process.exit(1);
  }
  draft = RCV.toDraft(shop, picked);
}

/**
 * The one substitution. Note that `id` is left alone: the draft keeps the
 * idempotency key the agent gave it, so a second run of this script cannot
 * quietly produce a second live draft for the same basket.
 */
draft.channel = "voice";
draft.to = { ...draft.to, phone: to };

console.log("");
console.log(`treatment   ${draft.treatment}`);
console.log(`cart        ${draft.cartId}`);
console.log(`margin      Rs ${draft.marginAtStake}`);
console.log(`facts       ${draft.facts.map((f) => `${f.label}=${f.value}`).join(", ") || "(none)"}`);
console.log("");
console.log("--- what will be spoken, verbatim ---");
console.log(draft.link ? draft.text.replaceAll(draft.link, "[signed recovery link]") : draft.text);
console.log("------------------------------------");
console.log("");

if (localPreview) {
  console.log("--local-preview: nothing sent to speech or call providers.");
  process.exit(0);
}

/* ---- 3. render first, so a TTS failure is not a wasted call ------ */

const rendered = await VOI.render(draft.text, c, { timeoutMs: 10_000 });
if (!rendered.ok) {
  console.error(`sarvam refused: ${rendered.error}`);
  process.exit(1);
}
console.log(
  `audio       ${rendered.bytes} bytes ${rendered.cached ? "(cached)" : "(rendered)"} -> ${rendered.file}`,
);

if (dry) {
  console.log("");
  console.log("--dry: nothing dialled. Play the file above to hear exactly what would go out.");
  process.exit(0);
}

/* ---- 4. through send(), rails and all --------------------------- */

const rec = await OUT.send(draft);
console.log("");
if (rec.ok) {
  console.log(`PLACED   call ${rec.ref}`);
  console.log("Twilio will now fetch the TwiML. If the phone rings and plays nothing,");
  console.log("the call connected but the fetch failed — check the ngrok request log first.");
} else {
  console.log(`NOT SENT ${rec.error}`);
}
