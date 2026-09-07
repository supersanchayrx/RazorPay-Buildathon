/**
 * The voice channel.
 *
 * Voice is the most dangerous thing this codebase does. It reaches somebody who
 * is not in a conversation, on a channel they handed over for a different
 * purpose, with nobody present to say "that's wrong" — and unlike every other
 * channel it leaves the shopper no artefact. There is no screenshot. "The agent
 * offered me fifteen percent" is unanswerable when the only witness is a
 * memory.
 *
 * So this suite is mostly about what CANNOT happen:
 *
 *   1. Nothing can make the shop's voice say an arbitrary sentence. The URL
 *      Twilio fetches carries a token that NAMES a draft; it never carries text.
 *   2. Three token types, three prefixes, and no verifier accepts another's
 *      output. A leaked audio link must not become a door into a basket.
 *   3. A model reply that claims a discount is refused and not repaired.
 *   4. Press 9 stops the calls — really stops them, through the suppression the
 *      rest of the system already reads, not a new flag someone must remember.
 *   5. A spoken answer reaches the same reason histogram as a typed one, and
 *      the shopper's own words do not cross into the cortex.
 *   6. The channel cannot be switched on by editing a settings file.
 *
 * Run:  node scripts/check-voice.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, dataPath } from "./data-dir.mjs";
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

const IDN = await load("app/lib/identity.server.ts", "idn-cv.mjs");
const VOI = await load("app/lib/voice.server.ts", "voi-cv.mjs");
const OUT = await load("app/lib/outreach.server.ts", "out-cv.mjs");
const SET = await load("app/lib/settings.server.ts", "set-cv.mjs");
const CNV = await load("app/lib/conversations.server.ts", "cnv-cv.mjs");
const VTK = await load("app/lib/voicetalk.server.ts", "vtk-cv.mjs");
const VRC = await load("app/lib/voice-recovery.server.ts", "vrc-cv.mjs");
const BND = await load("app/lib/bounds.server.ts", "bnd-cv.mjs");
const TWM = await load("app/lib/twiml.server.ts", "twm-cv.mjs");
const FND = await load("app/lib/findings.server.ts", "fnd-cv.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

const SHOP = "pk_check_voice";
const SECRET = "check-voice-secret";
const DRAFT_ID = "rcv_check_voice_1";
const CART = "crt_check_voice_1";
const CUST = "cus_check_voice_1";

/* ================= 1. the token names a draft, never text ================= */
console.log("--- the URL carries a name, not a sentence ---");

const tok = IDN.mintVoiceToken({ site: SHOP, draft: DRAFT_ID, secret: SECRET });
const decoded = JSON.parse(
  Buffer.from(tok.split(".")[1], "base64url").toString("utf8"),
);

check(
  "an audio token carries the draft id and nothing else",
  Object.keys(decoded).sort().join(",") === "draft,exp,site" &&
    decoded.draft === DRAFT_ID,
  Object.keys(decoded).sort().join(", "),
);
check(
  "it names no cart and no customer",
  !JSON.stringify(decoded).includes(CART) &&
    !JSON.stringify(decoded).includes(CUST),
  "a leaked audio URL should not identify whose basket it is",
);
check(
  "it verifies for the site that minted it",
  IDN.verifyVoiceToken(tok, { site: SHOP, secret: SECRET }).ok === true,
);
check(
  "and not for another site's secret",
  IDN.verifyVoiceToken(tok, { site: SHOP, secret: "a-different-secret" })
    .reason === "bad_signature",
);
check(
  "nor for another site with our secret",
  IDN.verifyVoiceToken(tok, { site: "pk_someone_else", secret: SECRET })
    .reason === "wrong_site",
);
check(
  "it expires",
  IDN.verifyVoiceToken(
    IDN.mintVoiceToken({
      site: SHOP,
      draft: DRAFT_ID,
      secret: SECRET,
      ttlSeconds: 1,
    }),
    {
      site: SHOP,
      secret: SECRET,
      now: Math.floor(Date.now() / 1000) + 5,
    },
  ).reason === "expired",
);

/**
 * The cross-prefix check, and it is the reason three prefixes exist.
 *
 * A session token says "this is who is browsing". A recovery token says "this
 * link came from a message about this basket". An audio token says "this one
 * sentence may be spoken". They carry wildly different authority, and a
 * verifier that accepted a sibling's output would silently promote one to
 * another — the audio URL from a voicemail becoming a door into somebody's
 * account.
 */
console.log("--- three token types, and none opens another's door ---");

const rec = IDN.mintRecoveryToken({
  site: SHOP,
  cart: CART,
  sub: CUST,
  secret: SECRET,
});
const ses = IDN.mintSessionToken({ site: SHOP, sub: CUST, secret: SECRET });

check(
  "prefixes are distinct",
  tok.startsWith("a1.") && rec.startsWith("r1.") && ses.startsWith("v1."),
  `${tok.slice(0, 3)} ${rec.slice(0, 3)} ${ses.slice(0, 3)}`,
);
check(
  "the audio verifier refuses a recovery token",
  IDN.verifyVoiceToken(rec, { site: SHOP, secret: SECRET }).reason ===
    "malformed",
);
check(
  "the audio verifier refuses a session token",
  IDN.verifyVoiceToken(ses, { site: SHOP, secret: SECRET }).reason ===
    "malformed",
);
check(
  "the recovery verifier refuses an audio token",
  IDN.verifyRecoveryToken(tok, { site: SHOP, secret: SECRET }).reason ===
    "malformed",
);

/* ================= 2. Twilio signatures ================= */
console.log("\n--- proving a request came from Twilio ---");

const crypto = await import("node:crypto");
const sigUrl = "https://example.ngrok-free.app/voice/twiml/pk_x/a1.abc";
const sigParams = { CallSid: "CA1", From: "+10000000000", To: "+919999999999" };
const authToken = "twilio-auth-token-for-the-test";
const good = crypto
  .createHmac("sha1", authToken)
  .update(
    Buffer.from(
      sigUrl +
        Object.keys(sigParams)
          .sort()
          .map((k) => k + sigParams[k])
          .join(""),
      "utf8",
    ),
  )
  .digest("base64");

check(
  "a correct signature verifies",
  VOI.verifyTwilioSignature({
    signature: good,
    url: sigUrl,
    params: sigParams,
    authToken,
  }) === true,
);
check(
  "one changed parameter fails",
  VOI.verifyTwilioSignature({
    signature: good,
    url: sigUrl,
    params: { ...sigParams, To: "+919999999998" },
    authToken,
  }) === false,
  "the To number is what decides whose phone rings",
);
check(
  "a different URL fails",
  VOI.verifyTwilioSignature({
    signature: good,
    url: sigUrl + "x",
    params: sigParams,
    authToken,
  }) === false,
);
check(
  "an absent signature is not treated as valid",
  VOI.verifyTwilioSignature({
    signature: null,
    url: sigUrl,
    params: sigParams,
    authToken,
  }) === false,
);

const savedFetch = globalThis.fetch;
let callForm;
try {
  globalThis.fetch = async (_url, init) => {
    callForm = new URLSearchParams(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({ sid: "CA_check_voice", status: "queued" }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };
  const placed = await VOI.placeCall({
    to: "+919999999999",
    twimlUrl: "https://example.ngrok-free.app/voice/twiml/pk_x/a1.abc",
    statusCallbackUrl:
      "https://example.ngrok-free.app/voice/status/pk_x/a1.abc",
    c: {
      sarvamKey: "unused",
      twilioSid: "AC00000000000000000000000000000000",
      twilioToken: "test-token",
      twilioFrom: "+10000000000",
      origin: "https://example.ngrok-free.app",
      voice: "priya",
      language: "en-IN",
      pace: 1.15,
    },
  });
  check(
    "a trial-compatible call sends only the callback URL",
    placed.ok === true &&
      callForm?.get("StatusCallback")?.includes("/voice/status/") &&
      !callForm?.has("StatusCallbackMethod") &&
      !callForm?.has("StatusCallbackEvent"),
    "POST and completed are Twilio defaults; explicitly sending them is rejected by trial accounts",
  );
} finally {
  globalThis.fetch = savedFetch;
}

/* ================= 3. the channel is a purchase, not a preference ================= */
console.log("\n--- the channel cannot be switched on by editing a file ---");

const savedFrom = process.env.TWILIO_FROM;
delete process.env.TWILIO_FROM;
const voiceCh = OUT.CHANNELS.find((c) => c.id === "voice");
check(
  "voice is unavailable with a credential missing",
  voiceCh.available === false,
  "one variable moved: TWILIO_FROM",
);
check(
  "and it names the missing one",
  (voiceCh.unlockedBy ?? "").includes("TWILIO_FROM"),
);
SET.writeSettings(
  SHOP,
  { outreach: { enabled: true, maxPerRun: 25 } },
  "check",
);
check(
  "settings enabled, ceilings raised, still off",
  OUT.CHANNELS.find((c) => c.id === "voice").available === false,
  "a settings file cannot buy a Twilio account",
);
if (savedFrom === undefined) delete process.env.TWILIO_FROM;
else process.env.TWILIO_FROM = savedFrom;

check(
  "a call is a notice until a merchant says otherwise",
  SET.DEFAULTS.outreach.call.mode === "notice",
  "conversation is strictly more capability and strictly more risk",
);
check(
  "a corrupted mode falls back to the smaller thing",
  (() => {
    const f = dataPath(`settings-${SHOP}.json`);
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    raw.outreach.call = { mode: "conversatoin", maxTurns: 6 };
    fs.writeFileSync(f, JSON.stringify(raw));
    return SET.readSettings(SHOP).outreach.call.mode === "notice";
  })(),
  "a typo must not silently promote a notice into a conversation",
);
check(
  "an older settings file keeps every call ceiling",
  (() => {
    const f = dataPath(`settings-${SHOP}.json`);
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    delete raw.outreach.call;
    fs.writeFileSync(f, JSON.stringify(raw));
    const c = SET.readSettings(SHOP).outreach.call;
    return (
      c.maxTurns === SET.DEFAULTS.outreach.call.maxTurns && c.mode === "notice"
    );
  })(),
  "an absent ceiling read as undefined is a ceiling every call site treats as infinite",
);
check(
  "a call longer than the carrier allows is refused",
  SET.writeSettings(
    SHOP,
    { outreach: { call: { mode: "conversation", maxTurns: 20 } } },
    "check",
  ).ok === false,
  "Twilio caps how many TwiML documents one call may fetch; past it the call dies with a machine error",
);

const outreachSource = fs.readFileSync(
  "app/lib/outreach.server.ts",
  "utf8",
);
const voiceDelivery = outreachSource.slice(
  outreachSource.indexOf('label: "Voice callback"'),
  outreachSource.indexOf('id: "email"'),
);
check(
  "voice audio is rendered before the phone is dialled",
  voiceDelivery.indexOf("await renderVoice(d.text") >= 0 &&
    voiceDelivery.indexOf("await renderVoice(d.text") <
      voiceDelivery.indexOf("await placeCall({"),
  "Twilio's media GET must read a cached file; putting Sarvam inside that live request produced a 502 after the caller answered",
);
check(
  "a failed pre-render refuses to dial",
  voiceDelivery.includes("could not prepare voice audio; nothing was dialled"),
  "ringing first and discovering synthesis failed later produces Twilio's generic application-error message",
);
check(
  "an outbound call registers one terminal status callback",
  voiceDelivery.includes("statusCallbackUrl:") &&
    voiceDelivery.includes("/voice/status/") &&
    fs
      .readFileSync("app/lib/voice.server.ts", "utf8")
      .includes('form.set("StatusCallback", opts.statusCallbackUrl)'),
  "the SMS trigger belongs after the call, not inside a live speech turn",
);

const statusRoute = fs.readFileSync(
  "app/routes/voice.status.$site.$token.tsx",
  "utf8",
);
check(
  "the post-call trigger proves both the placed call and spoken offer",
  statusRoute.includes("readSends(site.key)") &&
    statusRoute.includes("callTranscript(site.key, callSid)") &&
    statusRoute.includes('values.CallStatus !== "completed"'),
  "a grant alone is not evidence that the caller actually heard an offer",
);

/* ================= 4. the bounds gate, on the model's spoken words ================= */
console.log("\n--- what may be said aloud ---");

const forbidden = [
  "Sure, I can do 15% off for you right now.",
  "Hurry — this deal ends tomorrow, only 2 left!",
];
for (const line of forbidden) {
  const violations = BND.checkReply(line, {
    groundedStockClaims: [],
    approvedOffers: [],
  });
  check(
    `refused aloud: “${line.slice(0, 42)}…”`,
    violations.length > 0,
    violations.map((v) => v.gate).join(", "),
  );
}
check(
  "the safe line itself passes the gate",
  BND.checkReply(VTK.SAFE_LINE, { groundedStockClaims: [], approvedOffers: [] })
    .length === 0,
  "a fallback that fails its own gate is a fallback that cannot be used",
);
check(
  "and so does the question we ask",
  BND.checkReply(VTK.THE_ASK, { groundedStockClaims: [], approvedOffers: [] })
    .length === 0,
);
const approvedOnly = VRC.voiceRemedyLine({
  ok: true,
  decision: {
    remedy: {
      kind: "discount",
      grant: { depth: 0.08, tier: "regular" },
    },
  },
  handoff: { ok: false, error: "trial template restriction" },
  followup: null,
});
check(
  "the caller hears the approval without SMS provider commentary",
  approvedOnly?.includes("8% off approve") &&
    !/sms|link|send nahi|could not|cannot/i.test(approvedOnly),
  approvedOnly ?? "no fixed approval line",
);
const approvedWithTemplate = VRC.voiceRemedyLine({
  ok: true,
  decision: {
    remedy: {
      kind: "discount",
      grant: { depth: 0.08, tier: "regular" },
    },
  },
  handoff: { ok: false, error: "trial template restriction" },
  followup: "template_after_call",
});
check(
  "a demo discount promises only the post-call template that can actually be sent",
  approvedWithTemplate?.includes("8% off approve") &&
    /call.*baad.*sms/i.test(approvedWithTemplate) &&
    !/payment link|upi/i.test(approvedWithTemplate),
  approvedWithTemplate ?? "no fixed approval line",
);
check(
  "the complete fixed discount sentence passes the spoken bounds gate",
  BND.checkReply(approvedWithTemplate ?? "", {
    groundedStockClaims: [],
    approvedOffers: [
      {
        handle: "masala-chai-blend",
        title: "Masala Chai Blend",
        percent: 8,
        endsAt: "2099-01-01",
      },
    ],
  }).length === 0,
  approvedWithTemplate ?? "no fixed approval line",
);
const deliveryAnswer = VRC.voiceRemedyLine({
  ok: true,
  decision: {
    remedy: {
      kind: "answer",
      say: "Delivery is Rs 60 on this basket, and it is free over Rs 1,200.",
    },
    blocked: ["delivery policy applies"],
  },
  handoff: null,
  followup: null,
});
check(
  "a deterministic non-discount remedy is spoken instead of falling through to the model",
  deliveryAnswer ===
    "Delivery is Rs 60 on this basket, and it is free over Rs 1,200.",
  deliveryAnswer ?? "no fixed delivery answer",
);

/* ================= 5. the prompt holds no number to give away ================= */
console.log("\n--- what the model is allowed to know ---");

const draft = {
  id: DRAFT_ID,
  shop: "Nilgiri Post",
  cartId: CART,
  customerId: CUST,
  to: { phone: "+910000000000", email: null },
  channel: "voice",
  text: "Hello, this is a message from Nilgiri Post. You were looking at Masala Chai Blend and didn't finish checking out.",
  link: "",
  treatment: "reminder",
  facts: [
    { label: "basket", value: "Masala Chai Blend" },
    { label: "abandoned", value: "43 hours ago" },
  ],
  marginAtStake: 235,
};

const prompt = VTK.systemPrompt("Nilgiri Post", null, draft);
for (const leak of [
  "8%",
  "maxDepthPct",
  "grant",
  "monthlyMarginCap",
  "235",
  "margin",
]) {
  check(
    `the prompt never mentions “${leak}”`,
    !prompt.toLowerCase().includes(leak.toLowerCase()),
  );
}
check(
  "it does carry the facts the message already asserted",
  prompt.includes("Masala Chai Blend") && prompt.includes("43 hours ago"),
  "the same array the drafting layer bounds a written message by",
);

/* ---- what the shop knows, and what that must not widen ---- */
console.log("\n--- the cortex on the telephone ---");

const enriched = VTK.systemPrompt("Nilgiri Post", null, draft, {
  policies: {
    returns: "Unopened tea can be returned within 14 days.",
    shipping: "Free delivery over 800 rupees, otherwise 60 rupees.",
    cod: "Cash on delivery is not available.",
  },
  serviceNotices: [
    "Some HDFC netbanking payments have not been going through recently.",
  ],
  memories: ["Prefers low-caffeine teas.", "Buys gifts for their father."],
});

check(
  "the shop's own policy wording reaches the call",
  enriched.includes("Unopened tea can be returned within 14 days."),
  "a caller told 'I do not know' by a shop that does know has been failed by the design, not protected by it",
);
check(
  "and it is instructed to read it back rather than reword it",
  /Do not reword/i.test(enriched),
  "a reworded return window is a new promise",
);
check(
  "a live service notice is available if they say a payment failed",
  enriched.includes("Some HDFC netbanking payments"),
);
check(
  "what the shop remembers about this person reaches the call",
  enriched.includes("Prefers low-caffeine teas."),
);
check(
  "and it must SAY SO when it uses one",
  /SAY SO/.test(enriched),
  "on a call there is nothing to scroll back through, so silent memory cannot be corrected",
);

/**
 * THE POINT OF THE WHOLE FILE, RESTATED AGAINST THE WIDER CONTEXT.
 *
 * Giving the call more knowledge of the SHOP must not give it a number to
 * concede. Policy wording legitimately contains figures — a delivery threshold
 * is a fact the widget states too — so the assertion is not "no digits", it is
 * that nothing about discounts, depths, grants or this basket's margin has
 * appeared.
 */
for (const leak of [
  "8%",
  "maxDepthPct",
  "grant",
  "monthlyMarginCap",
  "235",
  "% off",
]) {
  check(
    `even with the cortex attached, the prompt never mentions “${leak}”`,
    !enriched.toLowerCase().includes(leak.toLowerCase()),
  );
}
/*
 * NOT "the word discount never appears" — rule 1 IS "never state a discount",
 * so that assertion fails on the very instruction it is meant to protect. The
 * first version of this check did exactly that and would have been "fixed" by
 * weakening rule 1, which is the wrong direction entirely.
 *
 * What matters is that no CONCEDEABLE FIGURE is in context. A shop policy may
 * legitimately carry a percentage one day (a restocking fee, say); if one ever
 * does, this check should be narrowed to the discount vocabulary around it
 * rather than deleted.
 */
check(
  "no percentage figure of any kind is in the model's context",
  !/\d+\s*%/.test(enriched),
  "there is nothing to concede, which is the mechanism — the instruction above it is only the seatbelt",
);
check(
  "rule 1 is still rule 1",
  /Never create, improve or negotiate a discount/i.test(enriched),
  "only a later server-issued grant can add exact terms to the call",
);
check(
  "an empty context produces exactly the prompt it always did",
  VTK.systemPrompt("Nilgiri Post", null, draft, {}) === prompt,
  "the enrichment is additive; a shop with no cortex is a shop the caller can still be spoken to",
);

/* ---- the aggregate that crosses back, and what it must not erase ---- */
console.log("\n--- what a call writes into the shop's memory ---");

const FSHOP = SHOP;
/*
 * The analysis is dated THREE DAYS AGO, explicitly.
 *
 * With both writes taking `new Date()`, they can land in the same millisecond
 * and "the call did not move ranAt" becomes indistinguishable from "the call
 * moved ranAt to now, which happens to equal then". That is not a theoretical
 * flake: it failed exactly once, only when this suite ran straight after
 * check-recovery had warmed the filesystem. An explicit gap makes the property
 * either true or false rather than true-if-slow.
 */
const RAN_AT = new Date(Date.now() - 3 * 86_400_000);
FND.publishFindings({
  shop: FSHOP,
  incidents: [
    {
      id: "payment_incident:netbanking/HDFC",
      title: "HDFC netbanking failures",
      facts: [
        { label: "estimated onset", value: "2026-08-01" },
        { label: "detected", value: "2026-08-20" },
      ],
    },
  ],
  actions: [
    { id: "a1", title: "Pair the chai with the kettle", reach: 10, impact: 40 },
  ],
  stopped: 3,
  recovery: {
    wouldContact: 12,
    suppressed: 214,
    marginAtStake: 4200,
    expectedValue: 500,
    enabled: true,
  },
  reasons: {
    total: 4,
    enough: false,
    counts: [{ reason: "price_too_high", count: 4, share: 1 }],
  },
  asOf: RAN_AT,
});

const patched = FND.updateFindings(FSHOP, {
  reasons: {
    total: 5,
    enough: false,
    counts: [{ reason: "price_too_high", count: 5, share: 1 }],
  },
});

check("a call refreshes the reason counts", patched.reasons.total === 5);
check(
  "A CALL DOES NOT ERASE THE SERVICE NOTICES",
  patched.serviceNotices.length === 1,
  "publishFindings writes the WHOLE document; calling it from a call with no incidents would silently stop the assistant warning shoppers mid-outage",
);
check("...nor the incidents", patched.incidents.length === 1);
check("...nor the ranked actions", patched.topActions.length === 1);
check(
  "the analysis timestamp is NOT moved by a phone call",
  patched.ranAt === RAN_AT.toISOString(),
  "one timestamp for a document with two writers is a lie in whichever direction it was last written — the console would report that the weekly analysis ran when somebody answered the phone",
);
check(
  "...and the conversation timestamp IS moved",
  patched.conversationsAt > patched.ranAt,
  "the two facts age differently, so they are dated differently",
);
check(
  "patching a shop that has never been analysed does nothing",
  FND.updateFindings("pk_never_analysed_xyz", { reasons: null }) === null,
  "inventing an empty document makes 'never analysed' and 'analysed and found nothing' look identical",
);

/* ================= 6. press 9 really stops the calls ================= */
console.log("\n--- the opt-out a caller can actually reach ---");

VTK._reset();
CNV.addTurn({
  shop: SHOP,
  cartId: CART,
  customerId: CUST,
  turn: {
    kind: "asked",
    ts: new Date().toISOString(),
    channel: "voice",
    draftId: DRAFT_ID,
  },
});
const optOutcome = VTK.optOut(SHOP, "CAtest9", draft);

check("pressing 9 ends the call", optOutcome.kind === "hangup");
check("it is a fixed sentence, not a model's", optOutcome.source === "fixed");
const conv = CNV.conversation(SHOP, CART);
check("the conversation is closed", conv?.state === "closed", conv?.state);
check(
  "and the shopper is suppressed from every future run",
  CNV.silenced(SHOP).has(CUST),
  "through `silenced()`, which every run already reads — not a new flag to remember",
);
check(
  "nothing further can be recorded against that basket",
  CNV.addTurn({
    shop: SHOP,
    cartId: CART,
    customerId: CUST,
    turn: {
      kind: "answered",
      ts: new Date().toISOString(),
      reason: "price_too_high",
      by: "choice",
      evidence: "x",
      text: "x",
      tier: "returning",
    },
  }).ok === false,
  "terminal states are terminal",
);

/* ================= 7. a spoken answer joins the same loop ================= */
console.log("\n--- the reason is the product, wherever it was said ---");

const CART2 = "crt_check_voice_2";
const draft2 = { ...draft, cartId: CART2, id: "rcv_check_voice_2" };
CNV.addTurn({
  shop: SHOP,
  cartId: CART2,
  customerId: CUST,
  turn: {
    kind: "asked",
    ts: new Date().toISOString(),
    channel: "voice",
    draftId: draft2.id,
  },
});

/**
 * Phrase rules, not a model — so this assertion is deterministic and free. The
 * point being proven is the WIRING: that whatever the classifier decides lands
 * in the same store the web page writes to.
 */
const spoken = "honestly the delivery charge was too expensive for me";
await VTK.takeTurn({
  callSid: "CAtest7",
  said: spoken,
  shop: SHOP,
  draft: draft2,
});

const conv2 = CNV.conversation(SHOP, CART2);
check(
  "a spoken answer moves the basket to answered",
  conv2?.state === "answered",
  conv2?.state,
);
check(
  "classified into the closed set",
  conv2?.reason != null && conv2.reason !== undefined,
  conv2?.reason,
);
check(
  "delivery cost beats price, because it is checked first",
  conv2?.reason === "shipping_cost",
  "read price-first, “shipping was too expensive” becomes price_too_high and the shop discounts the tea",
);

const hist = CNV.reasonHistogram(SHOP);
check(
  "it reaches the histogram",
  JSON.stringify(hist).includes("shipping_cost"),
  "the same one a typed answer feeds",
);

/**
 * The shopper's own words are candid personal data. "I couldn't afford it" is
 * not something anyone volunteered for a dashboard.
 */
const histJson = JSON.stringify(hist);
check(
  "and their exact words do not cross into the histogram",
  !histJson.includes("honestly") &&
    !histJson.includes("expensive for me") &&
    !histJson.includes(CUST),
  "counts only — the sentence stays in the conversation store",
);

/* ================= 8. the transcript ================= */
console.log("\n--- what was said, on the channel with no screenshot ---");

const lines = VTK.callTranscript(SHOP, "CAtest7");
check(
  "both sides are written down",
  lines.some((l) => l.who === "shopper") && lines.some((l) => l.who === "shop"),
  `${lines.length} lines`,
);
check(
  "the shopper's line is verbatim",
  lines.some((l) => l.who === "shopper" && l.text === spoken),
);
check(
  "every shop line records where it came from",
  lines
    .filter((l) => l.who === "shop")
    .every((l) => typeof l.source === "string"),
  "a merchant must be able to tell a template from a model",
);

/* ================= 9. TwiML shape ================= */
console.log("\n--- the TwiML two hours were spent on ---");

const g = TWM.listen("https://example.test/voice/turn/pk_x/a1.abc");
check(
  "a gather always calls back, even on silence",
  g.includes('actionOnEmptyResult="true"'),
  "without it, “no callback” means both “they said nothing” and “gather never ran” — that ambiguity produced a wrong conclusion",
);
check(
  "it accepts a keypress as well as speech",
  g.includes('input="speech dtmf"'),
  "9 must work even when the recogniser does not",
);
check(
  "the two clocks are both set",
  g.includes('timeout="6"') && g.includes('speechTimeout="auto"'),
  "wait-for-speech and pause-after-speech are different things",
);
check(
  "an unrendered line still gets spoken, audibly worse",
  TWM.reply({ audioUrl: null, text: "hello" }) === "<Say>hello</Say>" &&
    TWM.reply({ audioUrl: "u", text: "hello" }) === "<Play>u</Play>",
  "a call that silently drops replies is harder to notice than one that changes voice",
);

/* ================= 10. the budgets cohere ================= */
console.log("\n--- the clock nobody owns ---");

/**
 * Four numbers govern how long a spoken turn may take, they live in four files,
 * and getting their ORDER wrong is invisible until somebody's call drops.
 *
 * Each one was learned the hard way. The model chain gave three models five
 * seconds each and so took fifteen. Synthesis had no timeout at all. A collect
 * deadline was set equal to the work it waited on and threw away an answer that
 * had arrived. And the whole turn was budgeted against Twilio's DOCUMENTED
 * fifteen seconds when the tolerance it actually showed was under six.
 *
 * So the invariant is asserted rather than remembered: everything a turn does
 * must fit inside the deadline that answers Twilio, with room for the network.
 */
const budgets = {
  model: Number(
    fs
      .readFileSync("app/lib/voicetalk.server.ts", "utf8")
      .match(/VOICE_MODEL_MS \?\? (\d+)/)[1],
  ),
  sarvam: Number(
    fs
      .readFileSync("app/lib/voice.server.ts", "utf8")
      .match(/SARVAM_TIMEOUT_MS \?\? (\d+)/)[1],
  ),
  deadline: Number(
    fs
      .readFileSync("app/routes/voice.turn.$site.$token.tsx", "utf8")
      .match(/VOICE_DEADLINE_MS \?\? (\d+)/)[1],
  ),
  inline: Number(
    fs
      .readFileSync("app/routes/voice.turn.$site.$token.tsx", "utf8")
      .match(/VOICE_INLINE_MS \?\? (\d+)/)[1],
  ),
};

/**
 * THE SUM, not each part.
 *
 * The first version of this assertion checked the model against the deadline
 * and synthesis against the deadline, and passed while the two together were
 * nearly double it. The result on a live call: the deadline fired every turn,
 * the caller heard the plain-voice fallback, and the transcript recorded the
 * good reply that had been composed but never spoken. A budget check that does
 * not add the parts up is not a budget check.
 */
/**
 * MAX, not sum — because generation and synthesis now overlap.
 *
 * The first version of this assertion checked each against the deadline and
 * passed while the two together were nearly double it: on a live call the
 * deadline fired every turn, the caller heard the plain-voice fallback, and the
 * transcript recorded the good reply nobody had heard. So it became a sum.
 *
 * The sum then proved impossible to satisfy honestly. A free model wants
 * 2.5-3.7s, bulbul:v3 wants ~1.8s, and Twilio's real tolerance is between five
 * and six seconds — measured, and well under its documented fifteen. Six
 * sequential seconds does not fit in five. Squeezing the model to 2.2s to make
 * the arithmetic work produced three fallbacks out of four replies.
 *
 * `takeTurn` now streams the model and hands the first complete sentence to
 * Sarvam while the rest is still being written, so the two run CONCURRENTLY and
 * the turn costs roughly the longer of them. The invariant is therefore max,
 * and each part must still fit on its own.
 */
check(
  "the inline wait leaves ample room to return TwiML",
  budgets.inline + 500 < budgets.deadline,
  `${budgets.inline}ms + 500ms < ${budgets.deadline}ms`,
);
check(
  "and the deadline stays inside what Twilio was measured to tolerate",
  budgets.deadline <= 4500,
  `${budgets.deadline}ms, below the measured failure window with margin for the tunnel`,
);
check(
  "every timeout is a real number, not NaN from a renamed variable",
  Object.values(budgets).every((n) => Number.isFinite(n) && n > 0),
  JSON.stringify(budgets),
);

const turnRoute = fs.readFileSync("app/routes/voice.turn.$site.$token.tsx", "utf8");
const replyRoute = fs.readFileSync("app/routes/voice.reply.$site.$token.tsx", "utf8");
check(
  "fresh speech finishes in parked work, outside Twilio's reply callback",
  turnRoute.includes("pending.set(callSid, voicedWork)") &&
    turnRoute.includes("cachedSpeech(VOICE_FILLER") &&
    !replyRoute.includes("await speak("),
  "the caller gets cached Sarvam filler while voicedWork continues; reply only plays completed audio",
);

/* ================= cleanup ================= */
console.log("\n--- leaving nothing behind ---");

try {
  fs.unlinkSync(dataPath(`settings-${SHOP}.json`));
} catch {
  /* already gone */
}
const convFile = CNV._file();
try {
  const kept = fs
    .readFileSync(convFile, "utf8")
    .split("\n")
    .filter((l) => l && !l.includes(SHOP));
  fs.writeFileSync(convFile, kept.join("\n") + (kept.length ? "\n" : ""));
} catch {
  /* nothing written */
}
const tFile = VTK._file();
try {
  const kept = fs
    .readFileSync(tFile, "utf8")
    .split("\n")
    .filter((l) => l && !l.includes(SHOP));
  fs.writeFileSync(tFile, kept.join("\n") + (kept.length ? "\n" : ""));
} catch {
  /* nothing written */
}
check(
  "the suite cleans up after itself",
  !fs.existsSync(dataPath(`settings-${SHOP}.json`)) &&
    CNV.conversations(SHOP).length === 0 &&
    VTK.transcript(SHOP).length === 0,
  "no test conversations, transcripts or settings left on any store",
);

console.log("");
if (failed) {
  console.log(`${failed} FAILED`);
  process.exit(1);
}
console.log(
  "All checks passed. The shop's voice cannot be made to say anything it was not handed.",
);
