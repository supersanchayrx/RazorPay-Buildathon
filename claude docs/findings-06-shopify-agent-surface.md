# Findings 06 — The Shopify agent surface

First measured results on the Shopify half of the build. Store:
`superstore-md6pjikd.myshopify.com`, a development store with Shopify's demo
catalog (snowboards) and storefront password protection on.

All `[PROBE]` unless marked otherwise.

---

## Why this doc exists

The build is a merchant-side agent gateway installed as a Shopify app. Before
writing any of it, three things needed measuring: whether the app-proxy path is
reachable, whether the storefront password blocks external agent traffic, and
what Shopify's new **Crawler access** panel actually does.

The third turned out to be the interesting one.

---

## Crawler access is RFC 9421, and it is genuinely verified

Shopify's **Settings → Crawler access** panel issues three headers —
`Signature`, `Signature-Input`, `Signature-Agent` — for the merchant to hand to
an external crawler. The `Signature-Input` carries `tag="web-bot-auth"`, which
places it in the **RFC 9421 HTTP Message Signatures / Web Bot Auth** lineage —
the same standard behind Visa's Trusted Agent Protocol
([buildplan §4](hackathon-track01-buildplan-v2.md)).

```
sig1=("@authority" "signature-agent");keyid="Sjjy…";nonce="yjqZ…";
     tag="web-bot-auth";created=1788551432;expires=1793735432
```

Covered components are **only** `@authority` and `signature-agent` — not the
method, not the path, not a per-request date. Issued 2026-09-04, expires
2026-11-03.

### It does not bypass the storefront password

| Request | Result |
|---|---|
| `/`, `/products.json`, `/apps/agent` — unsigned | 302 → `/password` |
| same three — signed | 302 → `/password`, **byte-identical** |

No error, no differing header. **Whether the signature was rejected or never
evaluated is not distinguishable from the response** — password protection
appears to sit in front of the crawler-access layer. Crawler access governs bots
on a *live* store; it is not a pre-launch bypass. `[OPEN]`

### Past the gate, a valid signature changes the response

Authenticating the storefront password as a session cookie
(`POST /password`, `form_type=storefront_password`) and re-running:

| Request | Bytes | `event_observer` hits | Runs |
|---|---|---|---|
| cookie only | 137152 | 0 | 3/3 |
| cookie + **valid** signature | **138342** | **2** | 3/3 |
| cookie + **corrupt** signature | 137152 | 0 | 3/3 |
| cookie + `Signature-Agent` only | 137152 | 0 | 3/3 |

Deterministic across three runs per arm.

**The corrupt-signature arm is the load-bearing control.** A signature with a
mangled base64 body produces output byte-identical to no signature at all. So
the trigger is **cryptographic validity**, not header presence. Shopify really
verifies it.

**Correction.** An earlier reading of this called the credential "a bearer token
wearing RFC 9421 clothing" on the grounds that the covered components are
host-only and the value is static and reusable. The reuse observation stands —
the same string works across paths — but "not actually verified" was **wrong**,
and the corrupt-signature control is what disproved it. `[DEAD]`

### It fails open, silently

An invalid signature does not 401. It gets ordinary treatment, with nothing in
the response saying why. **A broken signature is indistinguishable from a
working one** unless you diff the body against a control.

This is the third instance in the project of
[method-rule 13](method-rules.md) — accepted and ignored. First
`/customers?contact=`, then MCP's OTP tools, now this. Worth treating as a
pattern rather than three coincidences.

### A verified crawler is instrumented more, not less

The 1190-byte delta is Shopify's `event_observer.bootstrap` script, which hooks
`sendBeacon`, `fetch`, `XMLHttpRequest.open/send` and `addEventListener` —
fine-grained behavioural telemetry, served to the **authorised crawler** and not
to the unsigned request.

**Interpretation is `[OPEN]` and two readings survive:**

1. Shopify *adds* instrumentation for verified crawlers, or
2. The password gate *suppresses* analytics, and a valid signature makes Shopify
   treat the hit as a real pageview

The baseline here is a password-gated session, not a public visitor, so these
are not yet separable. **Attribution to the signature is solid; the meaning is
not.** Re-run on a store without the password before asserting either.

If reading 1 holds it is worth stating in the pitch: **the merchant surface
watches the agent more closely once the agent identifies itself** — a
merchant-side bound mirroring "tool output is data, never instructions" on the
agent side.

---

## The app proxy path is reachable and correctly empty

| Request | Unauthenticated | With password session |
|---|---|---|
| `/apps/agent` | 302 → `/password` | **404** |

The 404 is the correct pre-install state: the request reaches the app-proxy
router and finds no app registered on that subpath. **The tier-0 delivery path
is confirmed live before writing any code.**

Incidental signal, worth knowing: `/apps/*` returns a capitalised `Location`
header and **no** `_shopify_essential` cookie, while `/` and `/products.json`
return lowercase `location` **with** the cookie. The app-proxy router is a
distinct code path from the storefront renderer.

---

---

## The app proxy carries the crawler signature — open item 1, resolved

Measured with the app scaffolded (`agent-gateway`, React Router template) and a
diagnostic route at `/proxy/*` echoing every header it receives. `[PROBE]`

```
curl -b jar.txt https://superstore-md6pjikd.myshopify.com/apps/agent
-> 200 application/json, served by our own server
```

**The tier-0 delivery path works end to end.** A request to the *merchant's own
domain* reaches our service and returns our JSON.

### Three results

**1. Shopify signs proxy requests, and the library verifies them.** Shopify
appends `shop`, `path_prefix`, `timestamp` and an HMAC `signature` as query
parameters. `authenticate.public.appProxy(request)` returned `verified: true`.
Request authenticity at the proxy comes free — do not hand-roll it.

**2. The RFC 9421 crawler headers are forwarded intact.**

| Request | `signature` | `signature-input` | `signature-agent` |
|---|---|---|---|
| through proxy, headers sent | **present, verbatim** | **present, verbatim** | **present, verbatim** |
| through proxy, headers not sent | absent | absent | absent |

**This is the important one.** Agent identity verification is available at
**tier 0**, not only at tier 3. A plugin-only install can cryptographically
distinguish a merchant-authorised agent from anonymous traffic, on the
merchant's own domain.

**Control note.** The first run of this test reported `forwarded: false` — from
a request in which the signature headers *were never sent*. That is
[the broken-control failure](method-rules.md) recorded in the method rules:
a result that looks like a finding but never evaluated the variable. Re-run with
only the headers varying, it reverses.

**3. Subpaths route, with the prefix preserved.**

```
/apps/agent            -> receivedPath /proxy/
/apps/agent/manifest/v1 -> receivedPath /proxy/manifest/v1,  path_prefix /apps/agent
```

So the manifest can live at any path under the subpath, and
`x-forwarded-host` carries the merchant domain — which is what makes one
deployment multi-tenant.

### A gotcha worth recording

`authenticate.public.appProxy` returns `verified: true` with a **null session**
when the app is not installed. HMAC validity and installation are separate
facts, and only one of them is in the return value you are likely to check.
Confirm an offline session exists before assuming Admin API access.

---

## The password is a test-harness problem, not a build problem

It blocks exactly one thing: **anonymous external requests to the storefront**,
which is how you simulate a shopper agent arriving. It does not block the Admin
API (separately authenticated via the app's OAuth token), so catalog, orders,
customers and abandoned checkouts are all unaffected.

Workaround, if the toggle cannot be removed:

```bash
curl -c jar.txt --data-urlencode "form_type=storefront_password" \
     --data-urlencode "password=<pw>" https://<store>.myshopify.com/password
curl -b jar.txt https://<store>.myshopify.com/products.json    # 200
```

`/products.json` returns the full catalog with variants — **zero upload
required**, confirming the install design in the handoff.

---

## Consequences for the build

1. **Agent identity verification exists first-party on Shopify** and is real.
   Do not build UA sniffing.
2. **Never treat a signature as valid because the request succeeded.** It fails
   open. Diff against a control, or verify it yourself.
3. **The catalog needs no merchant upload** — `/products.json` and the Admin API
   cover feature 1.
4. **Remove the storefront password before any demo run**, or the recording
   shows a password page.

---

## Open items

1. ~~Does the app proxy receive the signature headers?~~ **RESOLVED — it does,
   intact. Agent verification is available at tier 0.** See above.
2. Reading 1 vs reading 2 on the instrumentation delta, on a store without the
   password.
2b. **Verify the signature ourselves at the proxy.** Shopify validates it at the
   edge, but our endpoint currently only observes that the headers arrived. Since
   Shopify **fails open**, arrival is not validity — we must verify against the
   `keyid` and the Web Bot Auth key directory, or treat the header as unproven.
3. Whether `/apps/<subpath>/.well-known/...` is servable, and therefore whether
   root-level discovery is genuinely tier-3-only.
4. How far back `read_orders` reaches without `read_all_orders` — the 60-day
   ceiling would cap features 8, 10 and 14.
