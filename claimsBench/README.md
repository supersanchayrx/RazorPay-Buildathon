# claimsBench — API reconnaissance for the agent

**This is not the project.** The project is the agent. This is the throwaway-ish
tool that answered "what can a plain Razorpay test account actually do?" before
we committed the agent to depending on any of it.

Three of six assumptions turned out to be wrong, which is why it was worth
building. Findings are at the bottom — that section is the actual output; the
rest is just how to re-run it.

The `bench` package is deliberately network-free and CLI-free, so if the agent
needs to re-check a capability at runtime it can import `bench` and `razorpay`
directly rather than shelling out to this CLI.

## Findings

Test account, last full run.

| Claim | State | Evidence |
|---|---|---|
| C1 orders + checkout | `supported` | P1, P2 → 200 |
| C2 mandate tokens (`max_amount`, `expire_at`, `frequency`) | `supported` for order creation, `untested` beyond it | P4 → 200 and P13 confirms the token is stored, enriched and rendered on the checkout preferences document — but authorising a payment against it was never attempted |
| C3 server-to-server UPI without PCI-DSS | **untestable here** | P5 → 400; but `/methods` reports `upi: false`, so the test is confounded |
| C4 IIN lookup | `refuted` | P7 → 400 on a registered route, and cards *are* enabled, so this is not a method gate |
| C5 payment links | `supported`, proven end-to-end | P8 → 200, link opened and payment captured |
| C6 UPI Reserve Pay reachable self-serve | **no evidence either way** | P10 → 400, and UPI is off account-wide |
| C7 enabled payment methods are discoverable | `supported` | P14 → 200, a detailed capability document |

The `run` command still prints C2 as `supported`, because the tool only knows
that the call returned 200. The table above is the honest reading; see the
caveats.

**What the agent can rely on:** creating orders, fetching them back, creating
customers, and payment links. Payment links are the only path confirmed all the
way through to captured money. Method availability is discoverable at runtime.

**What is unavailable:** IIN lookup, and anything UPI — the latter because UPI
is switched off for this account entirely, which is a different fact from the
one C3 was written to test.

### Caveats that matter for agent design

**P5, P7 and P10 returned the identical message across two different endpoints:**
`400` with "The requested URL was not found on the server." That is probably one
fact, not three — these surfaces simply are not present for a plain test
account, and Razorpay hides them rather than refusing them.

**This has now been controlled for, and the ambiguity is resolved.** Razorpay
returns three distinguishable shapes:

| Request | Status | Body |
|---|---|---|
| `/payments/create/not_a_real_flow` | 404 | `{"message":"no Route matched with those values"}` |
| `/orders/not_a_real_order_id` | 400 | `error` envelope, `input_validation_failed` |
| `/iins/411111` | 400 | `error` envelope, "The requested URL was not found on the server." |

An address the gateway does not recognise produces a bare **`no Route matched
with those values`** with no `error` envelope at all. That is *not* what
`/iins/{iin}` or `/payments/create/upi` return — both return the Razorpay error
envelope, which means the request cleared the gateway, reached the application,
and was refused there.

The two messages come from two different layers, and knowing which is which is
what makes the inference work. `no Route matched with those values` is the stock
response of Kong, the API gateway sitting at the edge; it means the path was not
in the gateway's route table. `The requested URL was not found on the server.`
is the stock 404 text of a Python web framework, wrapped here in Razorpay's own
error envelope; it means a service *behind* the gateway received the request and
had no handler for it.

**Misspelled-sibling control**, to rule out "the path shape is just slightly
wrong":

| Request | Status | Layer that answered |
|---|---|---|
| `/iins/411111` | 400 | application ("URL was not found on the server") |
| `/iins/999999` | 400 | application — same message for a nonsense IIN |
| `/iinz/411111` | 404 | gateway (`no Route matched`) |
| `/iins` | 404 | gateway (`no Route matched`) |
| `/orders/zzz/nope` | 404 | gateway (`no Route matched`) |

One letter changed, and it stops reaching the application entirely. So
`/v1/iins/{iin}` is a **specifically registered route** — that exact spelling,
that exact arity — and there is no catch-all swallowing arbitrary paths. Someone
configured that route on purpose. C4's reading holds.

The auth question is closed too. `/iins/411111` **with no Authorization header
returns 401** "Please provide your api key for authentication purposes", so the
endpoint does want merchant credentials and the wrong-auth-scheme explanation is
dead. With Basic auth it passes authentication and *then* the application says
it has no such URL.

What remains genuinely unresolved is *why* the application refuses: withheld
from this merchant, or removed while the gateway route lingers. Both mean
unavailable; only the first would change with an account upgrade.

This control also exposed a classifier bug, now fixed: a gateway 404 used to be
classified `deprecated`, which would let a typo in a probe masquerade as a
discovery. It now classifies as `error` — a defect in the bench, not a finding
about Razorpay.

An earlier version of this file claimed the reserve-pay result was stronger
"because it was the predicted outcome" — that is confirmation bias, not
evidence. A result matching a prediction is exactly the one to attack hardest,
since nobody questions an answer they like.

### The bound that looked dropped and was not

**This section previously reported that Razorpay silently discarded a spending
cap. That was wrong, and it was the headline finding. Here is the correction.**

P4 sends an order carrying a `token` object (`max_amount`, `expire_at`,
`frequency`), a `customer_id` and `method: "upi"`, and gets a 200. Fetching that
order back through `GET /orders/{id}` returns

```json
{ "id": "order_TWT4hqPOoe24gD", "entity": "order", "amount": 50000,
  "currency": "INR", "receipt": "bench-p4", "status": "created",
  "attempts": 0, "notes": [], "offer_id": null, "description": null }
```

No `token`, no `customer_id`, no `method` — which read as an obvious silent
field drop, and was written up as one.

**It was not.** The checkout preferences document, asked about the same order,
returns:

```json
"order": {
  "amount": 50000, "currency": "INR", "method": "upi",
  "token": { "max_amount": 1000000, "frequency": "monthly",
             "start_time": 1788199188, "end_time": 1804096787,
             "recurring_type": "before" }
}
```

The cap is there, at the value sent. `expire_at` was stored as `end_time`, and
`recurring_type: "before"` was **added by Razorpay** — a field never sent, so
this is not the request being echoed back, it is a processed, enriched, stored
mandate.

Control, to rule out boilerplate: the plain order from P1, created with no token
at all, has an order block with **no `token` and no `method`**. The fields
appear only on the orders that carried them.

So `GET /orders/{id}` simply does not render the mandate. The Orders API is not
the surface that consumes it; checkout is.

**What actually survives, and it is still worth something.** The verification
step produced a confident false negative. Reading the object back from the
obvious endpoint said the bound was gone, and the bound was there. So the rule
is narrower than first written:

> A bound must be verified — **on the surface that consumes it.** A read-back
> that shows nothing is not proof of absence; it may just be the wrong window
> onto the same object.

Note which way this fails. The naive echo-check does not wave a nonexistent
bound through; it does the opposite, refusing to proceed on a bound that really
exists. That is a **false refusal**, which is the failure mode worth counting
(and the one Track 02 asks to be measured). An over-eager verifier is safer than
a credulous one, but it is not free.

`Probe.MustEcho` still does the job — it just has to name fields on the right
endpoint. P13 now asks the preferences document, not the Orders API, and the
comment on it records why.

**Still genuinely unknown:** whether a payment can be *authorised* against that
mandate. Creating the order is the cheap half, and with `upi: false` on this
account the expensive half cannot be attempted at all. C2 is `supported` for
order creation and `untested` for anything past it — do not let the first stand
in for the second.

Separately, and still true: a test account is routinely more permissive than a
live one, so even a genuine success would not have proved live parity.

**P10 proves nothing about reserve pay.** The probe came from the frontend
fixtures; the payload value `"flow": "reserve_pay"` was invented for this bench
and cannot be sourced to any Razorpay documentation. It is moot either way,
because the endpoint returned "URL not found" — the request never reached
payload validation, so the flow value was never evaluated. Treat this row as
absent, not as a refutation.

**Gating arrives as a 400, not a 403.** "Recurring payments are not enabled for
this account" comes back as a plain `400 BAD_REQUEST_ERROR`. Anything in the
agent that reacts to Razorpay errors needs to read the body, not just the status.

**P5 and P10 both pay P1's order,** because s2s UPI needs an `order_id` and
neither probe had a prerequisite of its own. If P5 ever succeeds, P10 will fail
with "order already paid" and report a misleading `unknown`.

**There IS a capability handshake, and an earlier version of this file was
wrong to deny it.** `GET /methods?key_id=...` takes the key id — not the secret —
and returns a detailed document of what the account can actually accept:

```json
"card": true, "debit_card": true, "credit_card": true,
"card_networks": { "VISA": 1, "MC": 1, "RUPAY": 1, "MAES": 1,
                   "AMEX": 0, "DICL": 0, "JCB": 0 },
"wallet": { "airtelmoney": true, "mobikwik": true, "olamoney": true },
"netbanking": { ...40 banks... },
"nach": true,
"upi": false, "upi_intent": true,
"emi": false, "cod": false, "paylater": [], "cardless_emi": []
```

This is the single most useful thing the bench found, and it should be the first
call the agent makes. It resolves at runtime exactly the question the retry
logic needs: *which methods can I even offer?*

Consequences:

- **`upi: false` explains C3, C6 and the whole UPI story.** Those endpoints
  refuse because UPI is not enabled for this merchant — not because of PCI-DSS.
  So C3 as written cannot be tested on this account at all; recording it as
  `refuted` would be wrong. **Next action: turn UPI on in the dashboard**
  (Settings → Payment Methods) and re-run, rather than reasoning further from
  the outside. Every UPI result currently on record is confounded by that one
  switch, which makes flipping it the highest-value thing left to do.
- **It does not explain C4.** Cards are enabled, yet IIN lookup is refused, so
  that is a genuine product-level gap rather than a method gate.
- **`nach: true` is evidence for the argument, not a target for the build.**
  Mandates via NACH are enabled even though UPI Autopay is not — so the
  approve-once-then-operate-inside-an-envelope shape exists on a second,
  independent rail. Cite it as corroboration. Do **not** build on it: NACH is a
  slow bank-debit rail with its own registration ceremony, designed for monthly
  subscriptions, and it cannot complete a purchase in the moment, which is
  exactly the thing the agent has to demonstrate.
- **`upi: false` alongside `upi_intent: true` is probably not a contradiction.**
  Working hypothesis: the first is the older collect flow, where the customer
  types a UPI address and approves a request, which was retired; the second is
  the handoff-to-a-phone-app flow. Two different products, so two different
  answers. Unconfirmed — but "these are separate things" is a better first guess
  than "the document is unreliable", and the earlier note distrusting both was
  too quick.

It still reports only *methods*, not products — nothing here mentions s2s or
IIN. It does carry `recurring`, keyed by bank rather than by card number:
`recurring.card.credit` (Visa, MasterCard, RuPay), `recurring.card.debit`
(51 banks), and `recurring.emandate` — **298 banks, each with its `auth_types`**
(aadhaar, debitcard, netbanking). That is most of what the dead IIN endpoint was
supposed to supply, for bank mandates.

It does not rescue cards. `recurring.card.debit` is keyed by bank code, and the
only way to learn a card's bank is the IIN lookup, which is refused — and
`issuer` came back `null` on the one card object we have. So bank mandate
decisioning is possible today and card mandate decisioning is not.

### An API acceptance is not an entitlement check

The most reusable lesson here, and it cost several wrong conclusions to learn.

Razorpay's write path and its execution path are separate systems that do not
consult each other. An order can be accepted, stored, enriched with
server-side fields, and labelled correctly in the dashboard for a feature the
account cannot actually run. Nothing reports the gap until a human opens a
checkout.

Demonstrated on Magic Checkout. `POST /orders` with `line_items` returns 200,
Razorpay adds `cod_fee` and `shipping_fee` (fields only 1cc orders carry), the
cart reads back intact from the preferences document, and the dashboard labels
the order **"Order Type: Magic Checkout"**. Five signals, all green.

The modal then ignores all of it. Controlled comparison, three runs, fresh order
each time:

| Run | Methods shown | Phone | Email | Address |
|---|---|---|---|---|
| Standard, card only | cards only | yes | no | no |
| Standard (control) | cards, netbanking, wallet | yes | no | no |
| `one_click_checkout: true` | cards, netbanking, wallet | yes | no | no |

Identical. No address step, no coupon field, no line items rendered, and **zero
1cc network requests** from checkout.js.

The card-only run is what makes this conclusive rather than suggestive. It
passed `method: {card: true, netbanking: false, wallet: false}` in the same
options object — and that *worked*, the other blocks disappeared. So checkout.js
reads the options fine. `one_click_checkout` is received and discarded.

`magic: true` in the preferences document therefore reports availability, not
entitlement — the same trap as `upi_intent: true` beside `upi_type: {collect: 0,
intent: 0}`. The root cause for both is almost certainly `activated: false`.

**Rule: the only trustworthy test is one that exercises the surface a human
touches.** Reading the object back is not enough. It gave a false negative on
the mandate token and a false positive on Magic Checkout — wrong in both
directions, from the same mistake.

### Razorpay collects a phone number and nothing else

Neither surface asks for an email. Not the checkout modal — on wallet, on
netbanking, or with cards forced as the only option — and not a payment link,
with or without a `customer` block supplied at creation. Every one of those was
tested directly.

Where email is missing Razorpay writes **`void@razorpay.com`**: a sentinel that
is well formed, passes any validation you would write, and is identical for
every payer. Group customers by email and they all become one person.

The cause is a **dashboard setting**: Account & Settings → Checkout Features →
"Collect email from customers". It was off. Turning it on to Mandatory changed
the behaviour immediately:

```
00:36  netbanking  void@razorpay.com                   <- setting off
00:36  wallet      void@razorpay.com                   <- setting off
00:47  wallet      hithisemailtestisworking@gmail.com  <- setting on
```

Eleven minutes apart, wallet on both sides, so the setting is the variable and
not the payment method. The older `yhag@gmail.com` came in through a card
attempt while the setting was on.

Two earlier explanations in this file were wrong and are recorded so they are
not re-derived: that payment links collect email and the modal does not
(inferred from which payments happened to have one, refuted by a fresh link),
and that A/B bucketing was responsible (plausible, and there really is
per-request bucketing — see below — but it was not the cause here). Method rule
7 already said to check the dashboard before reasoning about entitlement. It
would have saved both.

### The setting is invisible to the API

Enabling mandatory email visibly reduced the methods offered in the modal. The
capability documents did not move at all:

| | before | after |
|---|---|---|
| `optional` | `[]` | `[]` |
| `methods.card` | true | true |
| `methods.netbanking` | 40 banks | 40 banks |
| `methods.wallet` | 3 | 3 |

So the filtering happens at render time, and **`/methods` and `/preferences`
describe what the account can do, not what a payer will be offered.** An agent
reading them gets a superset — every method listed there may not appear, and
nothing in the response says which.

That matters directly for any payment-path decision built on the capability
handshake: it is the right input, but it is an upper bound, not a prediction.

### Checkout is not deterministic — Razorpay A/B tests it per request

The preferences document carries an `experiments` block of **362 flags**. Three
identical unauthenticated calls, seconds apart, same key, no order id, returned
**five different values**:

```
truecaller_sdk                  [True, False, True]
disable_zero_sr_instruments     [True, False, True]
truecaller_1cc_for_non_prefill  ['control', 'test', 'test']
razorpaywallet_balance_ab_exp   ['variant_2', 'variant_1', 'variant_2']
shallow_offers_api_decomp       ['variant_on', 'control', 'control']
```

Bucketing is per request, not per account. And one of the 362 is
**`email_less_checkout`** — which explains the whole email puzzle: a payment
link on 31 Aug asked for an email and the payer typed one; a functionally
identical link two days later did not ask. Nothing changed on the account.

**This is the most important methodological finding in the file**, because it
sets the evidence bar for everything else. A single observation of checkout
behaviour is one sample from a distribution, not a fact about the account. The
"payment links collect email" claim was three-for-three and still wrong.

It also weakens conclusions drawn from small N — including the Magic Checkout
one above. That verdict rests on stronger evidence than field observations
(zero 1cc network requests, and `method` filtering demonstrably working from the
same options object), but three browser runs is three samples, and that is worth
stating rather than glossing.

For an agent the consequence is direct: **the checkout contract is not stable.**
Which fields are collected, and therefore which customer data comes back, varies
between sessions. Anything that requires a field must collect it before handing
off, never assume Razorpay will ask.

**`contact` is real and present on all eight payments, from every surface.** It
is the only identity field Razorpay reliably hands over. Two consequences worth
designing around:

- Formats differ by endpoint — payments store `+917484818651`, the customer
  object stores `9123460780`. Normalise to E.164 before joining anything.
- If the agent needs an email, **the agent has to collect it.** Razorpay will
  not, on any surface tested here, and a `customer` block sent at creation is a
  suggestion the payer can override.

Better still, put your own identifier in `notes` — those round-trip reliably on
every entity, verified repeatedly.

### The failure taxonomy

One real failure now exists, from the manual payment-link test:

```json
"status": "failed",
"error_code":        "BAD_REQUEST_ERROR",
"error_reason":      "international_transaction_not_allowed",
"error_source":      "business",
"error_step":        "payment_initiation",
"error_description": "Your payment could not be completed as this business
                      accepts domestic (Indian) card payments only.
                      Try another payment method."
```

For the agent, the important field is **`error_reason`** — a stable slug —
**not** `error_description`, which is prose written for humans and free to
change wording at any time. Branch on the slug; show the description.

**`error_source` alone is not the retry signal**, and an earlier version of this
file said it was. Source tells you *whose problem it is*. Reason tells you *what
to do about it*. The same source points in opposite directions:

| `error_source` | `error_reason` | Correct action |
|---|---|---|
| `business` | `international_transaction_not_allowed` | switch method — never retry |
| `business` | validation failure | fix our own request; do not switch, do not retry |
| `customer` | wrong OTP / wrong PIN | same method, ask the human again |
| `bank`, `gateway` | transient | retry the same method after a delay |

So it is a small grid, not a single-field lookup. Still simple, and it will not
tell the agent to switch payment method when the real fault is a malformed
request of our own making.

Two cautions on that table. Only `business` (on the failed payment) and
`internal` (on the IIN refusal) have actually been *observed* here — the rest
comes from documentation and is unverified against this account, so the corpus
is one row deep and the grid is a design sketch until more failures are
collected. And the literal value for a bank-side failure is reportedly
`issuer_bank`, not `bank`; branching on the short string would silently match
nothing. Confirm the exact spelling before relying on it.

Note Razorpay is explicitly telling the caller what to do next — "Try another
payment method" — and, via `/methods`, exactly which ones are available. Those
two responses compose into the agent's fallback strategy.

**IIN data arrives too late to be useful.** The failed card object included
`token_iin: "400005665"`. So Razorpay does hold card intelligence and will hand
it over — *after* the payment has already been attempted and failed, not before,
when an agent would need it to choose. That reframes C4 from "the data is
unavailable" to "the data is available for reporting, not for deciding," which
is a fair summary of a lot of payments tooling.

Fee figures from the same object are deliberately not quoted here: test mode
fabricates them, and a made-up number in a findings document is worse than no
number.

**Auth scheme is not the explanation for the refusals.** `--no-auth` now exists
on `get`, and the results are clean: `/methods?key_id=...` returns 200 with no
Authorization header at all, confirming it is a publishable-tier endpoint
addressed by key id. `/iins/411111` and `/orders` both return 401 without one.
The endpoints that refuse us are refusing on entitlement, not on credentials.

## Running it

Credentials come from the environment. `.env` in the **project root** (gitignored):

```
RAZORPAY_TEST_API_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_TEST_API_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

Real environment variables win over the file. Run everything from inside
`claimsBench/` — `.env` is looked up at `../.env`.

```
go run ./bench-cli --help              # top-level help
go run ./bench-cli claims              # the six claims and which probes test each
go run ./bench-cli probes              # the probe registry, nothing runs

go run ./bench-cli run                 # non-destructive probes only
go run ./bench-cli run P7              # one probe
go run ./bench-cli run P2              # runs P1 too: P2 needs P1's order id
go run ./bench-cli run --destructive   # the real run
```

`get` makes one raw call and prints the exact URL, the status, the classifier's
reading and the whole body. It answered more questions than the probe registry
did:

```
go run ./bench-cli get /orders/order_XXXX            # did the fields survive?
go run ./bench-cli get "/methods?key_id={key_id}"    # capability document
go run ./bench-cli get /iinz/411111                  # control: gateway or app?
go run ./bench-cli get /iins/411111 --no-auth        # credentials, or entitlement?
```

`run` prints one row per probe then the claim ledger. A `<-` marks a probe whose
outcome differed from the guess.

`--destructive` is off by default, so a careless invocation is inert. With it,
P1/P3/P4/P5/P8/P10 create real test-mode objects visible in the dashboard — an
order, a customer, a mandate order, two UPI attempts, a payment link. No real
money, and P8 forces email and SMS notifications off.

## Layout

```
types/         Verdict and ClaimState enums. Depends on nothing.
bench/         Domain logic. No network, no files, no CLI.
razorpay/      The only package that knows HTTP exists.
bench-cli/     Cobra commands and output formatting.
checkout-lab/  Browser harness — the questions the CLI cannot answer.
```

`checkout-lab` exists because the API and the modal disagree, and only the modal
is authoritative about what a payer will experience. `go run ./checkout-lab`,
then open `http://127.0.0.1:8899`. It mints a **fresh order per run** — an order
is single use, and a spent one makes checkout show "Uh! oh! Something went
wrong", which is easy to misread as the feature failing. Its Inspect button
queries the same order three ways so the disagreement is visible in one click.

Dependencies point inward only: `bench-cli` → `bench` + `razorpay` → `types`.
`bench` does **not** import `razorpay`. It declares what it needs instead
(`bench/probe.go`):

```go
type Caller interface {
	Get(path string) (int, []byte, error)
	Post(path string, payload any) (int, []byte, error)
}
```

`*razorpay.Client` satisfies that without either package mentioning the other.
This is the bit worth keeping when the agent is built: `bench` can be driven by
a fake `Caller` with canned responses, so its rules are testable with no network
and no credentials.

## How a verdict is reached

`ClassifyResponse(status, body)` in `bench/classify.go`:

| Signal | Verdict |
|---|---|
| 2xx | `reachable` |
| 401 | `error` — our keys are wrong, says nothing about the claim |
| 408, 429, 5xx | `error` — transient, no evidence |
| 404, 405 | `deprecated` — surface absent |
| body matches a deprecated phrase | `deprecated` (checked before gated) |
| body matches a gated phrase | `gated` |
| bare 403 | `gated` |
| anything else, mostly 400 | `unknown` — refuse to guess |

Phrase lists are package-level `var`s so they are easy to tune against real
responses. Probes that fetch by id (P2, P6) downgrade a 404 to `error`, since
there a 404 means "no such id", not "endpoint gone".

`DeriveClaimState` then rolls a claim's latest results up: no results →
`untested`; any `deprecated` → `refuted`; any `gated` → `blocked`; all
`reachable` → `supported`; otherwise `untested`. A probe that could not run is
`error`, never `blocked` — the reason is on our side, so it is not evidence
about Razorpay.

Every claim is phrased positively, which is what keeps this simple. Note the Go
bench and the frontend disagree about C6: the frontend still carries the old
negative wording plus a polarity flip.

## Not built, deliberately

- **Persistence** — results vanish on exit, so nothing accumulates across runs.
- **`ledger` / `report` subcommands** — both need stored history to mean
  anything.
- **Tests** — cheap whenever wanted, thanks to `Caller`.

None of these are needed for the reconnaissance this tool exists to do. Build
them only if the agent ends up wanting the bench as a live capability check.

## Housekeeping

Editor must write LF, not CRLF — `gofmt -l .` flags every CRLF file. VS Code:
`"files.eol": "\n"`.

```
go build ./... && go vet ./... && gofmt -l .
```
