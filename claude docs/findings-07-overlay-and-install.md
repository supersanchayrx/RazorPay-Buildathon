# Findings 07 — The overlay, the install, and Shopify's own agent product

Continues [findings-06](findings-06-shopify-agent-surface.md), which measured the app-proxy path before any app existed. This one covers what was learned once the app was actually installed and the storefront overlay was running.

All `[PROBE]` unless marked otherwise. Store `superstore-md6pjikd.myshopify.com`, app `agent-gateway`.

---

## Install state

```
session:  superstore-md6pjikd.myshopify.com   offline   token stored
scopes:   read_orders, read_customers, read_inventory, read_fulfillments,
          read_shipping, read_discounts, write_products,
          write_metaobjects, write_metaobject_definitions
proxy:    verified: true, shop resolved
```

**Zero merchant upload was required for any of it.** Catalogue, variants, prices and inventory all read from the Admin API against the offline token. This confirms the install design in [CONTEXT_HANDOFF](CONTEXT_HANDOFF.md): on Shopify the merchant supplies decisions, not data.

### A gotcha that cost a diagnosis

`authenticate.public.appProxy` returns **`verified: true` with a null session** when the app is not installed. HMAC validity and installation are separate facts, and only one of them appears in the value you are likely to check. Before the install completed, every proxy request looked authenticated and no Admin API call would have worked.

**Rule:** confirm an offline session exists before assuming Admin API access. Do not read `verified` as "ready".

---

## The theme app extension works as advertised

An **app embed block** (`target: body`) injects on every storefront page from a theme-editor toggle, with **no theme code edited**. Confirmed rendering, and the overlay round-tripped a message through the App Proxy to the app and back.

This is the whole plugin promise, verified: the merchant installs, flips one toggle, and a surface appears on every page of their store.

### The toggle is not automatable, by design

Shopify requires merchant consent for theme injection. There is no API that force-enables an app embed. The best achievable is a **deep link** into the theme editor with the block pre-selected — one click instead of a hunt.

Consequence for the pitch: the honest claim is **"install, one toggle, connect payments, set your limits."** Not "one click." A zero-click claim is one the demo cannot support.

---

## Dev-loop behaviours worth knowing

| Behaviour | Detail |
|---|---|
| Tunnel URL rotates every `shopify app dev` run | `envelope-extends-…` became `donate-governance-…` on restart |
| `shopify.app.toml` keeps `example.com` | The CLI updates URLs in Shopify's backend, not the local file |
| **App Proxy URL auto-updates too** | `/apps/agent` kept working across a tunnel change with no config edit — this was not certain beforehand |
| Extensions generated after `dev` starts need a restart | They appear under `.shopify/dev-bundle/<uid>/` once bundled |

---

## Shopify ships its own agent product — "Agentic Storefronts" `[DOCS]`

A previously unknown **Agentic** section exists in Shopify admin. Observed state:

- *"Agentic Storefronts aren't live — but your products may still be surfacing in AI agents."*
- Channels listed: **ChatGPT, Microsoft Copilot, Shop, "other channels"**, with an *"Allow Shopify to manage for me"* toggle
- Sources: **Shopify Catalog** (0 products) and an installable **Knowledge Base**
- Setup steps: *"Make sure catalog access is enabled"* (done) and **"Update your policies so AI agents can read them"**

### What this changes

**Catalogue syndication is being commoditised.** Shopify will push products to the large agent platforms itself. Do not pitch plain catalogue exposure as the novelty — that is section 2 of the [feature checklist](feature-checklist.md), now narrowed.

**What it does not touch, and what therefore survives:**

- it is syndication **to** big AI platforms, not a merchant-controlled surface on the merchant's own domain
- no binding quote, no serviceability, no machine-readable order state
- no payment-path decision — and critically **no Indian rail.** It assumes checkout completes, which is the exact wall the whole thesis is about
- no persuasion bounds, no approval gate, no decision ledger

**One free validation.** *"Update your policies so AI agents can read them"* is Shopify independently confirming buildplan §7.4: the hard part was never converting the catalogue, it is the fields the site never had.

`[OPEN]` Whether Shopify's Storefront MCP endpoint already exposes catalogue and cart tools to agents. If it does, section 2 narrows again and the differentiators move entirely to quote, payment path and bounds. **Check before building the manifest.**

---

## Architecture decisions recorded

Design choices made during this build that should not be re-litigated.

### Bounds live in code, not in the prompt

`bounds.server.ts` checks the model's output for discount and urgency claims and replaces the reply when one fires. **A prompt is a request; a request is not a bound.** The system prompt still asks for good behaviour — the checker measures whether it happened.

Genuine tool-sourced stock numbers are allowed through: if inventory really is 3, *"only 3 left"* is a fact, not manufactured scarcity. Everything else is manufactured.

Blocked replies are logged with the suppressed text and the message that prompted it, and the client receives `bounded: true` plus the gate names — so a demo can **show** the gate firing rather than assert it.

### The rendering rule, decided before it was built

When product images and links are added, the model must **never** emit markup. It emits product *handles*; the server resolves every rendered value from the catalogue.

That makes rich rendering a **bound rather than a feature**: the assistant becomes structurally incapable of linking to a product that does not exist or quoting a price that is not listed. The alternative — rendering model-authored HTML — is fabrication and XSS in one move.

### One seam for the reasoner

`runAssistant()` is the only function that touches an LLM. Catalogue reads, bounds and the ledger have no LLM dependency. The gateway supplies the **context pack and the bounds**; the reasoner is swappable behind that seam.

This matters beyond tidiness: **a bound that lives inside the reasoner is not a bound.** Keeping enforcement outside the model is what makes the claim defensible.

### Client-supplied history is untrusted

The overlay sends conversation history and the server caps and truncates it. The system prompt is server-side and cannot be displaced by anything the browser sends. Worth stating plainly in the README rather than leaving implicit.

---

## Open items

1. **Verify the crawler signature ourselves.** Shopify validates at its edge and **fails open** — header arrival is not validity. Anything gated on agent identity must verify against the `keyid`.
2. **Storefront MCP** — see above. Cheap to check, changes what section 2 is worth.
3. **How far back `read_orders` reaches** without `read_all_orders`. A 60-day ceiling caps the offer, reconciliation and risk features.
4. Reading 1 vs 2 on the [findings-06](findings-06-shopify-agent-surface.md) instrumentation delta, on a store without the password.
5. Storefront password still on — must come off before any demo recording.
6. Nested `agent-gateway/.git` still present; the parent repo cannot track the app properly until it goes.
