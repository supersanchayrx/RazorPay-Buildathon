# Razorpay Agentic Payments Test Bench — frontend

Plain HTML/CSS/vanilla JS (ES modules). No build step, no framework, no bundler,
no dependencies at runtime. Built against `claude docs/instructionforcode.md`.

The Go backend is not part of this deliverable and is not stubbed here.

## How to run

**Against the real backend:** the human runs `go run .` from wherever the Go
server lives; it serves `static/` at `/`. Nothing to configure on the frontend
side — `GET /api/config` is fetched at runtime for the publishable key, mode,
and merchant name.

**Without a backend yet:** open either page with `?fixtures=1`, e.g.
`static/bench.html?fixtures=1` and `static/index.html?fixtures=1`, served by
any static file server (no backend needed):

```
cd static
python -m http.server 8080
# then visit http://localhost:8080/bench.html?fixtures=1
#            http://localhost:8080/index.html?fixtures=1
```

Fixture mode short-circuits every `/api/*` call with canned data from
`js/fixtures.js` and shows a non-dismissible `FIXTURES` badge. Export is
disabled in that mode (there's nothing real to export).

## What each file does

```
static/
  index.html        Store — one product, ordinary D2C storefront
  bench.html         Bench — claim ledger, probe table, event log
  css/
    reset.css        base reset + self-hosted @font-face + the few UI
                      pieces shared verbatim by both pages (JSON viewer,
                      FIXTURES badge, unreachable-backend panel) so the
                      Store and Bench render evidence identically
    tokens.css        custom properties only — the Bench palette/type
                      scale, plus a separate, unrelated Store palette
    store.css         Store-only layout and look
    bench.css         Bench-only layout and look
  js/
    money.js          paise <-> rupee; the only place that formats money
    api.js             fetch wrapper over /api/*; normalises every response
                        into { kind: 'ok' | 'not_implemented' | 'network_error'
                        | 'api_error', ... }; short-circuits to fixtures.js
                        under ?fixtures=1
    config.js          fetches + caches GET /api/config once; re-exports
                        isFixtureMode()
    fixtures.js         canned backend for offline frontend work — see
                        "Fixture data" below
    checkout.js         all Razorpay Checkout concerns: lazy script load,
                        options, the three real outcomes (handler / 
                        payment.failed / modal.ondismiss), and the
                        simulated-checkout panel used under ?fixtures=1
    store.js            Store page controller
    bench.js            Bench page controller
    probes.js           probe registry + results state, sequential run
                        orchestration, requires-gating
    ledger.js           the six claims (hardcoded — they're the fixed
                        content of the test bench, not backend data) and
                        the claim-state derivation rules
    render.js           el() DOM helper, verdict/claim chips, JSON viewer
                        with hand-written syntax highlighting, a from-
                        scratch byte-mode QR encoder (versions 1-10, EC
                        level M), and other small shared render helpers
    export.js           bench-report.md / bench-results.json generation
  fonts/
    *.woff2             IBM Plex Sans (400/500/600) and IBM Plex Mono
                        (400/500), self-hosted, latin + latin-ext subsets,
                        pulled from Google's font host and vendored here —
                        SIL Open Font License, no runtime CDN dependency
```

## Which `/api/*` routes the backend still needs

All nine routes described in the spec are wired up on the frontend and will
work the moment the backend implements them: `GET /api/config`,
`POST /api/orders`, `POST /api/payments/verify`, `GET /api/probes`,
`POST /api/probes/run`, `GET /api/probes/results`, `POST /api/payment-links`,
`GET /api/iin/{iin}`, `GET /api/events`. Until each exists, its 404 renders as
a distinct "not implemented" state rather than breaking anything else on the
page (per the hard rule that missing routes are a UI state, not a crash).

## Design decisions worth knowing about (spec was ambiguous here)

- **IIN lookup UI.** The spec documents `GET /api/iin/{iin}` as a
  frontend-facing route but never carves out screen space for it (the Bench
  is fixed at three regions). The frontend adds a small input + "Look up"
  button *inside the expanded detail of whatever probe's `razorpay_call`
  contains `/iins/`* — driven by that backend-declared string, not a
  hardcoded probe ID, so it stays data-driven the same way the rest of the
  probe table does.
- **Fixture-mode checkout.** Real Razorpay Checkout can't open with a fake
  `key_id`, so under `?fixtures=1` the Buy flow never loads
  `checkout.razorpay.com`. Instead `checkout.js` renders an inline panel
  with four buttons — success, success-with-bad-signature, failure, abandon —
  that drive the exact same result-rendering code a real Checkout callback
  would, so every required fixture state (including `verified: false`) is
  reachable with the backend fully down.
- **`error` verdict color.** The Bench palette in the spec defines five
  colors but the probe verdict enum has six values (`reachable`, `gated`,
  `deprecated`, `error`, `unknown`, plus the derived `unrun`). `error` reuses
  `--deprecated`'s red rather than inventing a sixth hue outside the
  specified palette.
- **Payment-links vs. P8.** `POST /api/payment-links` (the Store's direct
  fallback button) and probe P8 (`POST /v1/payment_links` via the Bench) are
  different frontend routes. In fixtures, P8 succeeds (proving the capability
  works) while the direct Store route returns `not_implemented` — that's the
  fixture data's way of demonstrating the required "route not implemented
  yet" state on a real, visible feature, distinct from a probe result.
- **QR code.** Hand-written byte-mode QR encoder (Reed–Solomon over GF(256),
  standard finder/timing/alignment placement, format-info bits verified
  independently against the BCH(15,5) generator polynomial — see the
  `qr_verify` reasoning in the build notes). It always uses mask pattern 0
  rather than searching for the lowest-penalty mask, which is valid per spec
  but not necessarily optimal. It has not been scanned with a real phone
  camera — worth a 5-second check as part of the smoke test below.

## Deliberately omitted

Per the spec's anti-goals: no auth/sessions/accounts, no cart or multi-SKU
catalogue, no persistence beyond in-memory state + whatever the backend
returns, no SSR/routing/state-management library, no dark mode, no automated
tests beyond this checklist, no retry logic for failed probes, and no part of
the Go backend.

## Smoke checklist

- [ ] `bench.html?fixtures=1` — claim ledger shows a mix of states on load;
      probe table is grouped by claim with a visible `<thead>`; P6 is
      disabled with "Requires P5" until P5 has run and been `reachable`
- [ ] Expand a probe row — question, request, finding, raw JSON (with a
      working copy button) all render; the IIN-lookup widget appears under
      the probe whose call is `/v1/iins/{iin}` and returns real-looking data
- [ ] Run a single probe, then "Run all" — progress text names the in-flight
      probe, ledger rows transition their chip + left rule once, sequential
      (not parallel)
- [ ] Filter the probe table by verdict; empty groups hide themselves
- [ ] `index.html?fixtures=1` — standing warning banner is present and not
      dismissible; test-mode helper card dismisses; Buy now opens the
      simulated-checkout panel (never the real Razorpay script) and each of
      the four outcomes renders its distinct result panel
- [ ] Payment-link fallback renders the `not_implemented` state under
      fixtures (expected — see design decisions above); against a real
      backend it should render a scannable QR + copyable link
- [ ] Resize both pages down to 360px — single column, nothing clipped
- [ ] Tab through both pages — every interactive element has a visible focus
      ring
- [ ] `prefers-reduced-motion: reduce` — ledger transition is instant
- [ ] Kill the backend mid-session (or just don't run it) — every screen
      still renders via fixtures/blocking-panel states, never a blank page
