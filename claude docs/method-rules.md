# Method rules and corrections log

Every rule here was earned by getting something wrong first. The corrections log records what was believed and disproven, so it is not re-derived.

---

## The rules

**1. Run negative controls before interpreting absence.**
"Not found" means nothing until you know what a known-bad path returns. The misspelled-sibling test ([findings-01](findings-01-api-surface.md)) is the model: change one letter and see which layer answers.

**2. Verify a 200 on the surface that consumes the field, not the most obvious one.**
Reading a mandate order back from `GET /orders/{id}` said the spending cap was gone. It was not. The Orders API renders order accounting only; the checkout preferences document renders what checkout will use. Cost: the project's headline finding, wrong for days.

**3. Never invent endpoints or field names.**
`"flow": "reserve_pay"` was fabricated by a coding assistant and wasted a probe slot. Five guessed 1cc paths returned bare gateway 404s. Record guesses as *"not located"*, never as *"does not exist"*.

**4. Don't strengthen evidence because it matched a prediction.**
A result you expected is not better evidence than one you didn't. If anything, attack it harder — nobody questions an answer they like.

**5. Distinguish gateway rejection from application rejection.**
Different layers, different meanings. A gateway 404 means the probe URL is wrong — a defect in the harness. An application refusal is a finding about the account. The classifier originally scored both as `deprecated`, which would have let a typo masquerade as a discovery.

**6. Log the resolved URL your code actually sent**, not the template.

**7. Check the dashboard before reasoning about entitlement.**
This rule already existed and was **still violated twice in one session** — once on email collection, once on Magic Checkout. Both times a plain toggle explained what an elaborate mechanism had been invented for. Check the dashboard first. Every time.

**8. Prefer the boring explanation.**
A settings toggle beats A/B bucketing. A spent order beats a broken feature. A build hash beats a 1cc API call. The interesting hypothesis lost every time it competed with a dull one.

**9. Small N is small N.**
Checkout behaviour varies per request — 5 of 362 experiment flags differ between identical calls ([findings-03](findings-03-checkout-behaviour.md)). Three runs is three samples. The "payment links collect email" claim was three-for-three and still wrong.

**10. The only trustworthy test exercises the surface a human touches.**
The API and the checkout modal are different systems. The modal is authoritative about what a payer experiences. `checkout-lab` exists for exactly this.

**11. Read the browser, not the screenshot.**
UI recall is unreliable and layouts look alike. Filter the Network tab and read the actual matches — one `1cc` hit turned out to be a build hash in a CDN filename. Chrome's autofill dropdown is Chrome, not Razorpay knowing the payer.

**12. A bare gateway 404 can mean "wrong id shape", not "no such route".**
`/items/item_fake123` is refused by the gateway; `/items/item_AAAAAAAAAAAAAA`
reaches the application; a real id returns 200. Rule 1's control varies a letter
in the **path**, which is sound — but id shape is a **different variable**, and
reading a malformed-id 404 as a missing endpoint produces a false
"does not exist". Test a well-formed-but-absent id before concluding anything.
([findings-01](findings-01-api-surface.md))

**13. "Accepted and ignored" is a third failure mode. Watch for it specifically.**
Accepted-and-dropped at least leaves a gap you might notice.
`/customers?contact=` returns **200 with the full unfiltered collection** — no
error, no missing field, a response that looks completely correct. Code built on
it is silently wrong on every call. When a filter parameter is accepted, **prove
it filters** with a nonsense value that must return zero.

**14. Do not generalise a write-path behaviour into a rule about the API.**
"The write path is permissive" was true of Orders and checkout options and false
of `/items` and `/customers/{id}/addresses`, which reject unknown fields by name
and enforce closed enums. Strictness is per-endpoint. Test the endpoint you are
using.

**15. Read the docs before inferring semantics from behaviour.**
`fail_existing` was reverse-engineered from three probes when the documented
sentence was one fetch away. The probes were still needed — the docs say "the
same details" and only measurement reveals that means the (contact, email)
tuple — but guessing first wasted a cycle and produced an overstated claim
("it creates duplicates") that the docs immediately corrected. Docs are a
source. Read them, then measure what they leave vague.

**16. Mint a fresh object per test.**
An order is single use. A paid order makes checkout show a generic error that reads exactly like a broken feature.

---

## Corrections log

| Belief | Status | Correction |
|---|---|---|
| Reserve Pay isn't public | `[DEAD]` | Publicly documented; activation is what's gated |
| S2S UPI collect is a good agent path | `[DEAD]` | Collect deprecated Feb 2026; S2S needs PCI-DSS |
| Mandate token is "the same shape as a reservation" | `[DEAD]` | Per-transaction cap, no funds blocked, 24h notification |
| Nobody has a mandate-handshake pattern | `[DEAD]` | AP2 reached v0.2 April 2026, contributed to FIDO Alliance May 2026 alongside Mastercard's Verifiable Intent; UCP launched Jan 2026 `[DOCS]` |
| "Ray AI reaches for a payment link on failure" | `[DEAD]` | The verified behaviour is Agent Studio's recovery agent generating a WhatsApp payment link. Merchant ops, not a buying agent `[DOCS]` |
| UPI Circle is part of the merchant toolkit | `[DEAD]` | Consumer/PSP-side only. No merchant API `[DOCS]` |
| "There is no capability handshake" | `[DEAD]` | A substantial one exists — [findings-02](findings-02-capability-discovery.md) |
| The "URL not found" body is a generic no-route response | `[DEAD]` | Genuine no-route returns a bare gateway 404 with no envelope `[PROBE]` |
| **Mandate fields are silently dropped on a plain test account** | `[DEAD]` | **Was the strongest claim in the project. The token is stored, and enriched. [findings-03](findings-03-checkout-behaviour.md)** `[PROBE]` |
| Method-level capability is discoverable, product-level is not | `[DEAD]` | `recurring` is in the preferences document, keyed by bank `[PROBE]` |
| Magic Checkout works — the order is accepted and labelled | `[DEAD]` | Order side works; the modal never engages `[PROBE]` |
| Payment links collect email, the checkout modal does not | `[DEAD]` | Neither does by default. It is a dashboard toggle `[PROBE]` |
| A/B bucketing explains the inconsistent email collection | `[DEAD]` | Bucketing is real, but the cause was the toggle. Rule 8 `[PROBE]` |
| Downtime API needs a support request to read | `[DEAD]` | Returns 12 live entries on a plain test account `[PROBE]` |
| `upi_intent: true` means the intent flow is available | `[DEAD]` | `upi_type: {collect: 0, intent: 0}` — both are off `[PROBE]` |
| Fee/tax figures are usable for pricing | `[DEAD]` | Test mode fabricates them `[PROBE]` |
| `error_source` uses `issuer_bank` | `[DEAD]` | Observed values are `customer`, `business`, `bank`, `issuer`. `issuer_bank` appears nowhere in 15 payments. The earlier warning was backwards `[PROBE]` |
| Address/pincode data is unavailable in test mode | `[DEAD]` | Only true of harvesting it from a payer. `POST /customers/{id}/addresses` works, with `zipcode`. Part A needs no synthesised pincodes `[PROBE]` |
| "What did this person buy" requires fetching everything | `[DEAD]` | `/payments?contact=` filters server-side. Undocumented, exact-match `[PROBE]` |
| `/customers?contact=` can look a customer up | `[DEAD]` | Accepted and **ignored** — returns the full collection for any value, including nonsense `[PROBE]` |
| `fail_existing: "0"` makes re-runs idempotent | `[DEAD]` | Only for a byte-identical (contact, email) pair. Change the email and it silently duplicates `[PROBE]` |
| `notes` allows 256 chars per value | `[DEAD]` | 512. Docs were right; our note was wrong `[PROBE]` |
| `notes` works on every entity | `[DEAD]` | `/items` rejects it by name `[PROBE]` |
| The write path is broadly permissive | `[DEAD]` | Orders and checkout options only. `/items` and the addresses API reject unknown fields by name `[PROBE]` |
| `GET /orders/{id}` always hides `token` | `[DEAD]` | It renders it for `auth_link` orders, where the token *is* the point of the order. Still hides it for regular and SBMD orders `[PROBE]` |
| Magic Checkout emits an abandoned-cart webhook | `[DEAD]` | Not in the 60+ supported events. Likely a Shopify-plugin or Agent Studio feature `[DOCS]` |
| The registration-link route to mandates is untested | `[DEAD]` | Tested and working, with a live payer-facing auth URL `[PROBE]` |
| Invoices give customer-scoped queries for free | `[OPEN]` | Auth-link invoices are fetchable by id but absent from the collection, so `?customer_id=` has nothing to filter. The parameter is accepted; that it filters remains unproven `[PROBE]` |
| MCP has no Subscriptions coverage (buildplan §5.8) | `[DEAD]` | `create_registration_link` is the Subscriptions registration API and works. Subscription CRUD is what is missing `[PROBE]` |

**The AP2 correction is the one to internalise.** The defensible claim is narrower and stronger than the original: AP2's initial version targets pull methods like cards, with push payments such as UPI on the roadmap. **Nobody has bound a verifiable-mandate handshake to Indian push rails.** That is the gap, stated accurately.

---

## The two mistakes that recur

Worth naming, because they were made repeatedly and in both directions.

### Conflating "accepted" with "will work"

A 200 answers the question you asked. It is easy to think it answered a bigger one. `POST /orders` promises *"I created an order record"* — not *"checkout will honour what this order carries"*.

Four instances: the mandate token, `method: "upi"`, Magic `line_items`, and an invented `required` key that returned 200.

### Trusting a confident number

`detect_stack` reported `framework: "gin"` at **`confidence: 0.9`** for a
`go.mod` containing neither gin nor any web framework. A confidence score is
generated by the same process as the answer and is not independent evidence of
it. This is the machine version of rule 4: a stated certainty is not
corroboration.

### Reaching for the interesting mechanism

Twice a dashboard toggle was the answer while an elaborate hypothesis was being constructed — A/B bucketing for the email behaviour, entitlement gating for Magic Checkout. Rule 7 already existed. Rule 8 exists because rule 7 was not enough.

---

### Designing a control that does not isolate the variable

A test of whether the addresses API rejects an invented `type` was written with
`city: "y"` — and returned `400 "The city must be between 2 and 32
characters."` The invented `type` was never evaluated. Re-run with everything
else valid, and only `type` varying, it returned `"type is not valid"`, with a
matching valid-type control returning 200.

The first result *looked* like a finding. **A 400 that rejects your payload for
the wrong reason is a broken control, not evidence.** Read which field the error
names before recording anything.

---

## What good evidence looked like

For contrast, the conclusions that held up shared a shape:

- **A control that isolates one variable.** Card-only vs all-methods separated "the wallet skipped this field" from "the account cannot do this".
- **An observation of behaviour rather than appearance.** Zero 1cc network requests beat any amount of squinting at a modal.
- **An unplanned control.** `method: {card: true, ...}` working in the same options object where `one_click_checkout` did nothing proved the harness was wired correctly. That was luck, but it was the strongest single piece of evidence in the session.
- **A field the other side added.** `recurring_type: "before"` appearing on a stored mandate proved processing rather than echo, in a way no field we sent ever could.
