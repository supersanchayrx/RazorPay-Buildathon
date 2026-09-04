# Findings 04 — Customer data

What you can actually learn about a payer, and why joining it up is harder than it looks.

Based on eleven payments across payment links and the checkout modal. All `[PROBE]` unless marked otherwise.

---

## What you get

| Field | Availability |
|---|---|
| `contact` | **reliable** — present and real on every payment, every surface, every method |
| `email` | only when a dashboard toggle is on; otherwise a sentinel |
| `card.name` | card payments only, from the embossed name |
| `card.last4`, `network`, `type`, `sub_type` | card payments. `sub_type` distinguishes consumer from business |
| `card.issuer` | **`null`** on the one card object we have |
| `vpa` | UPI payments — the address itself, often contains a phone or name. Untested here (`upi: false`) |
| `wallet` / `bank` | which provider |
| `international` | true/false |
| `method`, `amount`, `status`, `created_at` | the transaction |
| `error_*` (5 fields) | on failures, including auth-stage cancellations |

**Notably absent:** no IP address, no device info, no location, no billing address, no shipping address. The payment object does not carry them. Confirmed exhaustively — across all 15 payments on the account, `ip`, `device`, `location`, `user_agent`, `customer_id`, `billing_address` and `shipping_address` are present on **0 of 15**, while `notes` is present on 15 of 15. `[PROBE]`

**But addresses are not unavailable** — they are simply not collected *from the
payer*. There is a working addresses API you can write to. See
[the addresses section](#addresses-are-available-and-this-changes-part-a).

**The customer entity is optional and not automatic.** Nobody paying you creates one. It exists only if you `POST /customers` yourself. In live mode, by default, you would have **zero customer records** no matter how many people paid — you would have payments with a phone number attached, which is a different thing.

---

## Email is a dashboard toggle, not a property of the surface

**Account & Settings → Checkout Features → Collect email from customers**, with Optional/Mandatory radio buttons.

It was off. Turning it on changed behaviour immediately:

```
00:36  netbanking  void@razorpay.com                   <- setting off
00:36  wallet      void@razorpay.com                   <- setting off
00:47  wallet      hithisemailtestisworking@gmail.com  <- setting on
```

Eleven minutes apart, wallet on both sides, so **the setting is the variable and not the payment method.**

### `void@razorpay.com` is a sentinel, not data

Where email is missing Razorpay writes a placeholder that is **well formed, passes any validation you would write, and is identical for every payer.**

Group customers by email and they all become one person. This is worse than a null, because nothing about the value's shape tells you it is fake.

### Mandatory is not honoured everywhere

With the dashboard set to Mandatory, the hosted payment-link page still renders **"Email address (optional)"**. The setting reaches the checkout modal and not payment links — one more accepted-but-not-applied case.

### There is no API knob for it

Tested on payment links:

| Attempt | Result |
|---|---|
| `options.checkout.prefill.email` + `readonly.email: true` | accepted — locks a value **you** supply |
| invented `options.checkout.required: {email: true}` | **accepted with 200**, no such feature |
| plain control | accepted |

`prefill` + `readonly` is not "the payer must enter an email" — it is "you already know the email". Useful only if you have it beforehand.

And the invented `required` key returning 200 is the write-path permissiveness from [findings-03](findings-03-checkout-behaviour.md) showing up again.

---

## Identity is the weakest thing on the account

- `/payments?customer_id=` and `/orders?customer_id=` are both **rejected outright**: *"customer_id is/are not required and should not be sent"*
- `/invoices?customer_id=` is **accepted** — invoices and subscriptions are the customer-indexed entities; orders and payments are not
- **no payment carries a `customer_id`**, even when the order was created with one
- a payment link's `customer` block is a **pre-fill the payer can override** — observed: `bench.probe@example.com` went in, a different address came out
- Magic Checkout created no customer record
- **formats differ by endpoint:** payments store `+917484818651`, the customer object stores `9123460780`

**Correction:** this is no longer true. `[PROBE]` `/payments?contact=<E.164>`
filters server-side — undocumented, but with passing negative controls. See
[findings-01](findings-01-api-surface.md). It is an **exact string match**, so
normalisation is load-bearing, and being undocumented it needs a `from`/`to`
full-sync fallback. But "fetch everything and group on strings" is the fallback
now, not the only option.

What remains true is the harder half: **there is no way to look a *customer* up.**

### Two things to design around

**1. Normalise to E.164 before joining anything.** `[PROBE]` More precisely: the
**customer API stores exactly what you send** — `+919000000001` and
`9000000002` both persist verbatim — while **all 15 checkout-created payments
carry a `+91` prefix**. So checkout normalises and the API does not. A naive
join silently fails to match, and now there is a second reason to care:
`/payments?contact=` is an exact match, so an unnormalised number returns
**zero results rather than an error**.

Normalise on the way in and on the way out. Never store anything but E.164.

**2. `notes` is the identifier you control.** 15 key-value pairs on every entity **except `/items`**, which rejects `notes` by name — and **verified to round-trip reliably**, repeatedly, unlike most optional fields.

The per-value limit is **512 characters, not 256.** `[PROBE]` A 300-character
value is accepted and stored at full length; 520 is rejected with `"Notes value
cannot be greater 512 characters"`. Razorpay's docs say 512 and were right; the
MCP `create_order` schema says 256 and is conservative. Stamp your own user ID, session ID, cart ID or campaign onto every order at creation. Then you are not reverse-engineering identity from strings; you are reading back the ID you put there.

If you do one thing from this document, do that one. It is free and it solves the join problem properly.

---

## Getting more, legitimately

Ranked by how much they add:

**1. Magic Checkout — the biggest jump, and unavailable here.** It would collect a full shipping address including pincode, `line_items` (what they actually bought), an abandoned-cart webhook, and phone-first login so identity is consistent across visits. **The modal does not engage on this account** ([findings-03](findings-03-checkout-behaviour.md)), so none of it is available in test mode.

**2. Create customers deliberately and attach them.** `POST /customers`, then pass `customer_id` on the order. This is the only way saved cards and addresses accumulate under a person — without it, `/customers/{id}/tokens` stays empty forever. Note the gap: attaching a customer to an order is not the same as knowing who paid.

**3. Use Invoices or Subscriptions where they fit.** These are the entities Razorpay actually indexes by customer. If your model tolerates them you get customer-scoped queries for free instead of building the join yourself.

**4. `notes`.** See above.

**5. Webhooks instead of polling.** Real-time, and you get `payment.failed` with the full error envelope plus events polling would miss.

**6. Collect it yourself before handing off.** See below.

---

## On enriching what you have

**Razorpay gives you no lookup.** There is no "tell me about this email", no cross-merchant history, no person-level query. The pooled data that exists — Thirdwatch's risk scoring across merchants — runs one direction: it protects you from bad buyers, it does not answer queries about good ones. `[DOCS]`

The asymmetry is the real line: **pooled cross-merchant data is fine for protecting merchants from buyers, and not fine for selling to buyers.**

Going outside to a data broker to enrich emails and phone numbers hits DPDP. Data collected to process a payment cannot be repurposed to profile someone; that needs consent for that purpose, obtained up front. It is also the thing Razorpay publicly says it does not do, after being questioned about price discrimination — worth staying on the right side of if you are pitching them.

**The legal version of the same intent:** cohort analysis on the merchant's **own** payment history — who bought once and never returned, which method, what they spent. Entirely available.

**Practical version:** depth comes from your own funnel, not from lookups.

---

## The design conclusion

> **`contact` is the join key. `notes` is the identifier you control. If the
> agent needs anything else — an email, a name, an address — the agent collects
> it before handing off.**

Razorpay's collection is a toggle applied inconsistently across surfaces, varying per request ([findings-03](findings-03-checkout-behaviour.md)), with no API to check what a given page will ask for.

That is workable for this build, because you own the merchant surface and therefore the step before handoff. It just needs to be a deliberate choice in the design rather than an assumption that breaks quietly.

---

## Caveats on everything above

- **Test mode is a mock.** No real payer ever typed anything; every email and phone on the account was invented during testing. **The schema is trustworthy; the data is not.** You will not know what real payers supply until live mode.
- `contact` is *what they typed*, not a verified identity. Test mode never OTPs. In live mode a wallet or UPI provider effectively verifies it as a side effect; a card payment does not. Do not treat it as authenticated unless the method implies it.
- **You only get a number if a payment was attempted.** Abandon at the modal and nothing is recorded — several numbers typed during testing exist nowhere. See the abandonment table in [findings-01](findings-01-api-surface.md).


---

## Addresses are available, and this changes Part A

**[findings-03](findings-03-checkout-behaviour.md) says address and pincode data
is unavailable in test mode and that anything in buildplan Part A depending on
serviceability-by-pincode must be synthesised and labelled.** That is true only
of *Magic Checkout collecting an address from a payer*. There is a full working
addresses API. `[PROBE]`

```
POST /customers/{id}/addresses
  { type: "shipping_address", line1, line2, city, state, country,
    zipcode, primary, contact, name, landmark, tag }
-> 200  addr_TXcydNfsC6WlJs
```

Verified:

| Test | Result |
|---|---|
| `type: "shipping_address"` | 200 |
| `type: "billing_address"` | 200 — both types work |
| `type: "warehouse_address"` (only `type` varied) | 400 `"type is not valid"` — closed enum |
| Read back via `/customers/{id}/addresses` | `count: 2`, all fields intact |
| Read back via `GET /customers/{id}` | populated into the `shipping_address` array |
| Invented extra fields | 400, rejected **by name** |

And they are not inert: a registration link created later **auto-attached both
addresses** into its `customer_details`, with zipcodes
([findings-03](findings-03-checkout-behaviour.md)).

**So Part A does not need synthesised pincodes.** The real limit is narrower and
should be stated that way: you cannot *harvest* an address from a payer at
checkout, but you can store and read one perfectly well. Since the agent
collects the address in conversation anyway, that is exactly the shape needed.

---

## `fail_existing` — the uniqueness key is the (contact, email) pair

[findings-01](findings-01-api-surface.md) advises using `fail_existing: "0"` so
re-runs are idempotent. **True only under a condition that doc does not state.**

Razorpay's docs: `"1"` (default) throws if a customer with **the same details**
exists; `"0"` "fetches details of the existing customer." `[DOCS]` The whole
question is what "the same details" means. Measured: `[PROBE]`

| Sent | Result |
|---|---|
| same contact, **different** email, `fail_existing: 0` | **new** customer — duplicate phone |
| same contact **and** same email, `fail_existing: 0` | **same id** — idempotent |
| contact only, no email, twice | same id both times — idempotent |
| duplicate, `fail_existing` omitted | 400 `"Customer already exists for the merchant"` |

**The key is the whole tuple, not the phone.**

### This is a live hazard for the agent

If the agent learns a user's email on visit 2 that it did not have on visit 1,
`fail_existing: "0"` silently creates a **second customer record for the same
person**. Same phone, two ids, split history, and **no error**.

The rule that follows: **look the user up in your own index first, and use
`PUT /customers/{id}` to add newly-learned fields to the existing record.**
Never re-POST a customer with a changed field set.

---

## Customer lookup by phone does not exist — and the endpoint that looks like it lies

The dangerous one. `[PROBE]`

| Query | count |
|---|---|
| `/customers?count=100` | 4 |
| `/customers?contact=%2B919000000009` | **4** |
| `/customers?contact=%2BTOTALNONSENSE` | **4** |
| `/customers?email=nonexistent@nowhere.tld` | **4** |

200 every time, the full unfiltered collection every time. The parameter is
**accepted and ignored.** There is no documented customer-search parameter,
which is consistent.

Build "find this user by phone" on it and it returns whichever customer happens
to be first — **silently wrong on every call, forever.** Contrast
`/payments?contact=`, which genuinely filters. Two endpoints, same parameter
name, opposite behaviour, both returning 200.

**Consequence: you must keep your own phone → `customer_id` index.** Razorpay
will not give you one, and the endpoint that appears to is worse than nothing.

MCP's `fetch_tokens` is a partial escape hatch — given a `contact` it will "find
**or create** the customer" and returns the full customer object with addresses
`[DOCS]` — but a lookup that may create a record is not a lookup.

---

## The identity collision, quantified

The `void@razorpay.com` problem, measured on the real corpus: `[PROBE]`

```
15 payments  ->  5 distinct emails   but   9 distinct contacts
largest email bucket:   void@razorpay.com  x9
largest contact bucket: +917484818651      x3
```

**Grouping by email turns 9 different payers into one person.** That is a
better line for the pitch than any abstract statement of the problem, and it is
from our own data.

---

## The design conclusion, updated

The original conclusion stands but is now sharper, and the direction is the
important part:

> **`contact` is the join key, normalised to E.164. `notes` is the identifier
> you control. Everything else — name, email, address — the agent collects
> before handoff and writes in.**

Compare with catalog data, which flows the other way. For products the merchant
is the source of truth and you read from them. **For users the agent is the
source of truth and you write to Razorpay.** You never reverse-engineer who
paid, because you put the id there yourself.

Concretely:

1. Agent collects name, contact, email, address in conversation
2. Normalise contact to E.164
3. Check your own index; `POST /customers` only if new, else `PUT` the delta
4. `POST /customers/{id}/addresses` for shipping and billing
5. Stamp `my_user_id` into `notes` on the customer and on every order
6. Read history via `/payments?contact=`, with a `from`/`to` sync as fallback

Steps 3 and 6 are the two that today's testing changed, and both are the
difference between working code and silently wrong code.
