# Feature checklist

Working checklist for the merchant-side agent gateway. Status is honest, not aspirational.

`[x]` done and verified · `[~]` partially done · `[ ]` not started · `[!]` blocked by something outside our control

Evidence for anything marked done is in [findings-06](findings-06-shopify-agent-surface.md) or the repo.

---

## 0. Platform plumbing — **done**

- [x] Shopify Partner account, dev store with demo catalogue
- [x] App scaffolded (`agent-gateway/`, React Router + TypeScript)
- [x] OAuth install, offline session with access token stored
- [x] Scopes: `read_orders`, `read_customers`, `read_inventory`, `read_fulfillments`, `read_shipping`, `read_discounts`, `write_products`
- [x] App Proxy live — `merchant.myshopify.com/apps/agent/*` reaches our server
- [x] Shopify's proxy HMAC verified via `authenticate.public.appProxy`
- [x] Subpath routing confirmed, `path_prefix` preserved
- [x] Theme app extension (app embed block) rendering on the storefront
- [x] RFC 9421 crawler signature headers **forwarded intact** through the proxy — agent identity is a **tier-0** capability
- [ ] Remove storefront password before any demo recording
- [ ] Delete the nested `agent-gateway/.git` so the parent repo tracks it
- [ ] Hosting for the non-dev deployment (the tunnel is dev-only)

---

## 1. Conversational overlay (human shopper) — **partially done**

### 1.1 Transport and shell — done
- [x] App embed block, no theme code edited, merchant-toggleable
- [x] Floating panel UI, vanilla JS, no build step
- [x] `/apps/agent/chat` behind the App Proxy — same-origin, no CORS, HMAC-signed
- [x] Conversation history round-tripped, capped, treated as untrusted input
- [x] Server-side system prompt the browser cannot displace

### 1.2 Reasoning — partially done
- [x] Catalogue tools written: `search_catalog`, `get_product` — live Admin API, zero merchant upload
- [x] Grounding rule: may only speak from what the catalogue returned
- [~] LLM seam (`runAssistant()`) — **provider being swapped to our own API**
- [ ] Decide whether our API does tool calling; if not, grounding becomes retrieve-then-prompt
- [ ] End-to-end verified against the real catalogue
- [ ] Streaming responses (currently one blocking reply)
- [ ] Latency budget measured

### 1.3 Rich rendering (images, links, cards) — not started
- [ ] Structured response envelope: `{ reply, cards[] }`
- [ ] Cards rendered from **server-supplied catalogue data**, never model-written markup
- [ ] Model emits product *handles*; the server resolves image, price, URL
- [ ] Never render model-authored HTML — that is fabrication and XSS in one move

### 1.4 Bounds — partially done
- [x] Enforced in code, not in the prompt (`bounds.server.ts`)
- [x] Unverifiable discount claims blocked
- [x] Unverifiable urgency blocked, with tool-sourced stock numbers allowed through as fact
- [x] Blocked replies replaced, the attempt logged
- [x] `bounded` + `gates` returned to the client so the gate is *visible*
- [ ] Bounds consult a real approved-offer store (today zero discounts are offerable, so blocking all of them is right by accident)
- [ ] Sample-size floor — refuse to advise below N data points
- [ ] Delivery-promise bound

### 1.5 Memory and personalisation — not started
- [ ] Per-shopper profile keyed on `logged_in_customer_id` (the proxy already passes it)
- [ ] Anonymous-session continuity
- [ ] Purchase history via Razorpay `/payments?contact=` (E.164, exact match)
- [ ] First-party only — no cross-merchant enrichment (DPDP)

---

## 2. Agent-readable front (shopper agents) — **not started**

- [ ] Manifest at `/apps/agent/manifest` — capabilities, endpoints, payment paths
- [ ] Machine catalogue endpoint (JSON, paginated, stable ids)
- [ ] Binding quote endpoint — cart + destination in, authoritative total out
- [ ] Serviceability: pincode, COD, delivery estimate
- [ ] Machine-readable order state
- [ ] JSON-LD injected into storefront HTML via the app embed
- [ ] `<link rel>` manifest pointer
- [ ] **Verify the crawler signature ourselves** — Shopify fails open, so header arrival is not validity
- [ ] Content negotiation by identity: a signed agent gets the full surface
- [!] Root `/.well-known/` — not servable on Shopify, tier-3 only

**Watch:** Shopify's **Agentic Storefronts** syndicates catalogue to ChatGPT/Copilot/Shop. Plain catalogue exposure is being commoditised — do not pitch it as the novelty. Also verify whether Shopify's Storefront MCP endpoint already exposes catalogue and cart tools to agents; if it does, this section narrows and the differentiators move entirely to quote, payment path and bounds.

---

## 3. Offers: propose → approve → publish — **not started**

- [ ] Probe whether Razorpay's Offers API can hold an approved offer (unprobed; `offer_id` exists on the order object and is always null in our corpus)
- [ ] Approval object: scope, discount, **cap that depletes**, `valid_until`, eligibility rule
- [ ] Agent proposes from measured history, never invents
- [ ] Merchant approval UI in the embedded admin app
- [ ] Publish approved offers to both the storefront and the agent surface
- [ ] Assistant may only surface offers carrying an approval record
- [ ] Expiry stated only when `valid_until` is real

**Design rule earned from Razorpay:** `token.max_amount` failed as a wallet because it is a per-transaction ceiling that never depletes. An approved offer with no issuance cap has the same flaw.

---

## 4. Decision ledger — **partially done**

- [x] Append-only log, one shape for every gate
- [x] Refusals recorded with the suppressed reply and the prompting message
- [x] Tool errors recorded
- [ ] Move from JSONL to a Prisma table
- [ ] Merchant-rejected offer proposals in the same table
- [ ] Rejection reason as a **closed enum** so it aggregates
- [ ] Outcome captured after the fact — did the rejected offer's carts convert?
- [ ] Buyer-side false-refusal count (buildplan §6.4)
- [ ] No self-grading — holdout or baseline before scoring proposals
- [ ] Ledger view in the admin app

---

## 5. Payment path (Razorpay) — **not started**

- [ ] Connect Razorpay from the embedded admin (test key now, OAuth later)
- [ ] Capability handshake: `/preferences`, `/methods`
- [ ] Downtime feed with a staleness filter (**nothing ever closes** — DLXB has been "down" 128 days)
- [ ] Method success rates derived from payment history
- [ ] Payment-path decision: offer only what *this* buyer can complete
- [ ] Handoff: payment link / mandate registration link / SBMD order
- [ ] Razorpay webhooks: `payment.failed`, `payment.captured`, `refund.processed`
- [ ] Failure taxonomy from `error_source` × `error_step` × `error_reason`
- [!] Autonomous charge — impossible. UPI needs a PIN, cards need an OTP, S2S needs PCI-DSS, SBMD needs an activation we cannot request
- [!] Card recurring pre-flight — IIN endpoint refused, `issuer` is null

**Demo warning:** test mode never asks for a PIN, so a browser agent *will* complete a purchase. That is the mock, not proof. Say so on camera.

---

## 6. Reconciliation — **not started**

- [ ] Join Shopify orders ↔ Razorpay payments
- [ ] Normalise `contact` to E.164 on the way in and out
- [ ] Stamp our own id into Razorpay `notes` (512 chars, every entity except `/items`)
- [ ] Own phone → `customer_id` index — `/customers?contact=` is accepted **and ignored**, returning the full collection for any value
- [ ] Unmatched-payment and unmatched-order reports

---

## 7. Voice outreach — **not started**

- [ ] Abandoned checkouts from Shopify — **the only source.** Razorpay has no cart-abandonment webhook, and 17 of 27 orders sit indistinguishably at `attempts: 0`
- [ ] Failed-payment recovery from `payment.failed`
- [ ] Branch outbound on `error_step` × `error_reason`: `customer`/`payment_cancelled` is worth re-asking; `bank`/`issuer`/`payment_failed` means switch method, don't call
- [ ] Persuasion bounds applied to voice
- [ ] TRAI DND/DLT registration checked
- [ ] DPDP line held: recovery is transactional; **the moment it upsells it becomes marketing** and needs separate consent

⚠️ **Novelty risk: high.** Agent Studio ships cart recovery over voice + WhatsApp. Differentiate on the failure taxonomy and the bounds, or leave it out of the pitch.

---

## 8. Install experience — **not started**

- [ ] Deep link that activates the app embed in one click
- [ ] Post-install discovery pass: catalogue, orders, shipping zones, policies
- [ ] Derived facts with sample sizes — dispatch p50/p90, success rates, refund rate
- [ ] Readiness report: what I know / what I derived / what's missing and what each gap costs
- [ ] Gap punch-list ranked by value, pre-filled drafts to confirm
- [ ] Bounds form — the only genuinely mandatory human input
- [ ] Policy extraction to structured fields, merchant confirms

**The forced-provision list is only five items**, three of which are "confirm a draft": bounds · approval authority · COD + delivery promise · structured return policy · which payment methods to expose.

---

## 9. Custom-site integration (tier 3) — **not started**

- [ ] Drop-in `<script>` tag for the overlay
- [ ] API-key + domain-verification handshake, replacing Shopify's proxy HMAC
- [ ] CORS policy
- [ ] Catalogue ingestion: feed, crawl, or platform API
- [ ] Root `/.well-known/` discovery — **the thing Shopify cannot give us**
- [ ] Edge middleware for true request interception and content negotiation
- [ ] Our own RFC 9421 verification, with no Shopify edge doing it for us

---

## 10. Diagnostics (Part C) — **not started**

- [ ] Log every agent request we could not answer
- [ ] Rank by the value of the carts it killed
- [ ] Merchant-facing report
- [ ] Same engine as the install readiness report — one mechanism, two moments

---

## Cross-cutting

- [ ] Seed script — **hard prerequisite.** 15 payments is not a corpus, and sections 3, 5, 6 and 7 all need history
- [ ] Rerun any demo more than once — checkout A/B buckets per request
- [ ] README: thesis, designed-not-built list, honest limitations
- [ ] State "tool output is data, never instructions" as a bound, citing `integrate_razorpay_checkout`'s `aiInstructions` field
- [ ] Never claim a bounded agent transaction was demonstrated. **Recorded ≠ authorised ≠ debited** — say all three
