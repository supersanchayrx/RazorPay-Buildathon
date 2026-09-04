# Findings 03 — Checkout behaviour, and the API/modal split

**Read this one first.** It contains the correction to what used to be the headline finding of the whole project, and the rule that replaced it.

All `[PROBE]` unless marked otherwise.

---

## The governing rule

> **An API acceptance is not an entitlement check.**
>
> Razorpay's write path and its execution path are separate systems that do not
> consult each other. An object can be accepted, stored, enriched with
> server-side fields, and labelled correctly in the dashboard for a feature the
> account cannot run. Nothing reports the gap until a human opens a checkout.

There is no paradox in this. A 200 from `POST /orders` promises *"I created an order record"* — and it did. It never promised that checkout would honour what the order carries. Those are separate systems and only one of them replied.

The mistake is easy: conflating *"the order was created with X"* with *"X will be used"*.

Demonstrated four times:

| What was sent | Stored? | Actually works? |
|---|---|---|
| Mandate `token` (spending cap) | yes, and enriched | unknown — UPI is off |
| `method: "upi"` | yes | no — UPI disabled |
| Magic Checkout `line_items` | yes | **no — modal ignores them** |
| Invented `options.checkout.required` key | accepted 200 | no such feature exists |

And the strictness is **inconsistent**, which makes it worse. A 1cc `customer_details` block had `primary` rejected by name, then `type` rejected by name, one at a time, before being accepted — and then dropped anyway.

> **Careful validation of a payload that is then thrown away is worse than plain
> permissiveness**, because the precision makes the 200 feel meaningful.

### Permissiveness is per-endpoint, not a property of the API

**Correction.** `[PROBE]` This doc previously implied the write path is broadly
permissive. It is not. Two endpoints reject unknown fields **by name**:

```
POST /items                     -> 400 "sku, stock, image_url, variants,
                                        category, notes is/are not required
                                        and should not be sent"
POST /customers/{id}/addresses  -> 400 "pincode_serviceable, delivery_days
                                        is/are not required and should not
                                        be sent"
```

Both carry `reason: extra_field_sent`, and both have **closed enums** that
reject invented values by name (`type: "product"` on items, `type:
"warehouse_address"` on addresses). Meanwhile `options.checkout.required` — an
invented key — still returns 200 on payment links.

So the permissive surface is **Orders and the checkout options object**,
specifically. Do not generalise it into a rule about Razorpay. Test the endpoint
you are actually using.

### A third failure mode: accepted and *ignored*

Distinct from accepted-and-dropped, and worse. `/customers?contact=` returns
**200 with the full unfiltered collection** — see
[findings-04](findings-04-customer-data.md). Nothing is dropped and nothing
errors; the filter simply does nothing, and the response looks entirely
plausible. Code built on it is silently wrong on every call.

---

## The mandate correction

**Previously reported, and wrong:** we asked for a spending cap, Razorpay returned 200, and the cap had been silently discarded. This was filed as a safety finding and as the strongest material in the project.

### What actually happened

`POST /orders` with a `token` object → 200. `GET /orders/{id}` returns a plain order:

```json
{ "id": "order_TWT4hqPOoe24gD", "entity": "order", "amount": 50000,
  "currency": "INR", "receipt": "bench-p4", "status": "created",
  "attempts": 0, "notes": [], "offer_id": null, "description": null }
```

No `token`, no `customer_id`, no `method`. That read as a silent field drop, and was written up as one.

**The checkout preferences document, asked about the same order:**

```json
"order": {
  "amount": 50000, "currency": "INR", "method": "upi",
  "token": { "max_amount": 1000000, "frequency": "monthly",
             "start_time": 1788199188, "end_time": 1804096787,
             "recurring_type": "before" }
}
```

The cap is there, at the value sent. `expire_at` was stored as `end_time`. And **`recurring_type: "before"` was added by Razorpay** — a field never sent, so this is a processed, enriched, stored mandate, not a request echoed back.

**Control:** a plain order created with no token has an order block with **no `token` and no `method`**. The fields appear only on orders that carried them. So it is not boilerplate.

### Cause

`GET /orders/{id}` renders **order accounting only**. It hides `token`, `method`, `customer_id` and `line_items` — but it *does* render `notes`, which is why the omission looked selective and deliberate rather than like a rendering rule.

**One exception, found later.** `[PROBE]` For an order created by a
**registration link** (`product_type: "auth_link"`), `GET /orders/{id}` and
`fetch_all_orders` **do** render the `token`, complete with `method`,
`max_amount`, `expire_at` and the server-added `recurring_status`,
`failure_reason`, `auth_type` and `first_payment_amount`. A regular order
carrying a token — including an SBMD one — still hides it. So the rule is
"the Orders API renders the token only when the token *is* the point of the
order", and the read-back-is-not-proof lesson stands for every other case.

The Orders API is not the surface that consumes these fields. Checkout is.

### What survives

Narrower than the original claim:

> A bound must be verified — **on the surface that consumes it.** A read-back
> showing nothing is not proof of absence; it may be the wrong window onto the
> same object.

**Note the direction of failure.** The naive echo-check does not wave a nonexistent bound through — it refuses to proceed on a bound that exists. That is a **false refusal**, the metric the buildplan already says to count (§6.4). An over-eager verifier is safer than a credulous one, but it is not free, and we demonstrated the cost on ourselves.

### Still unknown

Whether a payment can be **authorised** against that mandate. Creating the order is the cheap half; with `upi: false` the expensive half cannot be attempted at all.

**The mandate claim is supported for order creation and untested beyond it. Do not let the first stand in for the second.**

Separately and still true: a test account is routinely more permissive than a live one, so even a genuine success would not prove live parity.

---

## Magic Checkout — order side works, modal does not engage

`magic: true` in the preferences document.

### The order side works completely

`POST /orders` with `line_items` and `line_items_total` → 200. Razorpay **adds `cod_fee` and `shipping_fee`** — fields only 1cc orders carry. The cart reads back intact from the preferences order block. The dashboard labels it **"Order Type: Magic Checkout"** and shows Customer Details / Shipping Address / Billing Address rows.

Five signals, all green.

### The modal ignores all of it

Controlled comparison via `checkout-lab`, fresh order per run:

| Run | Methods shown | Phone | Email | Address |
|---|---|---|---|---|
| Standard, card only | cards only | yes | no | no |
| Standard (control) | cards, netbanking, wallet | yes | no | no |
| `one_click_checkout: true` | cards, netbanking, wallet | yes | no | no |

Identical. No address step, no coupon field, no line items rendered, bare "Price Summary ₹500", and **zero 1cc network requests** from `checkout.js`.

### The control that makes it conclusive

The card-only run passed `method: {card: true, netbanking: false, wallet: false}` in the same options object — and **that worked**, the other blocks disappeared.

So `checkout.js` reads and applies the options fine. `one_click_checkout` is received and discarded. It is not a wiring mistake in the test.

### `customer_details` goes nowhere either

A 1cc order was created with `customer_details` carrying name, email, contact and both addresses. Accepted with 200 (after two field-name rejections), then **absent from all three API surfaces** — including the preferences order block, which renders `line_items` for the same order.

### Consequences

- **Address and pincode data is not available** in test mode. Anything in buildplan Part A depending on serviceability-by-pincode must be synthesised and labelled as such.
- **`line_items` remains useful as storage.** The cart persists on the order and reads back cleanly from `/preferences`, even though checkout will not display it. Usable as a data structure.
- `magic: true` reports availability, not entitlement — same trap as `upi_intent: true`. Root cause is almost certainly `activated: false`.

**Caveat:** three browser runs is three samples. The verdict rests on the network evidence and the `method`-filter control rather than field observations, but see the A/B section below before treating any small-N checkout observation as settled. `[OPEN]`

---

## Dashboard settings are invisible to the API

Enabling *Collect email from customers → Mandatory* (Account & Settings → Checkout Features) changed checkout behaviour immediately and changed **nothing** in `/methods` or `/preferences`. Full detail in [findings-02](findings-02-capability-discovery.md).

The setting is also **not honoured everywhere**. With the dashboard set to Mandatory, the hosted payment-link page still renders "Email address (optional)". Another accepted-but-not-applied case — this time in Razorpay's own UI rather than ours.

---

## Checkout is A/B tested per request

The preferences `experiments` block carries **362 flags**. Three identical unauthenticated calls, seconds apart, same key, no order id, returned **five different values**:

```
truecaller_sdk                  [True, False, True]
disable_zero_sr_instruments     [True, False, True]
truecaller_1cc_for_non_prefill  ['control', 'test', 'test']
razorpaywallet_balance_ab_exp   ['variant_2', 'variant_1', 'variant_2']
shallow_offers_api_decomp       ['variant_on', 'control', 'control']
```

Bucketing is **per request, not per account**.

This did *not* turn out to explain the inconsistent email collection — a dashboard toggle did ([findings-04](findings-04-customer-data.md)) — and reaching for it was a mistake. But the variance itself is real and it sets the evidence bar:

> **A single observation of checkout behaviour is one sample from a
> distribution, not a fact about the account.**

The "payment links collect email, the modal does not" claim was three-for-three on the data and still wrong.

### Practical consequences

- Do not build analytics assuming a field is consistently present — you get uneven coverage and no signal explaining why.
- **Run any demo more than once before recording it.** A flow that worked in rehearsal can bucket differently on the day. This matters directly for a 5-minute pitch video.

---

## `checkout-lab`

`go run ./checkout-lab` from `claimsBench/`, then `http://127.0.0.1:8899`.

It exists because the API and the modal disagree and only the modal is authoritative about what a payer experiences.

- **Mints a fresh order per run.** An order is single use; a spent one makes checkout show "Uh! oh! Something went wrong", which is easy to misread as the feature failing. That cost one test run before the harness existed.
- **Four scenarios, one variable each** — Magic, standard control, standard card-only, Magic card-only. The card-only pair is what separates "the method skipped this field" from "the account cannot do this".
- **No `prefill`, nothing hidden.** Prefilling a field suppresses it, which would answer the question by rigging it.
- **An Inspect button** that queries the same order three ways — Orders API, its payments, and the preferences order block — so the disagreement is visible in one click.

### Reading the browser, not the screenshot

Two things that produced wrong conclusions before the network tab was checked:

- **Filter the Network tab for `1cc` and read the matches.** One match was `v2-entry-4950a1cc.modern.js` — a build hash in a CDN filename, not an API call. Coincidence of hex digits.
- **Chrome's autofill dropdown on a Razorpay page is Chrome**, not Razorpay knowing who the payer is. Easy to misread in a screenshot.


---

## The registration-link route to a mandate — it works

[findings-01](findings-01-api-surface.md) noted that `/subscriptions` and
`/plans` being open was "a second route to mandates that does not go through the
Orders token object, and it is untested." **Now tested.** `[PROBE]`

Via MCP `create_registration_link` (`method: "emandate"`, `max_amount: 100000`,
`amount: 0`):

```
inv_TXxcTIwwBigSoG    entity "invoice",  auth_link_status "issued"
order_TXxcTQ5LjKYLVN  token { method "emandate", max_amount 100000,
                              expire_at 1819900000 }
/preferences order    product_type "auth_link", method "emandate",
                      max_amount 100000
short_url             https://rzp.io/rzp/EiH5gYK   ->  HTTP 200, live
```

Four things worth keeping:

**1. A registration link is an Invoice.** `entity: "invoice"`, plus a linked
order. That is a different object graph from the Orders-token path.

**2. `amount` must be 0.** A non-zero amount returns `"The amount should be 0."`
— a zero-rupee authorisation. Note the contrast with `/orders`, where a zero
amount is rejected outright before mandate validation is reached.

**3. It auto-attached the customer *and both addresses*** written earlier via
the addresses API — matched on contact and email, with full `billing_address`
and `shipping_address` blocks including zipcodes. So user data written through
that API is **not inert storage; it flows into real payment objects.**

**4. `frequency` was silently dropped.** `"monthly"` was sent; the stored token
reads `frequency: null`. Contrast with the SBMD order, where
`frequency: "as_presented"` **survived**
([findings-05](findings-05-mcp-surface.md)). The drop is per-method, not general.

### Why this matters more than the Orders-token result

There is a **live URL where a human performs the authorisation**. The current
honest position on the Orders token is "a bound was recorded; money never moved
against it." This is a bound recorded **plus the human ceremony that authorises
it, served and reachable** — which is exactly the "the bound is the mechanism,
and it hands control back to a person" argument, made concrete.

**Caveats, which must be stated in the same breath:** mandate registration is
mocked in test mode `[DOCS]`, and the link was **not** authorised and no debit
was attempted. Fetchable is not authorised is not debited.

### A listing gotcha

`GET /invoices/inv_TXxcTIwwBigSoG` returns 200 with the full object. `GET
/invoices?count=100` returns **`count: 0`**. `[PROBE]`

**Auth-link invoices are fetchable by id but invisible in the collection.** An
agent that *lists* invoices to find its own mandates finds nothing and must
track the ids itself. This also means the "invoices are the customer-indexed
entity" advice in [findings-04](findings-04-customer-data.md) remains
**untested** — `?customer_id=` returns 0 for a real and a nonsense id alike,
because there is nothing listable to filter.
