/**
 * The merchant install, and the check that tells them it worked.
 *
 * WHY THIS SUITE EXISTS: this feature's failure mode is silence. A redirect rule
 * lost in a redeploy, a snippet pasted into the wrong file, a static profile
 * minted before payments were configured — none of them raise an error
 * anywhere. They look exactly like nobody shopping. Verify is the only thing
 * standing between a merchant and that, so Verify itself has to be right, and
 * "right" specifically means: it must FAIL when the install is broken.
 *
 * A green checkmark that is always green is worse than no checkmark, because
 * the merchant now has a reason to stop looking.
 *
 * So every case below is driven against a REAL HTTP server on localhost, doing
 * real fetches and real redirects, rather than a mocked fetch. The measurement
 * this whole design rests on — that a cross-origin redirect on the well-known
 * path is followed — was a measurement, and a suite that stubs the network
 * cannot inherit it.
 *
 * Run:  node scripts/check-agentfront.mjs
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
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

const AF = await load("app/lib/agentfront.server.ts", "agentfront-check.mjs");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

const agentFrontPage = fs.readFileSync(
  "app/routes/dashboard.agentfront.tsx",
  "utf8",
);
check(
  "Agent front uses the pinned public gateway origin for snippets and verification",
  agentFrontPage.includes('import { selfOrigin } from "../lib/origin.server"') &&
    agentFrontPage.includes("const base = selfOrigin(request)") &&
    agentFrontPage.includes("verifyInstall(site, selfOrigin(request), reachableOrigin)"),
  "opening the dashboard through localhost must not publish localhost to external agents",
);

/* ------------------------------------------------------------------ *
 * Two servers: the merchant's storefront, and this gateway
 * ------------------------------------------------------------------ */

const listen = (handler) =>
  new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve({ server: s, port: s.address().port }));
  });

// The gateway: answers tools/list, and serves the profile a redirect points at.
let GATEWAY_TOOLS = 14;
const gw = await listen((req, res) => {
  if (req.method === "POST") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { tools: Array.from({ length: GATEWAY_TOOLS }, (_, i) => ({ name: `t${i}` })) },
      }),
    );
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(profileDoc()));
});
const GW = `http://127.0.0.1:${gw.port}`;

// The merchant's storefront. `mode` is rewritten between cases, which is how a
// broken install is simulated without a second server per scenario.
let mode = "redirect";
const shop = await listen((req, res) => {
  if (!req.url.startsWith("/.well-known/ucp")) {
    res.writeHead(404).end();
    return;
  }
  if (mode === "missing") {
    res.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
    return;
  }
  if (mode === "redirect") {
    res.writeHead(302, { location: `${GW}/ucp/pk_check/profile` }).end();
    return;
  }
  if (mode === "redirect-wrong-store") {
    res.writeHead(302, { location: `${GW}/ucp/pk_somebody_else/profile` }).end();
    return;
  }
  if (mode === "static-stale") {
    // The exact silent failure a copied file has: minted before payments were
    // configured, so it advertises no handler and never will again.
    const doc = profileDoc();
    doc.ucp.payment_handlers = {};
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(doc));
    return;
  }
  if (mode === "garbage") {
    res.writeHead(200, { "content-type": "application/json" }).end("not json at all");
    return;
  }
  if (mode === "no-endpoint") {
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ ucp: { version: "2026-08-25", services: {}, payment_handlers: {} } }),
    );
    return;
  }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(profileDoc()));
});
const SHOP = `http://127.0.0.1:${shop.port}`;

const SITE = {
  key: "pk_check",
  name: "Check Store",
  origins: [],
  catalogFeedUrl: `${SHOP}/catalog.json`,
  greeting: "",
  accent: "#000",
  secret: "s",
  razorpay: { keyIdEnv: "K", keySecretEnv: "S", webhookSecretEnv: "W" },
};

// This suite verifies a profile whose checkout is genuinely configured. The
// values are test-only and are never sent to Razorpay here.
process.env.K = "rzp_test_check";
process.env.S = "check-secret";

// Built from the real discovery document so the fixture cannot drift away from
// what we actually serve — a fixture that has to be updated by hand is a
// fixture that will eventually be testing last month's shape.
const U = await load("app/lib/ucp.server.ts", "ucp-af.mjs");
function profileDoc() {
  return U.discoveryDocument({ ...SITE, origins: [SHOP] }, GW);
}

const site = (over = {}) => ({ ...SITE, origins: [SHOP], ...over });

/* ================= the generated install ================= */

const snips = AF.installSnippets(`${GW}/ucp/pk_check/profile`);
const redirects = snips.filter((s) => !s.proxies);
const vercel = redirects.find((s) => s.host === "Vercel");

check("every host gets a snippet", redirects.length >= 8, redirects.map((s) => s.host).join(", "));
check(
  "the Vercel rule is explicitly a mergeable property, not a replacement file",
  vercel?.where.includes("merge") &&
    vercel.body.trimStart().startsWith('"redirects":') &&
    !vercel.body.trimStart().startsWith("{"),
  "wrapping a second JSON object inside an existing vercel.json makes the deployment config invalid",
);

const tierC = AF.tierCSnippets(GW, "pk_check");
const vercelTierC = tierC.find((s) => s.host === "Vercel — no code");
check(
  "the Vercel llms.txt rule is a mergeable same-origin rewrite",
  vercelTierC?.where.includes("merge") &&
    vercelTierC.body.trimStart().startsWith('"rewrites":') &&
    vercelTierC.body.includes('"source": "/llms.txt"') &&
    vercelTierC.body.includes(`${GW}/ucp/pk_check/llms.txt`) &&
    !vercelTierC.body.trimStart().startsWith("{") &&
    !vercelTierC.body.includes('"permanent"'),
  "a rewrite keeps /llms.txt on the merchant origin and avoids a second nested vercel.json object",
);
check(
  "every snippet names the well-known path and our profile URL",
  snips.every((s) => s.body.includes("/.well-known/ucp") && s.body.includes(`${GW}/ucp/pk_check/profile`)),
  "a snippet missing either is a paste that silently installs nothing",
);
check(
  "the redirect snippets are one line, except where the format cannot be",
  redirects.filter((s) => s.body.split("\n").length === 1).length >= 6,
  "the claim on the page is 'one line'; a five-line snippet under that heading is the page lying",
);
check(
  "no snippet hardcodes a different store's key",
  !snips.some((s) => /pk_(?!check\b)[a-z0-9_]+/.test(s.body)),
  "a rule copied from another store's instructions sells that store's catalogue from this domain",
);
check(
  "the proxy alternative is still offered",
  snips.some((s) => s.proxies),
  "a merchant already running code may prefer the request to terminate on their own origin",
);

const H = (o) => new Headers(o);
check(
  "hosts are guessed from what the server says about itself",
  AF.guessHost(H({ "x-nf-request-id": "abc" })) === "Netlify" &&
    AF.guessHost(H({ "x-vercel-id": "abc" })) === "Vercel" &&
    AF.guessHost(H({ server: "nginx/1.24" })) === "nginx" &&
    AF.guessHost(H({ "x-powered-by": "Express" })) === "Express",
);
check(
  "an unrecognised server is null, not a guess",
  AF.guessHost(H({ server: "something-bespoke" })) === null,
  "a wrong guess has a merchant paste an nginx block into a Netlify config and conclude we are broken",
);

/* ================= Verify: it must go green when it works ================= */

mode = "redirect";
const ok = await AF.verifyInstall(site(), GW);
check("A REDIRECT INSTALL VERIFIES", ok.ok, ok.steps.map((s) => `${s.state} ${s.label}`).join(" | "));
check(
  "...and it is recognised as a redirect, not merely as 'responded'",
  ok.steps.some((s) => /302/.test(s.detail)),
  "the measurement this design rests on is that a cross-origin redirect here is followed",
);
check(
  "...and the tools/list call actually happened",
  ok.steps.some((s) => s.label.includes("lists its tools") && s.state === "pass"),
  "discovery that leads to an endpoint nobody called is discovery that proves nothing",
);

mode = "direct";
const direct = await AF.verifyInstall(site(), GW);
check("a proxied install verifies too", direct.ok, "both installs are supported; neither is guessed at");

/* ================= Verify: it must go red when it does not ================= */

mode = "missing";
const gone = await AF.verifyInstall(site(), GW);
check(
  "A MISSING RULE FAILS",
  !gone.ok && gone.steps.some((s) => s.state === "fail" && s.detail.includes("404")),
  "this is the common case — a rule lost in a redeploy — and it is invisible everywhere else",
);
check(
  "...and says what a 404 means to an agent",
  gone.steps.some((s) => (s.why ?? "").includes("does not sell online")),
  "'404' is not actionable; 'agents conclude you do not sell online' is",
);

mode = "garbage";
const bad = await AF.verifyInstall(site(), GW);
check("a path that answers with non-JSON fails", !bad.ok);

mode = "no-endpoint";
const empty = await AF.verifyInstall(site(), GW);
check(
  "a profile naming no shopping endpoint fails",
  !empty.ok,
  "discovery succeeded and led nowhere, which is the one failure an agent cannot work around",
);

mode = "redirect-wrong-store";
const wrong = await AF.verifyInstall(site(), GW);
check(
  "a redirect pointing at ANOTHER store fails",
  !wrong.ok,
  "a rule copied from another merchant's instructions would sell their catalogue from this domain, and every other step would pass",
);

/* ---- the silent one: a stale static file ---- */

mode = "static-stale";
const stale = await AF.verifyInstall(site(), GW);
const staleStep = stale.steps.find((s) => s.label.includes("payment handler"));
check(
  "A STATIC FILE MISSING THE PAYMENT HANDLER IS CAUGHT",
  staleStep?.state === "warn" && staleStep.detail.includes("in.razorpay.checkout"),
  "the file was minted before Razorpay was configured; agents escalate every checkout forever and nothing looks broken",
);
check(
  "...as a warning, not a failure",
  stale.ok,
  "the store genuinely does work — an agent can browse, cart and hand the buyer a link — so red would be an overstatement",
);
check(
  "...and the advice is to fix the file, not to advertise the handler anyway",
  /re-upload|switch to a redirect/i.test(staleStep?.why ?? ""),
  "advertising a handler the served document does not carry would be a lie told in JSON",
);

/* ---- the endpoint is reachable but broken ---- */

mode = "redirect";
GATEWAY_TOOLS = 0;
const noTools = await AF.verifyInstall(site(), GW);
check(
  "an endpoint that lists no tools fails",
  !noTools.ok,
  "an agent that gets that far has done everything right and can still do nothing",
);
GATEWAY_TOOLS = 14;

/* ================= what Verify will not do ================= */

const noOrigin = await AF.verifyInstall(site({ origins: [] }), GW);
check(
  "a store with no registered origin fails rather than probing nothing",
  !noOrigin.ok,
  "silently passing a store we never checked is the exact failure this button exists to prevent",
);

check(
  "http origins are flagged, and localhost is only a warning",
  (await AF.verifyInstall(site({ origins: [SHOP] }), GW)).steps.some(
    (s) => s.label.includes("HTTPS") && s.state === "warn",
  ),
  "the `ucp` CLI refuses a non-HTTPS business URL before making any request — in production that is fatal, in dev it is Tuesday",
);
check(
  "a public http origin is a failure, not a warning",
  (await AF.verifyInstall(site({ origins: ["http://shop.example"] }), GW)).steps.some(
    (s) => s.label.includes("HTTPS") && s.state === "fail",
  ),
  "a plain-HTTP store is invisible to a conforming client no matter how correct everything else is",
);

/* ================= the static file we hand out ================= */

const staticDoc = JSON.parse(AF.staticProfile(site(), GW));
check(
  "the generated file is the document we serve, not a second implementation",
  JSON.stringify(staticDoc) === JSON.stringify(U.discoveryDocument(site(), GW)),
  "two ways to build one document is two documents that will eventually disagree",
);
check(
  "the generated file carries the payment handler when payments are on",
  "in.razorpay.checkout" in staticDoc.ucp.payment_handlers,
);
check(
  "...and carries none when they are not",
  Object.keys(
    JSON.parse(AF.staticProfile(site({ razorpay: undefined }), GW)).ucp.payment_handlers,
  ).length === 0,
  "advertising a handler the merchant has not configured is the lie the whole file is at risk of",
);

const download = AF.staticProfileDownload(site(), GW);
check(
  "the self-hosted profile downloads as an extensionless JSON attachment",
  download.headers.get("content-type") === "application/json; charset=utf-8" &&
    download.headers.get("content-disposition") === 'attachment; filename="ucp"' &&
    download.headers.get("cache-control") === "private, no-store",
  "the browser should save ucp, not render or cache an ambiguously named document",
);
check(
  "the downloaded profile is the same generated discovery document",
  JSON.stringify(JSON.parse(await download.text())) === JSON.stringify(staticDoc),
  "download, preview and live profile must never become three implementations",
);
check(
  "the dashboard presents self-hosting as a first-class install method",
  agentFrontPage.includes('label="Host a generated file"') &&
    agentFrontPage.includes('label="Download ucp file"') &&
    agentFrontPage.includes("public/.well-known/ucp") &&
    agentFrontPage.includes("Vercel content-type rule"),
  "a fallback hidden at the bottom is not a usable merchant install path",
);

gw.server.close();
shop.server.close();

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
