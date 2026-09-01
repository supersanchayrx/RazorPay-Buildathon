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
| C2 mandate tokens (`max_amount`, `expire_at`, `frequency`) | `refuted` | P4 → 200, but P13 fetched the order back and `token`, `customer_id` and `method` had all been silently discarded |
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

So those paths are **registered routes that this account cannot reach**, not
typos. C3 and C4 are stronger than first written, and "I may have had the
address wrong" is ruled out.

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

**C2 is the weakest claim here, not the strongest.** P4 sent an order with a
`token` object attached and got a 200. That is consistent with two very
different worlds:

1. Razorpay honoured the mandate fields, or
2. Razorpay ignored the fields it did not care about and created an ordinary
   order.

Both produce the same 200. **P13 settled it: world 2.** Fetching the order back
returns

```json
{ "id": "order_TWT4hqPOoe24gD", "entity": "order", "amount": 50000,
  "currency": "INR", "receipt": "bench-p4", "status": "created",
  "attempts": 0, "notes": [], "offer_id": null, "description": null }
```

No `token`. No `customer_id`. No `method`. Three fields were sent, three were
discarded, and the response was `200 OK`. It is an ordinary order.

**The general lesson, which matters more than C2 itself: a 200 from this API
does not mean your request was honoured.** Unrecognised or unpermitted fields
are dropped in silence rather than rejected. Anything the agent sends beyond the
basics must be verified by reading the created object back — never inferred from
the status code. This is what `Probe.MustEcho` now enforces automatically.

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
  So C3 as written cannot be tested on this account at all; answering it needs
  an account with UPI switched on. Recording it as `refuted` would be wrong.
- **It does not explain C4.** Cards are enabled, yet IIN lookup is refused, so
  that is a genuine product-level gap rather than a method gate.
- **`nach: true` is a live lead for C2.** Mandates via NACH appear enabled even
  though UPI Autopay cannot be.
- **`upi: false` alongside `upi_intent: true` is contradictory** on its face and
  should not be trusted without a second source.

It still reports only *methods*, not products — nothing here mentions recurring,
s2s, or IIN. So the honest statement is: the agent can discover which payment
methods are enabled, and must be told about everything else.

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

**`error_source` is the retry signal.** `business` means a policy refusal that
will fail identically forever, so the agent must switch method rather than
retry. A `bank` or `gateway` source would be the transient case worth retrying.
Any retry logic that ignores this field will hammer a wall.

Note Razorpay is explicitly telling the caller what to do next — "Try another
payment method" — and, via `/methods`, exactly which ones are available. Those
two responses compose into the agent's fallback strategy.

Two incidental findings from the same payment object:

- The captured ₹500 wallet payment carried `fee: 1298, tax: 198` — about 2.6%
  all-in. Worth knowing before the agent quotes anyone a price.
- The failed card object included `token_iin: "400005665"`. **IIN data is
  available after the fact on the payment**, even though the pre-flight IIN
  lookup endpoint is not. That reframes C4: the data exists, but only once it is
  too late to route on it.

**Alternate auth has not been tried.** Some Razorpay endpoints expect only the
key id, and this client always sends Basic auth with both halves. If a probe
returns "URL not found", retrying it without the secret is worth one attempt
before concluding the surface is absent.

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

`run` prints one row per probe then the claim ledger. A `<-` marks a probe whose
outcome differed from the guess.

`--destructive` is off by default, so a careless invocation is inert. With it,
P1/P3/P4/P5/P8/P10 create real test-mode objects visible in the dashboard — an
order, a customer, a mandate order, two UPI attempts, a payment link. No real
money, and P8 forces email and SMS notifications off.

## Layout

```
types/       Verdict and ClaimState enums. Depends on nothing.
bench/       Domain logic. No network, no files, no CLI.
razorpay/    The only package that knows HTTP exists.
bench-cli/   Cobra commands and output formatting.
```

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
