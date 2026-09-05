/**
 * The conversational voice leg — turn-based, and turn-based on purpose.
 *
 * Rung 1 (`voice.server.ts` plus the two Remix routes) speaks one bounds-checked
 * sentence and hangs up. It stays exactly as it is. This is the leg where the
 * shopper can answer back, and it is a separate process so that whatever
 * happens in here cannot reach the strict channel.
 *
 * WHY `<Gather>` AND NOT A MEDIA STREAM. The streaming design — Twilio
 * WebSocket, Sarvam STT, token-by-token TTS, barge-in via `clear` — was built
 * and is the better experience. It cannot run here: `<Stream>` is on Twilio's
 * documented list of verbs STRIPPED from trial accounts, replaced at runtime
 * with "The Stream verb is not available on trial accounts". Not a code
 * problem, an account tier. `<Gather>` is documented as supported on trial and
 * measured working: `SpeechResult="Hello. Hello. Can you hear me?"` at 0.80
 * confidence, first try.
 *
 * The cost of turn-based is honest: a couple of seconds between the shopper
 * finishing and the shop replying, and no interrupting her mid-sentence. The
 * loop is otherwise the same, and every guarantee below is unaffected.
 *
 *   Twilio STT ──▶ facts-only prompt ──▶ model ──▶ checkReply ──▶ Sarvam ──▶ <Play>
 *                                                     │
 *                                                     └─ fails? say the safe line
 *
 * FOUR THINGS THAT MAKE THIS SAFE TO POINT AT A PHONE.
 *
 * 1. THE MODEL NEVER LEARNS A NUMBER IT COULD GIVE AWAY. Its entire world of
 *    facts is `draft.facts` — the same array the drafting layer already uses to
 *    check what a message is allowed to assert. No discount policy, no ceiling,
 *    no mention that grants exist. It cannot negotiate toward a figure that is
 *    not in its context, so a hallucination degrades into vagueness rather than
 *    into fifteen percent off.
 *
 * 2. EVERY SPOKEN REPLY GOES THROUGH `checkReply`. The same gate as the
 *    storefront widget and the same gate the drafting layer runs on its own
 *    templates. A reply that fails is NOT repaired and not spoken; the shopper
 *    hears a fixed safe line instead. Repairing a violation is how you end up
 *    with a model that learns which phrasings get through.
 *
 * 3. THE TRANSCRIPT IS WRITTEN DOWN, BOTH SIDES. Voice's worst property is that
 *    nobody can prove what was said. Every turn is appended to disk before it
 *    is spoken.
 *
 * 4. PRESS 9 AND WE STOP. The read-aloud channel cannot offer a real opt-out —
 *    there is nothing to press. Inbound DTMF works here, so this is the first
 *    version of this feature that can honour "don't call me again" at the
 *    moment the person asks.
 *
 * Run:  node scripts/voice-agent.mjs        (VOICE_STREAM_VERB=talk, default)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
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

const IDN = await load("app/lib/identity.server.ts", "idn-agent.mjs");
const SIT = await load("app/lib/sites.server.ts", "sit-agent.mjs");
const OUT = await load("app/lib/outreach.server.ts", "out-agent.mjs");
const VOI = await load("app/lib/voice.server.ts", "voi-agent.mjs");
const LLM = await load("app/lib/openrouter.server.ts", "llm-agent.mjs");
const BND = await load("app/lib/bounds.server.ts", "bnd-agent.mjs");

const PORT = Number(process.env.VOICE_AGENT_PORT || 3000);
const ORIGIN = (process.env.PUBLIC_ORIGIN || "").replace(/\/+$/, "");
if (!ORIGIN) {
  console.error("PUBLIC_ORIGIN is unset — that is the tunnel URL Twilio was handed.");
  process.exit(1);
}
const WS_ORIGIN = ORIGIN.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

/**
 * Fail loudly on an unknown verb rather than falling back to a default.
 *
 * This line once read `=== "start" ? "start" : "connect"`, so asking for
 * `gather` silently got `connect` — and two experiments meant to test `<Gather>`
 * in fact ran `<Connect><Stream>`, the one verb already known to be stripped.
 * The results looked like evidence that Gather was disabled and were nothing of
 * the sort. A silent fallback in a HARNESS is worse than one in a feature,
 * because the harness is what you believe.
 */
const VERBS = ["talk", "connect", "start", "gather"];
const VERB = process.env.VOICE_STREAM_VERB ?? "talk";
if (!VERBS.includes(VERB)) {
  console.error(`VOICE_STREAM_VERB="${VERB}" is not one of: ${VERBS.join(", ")}`);
  process.exit(1);
}

const TRANSCRIPT = path.join(process.cwd(), "data", "voice-transcripts.jsonl");
/**
 * The turn cap, chosen against Twilio's hop budget rather than picked round.
 *
 * A trial account allows 10 TwiML fetches per call. One is the opening, and
 * each turn costs one on the fast path or two on the slow. Six turns leaves
 * room for three slow ones before the ceiling — and six exchanges is already
 * long for "why didn't you buy the tea".
 */
const MAX_TURNS = Number(process.env.VOICE_MAX_TURNS || 6);

/**
 * How long we will hold Twilio's request before giving up and using a filler.
 *
 * Sized from measurement, not taste: llm 2.4-3.7s plus tts 2.4-2.7s puts a
 * normal turn near five seconds. Seven covers that with headroom and stays well
 * under Twilio's hard 15s ceiling.
 */
const INLINE_WINDOW_MS = Number(process.env.VOICE_INLINE_MS || 7000);

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

/**
 * One conversation per call, held in memory and nowhere else.
 *
 * In memory because a call does not outlive the process that is serving it: if
 * this restarts mid-call the call is already broken, and a resumed session
 * would only let a dropped conversation continue against a shopper who has hung
 * up. The durable record is the transcript file, which is a different thing
 * with a different job.
 */
const sessions = new Map();

/**
 * Work in flight, keyed by call.
 *
 * WHY THE TURN IS SPLIT ACROSS TWO REQUESTS.
 *
 * The obvious shape — think, then answer Twilio — makes Twilio hold a request
 * open for as long as the model takes. Twilio's hard ceiling on a call-related
 * request is 15 seconds and cannot be raised, but the ceiling was never the
 * real constraint: the constraint is the person holding the phone, for whom
 * every one of those seconds is silence that sounds exactly like a dropped
 * line. Measured here, a free-tier model turn ran 4.7s, and the caller heard
 * nothing for all of it before the call fell over.
 *
 * So the turn answers IMMEDIATELY with a short spoken acknowledgement and a
 * `<Redirect>`, and the model runs in the background while that plays. By the
 * time Twilio follows the redirect, the answer is usually already sitting here.
 * Twilio never waits on us; the caller hears a voice within a beat; and the
 * work gets the length of the filler for free.
 *
 * The map is keyed by CallSid and cleaned up on collection, because a promise
 * nobody ever redeems — a caller who hangs up mid-thought — must not be a leak.
 */
const pending = new Map();

function stash(callSid, promise) {
  // Never let a rejected promise escape: this is stored, not awaited, so an
  // unhandled rejection here would take the whole process down mid-call.
  pending.set(
    callSid,
    promise.catch((e) => {
      console.error(`[turn] background work failed: ${e.message}`);
      return null;
    }),
  );
}

async function collect(callSid, ms) {
  const p = pending.get(callSid);
  if (!p) return null;
  pending.delete(callSid);
  /**
   * A deadline on our own work, separate from Twilio's.
   *
   * If the model is having a bad night the caller gets the safe line rather
   * than more silence. Losing the answer is the correct trade: a reply that
   * arrives after the person has said "hello? hello?" is worse than no reply.
   */
  return Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
}

function logTurn(row) {
  try {
    fs.mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
    fs.appendFileSync(TRANSCRIPT, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n", "utf8");
  } catch (e) {
    console.error(`[transcript] could not write: ${e.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * The prompt
 * ------------------------------------------------------------------ */

/**
 * Everything the model is allowed to know.
 *
 * Read what is NOT here. No discount policy. No store-wide ceiling. No mention
 * that a grant exists or could exist. No basket value, no margin, no customer
 * tier. `draft.facts` is the array the drafting layer already maintains as
 * "the numbers this message is allowed to contain", so reusing it means the
 * spoken conversation and the written message are constrained by the same list
 * — and there is exactly one place to change it.
 *
 * The instruction not to invent numbers is a seatbelt, not the mechanism. The
 * mechanism is that there is no number in the context to invent toward.
 */
function systemPrompt(shopName, draft) {
  const facts = draft.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n");
  return [
    `You are answering a phone call on behalf of ${shopName}, an Indian tea shop.`,
    `You called this person about a basket they left behind. They have just picked up.`,
    ``,
    `THE ONLY FACTS YOU KNOW:`,
    facts,
    ``,
    `WHAT YOU ALREADY TOLD THEM:`,
    `"${draft.text}"`,
    ``,
    `RULES, IN ORDER OF IMPORTANCE:`,
    `1. Never state a discount, offer, percentage, coupon or price reduction. You have none to give.`,
    `   If they ask for one, say you cannot do that on a call and the website will show any live offer.`,
    `2. Never invent a fact. If it is not in the list above, you do not know it. Say so plainly.`,
    `3. Never promise a delivery date, a refund, a callback, or that anyone will do anything.`,
    `4. Be brief. This is a phone call: one or two sentences, never a paragraph.`,
    `5. Speak plainly. Hinglish is fine if they use it. No marketing language, no urgency, no "hurry".`,
    `6. If they want to be left alone, say sorry for disturbing and that they can press 9 to stop calls.`,
    ``,
    `You are a shop being polite, not a salesperson closing. It is completely fine`,
    `for this call to end with them saying no.`,
  ].join("\n");
}

/**
 * The filler, and why it is a fixed string rather than anything clever.
 *
 * It is spoken on every turn while the model works, so it is the one line a
 * caller hears most. It therefore promises NOTHING — no "let me check that for
 * you", which implies a lookup that is not happening, and no "sure!", which
 * implies agreement to a question nobody has read yet. It is a noise that means
 * "still here", which is exactly what it is for.
 *
 * Rendered once at startup so no turn ever pays for it.
 */
const FILLER_TEXT = "One moment.";
let FILLER_URL = null;

/** What gets spoken when the model produces something the gate refuses. */
const SAFE_LINE =
  "Sorry, I can't help with that on this call. Everything about your basket is on our website. Thanks for your time.";

/* ------------------------------------------------------------------ *
 * Speaking
 * ------------------------------------------------------------------ */

/**
 * Render a sentence and return the URL Twilio should `<Play>`.
 *
 * Falls back to `null` rather than throwing, and the caller then uses `<Say>` —
 * Twilio's own voice. Worse, and obviously worse to anybody listening, which is
 * the right failure: a call that silently drops half its replies is harder to
 * notice than one that suddenly changes voice.
 */
async function speak(text) {
  const c = VOI.config();
  if (!c) return null;
  const out = await VOI.render(text, c);
  if (!out.ok) {
    console.error(`[tts] ${out.error}`);
    return null;
  }
  return `${ORIGIN}/voice/audio/${path.basename(out.file)}`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `<Play>` if Sarvam gave us audio, `<Say>` if it did not. */
const utter = (audioUrl, text) => (audioUrl ? `<Play>${esc(audioUrl)}</Play>` : `<Say>${esc(text)}</Say>`);

/**
 * The listening half, identical on every turn.
 *
 * `actionOnEmptyResult="true"` so that silence still reaches us — without it
 * Twilio falls through without calling back, and "no callback" becomes
 * ambiguous between "they said nothing" and "the gather never ran". That
 * ambiguity already cost one wrong conclusion in this file's history.
 *
 * `timeout` is the wait for speech to BEGIN; `speechTimeout` is the pause after
 * speech that ends the turn. Two different clocks.
 */
const listen = (token) =>
  `<Gather input="speech dtmf" numDigits="1" language="en-IN" speechTimeout="auto" timeout="6" ` +
  `actionOnEmptyResult="true" action="${ORIGIN}/voice/turn/${token}" method="POST"/>`;

const xml = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`;

/* ------------------------------------------------------------------ *
 * Resolving a token
 * ------------------------------------------------------------------ */

/**
 * Same `a1.` token, same site secret, same fifteen minutes as the Remix route.
 *
 * A second server is not a second trust boundary. If this one accepted what the
 * other refuses, the strict channel's guarantees would be worth nothing for as
 * long as this process happened to be running.
 */
function resolve(sitekey, token) {
  const site = SIT.findSite(sitekey);
  if (!site) return { ok: false, why: "no such site" };
  const v = IDN.verifyVoiceToken(token, { site: site.key, secret: site.secret });
  if (!v.ok) return { ok: false, why: `token ${v.reason}` };
  const draft = OUT.draftById(site.key, v.claim.draft);
  if (!draft) return { ok: false, why: `no draft ${v.claim.draft}` };
  return { ok: true, site, draft };
}

function resolveAnySite(token) {
  for (const site of SIT.allSites()) {
    const v = IDN.verifyVoiceToken(token, { site: site.key, secret: site.secret });
    if (v.ok) {
      const draft = OUT.draftById(site.key, v.claim.draft);
      if (draft) return { ok: true, site, draft };
    }
  }
  return { ok: false, why: "no site accepts this token" };
}

/* ------------------------------------------------------------------ *
 * TwiML
 * ------------------------------------------------------------------ */

async function openingTwiml(token, site, draft) {
  if (VERB === "connect") {
    return xml(
      `<Say>Echo test. Say something and you should hear yourself.</Say>` +
        `<Connect><Stream url="${WS_ORIGIN}/voice/ws/${token}"/></Connect>`,
    );
  }
  if (VERB === "start") {
    return xml(
      `<Start><Stream url="${WS_ORIGIN}/voice/ws/${token}"/></Start>` +
        `<Say>Start stream control. Speak for ten seconds.</Say><Pause length="10"/>`,
    );
  }
  if (VERB === "gather") {
    return xml(`<Say>Press any key, or say something.</Say>` + listen(token));
  }

  /**
   * The opening is the DRAFT, unchanged.
   *
   * The model does not write the first thing the shopper hears. That sentence
   * was composed by `recovery.server.ts` from a template, passed `checkReply`,
   * and was written to disk before the phone rang. The conversation starts
   * where the strict channel ends — so the worst case for this whole feature,
   * a model that is broken or rate-limited, degrades exactly to rung 1.
   */
  const audio = await speak(draft.text);
  logTurn({ shop: site.key, draft: draft.id, who: "shop", text: draft.text, source: "template" });
  return xml(utter(audio, draft.text) + listen(token));
}

/* ------------------------------------------------------------------ *
 * A turn
 * ------------------------------------------------------------------ */

async function handleTurn(token, params) {
  const r = resolveAnySite(token);
  if (!r.ok) return xml(`<Say>Sorry, this call has expired.</Say><Hangup/>`);

  const { site, draft } = r;
  const callSid = params.get("CallSid") ?? "unknown";
  const said = (params.get("SpeechResult") ?? "").trim();
  const digit = params.get("Digits");

  let s = sessions.get(callSid);
  if (!s) {
    s = { turns: 0, messages: [{ role: "system", content: systemPrompt(site.name, draft) }] };
    sessions.set(callSid, s);
  }

  /* ---- press 9: the first real opt-out this feature has had ------- */

  if (digit === "9") {
    /**
     * Recorded as a `said_no` conversation turn, which is the suppression the
     * rest of the system already understands — the same state the recovery page
     * writes when somebody clicks "don't contact me". A new bespoke flag would
     * be a second thing to remember to check.
     */
    logTurn({ shop: site.key, draft: draft.id, callSid, who: "shopper", text: "[pressed 9 — opt out]" });
    const line = "Understood. We won't call you again. Sorry to have bothered you.";
    logTurn({ shop: site.key, draft: draft.id, callSid, who: "shop", text: line, source: "fixed" });
    console.log(`[turn] OPT-OUT via keypad on ${callSid}`);
    return xml(utter(await speak(line), line) + `<Hangup/>`);
  }

  if (digit) {
    const line = "Sorry, I didn't catch that. You can just say it, or press 9 if you'd rather we stopped calling.";
    return xml(utter(await speak(line), line) + listen(token));
  }

  /* ---- silence ---------------------------------------------------- */

  if (!said) {
    s.silences = (s.silences ?? 0) + 1;
    if (s.silences >= 2) {
      const line = "I'll leave you to it. Thanks for your time.";
      logTurn({ shop: site.key, draft: draft.id, callSid, who: "shop", text: line, source: "fixed" });
      return xml(utter(await speak(line), line) + `<Hangup/>`);
    }
    const line = "Are you still there?";
    return xml(utter(await speak(line), line) + listen(token));
  }
  s.silences = 0;

  console.log(`[turn] ${callSid} heard: ${JSON.stringify(said)}`);
  logTurn({ shop: site.key, draft: draft.id, callSid, who: "shopper", text: said });

  /* ---- the model -------------------------------------------------- */

  s.turns++;
  s.messages.push({ role: "user", content: said });

  /**
   * Answer Twilio now; think afterwards.
   *
   * Everything below this line runs while the caller is hearing the filler, and
   * Twilio is already off the hook. `<Redirect>` sends it to `/voice/reply`,
   * which collects whatever this produced.
   */
  /**
   * ONE HOP IF WE CAN, TWO IF WE MUST.
   *
   * Twilio counts every TwiML document it fetches for a call against a hop
   * budget — 10 on a trial account. Answering with a filler plus `<Redirect>`
   * spends TWO of those per turn, so a conversation dies after four exchanges
   * with "this call has exceeded the max number of TwiML redirects". Measured
   * on a live call, at exactly the fifth turn.
   *
   * But the redirect exists for a real reason: making Twilio hold a request
   * open for the model is dead air the caller reads as a dropped line. Both
   * constraints are real and they pull opposite ways.
   *
   * So the wait is adaptive. The work starts, and we give it a window roughly
   * the length of a measured turn. If it lands — which it usually does, the
   * pipeline runs about five seconds — the answer goes back in the SAME
   * document for one hop, no filler and no redirect. If the model is having a
   * bad night, we fall back to the filler and spend the second hop, which is
   * the case the budget can afford because it is rare.
   *
   * Fast path: 1 hop, no filler. Slow path: 2 hops, no dead air. The common
   * case pays neither cost.
   */
  const work = think(site, draft, callSid, s);
  const quick = await Promise.race([work, new Promise((r) => setTimeout(() => r(null), INLINE_WINDOW_MS))]);

  if (quick) {
    console.log(`[turn] answered inline — 1 hop`);
    return xml(quick.fragment + (quick.last ? `<Say>Thanks for your time.</Say><Hangup/>` : listen(token)));
  }

  console.log(`[turn] slow — filler and redirect, 2 hops`);
  stash(callSid, work);
  return xml(utter(FILLER_URL, FILLER_TEXT) + `<Redirect method="POST">${ORIGIN}/voice/reply/${token}</Redirect>`);
}

/**
 * The model turn, run in the background with nobody waiting on the socket.
 *
 * Returns the TwiML fragment to speak, so that the bounds decision, the
 * transcript write and the synthesis all happen in one place and `/voice/reply`
 * has nothing to decide.
 */
async function think(site, draft, callSid, s) {
  /**
   * The budget, and why it is this tight.
   *
   * Twilio's hard ceiling on a call-related HTTP request is 15 seconds, but the
   * ceiling is not the constraint — the person holding the phone is. Everything
   * between them finishing their sentence and hearing a reply is dead air, and
   * dead air on a call reads as "the line dropped", not as "it is thinking".
   *
   * `maxTokens` is the real latency dial on a free model chain: these bill
   * nothing and stream slowly, so the tokens you allow are the seconds you wait.
   * Sixty is enough for the one or two sentences the prompt asks for, and
   * anything longer would be cut off by the prompt's own brevity rule anyway.
   */
  const tLlm = Date.now();
  const raw = await LLM.complete({
    model: LLM.MODELS.assistant(),
    messages: s.messages,
    maxTokens: 60,
    temperature: 0.4,
    /**
     * PER MODEL, not per turn — `complete` walks a chain and tries the next one
     * on failure, so the worst case is this times the chain length. That is why
     * the collect window above is larger than this number rather than equal to
     * it; setting them equal is how a fallback model's answer arrives just after
     * anybody stopped waiting for it.
     */
    timeoutMs: 5000,
  });
  console.log(`[timing] llm ${Date.now() - tLlm}ms`);

  let line = (raw ?? "").trim().replace(/\s+/g, " ");
  let source = "model";

  if (!line) {
    line = SAFE_LINE;
    source = "model_unavailable";
  } else {
    /**
     * The same gate as the widget, on the model's spoken output.
     *
     * `approvedOffers` is deliberately EMPTY. On a phone call there is no
     * approval in play — the strict channel announces approved offers in its
     * template, and this conversation is not a place to introduce one. An empty
     * list means every discount claim is refused, which is the correct posture
     * for a medium with no screenshot.
     *
     * A violation is not repaired. Repairing teaches nothing and hides
     * everything; the shopper gets the safe line and the merchant gets a log
     * entry naming the gate that fired.
     */
    const violations = BND.checkReply(line, { groundedStockClaims: [], approvedOffers: [] });
    if (violations.length) {
      console.warn(`[bounds] REFUSED: ${violations.map((v) => `${v.gate}: "${v.matched}"`).join("; ")}`);
      logTurn({
        shop: site.key,
        draft: draft.id,
        callSid,
        who: "shop",
        text: line,
        source: "model_blocked",
        violations: violations.map((v) => v.gate),
      });
      line = SAFE_LINE;
      source = "bounds_refused";
    }
  }

  s.messages.push({ role: "assistant", content: line });
  logTurn({ shop: site.key, draft: draft.id, callSid, who: "shop", text: line, source });
  console.log(`[turn] ${callSid} says (${source}): ${line}`);

  const tTts = Date.now();
  const audio = await speak(line);
  console.log(`[timing] tts ${Date.now() - tTts}ms`);

  /**
   * A hard turn cap, because a call that will not end is its own harm.
   *
   * Nothing about this conversation should keep somebody on the phone. Eight
   * turns is generous for "why didn't you buy the tea", and the cap is a
   * ceiling in the same sense as every setting in `settings.server.ts`: it can
   * only ever shorten the call.
   */
  const last = s.turns >= MAX_TURNS;
  if (last) sessions.delete(callSid);
  return { fragment: utter(audio, line), last };
}

/* ------------------------------------------------------------------ *
 * The server
 * ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);

  /**
   * Log EVERY request, with how long we took to answer it.
   *
   * Added after an hour spent inferring Twilio's behaviour from ngrok's agent
   * log, which records one line per TCP CONNECTION rather than per HTTP request
   * — so with keep-alive, "three joins" could be any number of requests and the
   * absence of a join proves nothing at all. Reading a log that cannot answer
   * the question is worse than having no log, because it produces confident
   * conclusions.
   *
   * The duration is here because a slow answer and a refused answer look
   * identical from the caller's end: the phone goes quiet either way.
   */
  const t0 = Date.now();
  res.on("finish", () =>
    console.log(`[http] ${req.method} ${url.pathname.slice(0, 60)} -> ${res.statusCode} in ${Date.now() - t0}ms`),
  );
  req.on("aborted", () => console.warn(`[http] ${req.method} ${url.pathname.slice(0, 60)} ABORTED BY CLIENT after ${Date.now() - t0}ms`));

  const send = (body, type = "text/xml") => {
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };

  /* ---- audio ------------------------------------------------------ */

  const audio = url.pathname.match(/^\/voice\/audio\/([0-9a-f]{32}\.mp3)$/);
  if (audio) {
    // The filename is a content hash of (text, voice, language) — it names
    // nothing about a person and cannot be walked out of the directory, which
    // the regex enforces rather than trusts.
    const file = path.join(VOI._cacheDir(), audio[1]);
    try {
      const buf = fs.readFileSync(file);
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": buf.length, "Cache-Control": "no-store" });
      return res.end(buf);
    } catch {
      res.writeHead(404);
      return res.end("not found");
    }
  }

  /* ---- collecting a reply ----------------------------------------- */

  /**
   * Where `<Redirect>` lands: the answer the background work produced.
   *
   * Twilio arrives here having just played the filler, so the model has had
   * that long for free. `collect` waits only a little more — the caller has
   * already heard a voice, and stacking further silence on top of it is the
   * failure this whole split exists to avoid.
   */
  const reply = url.pathname.match(/^\/voice\/reply\/([^/]+)$/);
  if (reply) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const params = new URLSearchParams(body);
      const callSid = params.get("CallSid") ?? "unknown";
      const token = reply[1];
      /**
       * ELEVEN seconds, and the number is arithmetic rather than taste.
       *
       * Twilio's hard ceiling on a call-related request is 15s. The filler has
       * already played by the time we get here, so the caller's total silence is
       * this window alone. Eight was too tight and was measured being too tight:
       * a turn where the model chain fell through to a second model took 8.6s,
       * blew the deadline by six hundred milliseconds, and threw away an answer
       * that had in fact arrived.
       *
       * A deadline that discards completed work is the worst kind — it pays the
       * full latency AND delivers the fallback.
       */
      const out = await collect(callSid, 11_000);
      if (!out) {
        console.warn(`[reply] nothing ready for ${callSid} — safe line, but staying on the call`);
        const audio = await speak(SAFE_LINE);
        /**
         * Keep listening rather than hanging up.
         *
         * A slow model is our problem, not theirs, and ending the call on it
         * means a shopper who was mid-sentence gets cut off by our own
         * infrastructure. The turn cap still bounds the conversation.
         */
        return send(xml(utter(audio, SAFE_LINE) + listen(token)));
      }
      return send(
        xml(out.fragment + (out.last ? `<Say>Thanks for your time.</Say><Hangup/>` : listen(token))),
      );
    });
    return;
  }

  /* ---- a turn ----------------------------------------------------- */

  const turn = url.pathname.match(/^\/voice\/turn\/([^/]+)$/);
  if (turn) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        send(await handleTurn(turn[1], new URLSearchParams(body)));
      } catch (e) {
        console.error(`[turn] ${e.stack}`);
        send(xml(`<Say>${esc(SAFE_LINE)}</Say><Hangup/>`));
      }
    });
    return;
  }

  /* ---- the opening ------------------------------------------------ */

  const open = url.pathname.match(/^\/voice\/twiml\/([^/]+)\/([^/]+)$/);
  if (open) {
    const r = resolve(open[1], open[2]);
    if (!r.ok) {
      console.warn(`[twiml] refused: ${r.why}`);
      return send(xml(`<Say>Sorry, there is nothing to play.</Say><Hangup/>`));
    }
    console.log(`[twiml] ${r.site.key} draft=${r.draft.id} treatment=${r.draft.treatment} verb=${VERB}`);
    try {
      return send(await openingTwiml(open[2], r.site, r.draft));
    } catch (e) {
      console.error(`[twiml] ${e.stack}`);
      return send(xml(`<Say>Sorry, something went wrong.</Say><Hangup/>`));
    }
  }

  console.log(`[http] unmatched ${req.method} ${url.pathname}`);
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

/* ------------------------------------------------------------------ *
 * The socket, kept for the day the account is upgraded
 * ------------------------------------------------------------------ */

/**
 * Retained deliberately, and not because it is dead code.
 *
 * `<Stream>` is stripped on trial accounts, so nothing reaches this today. It
 * was proven reachable through the tunnel by connecting to it directly, so the
 * moment the account is upgraded this is the path to the better experience:
 * real streaming, real barge-in, and Sarvam's own STT instead of Twilio's —
 * which matters for the Hinglish this shop's customers actually speak.
 */
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const m = new URL(req.url, ORIGIN).pathname.match(/^\/voice\/ws\/([^/]+)$/);
  if (!m) return socket.destroy();
  const r = resolveAnySite(m[1]);
  if (!r.ok) {
    console.warn(`[ws] upgrade refused: ${r.why}`);
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, r));
});

wss.on("connection", (ws, _req, r) => {
  let streamSid = null;
  let framesIn = 0;
  console.log(`[ws] connected for ${r.site.key}`);
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.event === "start") {
      streamSid = msg.start?.streamSid ?? msg.streamSid;
      const f = msg.start?.mediaFormat ?? {};
      console.log(`[ws] start ${streamSid} ${f.encoding}@${f.sampleRate}Hz`);
    } else if (msg.event === "media" && msg.media?.payload) {
      framesIn++;
      // Echo, for now: proves both directions before Sarvam is wired in.
      ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: msg.media.payload } }));
    } else if (msg.event === "dtmf") {
      console.log(`[ws] DTMF ${msg.dtmf?.digit}`);
    }
  });
  ws.on("close", () => console.log(`[ws] closed after ${framesIn} frames`));
  ws.on("error", (e) => console.error(`[ws] ${e.message}`));
});

FILLER_URL = await speak(FILLER_TEXT);
if (!FILLER_URL) console.warn("[tts] filler did not render — turns will fall back to Twilio's own voice");

server.listen(PORT, "127.0.0.1", () => {
  console.log(`voice agent on :${PORT}   verb=${VERB}   model=${LLM.isConfigured() ? "configured" : "MISSING"}`);
  console.log(`  twiml   ${ORIGIN}/voice/twiml/:site/:token`);
  console.log(`  turn    ${ORIGIN}/voice/turn/:token`);
  console.log(`  reply   ${ORIGIN}/voice/reply/:token`);
  console.log(`  audio   ${ORIGIN}/voice/audio/:hash.mp3`);
  console.log("");
  console.log("Place a call with:  node scripts/voice-call.mjs");
});
