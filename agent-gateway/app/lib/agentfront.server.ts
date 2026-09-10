/**
 * The merchant's install, generated — and then checked by actually doing it.
 *
 * THE MEASUREMENT THIS FILE IS BUILT ON:
 *
 * On 2026-09-06 the gateway was tunnelled over HTTPS and driven by `ucp` CLI
 * v0.8.0, a reference client Shopify wrote and we did not. A merchant whose
 * ENTIRE integration was one redirect rule — no proxy, no file, no line of code
 * that knows what UCP is — was discovered and transacted with normally. Both
 * 301 and 302 were followed, cross-origin, on the well-known path.
 *
 * `demo-store/ucp.go` used to argue the opposite: that clients which do not
 * follow such a redirect "fail invisibly, and the merchant would be debugging
 * someone else's HTTP client". That was reasoning. This is a measurement, and it
 * is why the generated install below leads with a redirect instead of a proxy.
 *
 * WHY A REDIRECT BEATS A FILE, beyond being shorter: it resolves live. A
 * merchant who enables Razorpay an hour after installing advertises the payment
 * handler the instant they save, with nothing to regenerate. `capabilities()` is
 * a pure constant and the payment handler is the one field that varies by site,
 * so a static copy has exactly one silent failure mode — minted before payments
 * were configured, advertising none, forever. `verifyInstall` exists to catch
 * precisely that, by comparing what they serve against what we would serve now.
 *
 * ON FETCHING MERCHANT ORIGINS: every fetch here targets an origin from the site
 * registry, never a URL from a form. A verify button that took a URL would be a
 * request forger with a login page in front of it.
 */

import type { Site } from "./sites.server";
import { discoveryDocument, paymentHandlers } from "./ucp.server";
import { readLedger } from "./ledger.server";
import { findByGatewayOrder } from "./orderstore.server";

/* ------------------------------------------------------------------ *
 * Tier A — the one line
 * ------------------------------------------------------------------ */

export type Snippet = {
  /** Host or stack this is for. */
  host: string;
  /** Where it goes — a filename, a config key, or "your app". */
  where: string;
  /** Syntax hint for the code block. */
  lang: string;
  body: string;
  /** True when this terminates the request on the merchant's own origin. */
  proxies?: boolean;
};

/**
 * Every install, pre-filled. Redirects first, in the order a merchant is likely
 * to be hosted, and proxies last for the ones already running code.
 *
 * Deliberately NOT a "recommended" pick with the rest hidden. A merchant who
 * cannot find their own stack in the list assumes the product does not support
 * it, and the difference between six lines of UI and an abandoned install is
 * not worth the tidiness.
 */
export function installSnippets(profileUrl: string): Snippet[] {
  return [
    {
      host: "Netlify",
      where: "_redirects, in your publish directory",
      lang: "text",
      body: `/.well-known/ucp  ${profileUrl}  302`,
    },
    {
      host: "Vercel",
      where: "vercel.json — merge this property into the existing top-level object",
      lang: "json",
      body: `"redirects": [
  { "source": "/.well-known/ucp", "destination": "${profileUrl}", "permanent": false }
]`,
    },
    {
      host: "Cloudflare Pages",
      where: "_redirects (or one Bulk Redirect rule)",
      lang: "text",
      body: `/.well-known/ucp  ${profileUrl}  302`,
    },
    {
      host: "nginx",
      where: "your server block",
      lang: "nginx",
      body: `location = /.well-known/ucp { return 302 ${profileUrl}; }`,
    },
    {
      host: "Apache",
      where: ".htaccess",
      lang: "apache",
      body: `Redirect 302 /.well-known/ucp ${profileUrl}`,
    },
    {
      host: "Caddy",
      where: "Caddyfile",
      lang: "text",
      body: `redir /.well-known/ucp ${profileUrl} 302`,
    },
    {
      host: "Express",
      where: "your app",
      lang: "js",
      body: `app.get("/.well-known/ucp", (_req, res) => res.redirect(302, "${profileUrl}"));`,
    },
    {
      host: "Go",
      where: "your app",
      lang: "go",
      body: `http.HandleFunc("/.well-known/ucp", func(w http.ResponseWriter, r *http.Request) {
    http.Redirect(w, r, "${profileUrl}", http.StatusFound)
})`,
    },
    {
      host: "Rails",
      where: "config/routes.rb",
      lang: "ruby",
      body: `get "/.well-known/ucp", to: redirect("${profileUrl}")`,
    },
    {
      host: "Go — proxy instead",
      where: "your app",
      lang: "go",
      proxies: true,
      body: `http.HandleFunc("/.well-known/ucp", func(w http.ResponseWriter, r *http.Request) {
    res, err := http.Get("${profileUrl}")
    if err != nil { http.Error(w, "discovery unavailable", 502); return }
    defer res.Body.Close()
    w.Header().Set("Content-Type", "application/json")
    io.Copy(w, res.Body)
})`,
    },
    {
      host: "nginx — proxy instead",
      where: "your server block",
      lang: "nginx",
      proxies: true,
      body: `location = /.well-known/ucp {
    proxy_pass ${profileUrl};
    proxy_set_header Host $host;
}`,
    },
  ];
}

/**
 * Which of the above to show first, guessed from what their server says about
 * itself.
 *
 * A guess, and labelled as one in the UI. Header sniffing is right often enough
 * to save a merchant a scroll and wrong often enough that presenting it as fact
 * would have someone paste an nginx block into a Netlify config and conclude we
 * are broken.
 */
export function guessHost(headers: Headers): string | null {
  const h = (k: string) => headers.get(k)?.toLowerCase() ?? "";
  if (h("x-nf-request-id") || h("server").includes("netlify")) return "Netlify";
  if (h("x-vercel-id") || h("server").includes("vercel")) return "Vercel";
  if (h("cf-ray") && h("server").includes("cloudflare"))
    return "Cloudflare Pages";
  if (h("server").includes("nginx")) return "nginx";
  if (h("server").includes("apache")) return "Apache";
  if (h("server").includes("caddy")) return "Caddy";
  if (h("x-powered-by").includes("express")) return "Express";
  if (h("x-powered-by").includes("phusion") || h("server").includes("puma"))
    return "Rails";
  return null;
}

/* ------------------------------------------------------------------ *
 * Tier C — the optional legibility layer
 * ------------------------------------------------------------------ */

export type TierCSnippet = Snippet & {
  /** Which of the four Tier C behaviours this install actually delivers. */
  covers: string[];
  /** What it does not, stated rather than left to be discovered. */
  missing?: string[];
  /**
   * True only where we run this ourselves and a test suite drives it.
   *
   * The distinction is the whole reason this codebase has a corrections log: a
   * snippet we reasoned our way to and a snippet we watched work are different
   * artefacts, and presenting them identically is how the first one's bugs
   * become the merchant's problem.
   */
  measured?: boolean;
};

/**
 * Tier C splits into a half that needs no code and a half that does.
 *
 * That split is worth surfacing rather than hiding behind one "install
 * middleware" button. Two of the four behaviours — `/llms.txt` and the `Link:`
 * header — are a redirect rule and a header rule, which every static host
 * already supports and which a merchant can add in the same place they added
 * Tier A. The other two — injecting JSON-LD into the page, and answering the
 * same URL with data — require something in the request path that can see the
 * HTML on the way out.
 *
 * A merchant who cannot deploy code is not locked out of this tier. They get
 * half of it in two lines, and the console says which half.
 */
export function tierCSnippets(
  gatewayBaseUrl: string,
  siteKey: string,
): TierCSnippet[] {
  const base = `${gatewayBaseUrl.replace(/\/$/, "")}/ucp/${siteKey}`;
  const NO_CODE = ["/llms.txt", "Link: header"];
  const NO_CODE_MISSING = ["JSON-LD in the page", "?format=json"];

  return [
    {
      host: "Netlify — no code",
      where: "_redirects and _headers",
      lang: "text",
      covers: NO_CODE,
      missing: NO_CODE_MISSING,
      body: `# _redirects
/llms.txt  ${base}/llms.txt  302

# _headers
/*
  Link: </.well-known/ucp>; rel="ucp"; type="application/json"`,
    },
    {
      host: "Vercel — no code",
      where: "vercel.json — merge these entries into the existing top-level arrays",
      lang: "json",
      covers: NO_CODE,
      missing: NO_CODE_MISSING,
      body: `"rewrites": [
    { "source": "/llms.txt", "destination": "${base}/llms.txt" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Link", "value": "</.well-known/ucp>; rel=\\"ucp\\"; type=\\"application/json\\"" }
      ]
    }
  ]`,
    },
    {
      host: "nginx — no code",
      where: "your server block",
      lang: "nginx",
      covers: NO_CODE,
      missing: NO_CODE_MISSING,
      body: `location = /llms.txt { return 302 ${base}/llms.txt; }
add_header Link '</.well-known/ucp>; rel="ucp"; type="application/json"' always;`,
    },
    {
      host: "Express",
      where: "above your routes",
      lang: "javascript",
      covers: [
        "/llms.txt",
        "Link: header",
        "JSON-LD in the page",
        "?format=json",
      ],
      missing: [
        "pages sent with res.sendFile or a stream — this hooks res.send",
      ],
      body: `const CHAPMAN = "${base}";
const cache = new Map();

const originOf = (req) =>
  \`\${req.get("x-forwarded-proto") || req.protocol}://\${req.get("x-forwarded-host") || req.get("host")}\`;

async function view(path, origin) {
  const key = origin + path;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.view;
  try {
    const r = await fetch(
      \`\${CHAPMAN}/agentview?path=\${encodeURIComponent(path)}&origin=\${encodeURIComponent(origin)}\`,
      { signal: AbortSignal.timeout(2500) },
    );
    if (!r.ok) return null;
    const view = await r.json();
    if (cache.size > 512) cache.clear();
    cache.set(key, { view, until: Date.now() + (view.max_age || 300) * 1000 });
    return view;
  } catch {
    // The gateway is optional. The shop is not. Never let this throw.
    return null;
  }
}

app.get("/llms.txt", async (req, res) => {
  const r = await fetch(
    \`\${CHAPMAN}/llms.txt?origin=\${encodeURIComponent(originOf(req))}\`,
  ).catch(() => null);
  if (!r || !r.ok) return res.sendStatus(404);
  res.type("text/plain").send(await r.text());
});

app.use(async (req, res, next) => {
  if (req.method !== "GET") return next();
  const v = await view(req.originalUrl, originOf(req));
  if (!v) return next();

  // The same URL now has two answers. A shared cache has to be told.
  res.vary("Accept");
  if (v.link) res.set("Link", v.link);

  // \`?format=json\` as well as the header, because a browsing model calls a
  // fetch tool with a URL and cannot set one.
  const wantsJson =
    req.query.format === "json" || req.accepts(["html", "json"]) === "json";
  if (wantsJson && v.json) return res.json(v.json);

  const send = res.send.bind(res);
  res.send = (body) => {
    if (typeof body === "string" && body.includes("</head>")) {
      // Their structured data wins. Two Product nodes is an ambiguous page.
      const frag = body.includes("application/ld+json")
        ? v.head.replace(v.jsonld, "")
        : v.head;
      body = body.replace("</head>", frag + "</head>");
    }
    return send(body);
  };
  next();
});`,
    },
    {
      host: "Go (net/http)",
      where: "wrap your outermost handler",
      lang: "go",
      measured: true,
      covers: [
        "/llms.txt",
        "Link: header",
        "JSON-LD in the page",
        "?format=json",
      ],
      body: `// Copy demo-store/agentfront.go into your package, then:
tc := newTierC("${gatewayBaseUrl.replace(/\/$/, "")}", "${siteKey}")
mux.HandleFunc("/llms.txt", tc.handleLLMs)

http.ListenAndServe(addr, tc.wrap(mux))`,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Tier B — the static file, for hosts that cannot redirect
 * ------------------------------------------------------------------ */

/**
 * The document, ready to upload.
 *
 * Rare — even S3 has redirect rules — and worse than a redirect in exactly one
 * way, which the UI has to say out loud rather than bury: it is a copy, and a
 * copy taken before payments were configured will advertise no payment handler
 * until somebody regenerates it. We do not fix that by advertising the handler
 * unconditionally. That would be a lie told in JSON, and this codebase already
 * refuses that trade everywhere else.
 */
export function staticProfile(site: Site, gatewayBaseUrl: string): string {
  return JSON.stringify(discoveryDocument(site, gatewayBaseUrl), null, 2);
}

/**
 * The browser download for a merchant-hosted discovery document.
 *
 * The filename is deliberately extensionless because the public protocol path
 * is `/.well-known/ucp`, not `/.well-known/ucp.json`. `no-store` matters here:
 * changing a payment handler and then downloading a cached old manifest is the
 * quietest possible way to leave an agent storefront partially installed.
 */
export function staticProfileDownload(
  site: Site,
  gatewayBaseUrl: string,
): Response {
  return new Response(`${staticProfile(site, gatewayBaseUrl)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ucp"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/* ------------------------------------------------------------------ *
 * Verify — the probe, as a button
 * ------------------------------------------------------------------ */

export type StepState = "pass" | "fail" | "warn" | "skip";

export type VerifyStep = {
  label: string;
  state: StepState;
  detail: string;
  /** Why this step is worth a merchant's attention, when it fails. */
  why?: string;
};

export type VerifyResult = {
  origin: string;
  ok: boolean;
  checkedAt: string;
  steps: VerifyStep[];
};

const TIMEOUT_MS = 6000;

/**
 * Do what a shopper's agent does, in order, and report each step separately.
 *
 * One overall green tick is worth much less than this. An install fails in
 * distinct places — the rule never deployed, the rule points at the wrong site
 * key, the document is a stale copy, the MCP endpoint is unreachable — and a
 * merchant told only "not working" has to guess which. The `ucp` CLI's own
 * failure taxonomy makes the same distinction, and for the same reason.
 */
export async function verifyInstall(
  site: Site,
  gatewayBaseUrl: string,
  reachableOrigin = site.origins[0] ?? "",
): Promise<VerifyResult> {
  const origin = site.origins[0] ?? "";
  const steps: VerifyStep[] = [];
  const checkedAt = new Date().toISOString();
  const expected = discoveryDocument(site, gatewayBaseUrl);
  const expectedEndpoint =
    expected.ucp.services["dev.ucp.shopping"][0].endpoint;

  const done = (): VerifyResult => ({
    origin,
    ok: steps.every((s) => s.state !== "fail"),
    checkedAt,
    steps,
  });

  if (!origin) {
    steps.push({
      label: "A registered storefront origin",
      state: "fail",
      detail: "no origin on file for this store",
      why: "we would have nothing to check, and an agent would have nowhere to look",
    });
    return done();
  }

  // HTTPS is not a preference. `ucp discover http://…` is refused with
  // INVALID_INPUT before any network call is made, so a plain-HTTP storefront is
  // invisible to a conforming client no matter how correct the rest is.
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(
    origin,
  );
  steps.push(
    origin.startsWith("https://")
      ? { label: "Storefront is HTTPS", state: "pass", detail: origin }
      : {
          label: "Storefront is HTTPS",
          state: isLocal ? "warn" : "fail",
          detail: isLocal ? `${origin} — local development` : origin,
          why: "the `ucp` CLI refuses a non-HTTPS business URL before it makes any request; a plain-HTTP store is invisible, whatever else is right",
        },
  );

  /* ---- 1. the well-known path answers, however it chooses to ---- */

  // The public origin is what agents use and what we report. The optional
  // reachable origin is only the network route this server fetches. In Docker
  // those are localhost:4000 and store:4000 respectively.
  const wellKnown = `${reachableOrigin}/.well-known/ucp`;
  let hop: Response;
  try {
    hop = await fetch(wellKnown, {
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    steps.push({
      label: "/.well-known/ucp responds",
      state: "fail",
      detail: e instanceof Error ? e.message : "unreachable",
      why: "an agent fetches this one path and gives up if it fails — there is no fallback, no <link> tag and no directory it can consult instead",
    });
    return done();
  }

  const redirected =
    hop.status === 301 ||
    hop.status === 302 ||
    hop.status === 307 ||
    hop.status === 308;
  if (redirected) {
    const target = hop.headers.get("location") ?? "";
    steps.push({
      label: "/.well-known/ucp responds",
      state: "pass",
      detail: `${hop.status} → ${target}`,
    });
    steps.push(
      target.startsWith(gatewayBaseUrl)
        ? {
            label: "The redirect points at this store's profile",
            state: target.includes(`/ucp/${site.key}/`) ? "pass" : "fail",
            detail: target.includes(`/ucp/${site.key}/`)
              ? `site key ${site.key}`
              : `points at a different store — expected /ucp/${site.key}/profile`,
            why: "a rule copied from another store's instructions sells that store's catalogue from your domain",
          }
        : {
            label: "The redirect points at this store's profile",
            state: "warn",
            detail: `points outside this gateway: ${target || "no Location header"}`,
            why: "we cannot vouch for a document we do not serve; the steps below check what it actually returns",
          },
    );
  } else if (hop.ok) {
    steps.push({
      label: "/.well-known/ucp responds",
      state: "pass",
      detail: `${hop.status}, served directly from your origin`,
    });
  } else {
    steps.push({
      label: "/.well-known/ucp responds",
      state: "fail",
      detail: `returned ${hop.status}`,
      why:
        hop.status === 404
          ? "the rule is not deployed. A 404 here is indistinguishable, to an agent, from a store that does not sell online"
          : "an agent treats a non-200 as a store that does not speak the protocol",
    });
    return done();
  }

  /* ---- 2. following it produces a readable document ---- */

  let doc: {
    ucp?: {
      version?: string;
      services?: Record<
        string,
        Array<{ endpoint?: string; transport?: string }>
      >;
      payment_handlers?: Record<string, unknown>;
    };
  };
  try {
    const res = await fetch(wellKnown, {
      redirect: "follow",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`returned ${res.status} after following`);
    doc = await res.json();
    steps.push({
      label: "It returns a UCP profile",
      state: "pass",
      detail: `${res.status}, valid JSON`,
    });
  } catch (e) {
    steps.push({
      label: "It returns a UCP profile",
      state: "fail",
      detail: e instanceof Error ? e.message : "could not be read",
      why: "the path answers but the document does not parse, so an agent has nothing to act on",
    });
    return done();
  }

  steps.push(
    doc.ucp?.version
      ? {
          label: "It names a protocol version",
          state: "pass",
          detail: doc.ucp.version,
        }
      : {
          label: "It names a protocol version",
          state: "fail",
          detail: "no ucp.version",
          why: "an agent cannot tell which version of the protocol to speak",
        },
  );

  const endpoint = doc.ucp?.services?.["dev.ucp.shopping"]?.[0]?.endpoint ?? "";
  steps.push(
    endpoint
      ? {
          label: "It names a shopping endpoint",
          state: "pass",
          detail: endpoint,
        }
      : {
          label: "It names a shopping endpoint",
          state: "fail",
          detail: "no dev.ucp.shopping service",
          why: "discovery succeeded and led nowhere, which is the one failure an agent cannot work around",
        },
  );
  if (!endpoint) return done();

  /* ---- 3. drift: is this the document we would serve today? ---- */

  const liveHandlers = Object.keys(paymentHandlers(site));
  const servedHandlers = Object.keys(doc.ucp?.payment_handlers ?? {});
  const missing = liveHandlers.filter((h) => !servedHandlers.includes(h));

  steps.push(
    endpoint === expectedEndpoint
      ? {
          label: "It matches what we serve now",
          state: "pass",
          detail: "endpoint is current",
        }
      : {
          label: "It matches what we serve now",
          state: "warn",
          detail: `serves ${endpoint}, we would serve ${expectedEndpoint}`,
          why: "a static copy drifts. A redirect never does, because it resolves live on every request",
        },
  );

  if (missing.length > 0) {
    steps.push({
      label: "Your payment handler is advertised",
      state: "warn",
      detail: `missing from the served document: ${missing.join(", ")}`,
      why: "this is the one field that goes stale in a copied file. Agents will escalate every checkout to a browser instead of paying, and nothing will look broken. Re-upload the file, or switch to a redirect and it fixes itself",
    });
  } else if (liveHandlers.length > 0) {
    steps.push({
      label: "Your payment handler is advertised",
      state: "pass",
      detail: liveHandlers.join(", "),
    });
  } else {
    steps.push({
      label: "Your payment handler is advertised",
      state: "skip",
      detail:
        "no payment keys configured — agents can browse and build carts, not check out",
    });
  }

  /* ---- 4. the endpoint actually answers an agent's first call ---- */

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    // Streamable HTTP may answer as SSE, so the JSON is located rather than
    // assumed to start at byte zero.
    const start = text.indexOf("{");
    const parsed =
      start >= 0
        ? (JSON.parse(text.slice(start)) as { result?: { tools?: unknown[] } })
        : null;
    const count = parsed?.result?.tools?.length ?? 0;
    steps.push(
      count > 0
        ? {
            label: "The endpoint lists its tools",
            state: "pass",
            detail: `${count} operations`,
          }
        : {
            label: "The endpoint lists its tools",
            state: "fail",
            detail: "tools/list returned nothing",
            why: "an agent that gets here and finds no operations has done everything right and can still do nothing",
          },
    );
  } catch (e) {
    steps.push({
      label: "The endpoint lists its tools",
      state: "fail",
      detail: e instanceof Error ? e.message : "unreachable",
      why: "discovery worked but the endpoint it points at did not answer",
    });
  }

  return done();
}

/* ------------------------------------------------------------------ *
 * What agents have actually done
 * ------------------------------------------------------------------ */

/**
 * Agent traffic, DERIVED from the ledger and the order book rather than counted
 * into a tally somewhere.
 *
 * A stored counter is a counter that drifts: it double-counts a retry, misses a
 * write that failed, and cannot be checked against anything. These numbers are
 * recomputed from the same append-only records a merchant can read themselves,
 * so a figure on the dashboard and a figure in the ledger cannot disagree.
 *
 * `detail.agent` is the marker. Only the UCP path writes it \u2014 a human checking
 * out through the widget has no agent host \u2014 so this separates the two surfaces
 * without a flag anyone has to remember to set.
 */
export type AgentActivity = {
  calls: number;
  checkouts: number;
  orders: number;
  revenue: number;
  hosts: string[];
  recent: Array<{
    ts: string;
    kind: string;
    message: string;
    agent: string;
    /** Present once the payment settled and an order exists. */
    orderId?: string;
    amount?: number;
  }>;
};

export function agentActivity(shop: string): AgentActivity {
  const rows = readLedger(4000).filter(
    (r) =>
      r.shop === shop &&
      typeof (r.detail as { agent?: unknown } | undefined)?.agent === "string",
  );

  const hosts = new Set<string>();
  const started = new Map<string, number>();
  let calls = 0;

  for (const r of rows) {
    const d = r.detail as { agent: string; orderId?: string; amount?: number };
    hosts.add(d.agent);
    calls++;
    if (r.kind === "payment_started" && d.orderId)
      started.set(d.orderId, d.amount ?? 0);
  }

  // An order is only an order once it settled. `payment_started` is intent, and
  // counting intent as revenue is how a dashboard ends up flattering itself.
  let orders = 0;
  let revenue = 0;
  for (const [gatewayOrderId] of started) {
    const placed = findByGatewayOrder(gatewayOrderId);
    if (
      placed &&
      (placed.status === "paid" || placed.status === "authorized")
    ) {
      orders++;
      revenue += placed.amount;
    }
  }

  return {
    calls,
    checkouts: started.size,
    orders,
    revenue,
    hosts: [...hosts],
    recent: rows
      .slice(-12)
      .reverse()
      .map((r) => {
        const d = r.detail as {
          agent: string;
          orderId?: string;
          amount?: number;
        };
        return {
          ts: r.ts,
          kind: r.kind,
          message: r.message,
          agent: d.agent,
          ...(d.orderId ? { orderId: d.orderId } : {}),
          ...(d.amount != null ? { amount: d.amount } : {}),
        };
      }),
  };
}
