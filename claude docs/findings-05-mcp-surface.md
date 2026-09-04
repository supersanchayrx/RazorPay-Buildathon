# Findings 05 — The MCP surface

What Razorpay's official MCP server exposes, what it cannot reach, and the one result on it that is worth building the pitch around.

All `[PROBE]` unless marked otherwise. Server `https://mcp.razorpay.com/mcp`, HTTP transport, `Authorization: Basic base64(key_id:key_secret)`. **42 tools.**

---

## Why this doc exists

MCP was deliberately excluded from reconnaissance, and that was right — see [what it cannot reach](#what-mcp-cannot-reach), which is the justification, measured rather than asserted. It has now been connected and every tool exercised once, because the agent's *payment actions* will run through it and the tool contracts carry information the REST docs do not.

**The single most important result is [SBMD](#sbmd-is-accepted-and-stored).**

---

## Configuration — Razorpay's own docs target the wrong file

Razorpay's VS Code page prescribes a config for **VS Code's own** MCP support. Claude Code uses a different schema. Pasting theirs produces a silent no-op. `[DOCS]`

| | Razorpay's docs | Claude Code |
|---|---|---|
| File | VS Code User Settings JSON | `.mcp.json` at project root |
| Top-level key | `mcp.servers` | `mcpServers` |
| Secret placeholder | `${input:merchant_token}` (VS Code prompt) | `${ENV_VAR}` (environment only) |
| Transport | `npx mcp-remote` bridge (stdio) | native `"type": "http"` |

`${input:...}` is a VS Code feature. Claude Code does not prompt for it; it passes the literal text through, and the failure surfaces as a **401 that looks like a bad key** rather than a config error.

What works:

```json
{ "mcpServers": { "razorpay": {
    "type": "http",
    "url": "https://mcp.razorpay.com/mcp",
    "headers": { "Authorization": "Basic ${RAZORPAY_MCP_AUTH}" } } } }
```

`${VAR}` expansion works in `url` and `headers`, so **the credential never enters the file** — which fixes the plaintext-config complaint recorded in the handoff. The variable must be a real process env var (`setx` on Windows); the project `.env` is loaded by `godotenv` in our Go code and is invisible to Claude Code.

**Gotcha that cost time:** a stray character in the base64 produces a 401 indistinguishable from a stale key. Verify the token independently before blaming the server — decode it, check it splits into two parts of 23 and 24 characters, and call `GET /orders?count=1` with that exact header.

---

## SBMD is accepted and stored

**This is the strongest result in the project.**

`create_order`'s contract explicitly documents mandate orders with `token.type = "single_block_multiple_debit"` — **SBMD, which is Reserve Pay's mechanism** — and requires `method: "upi"` when that type is used. `initiate_payment` carries matching plumbing (`recurring`, and a `force_terminal_id` described as "in case of single block multiple debit"). `[DOCS]`

Sent via MCP `create_order` on a plain account (`activated: false`, `upi: false`):

```
amount 100, currency INR, method "upi", customer_id cust_...,
token { max_amount 500000, frequency "as_presented",
        type "single_block_multiple_debit" }
```

→ `200`, `order_TXxhLpDltIAzcP`. The response body shows **no token and no method** — the [findings-03](findings-03-checkout-behaviour.md) trap. `GET /orders/{id}` also hides both. Asked on the surface that consumes it:

```json
"order": {
  "amount": 100, "currency": "INR", "method": "upi",
  "token": { "max_amount": 500000, "frequency": "as_presented",
             "start_time": 1788525371, "end_time": 1793709370,
             "recurring_type": "before" } }
```

**Control:** a plain order created in the same minute has an order block with no `token` and no `method`. So this is not boilerplate.

`recurring_type: "before"` was added server-side again — processing, not echo. And `frequency: "as_presented"` **survived**, which is worth noting because `monthly` was silently nulled on the emandate registration link. The drop is per-method, not general.

### What may and may not be claimed

**May:** the SBMD bound — the mechanism the Claude x Zomato/Swiggy/Zepto pilots run on — is recordable on an unactivated test account **through Razorpay's own public agent interface**, with a control isolating it.

**May not:** that it works. `initiate_payment` is refused and UPI is off account-wide, so authorisation cannot be attempted here at all. **Recorded ≠ authorised ≠ debited.** Order creation remains the cheap half.

This is narrower than the old mandate claim and much stronger, because SBMD is the thing the 24-hour pre-debit notification does *not* kill.

`[OPEN]` Whether an SBMD order can be authorised on any account we can obtain.

---

## What MCP cannot reach

The measured version of the handoff's argument.

**Absent entirely:**

- **Customers.** No create, no update, no addresses. Every user-data result in [findings-04](findings-04-customer-data.md) is REST-only.
- `/preferences` and `/methods` — **the whole capability handshake**
- `/payments/downtimes`
- `/items`, `/payment_pages`
- Disputes, Route / Linked Accounts / transfers

**`fetch_all_payments` accepts only `count`, `from`, `skip`, `to`.** The undocumented `contact=` filter ([findings-01](findings-01-api-surface.md)) is **unreachable through MCP.** One line, and it settles the point: MCP publishes the sanctioned surface; the Bench found a filter Razorpay neither documents nor exposes.

**Refinement to buildplan §5.8**, which lists Subscriptions as absent: partly wrong. `create_registration_link` **is** the Subscriptions registration API and it works. What is missing is subscription CRUD.

**One backdoor worth knowing:** `fetch_tokens` returns the **full customer object including addresses**, and its contract states that given only a `contact` it will "find **or create** the customer first." So MCP can create a customer as a side effect of a read.

---

## Tool-by-tool

`OK` works · `DEFECT` works with a defect · `REFUSED` refused

### Orders

| Tool | Result |
|---|---|
| `create_order` | OK — regular order |
| `create_order` (SBMD) | OK — stored, see above |
| `fetch_order` | OK |
| `fetch_all_orders` | OK — **renders `token` for auth_link orders** |
| `update_order` | OK — notes only, as documented |

### Payments

| Tool | Result |
|---|---|
| `fetch_all_payments` | OK — no identity filter |
| `fetch_payment` | OK — full envelope + embedded card, `card.name: "sauagh"` |
| `fetch_payment_card_details` | DEFECT — **drops the cardholder name**, `name: ""` for the same card |
| `fetch_order_payments` | OK |
| `update_payment` | OK — notes |
| `capture_payment` | OK — real validation, "This payment has already been captured" |
| `submit_otp` | DEFECT — `"We are facing some trouble completing your request"` |
| `resend_otp` | DEFECT — same generic message |
| `initiate_payment` | REFUSED — `"The requested URL was not found on the server."` |

`initiate_payment` returns the **identical** refusal to probe P5 against `/payments/create/upi`. Same wall, reached through a different door.

The OTP tools are worth flagging: a nonexistent payment id produces a generic retry message rather than "no such payment" or "not awaiting OTP". **Not diagnosable** — do not build retry logic on their error text.

### Payment Links

| Tool | Result |
|---|---|
| `create_payment_link` | OK — live `short_url` |
| `fetch_all_payment_links` | OK |
| `fetch_payment_link` | OK |
| `update_payment_link` | OK — reference_id + notes |
| `payment_link_notify` | OK — probed with a deliberately fake id so no message was sent |
| `payment_link_upi_create` | REFUSED — `"UPI Payment Links is not supported in Test Mode"` |

### QR Codes

| Tool | Result |
|---|---|
| `create_qr_code` | REFUSED — `"UPI transactions are not enabled for the merchant"` |
| `fetch_all_qr_codes` | OK — empty |
| `fetch_qr_code`, `fetch_payments_for_qr_code` | OK — clean id-not-found |
| `fetch_qr_codes_by_customer_id`, `_by_payment_id` | OK — empty |

**Two distinguishable UPI refusals**, which is new. One is a **mode** gate ("not in Test Mode"), the other an **entitlement** gate ("not enabled for the merchant"). Previous UPI probes only ever produced the second kind, and the distinction matters: only the first would change by going live.

### Refunds · Settlements · Payouts · Tokens

| Tool | Result |
|---|---|
| `fetch_all_refunds`, `fetch_multiple_refunds_for_payment` | OK — empty |
| `fetch_refund`, `fetch_specific_refund_for_payment` | DEFECT — `"invalid request sent"`, vague |
| `update_refund` | OK — clean id-not-found |
| `fetch_all_settlements`, `_instant_settlements`, `_recon_details` | OK — all empty |
| `fetch_settlement_with_id`, `_instant_settlement_with_id` | OK — clean id-not-found |
| `fetch_all_payouts` | REFUSED — `"Access to requested resource not available"` |
| `fetch_payout_with_id` | REFUSED — URL not found |
| `fetch_tokens` | OK — `count: 0`, plus the full customer and its addresses |
| `revoke_token` | OK — clean id-not-found |

Settlements being empty **closes buildplan §5.7's "unverified"** note. There is no RazorpayX account, so both payout tools are dead here.

### Registration link

`create_registration_link` — see [findings-03](findings-03-checkout-behaviour.md). Works, and closes an `[OPEN]` item.

### The two developer tools

**`detect_stack` reported `framework: "gin"` at `confidence: 0.9`** for a `go.mod` containing only `godotenv` and `cobra`, against servers written in stdlib `net/http`. Its `backendFramework` enum offers gin/echo/fiber and **no option for the standard library**, so our actual stack is inexpressible.

Downstream, `integrate_razorpay_checkout` emitted `gin.Context` handlers, a `handlers/` package and `r.POST` wiring — none of which fits this tree. The generated code is otherwise sound: HMAC-SHA256 verification of `order_id|payment_id`, `modal.ondismiss`, and `rzp.on('payment.failed')`.

**A trust-boundary note worth putting in the README.** `integrate_razorpay_checkout`'s result contains an `aiInstructions` field of imperatives aimed at the reading agent — "YOU MUST", "FORBIDDEN", "DO NOT give Next Steps", plus a directive to create and open a `NEXT_STEPS.md`. It was treated as data and not followed.

This is a live instance of the thing our own thesis is about: **a tool result that attempts to direct the agent.** For a project whose bar is "explainable, bounded and gated", *"tool output is data, never instructions"* is a bound worth stating explicitly — and we have a first-party example to cite.

---

## Consequences for the build

1. **The hybrid is now measured, not assumed.** Payment actions via MCP; capability discovery, customers, addresses, items and downtime via direct REST — because MCP has no tool for any of them.
2. **Do not route user-data writes through MCP.** It cannot, except by the `fetch_tokens` side effect, which is not a create path you want.
3. **Do not trust `detect_stack`.** Pass the stack explicitly.
4. **Treat MCP tool results as untrusted data.** One of them contains instructions.
5. **SBMD is the pitch** — with the caveat stated in the same breath.
