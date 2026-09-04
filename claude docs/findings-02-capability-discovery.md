# Findings 02 — Capability discovery

What an agent can learn about an account before it commits to anything, and the limits of that knowledge.

All `[PROBE]` unless marked otherwise.

---

## `GET /preferences?key_id=...` — the most valuable endpoint found

56KB, **no Authorization header required**, and it is what `checkout.js` itself loads. Substantially richer than `/methods`, which we had been treating as the capability document.

An earlier version of the project notes claimed "there is no capability handshake". That was wrong. There is a substantial one.

### Top-level fields that matter

```
activated: false          <- the root cause of most gating; no KYC submitted
blocked:   false
mode:      "test"
magic:     true           <- reports availability, NOT entitlement (findings-03)
merchant_name: ""         <- empty, consistent with unactivated
fee_bearer: false
terminals: {}             <- empty
optional:  []
risk_config: providers fingerprint, sardine, stripe_radar
payment_downtime: the full downtime collection, embedded
experiments: 362 A/B flags (findings-03) — a later run returned 363, consistent with per-request bucketing
```

**`activated: false` is the single most useful fact on the account.** It is the common cause behind:

- UPI being off
- Smart Collect / virtual accounts being refused
- Magic Checkout not engaging

Those were three separate mysteries. They are one. Before reasoning about entitlement on anything else, check whether it is simply gated behind activation.

### Method capability

```
card: true          debit_card, credit_card, prepaid_card: true
card_networks:      VISA 1, MC 1, RUPAY 1, MAES 1
                    AMEX 0, DICL 0, JCB 0, BAJAJ 0, UNP 0
wallet:             airtelmoney, mobikwik, olamoney
netbanking:         40 banks
nach:               true
upi: false          upi_intent: true      upi_type: { collect: 0, intent: 0 }
emi: false          cod: false
paylater: []        cardless_emi: []
card_subtype:       business 1, consumer 1, premium 0
```

### `upi_type` resolves the UPI contradiction

`upi: false` beside `upi_intent: true` looked like a contradiction, and one hypothesis was that the first meant the retired collect flow and the second the app-handoff flow — two different products, two different answers.

**`upi_type: {collect: 0, intent: 0}` says both flows are zero.** So the top-level `upi_intent: true` is a **default flag that does not reflect entitlement**. It joins `magic: true` in that category.

Consequence: every UPI probe result on this account is confounded by UPI being off account-wide, which says nothing about PCI-DSS or product entitlement. That claim cannot be tested here as configured.

---

## `recurring` — the substitute for the dead IIN endpoint

The buildplan's payment-path logic depends on IIN lookup for `recurring.available` and `authentication_types`. **That endpoint is refused** ([findings-01](findings-01-api-surface.md)). Most of the same data is here instead:

```
recurring.card.credit    MasterCard, Visa, RuPay
recurring.card.debit     51 banks, by bank code
recurring.emandate       298 banks, each with auth_types
recurring.nach           true
```

### `emandate` auth-type distribution

Exactly the pre-flight signal the buildplan wanted:

| auth_types | banks |
|---|---|
| aadhaar only | 108 |
| aadhaar + debitcard | 67 |
| debitcard only | 64 |
| aadhaar + debitcard + netbanking | 44 |
| aadhaar + netbanking | 6 |
| debitcard + netbanking | 5 |
| netbanking only | 4 |

Sample shape:

```json
"AACX": { "auth_types": ["netbanking", "aadhaar"],
          "bank_code": "HDFC", "is_merged_bank": true,
          "name": "AKHAND ANAND CO OP BANK LTD" }
```

Note `bank_code` maps a specific institution onto its sponsor bank, and the codes match the ones the downtime feed uses. So these two datasets join.

### It does not rescue cards

`recurring.card.debit` is keyed by **bank code**. The only way to learn a card's issuing bank is the IIN lookup, which is refused — and `issuer` came back `null` on the one card object we have.

| Decisioning | Possible today |
|---|---|
| Bank e-mandate | **yes** — the customer picks their bank explicitly, so you have the key |
| Card recurring | **no** — you cannot get from a card to its bank pre-flight |

So the "product-level entitlement is not discoverable" correction in earlier notes needs its own correction: recurring capability **is** discoverable, keyed by bank rather than by card number. Just not for cards.

---

## Order-scoped preferences

`GET /preferences?key_id=X&order_id=Y` adds an `order` block showing **what checkout will actually do with that order** — the mandate token, the payment method, and `line_items`.

```json
"order": {
  "amount": 50000, "amount_due": 50000, "amount_paid": 0,
  "currency": "INR", "method": "upi",
  "line_items": [ ... ],
  "first_payment_min_amount": null, "partial_payment": false,
  "token": { "max_amount": 1000000, "frequency": "monthly",
             "start_time": ..., "end_time": ...,
             "recurring_type": "before" }
}
```

**This is the surface to query when verifying anything checkout-related.** The Orders API hides all of it. See [findings-03](findings-03-checkout-behaviour.md) for what that cost us.

A paid order returns 400 "Your payment has been declined as the order is invalid" instead of an order block.

---

## The Downtime API works — with stale records

`GET /payments/downtimes` → **200, count 12**, on a plain test account with no support request. Earlier belief that it needs enabling was wrong for the read path.

| Date | Method | Instrument |
|---|---|---|
| 2026-04-28 | netbanking | `bank: DLXB` |
| 2026-07-03 | card | `issuer: BKID` |
| 2026-07-30 | card | `issuer: PUNB`, `issuer: CNRB` |
| 2026-08-04 | upi | `vpa_handle: kotak811` |
| 2026-08-20 | card | `issuer: CITI` |
| 2026-09-01 | fpx | `bank: BNPA_C`, `bank: BMMB` |
| 2026-09-01 | upi | `vpa_handle: ibl`, `axl`, `ptyes`, `ybl` |

Three things to know before building on it:

**1. Nothing ever closes.** All are `status: "started"` with `end: null`. An agent trusting this literally will believe DLXB netbanking has been down since April. **A staleness filter is mandatory** — ignore anything that began more than N hours ago and never ended.

**Re-run confirms both halves.** `[PROBE]` A later run returned **count 13**, and
the feed is genuinely live — four `fpx` entries and two Indian netbanking
entries (`SBIN`, `IDIB`) appeared the same day. The stale rows did not move:

```
netbanking DLXB   status=started  end=None  age=128.0d
card       BKID   status=started  end=None  age= 62.3d
card       PUNB   status=started  end=None  age= 35.5d
upi        kotak811  status=started end=None age= 30.2d
netbanking SBIN   status=started  end=None  age=  0.0d
```

**DLXB has been "down" for 128 days.** So the feed is simultaneously useful
(fresh entries arrive) and untrustworthy (nothing ever resolves). Both facts
have to be handled, and a fresh entry is the only kind worth acting on.

**2. It is platform-wide, not account-scoped.** It reports UPI outages on an account that cannot accept UPI, and lists `fpx` (a Malaysian method) on an Indian account.

**3. Instrument keys vary by method** — `bank`, `issuer`, `vpa_handle`. Branch on the method before reading the instrument.

So the two documents answer different questions:

| Document | Question |
|---|---|
| `/methods`, `/preferences` | what can this account accept? |
| `/payments/downtimes` | what is broken right now, everywhere? |

The agent needs both and must not confuse them.

---

## The capability documents are an upper bound, not a prediction

**This is the most important limit on everything above.**

Enabling one dashboard setting — Account & Settings → Checkout Features → *Collect email from customers* → Mandatory — visibly **reduced the payment methods offered in the modal**. The capability documents did not move at all:

| | before | after |
|---|---|---|
| `optional` | `[]` | `[]` |
| `methods.card` | true | true |
| `methods.netbanking` | 40 banks | 40 banks |
| `methods.wallet` | 3 | 3 |

The filtering is **render-time and invisible to the API.**

So `/methods` and `/preferences` describe **what the account can do, not what a payer will be offered.** An agent reading them gets a superset, and nothing in the response says which entries will not render.

**Consequence for the payment-path decision** (buildplan §6.3 Part B): the capability handshake is the right input, but treat it as a **candidate set to be confirmed**, not an answer.

### The trade-off worth stealing

Buried in that experiment is a real decision with a measured instance on our own account:

> **Customer data was bought with payment methods.** More fields collected,
> fewer ways to pay, lower completion.

That is precisely the decision Part B exists to reason about, and it is more persuasive as something observed than as something hypothesised.

**Not yet counted:** how many methods were lost, and which. That number is worth having. `[OPEN]`


---

## Settlements are empty — closing an "unverified"

Buildplan §5.7 leaves open whether test mode generates meaningful settlement
entities. It does not. `[PROBE]`

| Endpoint / tool | Result |
|---|---|
| `fetch_all_settlements` | `count: 0` |
| `fetch_all_instant_settlements` | `count: 0` |
| `fetch_settlement_recon_details` (2026-09) | `count: 0` |

All three answer cleanly rather than refusing, and a well-formed absent
settlement id returns a proper application-level "does not exist". So the
surface works and the account simply has no settlements. **Anything depending on
settlement timing or payout reconciliation is not demonstrable here.**

RazorpayX is a separate matter: `fetch_all_payouts` returns
`"Access to requested resource not available"` and `fetch_payout_with_id`
returns a URL-not-found. No X account exists, so payout-failure injection
(buildplan §5.2) is unavailable too.
