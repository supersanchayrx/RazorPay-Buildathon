# Findings 01 — The API surface

What exists, what is refused, and how to tell a typo from an entitlement gate.

All `[PROBE]` unless marked otherwise. Base `https://api.razorpay.com/v1`, no trailing slash — confirmed, no double-slash bug. Auth is HTTP Basic, key ID as username, key secret as password.

---

## Three distinguishable failure shapes

| Request | Status | Body |
|---|---|---|
| `/payments/create/not_a_real_flow` | 404 | bare `{"message":"no Route matched with those values"}`, no envelope |
| `/orders/not_a_real_order_id` | 400 | error envelope, `input_validation_failed` |
| `/iins/411111` | 400 | error envelope, "The requested URL was not found on the server." |

These come from **two different layers**, and knowing which is which is what makes the inference work:

- **`no Route matched with those values`** is Kong's stock message — the API gateway at the edge. It means the path was not in the gateway's route table. Nothing behind the gateway ever saw the request.
- **"The requested URL was not found on the server."** is a Python framework's stock 404, wrapped here in Razorpay's own error envelope. It means a service *behind* the gateway received the request and had no handler for it.

So the two failing endpoints are **registered routes refused at the application layer**, not typos.

---

## The misspelled-sibling control

The test that rules out "the path shape is just slightly wrong":

| Request | Status | Layer that answered |
|---|---|---|
| `/iins/411111` | 400 | application |
| `/iins/999999` | 400 | application — same message for a nonsense IIN |
| `/iinz/411111` | 404 | **gateway** |
| `/iins` | 404 | **gateway** |
| `/orders/zzz/nope` | 404 | **gateway** |

One letter changed and it stops reaching the application entirely. So `/v1/iins/{iin}` is a **specifically registered route** — that exact spelling, that exact arity — and there is no catch-all swallowing arbitrary paths.

Someone configured that route on purpose. A path nobody ever supported would not be in the table.

**Auth is ruled out too.** `/iins/411111` with no `Authorization` header returns **401** "Please provide your api key for authentication purposes". So the endpoint does want merchant credentials; with Basic auth it passes authentication and *then* the application says it has no such URL. The "some endpoints only want the key ID" hypothesis is dead for this one.

**Unresolved:** whether the route is withheld from this merchant or was removed with the gateway entry left standing. Both mean unavailable; only the first would change with an account upgrade. `[OPEN]`

### A gateway 404 does not always mean "no such route"

**It can also mean "the route exists and your id is the wrong shape."** This was
misread mid-session and had to be corrected.

| Request | Status | Layer |
|---|---|---|
| `/items/item_fake123` | 404 | **gateway** — bare Kong message |
| `/items/item_AAAAAAAAAAAAAA` | 400 | application — "The id provided does not exist" |
| `/payment_pages/pp_fake123` | 404 | **gateway** |
| `/payment_pages/pp_AAAAAAAAAAAAAA` | 400 | application — same message |
| `/items/{a real id}` | 200 | the route plainly exists |

Razorpay ids are a prefix plus **14** base62 characters, and the gateway route
patterns appear to constrain that length. A wrongly *sized* id never reaches the
application.

So the misspelled-sibling control is still sound — it varies a letter in the
**path** — but the same reading applied to a malformed **id** produces a false
"this endpoint does not exist". Note also that `/orders/order_fake123` *does*
reach the application (`400 "fake123 is not a valid id"`), so the behaviour is
not uniform across endpoints. Always test a well-formed-but-absent id before
concluding a route is missing.

---

## Auth requirements by endpoint

Tested with `bench-cli get PATH --no-auth`:

| Endpoint | No auth header | Basic auth |
|---|---|---|
| `/methods?key_id=...` | **200** | 200 |
| `/preferences?key_id=...` | **200** | 200 |
| `/iins/411111` | 401 | 400 (app-level) |
| `/orders` | 401 | 200 |

`/methods` and `/preferences` are genuinely publishable-tier — addressed by key ID in the query string, no secret involved. That is why they are safe for a browser and why they are the right pre-flight calls for an agent.

---

## Endpoint map

### Reachable and useful

| Endpoint | Notes |
|---|---|
| `POST /orders` | The substrate. Accepts far more than it renders back — see [findings-03](findings-03-checkout-behaviour.md) |
| `GET /orders/{id}` | Renders order **accounting only**. Hides `token`, `method`, `customer_id`, `line_items`. Does render `notes` |
| `GET /orders/{id}/payments` | The payments against an order |
| `POST /customers` | Use `fail_existing: "0"` so re-runs are idempotent |
| `POST /payment_links` | `notify: {sms: false, email: false}` suppresses notifications. **The only path proven end to end to captured money** |
| `GET /methods?key_id=` | Method-level capability |
| `GET /preferences?key_id=` | The richest endpoint available. See [findings-02](findings-02-capability-discovery.md) |
| `GET /payments/downtimes` | Works on a plain test account, returns real data. See [findings-02](findings-02-capability-discovery.md) |
| `GET /payments` | The failure corpus lives here |

### Read-only routes

| Endpoint | Notes |
|---|---|
| `GET /payment_pages` | **200**, `count: 0`. `POST /payment_pages` returns a **bare gateway 404** — the route table has a read route and no write route. Payment Pages are dashboard-created and API-readable only. `/payment_pagez` and `/payment_page` both gateway-404, so the spelling is specifically registered |

`[OPEN]` Whether a dashboard-created Payment Page exposes item and stock data.
That is the one place Razorpay might hold a minimal catalog, and it needs a
dashboard step to test.

### `/items` — writable, and strict

Reachable, writable, `PATCH`-able, with an `active` flag usable as a soft delete.
**It is not a catalog**, and the API says so itself:

```
POST /items {"sku":..., "stock":..., "image_url":..., "variants":...,
             "category":..., "notes":...}
-> 400 "sku, stock, image_url, variants, category, notes is/are not
        required and should not be sent"     reason: extra_field_sent

POST /items {"type":"product"}  ->  400 "Not a valid type: product"
```

Every item comes back `type: "invoice"` — a closed enum with one member. The
complete accepted field set is `name, description, amount, currency, unit,
tax_inclusive, hsn_code, sac_code, tax_rate, tax_id, tax_group_id`. No stock, no
SKU, no images, no variants, and **no `notes`** — items are the one entity where
the "stamp your own id everywhere" strategy does not work. A zero amount is
rejected ("The amount must be atleast INR 1.00"); `currency: "USD"` is accepted.

Order `line_items`, by contrast, **do** accept `sku` and read back intact from
`/preferences` ([findings-03](findings-03-checkout-behaviour.md)). If you need to
carry catalog data on a Razorpay object, that is the better carrier.

### Reachable and empty

`/subscriptions`, `/plans`, `/invoices`, `/settlements`, `/customers`.

All 200. `/subscriptions` and `/plans` being open is worth noting — that is a second route to mandates that does not go through the Orders token object, and it is untested.

### Refused at the application layer

| Endpoint | Meaning |
|---|---|
| `/iins/{iin}` | Registered route, credentials accepted, no handler. Cards *are* enabled, so this is not a method gate |
| `/accounts` | Partner-only. Same shape as IIN |
| `/payments/create/upi` | Refused — but confounded by `upi: false` account-wide, so it says nothing about PCI-DSS |

### Do not exist as guessed

`/tokens`, `/payments/validate/vpa`, `/1cc/config`, `/merchant/1cc_config`, `/1cc/coupons`, `/orders/1cc/configs`, `/merchant/config`, `/checkout/preferences`.

All bare gateway 404s. **These were guesses, not Razorpay's paths** — record them as "not located", not "does not exist". Guessing at URLs is the thing the Bench is supposed to stop.

---

## Query parameters that work and don't

| Query | Result |
|---|---|
| `/orders?customer_id=...` | **400** "customer_id is/are not required and should not be sent" |
| `/payments?customer_id=...` | **400**, same |
| `/payments?contact=%2B91...` | **200 — and it genuinely filters.** Undocumented; see below |
| `/payments?email=...` | **400** `extra_field_sent` |
| `/customers?contact=` / `?email=` | **200 — accepted and silently ignored.** See [findings-04](findings-04-customer-data.md) |
| `/orders?notes[key]=value` | **400** `extra_field_sent` |
| `/invoices?customer_id=...` | **200** |
| `/orders?expand[]=payments` | 200 |
| `/orders/{id}?expand[]=line_items` | 200, but returns `line_items: null` even post-payment |
| `/orders/{id}?expand[]=customer_details` | 400 |
| `/preferences?key_id=X&order_id=Y` | 200 with an `order` block — **the surface that shows what checkout will do** |
| `/preferences?...&order_id=<paid order>` | 400 "the order is invalid" |

**Invoices and Subscriptions are the customer-indexed entities. Orders and Payments are not.** That drives the identity problem in [findings-04](findings-04-customer-data.md).

---

## The error envelope

Every failed payment carries `code`, `description`, `source`, `step`, `reason` and `metadata`, on both the payment entity (as `error_code` etc.) and the `payment.failed` event. Razorpay frames these as the who, where and why. `[DOCS]`

Published enums: `[DOCS]`

| Field | Values |
|---|---|
| `source` | `customer`, `business`, `internal`, `gateway`, `issuer_bank` |
| `step` | `payment_initiation`, `card_enrollment_check`, `payment_authentication`, `payment_authorization`, `payment_capture` |
| `reason` | e.g. `invalid_otp`, `input_validation_failed`, `international_transaction_not_allowed` |

**Correction — the published enum is not what arrives.** `[PROBE]` The docs list
`issuer_bank`. Across the 15 payments on this account the observed values are
**`customer`, `business`, `bank` and `issuer`** — `issuer_bank` appears nowhere.
An earlier version of this doc told you to branch on `issuer_bank` and warned
that the short form matches nothing. **That advice was backwards.** Branch on
what arrives, and treat the documented enum as a superset of unverified spellings.

### Retry must be a grid, not a lookup

`source` says *whose problem it is*. `reason` says *what to do*. Same source, opposite actions:

| source | reason | action |
|---|---|---|
| `business` | `international_transaction_not_allowed` | switch method, never retry |
| `business` | `input_validation_failed` | **fix our own request** — don't switch, don't retry |
| `customer` | `invalid_otp` | same method, ask again |
| `issuer_bank` | `payment_authorization` | switch method, don't retry |

A source-only rule would tell the agent to switch payment method when the real fault is a malformed request of our own making.

**Caveat:** only `business` and `internal` have actually been *observed* on this account. The rest is documentation. The corpus is one row deep and the grid is a design sketch.

### What a payment never carries

The union of every key across all 15 payments on the account: `[PROBE]`

```
acquirer_data amount amount_captured amount_refunded bank captured card card_id
contact created_at currency description email entity error_code
error_description error_reason error_source error_step fee id international
invoice_id method notes order_id refund_status status tax vpa wallet
```

Present on 0 of 15: **`ip`, `device`, `location`, `user_agent`, `customer_id`,
`billing_address`, `shipping_address`.** `notes` is present on 15 of 15. Note in
particular that **no payment carries a `customer_id`**, even when its order was
created with one.

### The one real failure captured

International card against a payment link:

```
error_reason:      international_transaction_not_allowed
error_source:      business
error_step:        payment_initiation
error_description: domestic (Indian) card payments only; try another method
```

Branch on `error_reason` — a stable slug. Show `error_description` — prose written for humans, free to change wording.

This composes neatly with the capability handshake: Razorpay says *try another method*, `/methods` says *which ones exist*. Good demo beat.

Also on that object: `token_iin` was present on the failed card. **Razorpay hands over card intelligence after the attempt has already failed, not before, when an agent would need it to route.** A concrete example of tooling shaped for reporting rather than for deciding — and it reframes the IIN gap from "the data is unavailable" to "the data is available for reporting, not for deciding."

---

## `/payments?contact=` — an undocumented filter that works

Not in the docs. The Fetch All Payments page lists **only** `from`, `to`,
`count` and `skip`; `contact` appears there solely as a *response* field.
`[DOCS]` It nonetheless filters, and the controls hold: `[PROBE]`

| Query | count |
|---|---|
| `/payments?count=100` | 15 |
| `/payments?contact=%2B917484818651` | **3** — all matching |
| `/payments?contact=%2B917527522578` | **2** — all matching |
| `/payments?contact=%2B910000000000` | **0** — negative control passes |
| `/payments?contact=7484818651` | **0** — same number, no `+91` |

Two things follow.

**It is an exact string match.** Store `9000000002` and query `+919000000002`
and you get silence, not an error. This makes E.164 normalisation
load-bearing rather than cosmetic ([findings-04](findings-04-customer-data.md)).

**It overturns a claim in [findings-04](findings-04-customer-data.md)** that
"what did this person buy over time means fetching everything and grouping on
strings you do not control." You can filter server-side. But because it is
undocumented it may disappear without notice, so treat it as a fast path with a
`from`/`to` full-sync fallback — **never as the only route.**

It is also **unreachable through MCP**, whose `fetch_all_payments` exposes only
the four documented parameters ([findings-05](findings-05-mcp-surface.md)).

---

## Abandonment: the stage ladder

Richer than previously recorded. For an *attempted* payment the stage is
directly readable; before that there is a hard blind spot.

| Stage | Visible server-side? | How |
|---|---|---|
| Order created | yes | order exists, `status: created`, `attempts: 0` |
| Checkout opened | **no** | nothing. No field, no webhook |
| Method chosen, details typed | **no** | nothing |
| Payment submitted | yes | `order.attempts` increments, payment record appears |
| Died at a specific step | yes | **`error_step`** |
| Authorised / captured | yes | `payment.status`, webhooks |

### `error_step` is the stage, and it separates the payer from the bank

Distribution across the 15 payments on this account:

| `error_step` | n | `error_source` | `error_reason` |
|---|---|---|---|
| `payment_initiation` | 1 | `business` | `international_transaction_not_allowed` |
| `payment_authentication` | 2 | `customer` | `payment_cancelled` |
| `payment_authorization` | 2 | `bank`, `issuer` | `payment_failed` |

**`source: customer` + `reason: payment_cancelled` at `payment_authentication`
is recorded abandonment** — the payer reached the bank or wallet screen and
walked away, and Razorpay wrote it down with the stage attached. So two things
that look identical in a funnel are cleanly separable:

- **the payer gave up** → `customer` / `payment_cancelled` → worth re-asking
- **the bank refused** → `bank` or `issuer` / `payment_failed` → switch method

Retries are visible too: `order.attempts` across 27 orders is
`{0: 17, 1: 7, 2: 3}`. Three orders needed a second attempt to succeed.

### The blind spot

**17 of 27 orders sit at `attempts: 0, status: created`**, and that bucket mixes
"never opened checkout", "opened it and left", and "started typing and left".
Server-side these are **indistinguishable**.

**No webhook closes it.** The full supported-events list — 60+ events across
orders, payments, links, refunds, disputes, subscriptions, QR codes, virtual
accounts, payouts and settlements — contains **nothing** for a customer opening
or abandoning checkout, and no cart-abandonment event of any kind. `[DOCS]`

**This contradicts buildplan §5.5**, which states Magic Checkout emits an
abandoned-cart webhook. Not in the event list. Likely a Shopify-plugin or Agent
Studio feature rather than a webhook. **Do not let Part C depend on it.** `[DEAD]`

Payment links carry no view tracking either — the object is pure config and
money, and `status` only moves `created` → `paid`.

### Closing it requires client instrumentation

The documented hooks, all client-side: `[DOCS]`

```js
modal: {
  ondismiss:     function(){},  // "called when the modal is closed by the user"
  confirm_close: true,          // confirmation dialog on close
  backdropclose: false, escape: true, handleback: true
}
rzp.on('payment.failed', r => {
  r.error.step; r.error.source; r.error.reason;
  r.error.metadata.order_id; r.error.metadata.payment_id;
});
```

So log the stages yourself — `checkout_opened` when you call `rzp.open()`,
`checkout_dismissed` on `ondismiss`, `payment_failed` from the event — then
reconcile against `order.attempts` and `payment.error_step`.

**The trap:** with `retry` false, `ondismiss` fires when checkout closes **even
after a failure**. `[DOCS]` A dismiss alone is therefore not abandonment; without
correlating against a preceding `payment.failed` you will double-count every
failed payment as an abandonment.

Concretely, on the old record: several phone numbers were typed into modals
during testing and then dismissed. None of them exist anywhere.

---

## Small gotchas

- **An order is single use.** A paid order makes checkout show "Uh! oh! Something went wrong" — the user-facing rendering of the same 400 the API gives. Easy to misread as a broken feature; it cost one test run. Mint a fresh order per test.
- A zero-amount order is rejected outright ("Order amount less than minimum amount allowed") *before* mandate validation is reached. Don't use `amount: 0` to probe mandate support.
- Malformed order id → `400 "...is not a valid id"`. Well-formed but absent → 404. Two shapes for "not found".
- `GET /orders?count=1` is a good zero-side-effect auth preflight: 200 proves credentials and base URL, 401 proves bad keys, 404 proves bad path.
- The invented `"flow": "reserve_pay"` probe proves nothing either way — the endpoint returned "URL not found", so the payload was never evaluated. No-evidence, not refuted.
