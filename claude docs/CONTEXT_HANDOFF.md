# Context Handoff — Razorpay Agentic Payments Project

**Last updated:** 4 September 2026
**Purpose:** Orientation and index. Read this, then the findings doc you need.

Evidence tags used throughout this doc set:

- `[DOCS]` — verified against Razorpay's public documentation, NPCI/RBI material, or official repos
- `[PROBE]` — observed directly by our own probe runs
- `[OPEN]` — believed but not verified; do not repeat as fact
- `[DEAD]` — was believed, now disproven; recorded so it isn't rediscovered

---

## The document set

| Doc | Covers |
|---|---|
| **this file** | project, thesis, account state, open items |
| [findings-01-api-surface.md](findings-01-api-surface.md) | which endpoints exist, which are refused, and how to tell a typo from a gate |
| [findings-02-capability-discovery.md](findings-02-capability-discovery.md) | `/preferences`, the recurring tables, `activated: false`, why capability docs are an upper bound |
| [findings-03-checkout-behaviour.md](findings-03-checkout-behaviour.md) | the API/modal split, Magic Checkout, the mandate correction, A/B bucketing |
| [findings-04-customer-data.md](findings-04-customer-data.md) | what you can actually learn about a payer, the identity problem, and how to write user data in |
| [findings-05-mcp-surface.md](findings-05-mcp-surface.md) | the MCP server: 42 tools measured, what it cannot reach, and **the SBMD result** |
| [findings-06-shopify-agent-surface.md](findings-06-shopify-agent-surface.md) | the Shopify half: RFC 9421 crawler signatures measured, the app-proxy path, the password gate |
| [findings-07-overlay-and-install.md](findings-07-overlay-and-install.md) | the install, the storefront overlay, dev-loop behaviours, and Shopify's own "Agentic Storefronts" |
| [feature-checklist.md](feature-checklist.md) | the working build checklist, with honest status per item |
| [method-rules.md](method-rules.md) | rules earned by getting things wrong, plus the full corrections log |
| `../claimsBench/README.md` | the harness itself and how to re-run everything |
| [hackathon-track01-buildplan-v2.md](hackathon-track01-buildplan-v2.md) | the build definition. Older than these findings — see the deltas note at the end of this file |

**If you read one thing beyond this file:** [findings-05](findings-05-mcp-surface.md). It contains the current strongest result — an SBMD (Reserve Pay mechanism) bound accepted and stored on a plain unactivated account, through Razorpay's own agent interface, with a control. Then [findings-03](findings-03-checkout-behaviour.md), which contains the correction to what used to be the headline finding and the rule that replaced it.

---

## 1. The project

An AI agent that can transact through Razorpay in India, for a hackathon track whose bar is that agent behaviour be **explainable, bounded and gated**.

**Central thesis:**

> "Explainable, bounded and gated" is not a safety wrapper bolted onto an agent
> that could otherwise spend freely. On Indian rails, **the bound is the payment
> mechanism.** Without it there is no transaction at all.

Two supports. The regulatory one: every available mechanism moves the human *earlier in time* rather than removing them. The empirical one: six ways to move money were probed, five are refused, and the one that works hands control back to a person.

**The agent is a decisioning-and-handoff system, not a spending system.** That was argued from documentation first and is now confirmed by exhaustion.

---

## 2. Why Indian rails block agent autonomy

**UPI.** Checkout either deep-links into a UPI app or pushes a collect request. Either way the PIN is entered inside the UPI app on the user's own device. No API, by design. `[DOCS]`

**Cards.** Additional factor authentication is regulatorily mandated, so the OTP goes to the user's phone. `[DOCS]`

**Why US approaches don't transfer.** ACP's shared payment token and Visa's tokenisation work because card-not-present without a step-up is normal there. `[DOCS]`

**Caveat on the card half.** The original framing — merchants can't store card numbers, so an agent can't hold a reusable instrument — is too strong. Card-on-file network tokens exist via TokenHQ, and card e-mandates permit debits without AFA below the threshold. The real blocker is registration AFA plus the notification window, not custody of the instrument. `[DOCS]`

### Reserve Pay / SBMD

Real and **publicly documented**. What's gated is *activation*: you raise a request with support, and your business category must support UPI mandate and SBMD. Live PSPs are Paytm, Navi, BHIM and BHIM SBI, with PhonePe, GPay and BOB epay listed as coming. `[DOCS]`

Mechanism: one-time consent-based authorisation setting a spending limit, funds blocked, agent transacts inside that envelope without repeated PIN prompts, instant revocation retained. `[DOCS]`

The Claude x Zomato/Swiggy/Zepto pilot is real, runs on Reserve Pay, and is limited to a selected user group. Earlier ChatGPT and Gemini pilots exist too. `[DOCS]`

### The mandate is not a Reserve Pay substitute

The Orders API accepts a `token` object with `max_amount`, `expire_at` and `frequency`. It **is** accepted and stored on a plain test account — see [findings-03](findings-03-checkout-behaviour.md). But three differences remain decisive: `[DOCS]`

1. `max_amount` is a **per-transaction ceiling, not a wallet.** Set it to ₹10,000 and an agent may spend ₹10,000 repeatedly without ever violating it. Nothing depletes.
2. A mandate does not block funds. SBMD does.
3. **The 24-hour pre-debit notification.** Every scheduled debit requires notifying the customer at least 24 hours ahead with amount, date and mandate reference, and NPCI enforces the window.

Point 3 means **an agent cannot say "ordering now" and debit in-session using a standard mandate.** That is why the pilots use SBMD.

### Regulatory position

RBI issued consolidated Digital Payments E-mandate Directions in 2026, effective immediately, superseding eight earlier circulars. Recurring transactions up to ₹15,000 may run without AFA; above that AFA is required, with higher thresholds for insurance premiums, mutual fund subscriptions and credit card bills. Pre- and post-transaction notifications are mandatory with an opt-out path. `[DOCS]`

Cite this framework by name. Earlier framings are a version behind.

### UPI Collect is deprecated

Per NPCI, deprecated effective **28 February 2026**. Customers can no longer pay or register UPI mandates by entering a VPA or mobile number manually. New Razorpay users go to UPI Intent. Exemptions exist for certain IPO/secondary-market MCCs, iOS, eRupi and cross-border — none apply to us. **One surviving exemption is interesting: mandate execute, modify and revoke.** `[DOCS]`

This kills the "server-side UPI collect is friendlier to an agent than driving an iframe" idea from the original doc. It was the worst advice in it.

### Server-to-server

PCI-DSS certification is the stated prerequisite. Not available and not worth pursuing. `[DOCS]`

---

## 3. Account state

A plain test account, **not activated** (no KYC), no PCI-DSS, no special enablements.

```
activated: false
mode:      "test"
upi:       false      upi_type: { collect: 0, intent: 0 }
card:      true       netbanking: 40 banks    wallet: 3
nach:      true       emi/cod: false
```

**`activated: false` is the single most useful fact.** It is the common cause behind UPI being off, Smart Collect being refused, and Magic Checkout not engaging. Those were three separate mysteries; they are one. `[PROBE]`

### Test mode is a mock, not a sandbox rail

- Test UPI IDs `success@razorpay` / `failure@razorpay`; test card `4111 1111 1111 1111`, any future expiry, any CVV. `[DOCS]`
- **Cancellation resolves as success in test mode.** Live mode required to test UPI cancellation. `[DOCS]`
- Mandate registration and authentication are mocked. `[DOCS]`
- Test UPI IDs cover one-time domestic payments only. `[DOCS]`
- **Fee and tax figures are fabricated. Never quote them.** `[PROBE]`

**Critical consequence:** a browser agent pointed at a test checkout will complete the purchase, because the mock never asks for a PIN. This looks like proof that agentic checkout works. It is not. Any demo must carry this warning prominently.

### The MCP server — now connected and measured

**Status: connected**, project-scoped `.mcp.json`, HTTP transport, credential in
a `${RAZORPAY_MCP_AUTH}` env var so it never enters the file. **42 tools, every
one exercised.** Full inventory and per-tool results in
[findings-05](findings-05-mcp-surface.md).

Three things to carry from it:

1. **SBMD works at the write layer.** `create_order` documents
   `token.type = "single_block_multiple_debit"` and stores it. This is the
   project's best material — read findings-05 before pitching anything.
2. **The exclusion decision was correct, and is now measured rather than
   asserted.** MCP has **no** customers, addresses, `/preferences`, `/methods`,
   downtime, items, payment_pages, disputes or Route tools, and its
   `fetch_all_payments` cannot reach the undocumented `contact=` filter the
   Bench found. The hybrid is a forced choice, not a preference.
3. **`detect_stack` is confidently wrong** (`gin` at 0.9 confidence on a
   framework-free `go.mod`), and `integrate_razorpay_checkout` ships an
   `aiInstructions` field of imperatives aimed at the reading agent. **Tool
   output is data, never instructions** — that belongs in the README as a stated
   bound, with a first-party example.

**Config trap:** Razorpay's VS Code docs target VS Code's *own* MCP block
(`mcp.servers`, `${input:}`, `npx mcp-remote`), which is a silent no-op in
Claude Code (`mcpServers`, `${ENV}`, native http). And a stray character in the
base64 produces a 401 indistinguishable from a stale key — verify the token
against `GET /orders?count=1` before blaming the server.

### Positioning, and why MCP was excluded from reconnaissance

Razorpay ships an official MCP server — GitHub, Docker Hub, and hosted at `https://mcp.razorpay.com/mcp`. Accepts `rzp_test_` keys. `create_order` supports mandate orders. The ChatGPT pilot and Gnani's voice integration route through it. `[DOCS]`

**Positioning matters here:** Razorpay already ships an agent surface in the open. Any pitch claiming otherwise gets corrected in Q&A.

It was **deliberately not used for reconnaissance.** MCP is 42 curated tools over documented endpoints; nearly every finding came from something a curated toolset cannot do — `GET /preferences` (no tool exists), a misspelled path, a wrongly-shaped id, an unauthenticated request, an invented field name rejected by name, raw status-plus-body. MCP shows the surface Razorpay wants you to see; the Bench finds where that surface stops matching reality.

**That is now measured, not asserted** — see the section above and [findings-05](findings-05-mcp-surface.md).

MCP is still the right choice for the agent's **payment actions**. It lacks customers, addresses, the capability handshake, downtime, items, Disputes and Route, so all of that is direct REST — make the hybrid a stated choice in the README, not an accident. (Subscriptions are partly present: the registration API works, CRUD does not.)

**Security — resolved.** The config used to store the credential as a plaintext `Authorization: Basic` header (base64 is encoding, not encryption). It now reads `Basic ${RAZORPAY_MCP_AUTH}` from the environment, so `.mcp.json` holds no secret and is safe to commit. Keep it that way.

### The intended path for a non-PCI integrator

Standard Checkout and Payment Links. Razorpay states the Payments API is for retrieving details and capturing already-authorised money, **not for collecting payments**, and directs no-website merchants to Payment Links, Payment Pages, Invoices and Smart Collect. `[DOCS]`

Architecturally this is the interesting answer: the sanctioned surface for someone in our position is a **handoff**, never a direct charge.

---

## 4. What the agent can and cannot do

**Confirmed working** `[PROBE]`

- ask what an account can accept, in detail, before committing to anything
- create an order with a per-transaction ceiling recorded on it
- hand a human a payment link and collect real money — the only path proven end to end
- read a failure and know whose fault it was, **and at which stage** — `error_step` separates "the payer gave up" from "the bank refused"
- see platform outages, with a staleness filter
- **record an SBMD bound** (Reserve Pay's mechanism) on an order, verified on the consuming surface
- **issue a mandate registration link** with a live payer-facing authorisation URL
- **write a customer with addresses** (shipping and billing, with pincode) and stamp its own ids on everything
- **fetch one payer's payment history server-side** via the undocumented `/payments?contact=` filter

**Confirmed blocked, every route**

- charging anyone autonomously
- **authorising** any mandate it records — the registration link is served but was never authorised, and no debit was attempted
- knowing whether a human opened checkout at all — 17 of 27 orders sit at `attempts: 0` and no webhook exists for it
- looking a customer up by phone — the endpoint that appears to do this returns the full collection for any value

UPI needs a human's PIN. Cards need a human's OTP. S2S needs PCI-DSS. Reserve Pay needs an activation you cannot request.

---

## 5. Open items

Ordered by value.

0. **Try authorising the registration link.** `https://rzp.io/rzp/EiH5gYK` is live. Registration is mocked in test mode, so this shows how far the ceremony goes without proving live behaviour — but it is the cheapest next step and it sits directly on the thesis.
1. **Decide whether to activate the account.** `activated: false` is the common cause behind UPI, Smart Collect and Magic Checkout all being unavailable — one decision, not three mysteries. But it is a real decision: activation requires KYC and switches live mode on. Check what the dashboard asks for before committing.
2. **Look at the Payment Configuration tab** (Account & Settings). The Checkout Features tab held a consequential toggle that is invisible to the API. Payment Configuration is unexamined and is where UPI most plausibly lives.
3. **Count what mandatory email cost.** Methods disappeared from the modal when it was enabled; nobody counted which. That number is the measured trade-off for Part B.
4. **Re-run the SBMD probe with UPI on.** The bound is recorded; `initiate_payment` is refused and UPI is off, so authorisation cannot be attempted here at all. This is the single highest-value open item after activation.
5. **Attempt the authorisation transaction** on any mandate order that survives. That is where the real entitlement gate lives — order creation is the cheap half.
6. **Build the source × reason retry grid**, not a source-only lookup. Use `issuer_bank`, not `bank`.
7. **Count what the addresses API unlocks for Part A.** Pincodes are real now, not synthesised — the serviceability logic can be built against stored addresses.
8. Collect more failure envelopes. **No longer one row deep** — five failures across three `error_step` values and four `error_source` values — but `internal` and `gateway` sources remain unobserved.
9. Resolve whether `/invoices?customer_id=` actually filters. Auth-link invoices are fetchable by id but absent from the collection, so there is currently nothing listable to test against.

**Closed:** the misspelled-sibling test; key-ID-only auth on IIN; whether the Downtime API returns anything usable in test mode; **whether settlements exist in test mode** (they do not — [findings-02](findings-02-capability-discovery.md)); **the second route to mandates via registration links** (it works — [findings-03](findings-03-checkout-behaviour.md)); **reconfiguring the MCP server** (done, connected, all 42 tools exercised — [findings-05](findings-05-mcp-surface.md)).

**Still unverified, do not assert:** the exact S2S UPI path (docs are noindexed — though MCP's `initiate_payment` hits the same refusal as our own probe, which is corroboration); whether Reserve Pay exposes a distinct API surface beyond the SBMD token type; whether `recurring_type: "before"` denotes the pre-debit notification; how many methods mandatory email removes; and whether a dashboard-created Payment Page holds item and stock data.

---

## 6. Artifacts

| Artifact | State |
|---|---|
| `static/` frontend | Complete and tested. Vanilla JS, no build step. **Do not modify without a specific request** |
| `claimsBench/` | Go probe harness. Eleven probes, seven claims. The `bench` package is network-free and CLI-free, so the agent can import it directly |
| `claimsBench/bench-cli` | `run`, `probes`, `claims`, and `get PATH` — the last answered more questions than the probe registry did. `--no-auth` flag for auth-scheme tests |
| `claimsBench/checkout-lab` | Go server + browser harness on `:8899`. Fresh order per run, four scenarios isolating one variable each, an Inspect button that queries the same order three ways |
| `claimsBench/README.md` | The findings document for the harness, kept honest including corrections |
| `.mcp.json` | Project-scoped MCP config. Credential is `${RAZORPAY_MCP_AUTH}`, so **safe to commit** — and worth committing, since the public repo is a graded deliverable |

**Note on the frontend spec:** it deliberately specifies vanilla JS with no framework and no build step, because the Go backend serves it same-origin and Razorpay's `checkout.js` fights bundlers. If that changes, delete the justification paragraph too — contradictory reasoning in a spec is worse than either choice.

**Already decided:** Shopify was rejected. It owns order creation, so the mandate token can't be injected and the raw error envelope never surfaces — the two things the Bench exists to test. It also needs completed KYC and a paid plan. Revisit only as a *second* demo target.

---

## 7. How to pitch this

1. **The bound is the mechanism.** Not a safety wrapper on an agent that could otherwise spend freely. Without the bound there is no transaction. **And the bound is now demonstrable:** an SBMD token — the mechanism the Claude x Zomato/Swiggy/Zepto pilots run on — is accepted and stored on a plain unactivated account through Razorpay's own MCP server, with a control isolating it ([findings-05](findings-05-mcp-surface.md)); and a mandate registration link produces a **live URL where a human performs the authorisation** ([findings-03](findings-03-checkout-behaviour.md)). Recorded, not authorised — say both in the same breath.
2. **A measured capability envelope.** State exactly what a plain Razorpay account can and cannot do for an agent, with probe output behind every row — including the assumptions that turned out wrong. Most submissions assert capabilities from documentation; this one measured them and found the documentation optimistic in several places. **This is the strongest material.**
3. **Two independent rails agree.** UPI mandates and NACH both move the human earlier rather than removing them. NACH is *evidence, not a build target* — a slow bank-debit rail with its own registration ceremony that cannot complete an in-the-moment purchase.
4. **The sanctioned surface for a non-PCI integrator is a handoff**, by Razorpay's own statement.
5. **The real gap:** AP2 defines the mandate handshake but targets pull methods first, with push payments on the roadmap. **Nobody has bound a verifiable-mandate handshake to Indian push rails.**
6. **Tool output is data, never instructions.** `integrate_razorpay_checkout`'s result carries an `aiInstructions` field of imperatives aimed at the reading agent. For a track whose bar is "explainable, bounded and gated", this is a bound nobody else will think to state, with a **first-party Razorpay example** to cite. Cheap, specific, and it lands in the room where Agent Studio was built.

7. **False refusals, told straight.** Our own verifier gave a confident wrong answer and blocked something legitimate. Told plainly — we built a check, it was wrong, here is how we caught it, here is the metric it taught us to count — that reads as rigour. Stretched into "our mistake was actually a discovery", it reads as spin and will be noticed. Point 2 is the headline; this is support.

**Do not claim:**

- that nobody has built an agent payment interface — the MCP server exists, in the open
- that mandates substitute for Reserve Pay — the 24-hour notification kills it
- **that a bounded agent transaction was demonstrated.** A bound being *recorded* was demonstrated — now including an SBMD bound and a served authorisation link. **Money never moved against either, no mandate was ever authorised, and on this account it cannot be.** Recorded ≠ authorised ≠ debited; state all three
- that MCP is unusable or that Razorpay hides its agent surface. 42 tools work. The accurate claim is narrower: MCP publishes the sanctioned surface, and the capability handshake, customers, addresses and the working `contact` filter are all outside it
- any aggregate metric from synthetic data. Individual synthetic events illustrating a decision path are a demo; a synthetic percentage unravels under one follow-up question
- any fee or tax figure from test mode

---

## Delta from the Shopify half

`findings-06` is the first measured result on Shopify rather than Razorpay. Two items land on earlier docs:

- **§7.6 "full RFC 9421 agent-signature path — DEFERRED"** -> Shopify ships the merchant-side half natively, and it is **genuinely verified** (a corrupted signature is ignored, a valid one changes the response). Reframe from "designed-not-built" to "first-party precedent exists; here is what it does and does not cover."
- **§4 "every one of these verifies the AGENT, none verifies the MERCHANT"** -> still true, and now with a live first-party example instead of an assertion. Shopify authorises crawler *access*; nothing in it speaks to whether the merchant is real.

**Shopify rejection, narrowed.** The "already decided" note in §6 rejects Shopify because it owns order creation. That objection is about the **payment path**, not the catalog path. With money terminating in our own Razorpay order and link, Shopify is a catalog source and a distribution channel and the objection largely dissolves — at the cost of no Shopify order record, fulfilment or inventory decrement until write scopes are added.

---

## Deltas against the buildplan

`hackathon-track01-buildplan-v2.md` predates these findings. Where they conflict, these win:

- **§5.1 "test mode is a full replica sandbox"** → it is a mock. See §3 above.
- **§6.2 "tokenization prevents an agent holding a reusable instrument"** → too strong. See §2 above.
- **§8 open question 1 (Downtime API in test mode)** → resolved, it works. [findings-02](findings-02-capability-discovery.md)
- **§8 open question 2 (S2S enabled?)** → dead twice over: collect deprecated, S2S needs PCI-DSS.
- **§5.4 / §6.3 Part B depends on IIN lookup** for `recurring.available` and `authentication_types` → **that endpoint is refused.** `/preferences` supplies the same data keyed by bank, which unblocks bank e-mandate decisioning but **not** cards. [findings-02](findings-02-capability-discovery.md)
- **§6.3 Part A depends on pincode serviceability** → Magic Checkout does not engage on this account, so no address data is collected. Synthesise and label it. [findings-03](findings-03-checkout-behaviour.md)
- **§8 lists the frontend as not yet built** → it is built and tested.
- **§5.5 "Magic Checkout also emits an abandoned cart webhook"** → **not in the 60+ supported events.** Part C must not depend on it. [findings-01](findings-01-api-surface.md)
- **§5.7 "settlements in test mode — unverified"** → resolved, empty. [findings-02](findings-02-capability-discovery.md)
- **§5.8 "Not present: Subscriptions"** → partly wrong. `create_registration_link` is the Subscriptions registration API and works; subscription CRUD is what is absent. [findings-05](findings-05-mcp-surface.md)
- **§6.3 Part A depending on synthesised pincodes** → not needed. The addresses API stores and returns real `zipcode` data. [findings-04](findings-04-customer-data.md)
- **§5.2 payout-failure injection via RazorpayX** → no X account; both payout tools are refused. [findings-02](findings-02-capability-discovery.md)
