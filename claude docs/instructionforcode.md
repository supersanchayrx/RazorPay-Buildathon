# Frontend Spec — Razorpay Agentic Payments Test Bench

**Audience:** Claude Code
**Deliverable:** the browser frontend only
**Backend:** Go, written separately by the human. Do not write, scaffold, or stub the Go server.

---

## 1. What this is

A two-part single-origin web app used to empirically test which parts of Razorpay's agentic-payments story are reachable by an ordinary developer on a plain **test-mode** account (`rzp_test_…` keys).

The two parts are deliberately different in character:

- **The Store** — an ordinary, unremarkable Indian D2C product page with a Buy button and Razorpay Checkout. It exists to be *typical*. It represents the merchant an AI agent would try and fail to buy from.
- **The Bench** — an instrument console that runs API probes against the same Razorpay account, records the raw results, and keeps a ledger of which claims have been proven, disproven, or blocked.

The contrast between the two is the point of the app. Do not homogenise them.

### The claims under test

The Bench exists to resolve these. They are the content of the app, not decoration — the claim ledger is the primary screen.

| ID | Claim | Resolved by |
|---|---|---|
| `C1` | A plain test account can create standard orders and complete checkout | Store flow + `P1`, `P2` |
| `C2` | The Orders API mandate token (`max_amount`, `expire_at`, `frequency`) is reachable self-serve | `P4` |
| `C3` | Server-to-server UPI payment creation is usable without PCI-DSS | `P5`, `P6` |
| `C4` | The IIN lookup returns usable pre-flight auth data (`recurring`, `authentication_types`) | `P7` |
| `C5` | Payment Links work as an agent fallback | `P8` |
| `C6` | UPI Reserve Pay has no self-serve surface | `P10` |

Each claim starts at `UNTESTED` and moves to `SUPPORTED`, `REFUTED`, or `BLOCKED` based on probe results.

---

## 2. Hard rules

Violating any of these makes the app useless or unsafe. They are not preferences.

1. **The key secret never reaches the browser.** Not in a config file, not in an env var read at build time, not in a comment. If you find yourself needing it, you have misread the contract.
2. **The publishable `key_id` is fetched from the backend at runtime** via `GET /api/config`. Never hardcode it, never put it in a `.env` that gets bundled.
3. **Signature verification happens server-side only.** The frontend posts the three Razorpay fields to the backend and renders whatever verdict comes back. Do not implement or import HMAC anywhere in frontend code.
4. **Never trust a client-side amount.** The Buy button asks the backend to create an order; the backend decides the amount. The frontend renders the amount the backend returns, not the one it sent.
5. **Do not invent Razorpay endpoints or field names.** Everything the frontend touches is a `/api/*` route on the Go backend. The frontend never calls `api.razorpay.com` directly. The only Razorpay-hosted thing it loads is `checkout.js`.
6. **Preserve raw responses verbatim.** The Bench's entire value is unedited evidence. Never truncate, pretty-print destructively, reformat, or "clean up" a response body before storing it. Render it prettified; keep the original string for export.
7. **Missing backend routes are a UI state, not a crash.** Any `/api/*` route may 404 because the human hasn't written it yet. Handle it as a distinct `NOT_IMPLEMENTED` state per feature.
8. **No telemetry, analytics, error reporting, or third-party scripts** beyond Razorpay Checkout and self-hosted fonts.

---

## 3. Stack

**Plain HTML + CSS + vanilla JavaScript (ES modules). No build step. No framework. No bundler. No TypeScript.**

This is a deliberate choice, not an oversight. Do not substitute React, Vite, Next, Tailwind, or a component library, and do not add a build step "for convenience."

Reasons, so you don't second-guess them:

- Razorpay's `checkout.js` attaches a global `Razorpay` constructor and opens a cross-origin iframe. It fights bundler lifecycles and adds no value when wrapped.
- The Go backend serves the frontend as static files from the same origin, so there is no CORS layer and no dev proxy to configure.
- The human runs one command (`go run .`) and gets the whole app. A second dev server would be friction.
- The output has to be readable as evidence by someone auditing it later. Fewer files, no transpilation.

Allowed dependencies: **none at runtime.** Fonts are self-hosted WOFF2 files in `/static/fonts/`. If you want syntax highlighting for JSON, write the ~40 lines yourself; do not pull in a library.

---

## 4. File layout

Everything lives under `static/`, which the Go server will serve at `/`.

```
static/
  index.html            Store
  bench.html            Bench console
  css/
    reset.css
    tokens.css          design tokens only — see §9
    store.css
    bench.css
  js/
    api.js              thin fetch wrapper over /api/*, error normalisation
    config.js           runtime config fetch + cache
    fixtures.js         canned data for offline UI work — see §7
    money.js            paise <-> rupee, the single conversion point
    checkout.js         Razorpay Checkout lifecycle
    store.js            Store page controller
    bench.js            Bench page controller
    probes.js           probe registry, run orchestration, verdict logic
    ledger.js           claim ledger state derived from probe results
    render.js           small DOM helpers, JSON viewer, verdict chips
    export.js           report generation (markdown + json)
  fonts/
    *.woff2
README.md               how to run, what each file does, current gaps
```

Do not create additional top-level directories. Do not add a `package.json` unless you need one purely to record that there are no dependencies — and if so, say why in the README.

---

## 5. The backend contract

This is the interface between your work and the human's. Build strictly against it. If something is ambiguous, implement the version described here and note the ambiguity in the README rather than improvising a different shape.

All requests and responses are `application/json`. All monetary amounts in transport are **integer paise**.

### Common error envelope

Any `/api/*` route may return a non-2xx with this body. Render it faithfully.

```json
{
  "error": {
    "code": "BAD_REQUEST_ERROR",
    "description": "Recurring payments are not enabled for this merchant",
    "source": "business",
    "step": "payment_initiation",
    "reason": "input_validation_failed",
    "metadata": {}
  }
}
```

`source`, `step`, `reason` and `metadata` may be absent or null. `description` is the field that actually matters to the human — give it visual priority over `code`.

### `GET /api/config`

Called once on page load, before anything else renders.

```json
{
  "key_id": "rzp_test_XXXXXXXXXXXX",
  "mode": "test",
  "currency": "INR",
  "merchant_name": "Ordinary Goods Co.",
  "backend_version": "0.1.0"
}
```

If `mode` is `"live"`, show a persistent full-width warning bar on both pages. If this route fails, the app is unusable — render a single blocking panel explaining that the backend is unreachable, and nothing else.

### `POST /api/orders`

Request:

```json
{ "sku": "chai-001", "quantity": 1 }
```

The frontend sends what the customer wants, not what it costs.

Response:

```json
{
  "order_id": "order_XXXXXXXXXXXX",
  "amount": 24900,
  "currency": "INR",
  "receipt": "rcpt_1730291831",
  "status": "created"
}
```

### `POST /api/payments/verify`

Request — exactly the three fields Checkout's success handler provides:

```json
{
  "razorpay_payment_id": "pay_XXXXXXXXXXXX",
  "razorpay_order_id": "order_XXXXXXXXXXXX",
  "razorpay_signature": "9ef4dffbfd84…"
}
```

Response:

```json
{
  "verified": true,
  "payment": {
    "id": "pay_XXXXXXXXXXXX",
    "amount": 24900,
    "currency": "INR",
    "status": "captured",
    "method": "upi",
    "vpa": "success@razorpay",
    "created_at": 1730291840
  },
  "raw": "{…unmodified Razorpay payment JSON…}"
}
```

`verified: false` is a legitimate outcome, not an error. Render it as a failed verification with the raw body shown, not as a network error.

### `GET /api/probes`

Returns the probe registry. The frontend renders whatever the backend declares — do not hardcode the probe list in JS beyond a fallback used only by fixture mode.

```json
{
  "probes": [
    {
      "id": "P4",
      "title": "Mandate order with token object",
      "claim_id": "C2",
      "razorpay_call": "POST /v1/orders",
      "question": "Is the Reserve Pay substitute reachable on a plain test account?",
      "expectation": "gated",
      "requires": ["P3"],
      "destructive": false
    }
  ]
}
```

`expectation` is one of `reachable`, `gated`, `deprecated`, `unknown`. It records what was predicted *before* running, so the UI can show prediction versus outcome. This matters — display both.

`requires` lists probe IDs that must have run successfully first (e.g. `P4` needs the customer from `P3`). Disable a probe's run button until its requirements are satisfied, with a tooltip saying which.

### `POST /api/probes/run`

Request:

```json
{ "probe_ids": ["P1", "P3", "P4"] }
```

Response:

```json
{
  "results": [
    {
      "probe_id": "P4",
      "ran_at": "2026-08-29T14:03:11+05:30",
      "duration_ms": 412,
      "request": {
        "method": "POST",
        "path": "/v1/orders",
        "body": "{\"amount\":100,\"currency\":\"INR\",\"method\":\"upi\",…}"
      },
      "response": {
        "http_status": 400,
        "body": "{\"error\":{\"code\":\"BAD_REQUEST_ERROR\",…}}"
      },
      "razorpay_error": {
        "code": "BAD_REQUEST_ERROR",
        "description": "Recurring payments are not enabled for this merchant",
        "source": "business",
        "step": "payment_initiation",
        "reason": "input_validation_failed"
      },
      "verdict": "gated",
      "notes": null
    }
  ]
}
```

`verdict` is one of `reachable`, `gated`, `deprecated`, `error`, `unknown`. The backend decides it; the frontend renders it and never recomputes it.

`request.body` is already redacted server-side. Render it as-is.

### `GET /api/probes/results`

Returns `{ "results": [ … ] }` — every result recorded so far, newest first. Called on Bench load so a page refresh doesn't lose the session's evidence.

### `POST /api/payment-links`

Request: `{ "amount": 24900, "description": "Fallback for order_XXXX" }`

Response:

```json
{
  "id": "plink_XXXXXXXXXXXX",
  "short_url": "https://rzp.io/i/XXXXXXXX",
  "status": "created",
  "amount": 24900
}
```

### `GET /api/iin/{iin}`

`{iin}` is exactly 6 digits. Response is the passthrough:

```json
{
  "iin": "411111",
  "network": "Visa",
  "type": "credit",
  "issuer_name": "HDFC Bank Ltd",
  "international": false,
  "recurring": { "available": true },
  "authentication_types": [{ "type": "3ds" }, { "type": "otp" }],
  "raw": "{…}"
}
```

### `GET /api/events?since={unix_seconds}`

Webhook events the backend has received. Poll every 4 seconds while the Bench is visible; stop polling when the tab is hidden (`visibilitychange`).

```json
{
  "events": [
    {
      "id": "evt_XXXX",
      "event": "payment.captured",
      "received_at": 1730291841,
      "signature_valid": true,
      "raw": "{…}"
    }
  ],
  "server_time": 1730291900
}
```

If this route 404s, hide the event log section entirely rather than showing an empty one.

---

## 6. Views

### 6.1 Store (`index.html`)

One product. Ordinary. This page should look like it was built by a small business in 2023, not by a design studio — see §9.

Contains:

- Product image placeholder, name, price rendered from `amount` returned by `/api/orders` (fetch the order lazily on first Buy click; before that, show the display price from a constant and label it clearly as indicative).
- A **Buy now** button that runs the Checkout flow in §8.
- A result panel that appears after checkout resolves, showing: payment ID, order ID, verification verdict, method used, and a disclosure toggle for the raw payment JSON.
- A **Can't complete this? Send a payment link** button that calls `/api/payment-links` and renders the returned `short_url` as a copyable link plus a QR code. Generate the QR yourself with a small canvas routine or an inline SVG — do not fetch a QR image from a third party.
- A dismissible **test-mode helper** panel listing the credentials the human will need: UPI `success@razorpay` for the success path, `failure@razorpay` for failure, card `4111 1111 1111 1111` with any future expiry and any CVV.

**Required warning, shown persistently on the Store, not dismissible:**

> Test mode simulates payment approval. No UPI PIN is requested and cancellation resolves as success. A checkout that completes here has not demonstrated anything about live rails.

This warning is the most important string in the app. It stops the human drawing a false conclusion from a passing browser-automation run. Style it as a standing condition of the page, not a toast.

### 6.2 Bench (`bench.html`)

Three regions, in this order down the page.

**A. Claim ledger** — the primary view and the app's signature element.

One row per claim from §1. Each row shows the claim ID, the claim text, its current state (`UNTESTED` / `SUPPORTED` / `REFUTED` / `BLOCKED`), and which probes feed it. State is derived in `ledger.js` from the probe results:

- All feeding probes `reachable` → `SUPPORTED`
- Any feeding probe `deprecated`, or outcome contradicts the claim → `REFUTED`
- Any feeding probe `gated` and none refuting → `BLOCKED`
- No feeding probe has run → `UNTESTED`

Rows animate their state change once when a run completes — a single brief transition on the state chip and left rule. Nothing else on the page animates.

**B. Probe table** — one row per probe from `/api/probes`, grouped by claim.

Each row: probe ID, title, the Razorpay call it makes, predicted outcome, actual verdict, HTTP status, duration, and a run button. Rows with unmet `requires` are visually disabled with the reason available on hover and focus.

Clicking a row expands it in place to show:
- The question the probe answers
- Request method, path, redacted body
- `razorpay_error.description` rendered prominently in body text — this is the human-readable finding
- `code`, `source`, `step`, `reason` as a compact definition list
- Full raw response in a monospace JSON viewer with a copy button

Above the table: **Run all**, **Run unrun**, and a filter by verdict. Runs are sequential, not parallel — show a progress indicator naming the probe currently in flight. Razorpay rate-limits; do not fire concurrent requests.

**C. Event log** — webhook events, newest first, each with event type, received time, a signature-valid indicator, and an expandable raw body. Hidden entirely if `/api/events` is unavailable.

**Export**, available from the Bench header, produces two downloads from the same in-memory state:
- `bench-report.md` — a readable report: run timestamp, account mode, claim ledger as a table, then one section per probe with its question, prediction, verdict, and the error description. This is what the human pastes into a writeup.
- `bench-results.json` — the raw results array, unmodified.

Generate both client-side with `Blob` and an object URL. Do not ask the backend for them.

---

## 7. Fixture mode

The human is writing the Go backend in parallel. You must be able to build and check every screen without it.

Activate with `?fixtures=1` on either page. When active:

- `api.js` short-circuits every call and returns canned data from `fixtures.js` after a 200–600 ms artificial delay.
- Fixtures must cover **every state**, not just the happy path: a `reachable` probe, a `gated` probe with a realistic error envelope, a `deprecated` probe, an `error` probe, an unrun probe with unmet requirements, a `verified: false` payment, a `NOT_IMPLEMENTED` route, and an empty event log.
- A persistent badge reading `FIXTURES` sits in the top-right corner of the viewport so nobody mistakes canned data for evidence. It must be impossible to miss and impossible to dismiss.
- Export is disabled in fixture mode, with the button showing why.

Fixture data should read as plausible Razorpay responses. Use realistic ID prefixes (`order_`, `pay_`, `cust_`, `plink_`, `token_`) and realistic error descriptions.

---

## 8. Razorpay Checkout integration

Implemented in `js/checkout.js`. Keep every Checkout concern in this one file.

**Loading.** Inject `https://checkout.razorpay.com/v1/checkout.js` once, lazily, on the first Buy click — not in `<head>`. Resolve a promise on load, reject on error. If it fails to load, show an inline failure state offering the payment-link fallback. Never block initial page render on it.

**Flow.**

1. `POST /api/orders` with the SKU and quantity.
2. Build the options object using `key_id` from `/api/config` and `order_id` plus `amount` and `currency` from the order response.
3. `new Razorpay(options)` then `.open()`.

**Options to set:** `key`, `amount`, `currency`, `name`, `description`, `order_id`, `handler`, `prefill` (leave the values empty — do not invent a customer), `notes` (include your internal request ID so results can be correlated), `theme.color`, and `modal.ondismiss`.

**Three outcomes, all of which must be handled distinctly:**

- `handler(response)` fires on success. Take `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`, post them to `/api/payments/verify`, render the verdict. Show a pending state while verification is in flight — the payment is not confirmed until the backend says so.
- `rzp.on('payment.failed', callback)` fires on failure. The callback receives an object with an `error` property carrying `code`, `description`, `source`, `step`, `reason`, and `metadata` containing `order_id` and `payment_id`. Render the description prominently and the rest in the detail view. Do not collapse this into a generic "payment failed."
- `modal.ondismiss` fires when the user closes the modal. This is neither success nor failure — render it as abandoned and re-enable the Buy button. Do not report it as an error.

Guard against double-open: disable the Buy button while a Checkout instance is live.

---

## 9. Design direction

The two halves must not share a visual language. That divergence is the argument the app makes.

### The Store — deliberately ordinary

Plain system sans stack. Conventional single-column layout, product image left, details right, collapsing to stacked on narrow viewports. Modest border radius, a soft shadow on the buy card, one accent colour used for the button. It should be indistinguishable from a hundred real small Indian storefronts. **Do not make it beautiful.** If it looks designed, it stops representing "an ordinary Razorpay merchant" and the app's premise weakens.

Its one exception is the standing test-mode warning from §6.1, which should be visibly foreign to the page — a hairline-ruled band in the Bench's typeface and colours, as though the instrument has been clamped onto the storefront. That intrusion is intentional.

### The Bench — a field instrument

Type: **IBM Plex Sans** for prose and labels, **IBM Plex Mono** for all data, IDs, endpoints, statuses, and JSON. Self-host both as WOFF2. Every identifier, HTTP status, and endpoint path is monospace, always — that consistency is what makes the screen scannable.

Palette — define these in `tokens.css` and derive everything from them:

```
--ground     #E6E9E4   cool grey-green, the working surface
--ground-alt #DDE1DB   recessed panels, table header
--ink        #191D19   primary text
--ink-muted  #5C635C   labels, metadata
--rule       #B4BAB2   hairlines, 1px, used generously
--accent     #2A3FB8   interactive elements, focus rings, links
--reachable  #2F6B4F
--gated      #9C6512
--deprecated #8C2F2A
--unknown    #5C635C
```

Structure carries meaning. Every probe row and every ledger row has a 3px left rule coloured by verdict. Verdict words render in mono, uppercase, letter-spaced. Hairline rules separate rows; no card shadows, no rounded corners above 2px. Density is a feature — this is a readout, not a marketing page.

**Signature element: the claim ledger.** It is the first thing on the Bench, it is the widest element on the page, and it is the only place with motion. A claim's state chip and left rule transition once when a run resolves — a 180 ms colour and position change, nothing more. Everything else is still. Spend all the boldness here.

What to avoid, because they are the current defaults and will read as generic: cream backgrounds with a terracotta accent, near-black with a single acid-green accent, and broadsheet layouts with zero radius and newspaper columns. The palette above is specified precisely so you don't drift toward any of them.

### Quality floor

Responsive down to 360px. Visible keyboard focus on every interactive element using `--accent`. `prefers-reduced-motion: reduce` disables the ledger transition. Colour is never the sole carrier of meaning — every verdict has its word next to its colour. Expandable rows use real `<button>` elements with `aria-expanded`, and the tables are real `<table>` markup.

### Copy

Sentence case throughout. Active voice. A button says what happens: **Run probe**, not *Execute*. An action keeps its name through the flow — **Run probe** produces a row that says **Ran**.

Failure states explain and direct. Not *Something went wrong* but **This route isn't implemented on the backend yet. Add `POST /api/probes/run` to enable probe runs.** Empty states invite action: **No probes have run. Start with P1 to confirm the account works at all.**

Never write copy that implies a result is more certain than it is. A probe that returns `reachable` in test mode has shown that the API accepted the call — not that the feature works on live rails.

---

## 10. Anti-goals

Do not build any of these. If you think one is needed, put it in the README under "deliberately omitted" instead.

- Authentication, sessions, users, or accounts
- A cart, a catalogue, product variants, or more than one SKU
- Any database or persistence beyond in-memory state plus what the backend returns
- Server-side rendering, routing libraries, or a state management library
- Dark mode, theme switching, or a settings panel
- Tests beyond a single manual smoke checklist in the README
- Any part of the Go backend, including handler stubs, route sketches, or an OpenAPI file
- Retry logic that re-fires probe requests automatically — a failed probe is data, not a problem to paper over

---

## 11. Build order

Work in this sequence and stop for review at each checkpoint.

1. `tokens.css`, `reset.css`, fonts, and a single static page proving the type scale and verdict colours. **Checkpoint.**
2. `api.js`, `config.js`, `fixtures.js`, `money.js` — the data layer, with fixture mode working end to end and nothing rendered yet.
3. Bench: claim ledger and probe table against fixtures, all states visible. **Checkpoint — this is the most important screen.**
4. Bench: expansion detail, JSON viewer, event log, export.
5. Store: product page, Checkout integration, result panel, payment-link fallback.
6. Responsive pass, keyboard pass, reduced-motion pass.
7. README: how to run, what each file does, which `/api/*` routes the backend still needs, and the smoke checklist.

---

## 12. Acceptance checklist

The human will check these. Verify them yourself first.

- [ ] `grep -ri "key_secret\|secret\|hmac" static/` returns nothing meaningful
- [ ] No `rzp_test_` or `rzp_live_` string appears anywhere in `static/`
- [ ] `?fixtures=1` renders every screen and every state with the backend completely down
- [ ] The `FIXTURES` badge is visible on every fixture-mode screen and cannot be dismissed
- [ ] Killing the backend mid-session produces per-feature `NOT_IMPLEMENTED` or unreachable states, never a blank page or an uncaught exception
- [ ] A probe returning HTTP 400 renders `error.description` as readable prose, with the full raw body one click away
- [ ] Raw response strings in the export match the strings the backend returned, byte for byte
- [ ] The standing test-mode warning is present on the Store and cannot be dismissed
- [ ] Checkout dismissal is reported as abandoned, not as failure
- [ ] Every interactive element is reachable and operable by keyboard with a visible focus ring
- [ ] The claim ledger's state transition is the only animation on the Bench, and it is suppressed under `prefers-reduced-motion`
- [ ] The Store and the Bench are obviously different products at a glance