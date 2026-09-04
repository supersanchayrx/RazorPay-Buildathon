# Hackathon build plan — handoff doc v2

**Purpose of this document:** Successor to `hackathon-track01-buildplan.md` (referred to below as **v1**). Same convention: treat "Settled" items as closed unless new information contradicts them. Re-litigating them wastes spent effort.

**Read this before v1.** Several v1 sections are now known to be wrong or out of date. Section 1 below lists exactly what supersedes what. Everything in v1 not listed there still stands.

**Status as of this doc:** Build target has been **reinterpreted** (seller-side, not buyer-side). Open question #1 from v1 is **resolved**. Protocol research is **updated**. Test-mode capability has been inventoried in detail. Several candidate features have been evaluated and rejected with reasons. Nothing is built yet. Two open questions remain, both answerable by the builder without external input.

---

## 1. What this supersedes in v1

| v1 section | Status | Replacement |
|---|---|---|
| §1 "appears to be a Razorpay-run AI hackathon" | **Wrong framing** | §2 below — it is a hiring program, not a prize hackathon |
| §3 protocol research | **Incomplete** | §4 below — UCP, Visa TAP, Mastercard VI, Amex ACE all post-date v1 |
| §5 "Decision: what we are actually building" | **Superseded** | §6 below — build target reinterpreted |
| §6 demo script | **Superseded** | §6.4 below |
| §7 open question #1 (organizer access) | **Resolved** | §2.2 below — no organizer channel exists; build on standard test mode |
| §4 "what Razorpay itself actually has" | **Substantially expanded** | §3 and §5 below |

v1 §2 (the three clarifying questions about what the track means) still stands and is still correct. In particular: **the protocols are context, not compliance targets.** That decision survived re-examination.

---

## 2. The Buildathon itself (source: https://razorpay.com/buildathon/)

### 2.1 What it actually is

Not a prize hackathon. It is a **hiring funnel for a student internship**.

- **Who:** students only
- **Offer:** AI Builder Internship, 6 or 12 months, in-person Bangalore, **₹75,000/month stipend**, starting September
- **Process:** no resume screening and no aptitude test. Pick a track, build something real, submit. Shortlisted candidates go straight to a panel.
- **Deliverables:** a **public repo**, a **5-minute pitch video**, and the **architecture**
- **Application:** a Google Form

**Implications for the build:**

1. The artifact is judged by **Razorpay engineers reading a repo**, not by judges watching a live demo. README quality and architecture legibility carry weight equal to the code.
2. Five minutes of video cannot carry six features. Depth on one coherent thesis beats breadth.
3. The people reading it built Agent Studio. They know what already exists (see §3.2 — the do-not-build list).

### 2.2 Open question #1 from v1 — RESOLVED

**Question was:** does the hackathon provide expanded test-mode access (Reserve Pay / UPI Circle), or should we build on the public Orders API token mechanism?

**Answer: build on standard public test mode.** Reasons:

- There is **no organizer channel to ask**. Application is a Google Form. There is no track-specific provisioning step.
- The track text says plainly: "an agent that grows revenue for a merchant **on Razorpay test-mode APIs**."
- Reserve Pay and UPI Circle remain absent from public API reference (re-checked; still true).

**Settled. Do not spend more time on this.** The `max_amount` / `expire_at` / `frequency` token object on the Orders API (v1 §4) is the mechanism.

---

## 3. Razorpay's shipped agentic surface — and what it means

Source material: four Razorpay YouTube videos reviewed, plus press coverage of the same launches.

### 3.1 What exists

| Product | What it does |
|---|---|
| **Agentic Dashboard (Ray AI)** | Conversational analytics over the merchant's own payment data. Natural-language queries, root-cause on payment dips, failure patterns aggregated across 1,000+ businesses. Multimodal — merchant uploads a complaint screenshot, Ray diagnoses the bank timeout, pre-fills a payment link, drafts the customer email. |
| **Agent Studio** | One-click deploy of prebuilt agents: **cart abandonment recovery** (voice + WhatsApp), **revenue drop insights**, **dispute auto-responder** (classifies reason codes, calculates win probability, submits evidence), **fraud shield**. Plus a low-code custom agent builder. Connects to Shopify, WhatsApp, Slack. |
| **Onboarding / platform agents** | Identity check from PAN or website URL with automatic category detection and **CKYC validation**; code-generation agents that scan a dev stack and emit integration snippets; connected-banking agents for bookkeeping, payouts, cash burn, collection reminders. |

### 3.2 The do-not-build list

Anything in the table above is off the table. Building a thinner version of a shipped product, in front of the team that shipped it, is the worst possible outcome. This makes the v1-era caution about Track 03 drift much sharper: **cart recovery, dispute response, revenue-drop diagnosis and fraud detection are all already shipped.**

Also note Agent Studio's **custom agent builder**: merchants can already build arbitrary agents over Razorpay data with no code. So "I built an agent that does X with payment data" carries approximately zero novelty. Novelty must live either in data the agent reaches **outside** the merchant's own systems, or in the **mechanism** itself.

### 3.3 The pattern across all four videos (this is the load-bearing observation)

Every Razorpay agent does exactly one of two things:

1. **Assists a human merchant** (dashboard, onboarding, integration), or
2. **Automates merchant-internal operations** (recovery, disputes, cashflow, fraud)

**Not one of them transacts with a counterparty that has no prior reason to trust it.** Every agent operates inside a trust boundary that already exists. Discovery and cross-party verification are unclaimed.

Corroborating: Razorpay's CPO stated publicly that Agent Studio is **not a shopping destination or a channel for product discovery** — it is an operational layer. Razorpay's own agentic payments page pitches going "beyond visibility on LLM platforms," which concedes that visibility is the unsolved part.

There is no Razorpay consumer app. There is no Razorpay merchant discovery hub. (A user recollection of a now-deleted Razorpay post proposing one could not be verified. The closest real thing is Agent Studio's roadmap to let third parties publish agents — but that is a hub where *merchants find agents*, not where *buyers find merchants*.)

### 3.4 The dark-pattern criticism — a specific opportunity

At the Agent Studio launch demo, an agent pressured Razorpay's own CEO toward an impulsive purchase using steep discounts and a 24-hour expiry claim. Press flagged this as the **false urgency** dark pattern, alongside open questions about AI-driven dark patterns and price discrimination.

This is live, unresolved criticism of Razorpay's own product.

**Opportunity:** the track bar says every money action must be "explainable, bounded and gated." Nearly everyone will read "bounded" as a spend cap. It can also be read as a **bound on persuasion** — an agent structurally unable to manufacture scarcity, assert an expiry it cannot verify, or offer a personalised price it cannot justify in the audit log, with each refusal logged rather than silently skipped. Cheap to add, nobody else will do it, and it answers a criticism the judges are currently fielding in public.

---

## 4. Protocol landscape — updates since v1

v1 covered ACP, x402, AP2, UAP. All four entries remain accurate. Four additions:

### UCP (Universal Commerce Protocol) — Google + Shopify
- Announced at NRF, **11 January 2026**. Apache 2.0.
- **Discovery-first.** An agent's first move is a call to `/.well-known/ucp`, returning a JSON manifest of the merchant's capabilities. Unlike ACP (checkout-only), UCP spans discovery → post-purchase.
- Merchants **retain Merchant of Record status**, keep their own pricing and business logic, and own the customer relationship.
- **Payment methods are deliberately not defined centrally.** Each provider publishes its own handler spec; merchants advertise which they accept; agents follow the spec. New methods enter without core version bumps. Shopify's write-up names regional PSPs as the intended case.
- **No UPI handler exists.** See §7.5 for why this is a weaker opportunity than it first appears.

### Visa Trusted Agent Protocol (TAP)
- Cryptographic method for an agent to prove identity and authorisation **to a merchant**, so merchants can distinguish a credentialed agent from an anonymous bot.
- Built on **RFC 9421 HTTP Message Signatures**, developed with Cloudflare (Web Bot Auth lineage).
- Signatures bound to domain and to the specific operation.

### Mastercard Verifiable Intent
- **March 2026**, open-sourced. Uses **W3C Verifiable Credentials** to bind each agent transaction to a human-approved mandate carrying category, cap and time window.
- The credential carries a proof section verifiable by any party **without contacting the issuer**.
- Note: this is functionally the v1 governor, expressed as a credential rather than a hard-coded check.

### Amex ACE
- Purchase protection extended to **registered** agents.

### The through-line
**Every one of these verifies the AGENT. None verifies the MERCHANT.** For large brands, brand recognition substitutes. For an unknown small Indian merchant, nothing does. This maps to MECE case **A2.4** (trust deficit on an unrecognised domain — Silent, High), transposed into a setting where the buyer is an agent with no trust heuristics and no COD escape hatch.

India-specific advantage: verified merchant identity **already exists** as public infrastructure (GSTIN, PAN, CKYC), and Razorpay already validates against it at onboarding (§3.1). A payment aggregator can therefore *issue* a merchant credential rather than scrape one.

**UAP does not close this gap.** UAP registers, verifies and authorises *agents* over UPI Circle. It still requires RBI approval. It says nothing about whether a merchant is real.

---

## 5. Razorpay test-mode capability inventory

Everything below was verified against public docs during this session. **All of it is first-party only** — your keys see your account.

### 5.1 Foundations
- Test mode is a **full replica sandbox**. Available immediately on signup — **no account activation, no KYC, no approval**. Usable indefinitely. Separate key pair.
- Postman public workspace available with test keys.

### 5.2 Failure injection (richer than v1 assumed)
- UPI: `success@razorpay` / `failure@razorpay`
- Cards: distinct test cards for domestic, international, EMI, and **subscriptions specifically**
- Card and netbanking flows land on a **mock bank page with explicit Success / Failure buttons**
- RazorpayX payouts sit in `processing` until **manually advanced from the dashboard** — deterministic payout-failure injection
- Smart Collect can trigger a test NEFT/RTGS/IMPS payment from the dashboard on demand

**Two caveats:**
- UPI test IDs cover **one-time domestic payments only**. Mandates need the subscription test cards.
- **A UPI cancellation resolves as a SUCCESS in test mode.** "Buyer abandons mid-flow" is not testable on UPI.

### 5.3 The payment object (richest data source)
Every payment carries: `amount`, `currency`, `status`, `method`, `order_id`, `invoice_id`, `international`, `refund_status`, `amount_refunded`, `captured`, `email`, `contact`, `customer_id`, `fee`, `tax`, `error_code`, `error_description`, **`error_source`**, **`error_step`**, **`error_reason`**, `notes`, `created_at`, plus `card` / `upi` / `bank` / `vpa` / `wallet` / `acquirer_data`.

Expanding `card` gives: `last4`, `network`, `type` (credit/debit), `issuer` (bank code), `international`, `emi`, `sub_type` (consumer/business).

> **Note:** the `error_source` / `error_step` / `error_reason` decomposition is **better than MECE case A3.1.2 assumes.** That case treats decline reasons as opaque. Razorpay decomposes them. Adjust the framing if A3.1.2 is cited.

### 5.4 Pre-charge intelligence (underused, high value)
- **IIN / card lookup:** given a card's first six digits, returns `network`, `type`, `sub_type`, `issuer_name`, `is_tokenized`, `emi.available`, **`recurring.available`**, and **`authentication_types`** (3ds / otp).
  → The agent can know *before* charging whether an instrument can hold a mandate and what auth wall it will hit.
- **VPA validation API** — validate a UPI address before attempting.
- **`fetchPaymentMethods()`** — what is actually enabled on the account.
- **Downtime API:** `GET /v1/payments/downtimes` plus `payment.downtime.started` / `.resolved` webhooks. Returns method, severity (high/medium), and affected instrument (bank code or `vpa_handle`), and a `scheduled` flag.
  → **Unverified:** test mode almost certainly does not surface live bank outages. Treat as a schema to synthesise against. **Verify before designing around it.**

### 5.5 Catalog-adjacent
- **Razorpay does not hold merchant catalogs.** Agent Studio reads products from Shopify via OAuth.
- **Items API** — products/services for invoices. Lightweight, invoice-oriented.
- **Invoices** — up to 50 line items.
- **Magic Checkout** — takes `line_items` at order creation, and **expects merchants to host two endpoints**: one returning applicable promotions, one returning **shipping serviceability, COD serviceability, shipping fees and COD fees** for a given address.
  → This second endpoint is very close to the binding-quote endpoint an agent needs. **It is an existing Razorpay merchant pattern to generalise, not something to invent.**
- Magic Checkout also emits an **abandoned cart webhook**.

### 5.6 Route / Linked Accounts
- Create a **Linked Account** (a merchant), a **Stakeholder** (the person behind it), and a product configuration with bank details; then create transfers from orders or payments to split funds.
- Works with test keys. A linked account created in test mode can be used in live mode and vice versa.
- **Direct Transfers requires a support request to enable** — build on order- or payment-based transfers.

### 5.7 What cannot be done
- **Disputes cannot be generated.** The Disputes API is read + accept + contest only. Disputes originate from the issuing bank. **Your test-mode dispute list will be empty. Any credential claim or feature depending on dispute ratio is dead.**
- **No back-dating.** Razorpay stamps `created_at`. "This merchant has traded for three years" is not demonstrable in test mode by any means.
- **Refund turnaround is not directly available.** The refund object has `created_at`, `status`, `speed_requested`, `speed_processed` — but **no processed-at timestamp.** You would have to catch the `refund.processed` webhook and record the time yourself, and test-mode timings are simulated anyway.
- **No account-age API.** Usable proxy: `created_at` of the oldest payment ("first transacted N days ago"), which is arguably a better signal.
- **Settlements in test mode** — API exists; whether meaningful settlement entities are generated is **unverified**.

### 5.8 MCP server coverage
35+ tools across **Payments, Payment Links, Orders, Refunds, QR Codes, Settlements, Payouts**.

**Not present: Subscriptions, Disputes, Route / Linked Accounts.**

→ Architecture consequence: any Route work is **direct REST, not MCP**. A hybrid (discovery and splits in your own code, payment actions via MCP) is defensible but should be a deliberate, documented choice.

→ The MCP server is open-source Go with a clear tool-registration pattern. Adding Route tools via PR is *possible*. Treat as **bonus, not plan** — an unmerged PR is worth far less than a merged one, and merging is not in your control.

---

## 6. The build (current definition)

### 6.1 The interpretation shift — the most important change from v1

v1 built a **buyer agent** that purchases from a merchant. That was the wrong half.

The track reads: *"an agent that grows revenue for a merchant on Razorpay test-mode APIs, **or** that makes a merchant transactable by an AI buyer end to end."*

**"Makes a merchant transactable" means the merchant is the artifact.** The build is the **seller side**.

A buyer-side client is still required — but as a **test harness**, not a product. A couple hundred lines that walks the flow, generates traffic against the merchant surface, and produces the numbers. It does not browse, reason, or need to be smart.

### 6.2 Why the payment path is the growth lever (this is the thesis)

Payments is not "a bit of work" on the way to transactability. **In India it is a wall.**

- **UPI:** checkout either deep-links to a UPI app or pushes a collect request. Either way the user types a **UPI PIN inside the UPI app on their own device.** No API, by design. An agent cannot type it, forward it, or delegate it.
- **Cards:** additional factor authentication is regulatorily mandated, so an OTP goes to the user's phone. Tokenization rules prevent merchants storing card numbers, so an agent cannot hold a reusable instrument.

Razorpay's own framing: payments have been the natural stopping point for AI-led experiences, because every transaction demanded manual approval through PINs, OTPs and repeated authentication.

This is why US approaches do not transfer — ACP's shared payment token and Visa's tokenization work because card-not-present without step-up is normal there.

**Reserve Pay's actual mechanism:** a one-time, consent-based authorisation where the user sets a spending limit for a merchant, after which agents transact within those limits without repeated PIN prompts, with instant revocation.

> **Key reframe for the pitch:** Reserve Pay does not remove the human — it moves the human **earlier in time**. The PIN still happens, once, on the user's own phone, before the agent acts.
>
> Therefore **the bound IS the payment mechanism**, not a safety wrapper bolted on. Without it there is no transaction at all. A pitch that makes this argument is describing the architecture, not reciting the judging criteria.

**Can today's agents transact a Razorpay site?** Generic ones, no. The working pilots (Zomato/Swiggy/Zepto in Claude) are purpose-built integrations combining Razorpay's infrastructure, NPCI's network and the AI surface — a pilot with a select user group and a handful of named merchants. Every other merchant's checkout is unreachable. **That gap is the build.**

### 6.3 The three parts

**Part A — machine-readable merchant surface.** Over an existing Razorpay merchant, expose:
- Products with price-including-tax, availability, variants, delivery estimate, pincode serviceability
- **A binding quote endpoint** — agent sends cart + destination, merchant returns the authoritative total. This is the structural answer to price divergence: the merchant's quote *is* the price, not whatever was scraped. Generalise the Magic Checkout serviceability pattern (§5.5).
- Machine-readable order state afterwards

**Part B — payment-path decision (the growth agent).** For a human you show every method and let them choose. For an agent, most methods are **impossible to complete**. So the merchant must determine what *this* buyer can actually finish:
- Does it hold a mandate, and within what bounds? (Orders API token object)
- If card: does the IIN lookup report `recurring.available`, and which `authentication_types`?
- Is that method up right now (downtime feed)?
- What does the merchant's own history say about success rates on that path?

Then **offer only what can complete**, and when nothing can, **degrade to a payment link** handed back to the human — Razorpay's own native failure move (Ray AI reaches for exactly this).

Bounds (all hard-coded, outside LLM control):
- Refuse to act below a sample-size floor
- Never disable a method carrying more than X% of volume without escalating
- Never act on a downtime signal alone without corroborating history
- Persuasion bounds per §3.4

> An agent that **declines to optimise because it only has eleven data points** is a better demonstration of judgment than one that always has an answer.

**Part C — the agent-demand diagnostic.** Log every agent request the merchant could not answer (no pincode serviceability, ambiguous variant, no delivery estimate, no binding total), ranked by the value of the carts it killed. Deliver as a report.

MECE **B7.11**'s explicit point is that **no feedback loop exists** for this. Building it is the differentiated contribution, and it reads as a growth report in the merchant's own language: here is what you lost and why.

### 6.4 Measurement (the "measured evidence" bar)
- Seed a large synthetic batch (see §6.5) with **known ground truth**
- Run agent purchases with and without Part B's selection logic
- Report: completion rate delta, **and the false-refusal count** — how often the agent blocked something legitimate
- Reporting false refusals is Track 02's explicit standard (precision/recall *including false-positive cost*). Applying it unprompted to a Track 01 submission reads as taste.

### 6.5 Build prerequisite — the seed script
**A fresh test account has zero payments. Nothing can be computed or measured until history exists.**

First thing to build: a script that fires several hundred test payments through, mixed methods, a slice of failures via `failure@razorpay`, some refunds.

Make **two merchants with deliberately different profiles** (e.g. 3% refund rate + clean success vs 30% refund rate + frequent failures). This gives the buyer harness a real reason to prefer one, and gives you ground truth to measure against. **The seed set is both the demo and the eval set.**

Use the `notes` field (15 key-value pairs, 256 chars each, on every entity) to tag seeded records.

### 6.6 Anticipated judge objection — prepare two answers
*"Agent buyers barely exist, so you're growing revenue that isn't there."*

1. **The catalog work is dual-use.** Serviceability, binding totals, real availability — those absent fields cause human abandonment too (MECE §A2). Fixing them for agents fixes them for people.
2. **The diagnostic is the stronger answer** (Part C). It measures demand the merchant is currently failing to serve, which is a present-tense number, not a bet on the future.

---

## 7. Ideas evaluated and rejected — with reasons (do not re-litigate)

### 7.1 Cross-merchant customer targeting — REJECTED
*Idea: pull Razorpay's aggregated data about users (identified by payment method) and the sites they've paid, distil into target audiences for a merchant, then run targeted calls/ads.*

**Not a technical objection — a legal one.**
- Under DPDP, data collected to process payments for Merchant A cannot be repurposed to market for Merchant B. No consent exists for that.
- Razorpay's own public defence of Agent Studio is explicitly that agents use structured **first-party** data from the merchant's own systems and **do not interpret information from external or unverified sources.** This idea is precisely the thing they went out of their way to say they don't do — after being publicly questioned about price discrimination.
- Proposing it to the company you want to intern at would read as not understanding their regulatory position.
- It is also unbuildable: test mode contains no other merchant's data.

**The rule that actually governs, and it is worth understanding:** Razorpay *does* pool data across merchants — Thirdwatch assigns every user a risk score based on historical data across websites, 300+ parameters, red/green in under 200ms. So pooled cross-merchant data is fine for **protecting merchants from buyers**, and not fine for **selling to buyers**. That asymmetry is the real line.

**Legal version of the same intent:** cohort analysis on the merchant's **own** payment history — who bought once and never returned, which method, what they spent. That is MECE **A5.13** (Silent, High) and entirely available.

### 7.2 Route-backed marketplace vs. directory — DIRECTORY PREFERRED
Two distinct products were conflated:
- **Directory:** hub does discovery/verification only, never touches money; buyer pays the merchant directly at the merchant's own Razorpay account. No Route needed.
- **Marketplace:** money lands in your account and you split it. Needs Route.

**Prefer directory**, because:
- UCP explicitly preserves the merchant as **Merchant of Record** owning the customer relationship. Route makes *you* the MoR — quietly contradicting the standard you're aligning with.
- ONDC's low take rate (1–3% vs 25–30%) exists precisely *because* the network doesn't sit in the middle.
- Collecting money on someone else's behalf is regulated activity in India. A directory that never holds funds sidesteps the question entirely.

Cost: you need several separate Razorpay test accounts, one per merchant. Free, no KYC, just tedious.

Route remains the right answer **only** if demonstrating take-rate economics is explicitly part of the pitch.

### 7.3 Merchant credibility credential — PARKED (viable, not current focus)
User's own framing was architecturally correct: the signal is **embedded in the merchant's site and signed**, not an API the agent calls Razorpay with. This matters — an issuer-callback design makes Razorpay a gatekeeper and only works for Razorpay merchants; signed data verifiable offline could be issued by any provider.

**Claims that survived contact with the API** (see §5.7 for what died): transaction count, first-transaction date, refund rate, method-level success rate. **Four real claims beat ten invented ones.**

**Architecture:** the merchant's agent does not compute the credential — a separate **issuer service** does. It holds read access to the merchant's account (OAuth in production, pasted test key in the build — say so in the README), computes the metrics, signs, returns the blob; the merchant serves it at a fixed URL.

**Mechanism:** sign a JWT with Ed25519; publish the public key as a JWKS file at a well-known path. Payload: `iss`, `sub` (merchant domain + account id), `iat`, `exp`, `kid`, then the four claims.

**Four problems signing alone does not solve** — this is the actual design work:
1. **Staleness** — expiry timestamp inside the signed document; short lifetime (~1 week)
2. **Theft** — the document must name the merchant's domain and account id, and the agent must check it against the site it is talking to (the Visa TAP binding pattern)
3. **Revocation** — real trade-off: a revocation list (precise, but reintroduces a network call to the issuer) vs. short expiries only (no infrastructure, tolerates a staleness window). Pick deliberately and write down why.
4. **Key rotation** — `kid` in the signature

**The limit that cannot be engineered away:** the agent must be *told* which issuer keys to trust — either fetched from a fixed URL on Razorpay's own domain (HTTPS + domain ownership doing the work, as Visa does) or pinned in the agent (as browsers do with root certs). **State this openly in the README. Pretending it's solved is what would look weak.**

**Scope note:** this attests only what the issuer computed from payment data. It says nothing about whether product descriptions or prices are honest — which is why the binding-quote endpoint (§6.3 Part A) is a separate defence.

**Also: this is optional for merchants**, which means adoption is a design question, not just a crypto question.

### 7.4 Catalog conversion via proxy/embed — IN SCOPE, source corrected
Converting an existing merchant site's catalog to agent-readable form is Part A of the build. **But Razorpay is not the source** — read from Shopify / WooCommerce / the site itself.

**The hard part is not conversion.** It is the fields the site never had: machine-readable return policy, pincode serviceability, delivery estimate. That absence *is* MECE B7.11's content, and it is what Part C measures.

### 7.5 Writing the UPI payment handler for UCP — DOWNGRADED
Originally pitched as "contribute a missing piece to an open standard." That framing was **oversold**. Reasons:
- Nobody is asking. UCP is wired into Google's AI Mode and Gemini with US retailers. No Indian merchants in the coalition.
- Razorpay has not taken the standards route at all — they did bilateral deals with OpenAI and Anthropic.
- **You cannot appoint yourself the author of a payment handler spec.** That requires the payment provider's authority. If a UPI handler happens, NPCI or Razorpay writes it.

**Survives as:** a *demonstration* — "here is what a UPI payment could look like inside an agent–merchant conversation." Not as a standards contribution.

### 7.6 Full RFC 9421 agent-signature path — DEFERRED
Real and implementable (sign a base string, verify with a public key, timestamp + nonce for replay prevention). Not the current focus. **Document as designed-not-built in the README** — that reads as judgment, not omission.

---

## 8. Open questions

1. **Does the Downtime API return anything usable in test mode?** (§5.4) Run it against a test account before designing Part B around it. If empty, synthesise against the documented schema and say so.
2. **Are server-to-server payment creation endpoints enabled on a plain test account?** The SDKs expose UPI payment creation directly (`flow: collect`, target VPA, expiry) server-to-server rather than through the browser modal — far friendlier to an agent than driving an iframe. S2S endpoints usually require approval. Verify.

v1's open questions #2 (agent framework) and #3 (synthetic vs. realistic catalog) remain open and remain low-stakes.

---

## 9. Sources added since v1

**Buildathon**
- https://razorpay.com/buildathon/

**Razorpay product (video)**
- Agentic Dashboard: https://youtu.be/nJo9LgoGKZ4 · Ray AI walkthrough: https://youtu.be/CoVQhnWmvDo · Agent Studio: https://youtu.be/JXOzdo9S4F8 · Platform overview: https://youtu.be/LOlSr6u6BRI

**Razorpay docs**
- Test/live modes · Test card & UPI details · Payment entity (see also razorpay-node / -go / -php / -java / -ruby `documents/payment.md`) · Refunds entity · Disputes entity & APIs · Invoices & Items · Magic Checkout (web) · Route + Linked Accounts · Downtime API · MCP server tools reference

**Protocols**
- UCP (Google + Shopify, NRF Jan 2026) · Visa Trusted Agent Protocol (RFC 9421 / Cloudflare Web Bot Auth) · Mastercard Verifiable Intent (W3C VC, Mar 2026) · Amex ACE

**Context**
- Razorpay CPO on Agent Studio not being a discovery destination · Medianama coverage of Agent Studio launch (false urgency, price discrimination) · Thirdwatch cross-merchant risk scoring · ONDC take-rate comparisons · NPCI UAP status (RBI approval pending)

---

## 10. Next steps

1. **Seed script first** (§6.5). Two merchants, divergent profiles, several hundred payments. Nothing else can be measured until this exists.
2. Resolve open questions #1 and #2 (§8) by running the calls. Both are ten-minute checks.
3. **Part A** — machine-readable surface over one seeded merchant, including the binding-quote endpoint.
4. **Part B** — payment-path decision logic. Bounds as hard code, not prompt instructions. Logging built in from the start, not bolted on.
5. **Buyer test harness** — minimal; just enough to generate traffic and produce numbers.
6. **Part C** — the unanswered-request diagnostic, built on top of Part A's logs.
7. **Measurement run** (§6.4), including false-refusal count.
8. README last, covering: the thesis (§6.2), the designed-not-built list (§7.3, §7.6), and honest limitations (no back-dating, disputes unavailable, downtime synthesised if applicable).

---

## Appendix — one-sentence thesis

> Indian merchants cannot be bought from by AI agents because every payment rail terminates in a human typing a PIN or an OTP; the merchant side must therefore decide, per buyer, which payment paths can actually complete — and measure the demand it is currently failing to serve.
