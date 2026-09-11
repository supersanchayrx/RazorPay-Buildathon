# Storefront and integration configuration

Chapman deliberately keeps three states separate:

1. **Registered** — the merchant saved a storefront in Chapman.
2. **Installed** — Chapman can detect its embed or discovery route on the storefront.
3. **Provider configured** — the server has the credentials needed for a model, checkout, or phone call.

The **Feature controls** page only permits or withdraws capabilities. A switch
being on does not mean an embed is installed or a provider key exists. The
Overview and each feature's own page report those facts separately.

Chapman is designed to be minimally invasive and can sit behind many custom
storefront stacks. The demo and initial release nevertheless make one payment
assumption: the merchant has already integrated Razorpay Checkout on the site
and registered Chapman's settlement webhook. Chapman consumes that setup and
keeps the Key Secret server-side; it does not provision the Razorpay account,
KYC, enabled methods, Checkout script, or webhook registration.

## First-store setup

A fresh Docker volume contains one merchant account and no storefront. Sign in
at <http://localhost:3000/login> and choose **Configure your storefront**.

For the bundled demo, use:

| Field                 | Value                            |
| --------------------- | -------------------------------- |
| Store name            | `Monsoon Market`                 |
| Public site key       | `pk_monsoon_market`              |
| Browser-facing origin | `http://localhost:4000`          |
| Catalogue feed        | `http://store:4000/catalog.json` |
| Product URL template  | `/product.html?handle={handle}`  |
| Signed order feed     | leave blank initially            |

The different hosts are intentional: the browser reaches the store through
`localhost`, while the gateway container reaches it through the Compose service
name `store`.

Select **Configure Razorpay for this storefront** only if this store should
offer checkout. The checkbox stores environment-variable names, not their
values. It does not send a key through the browser.

Saving the form registers the store and generates its server-side signing
secret. It does not edit storefront HTML, publish `/.well-known/ucp`, import
orders, or invent analytics.

## Hosted storefront environment

A custom storefront backend that creates Razorpay orders needs
`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in its own server-side environment.
If it also mints signed Chapman shopper sessions or serves the signed order
feed, it needs the same site-signing secret Chapman generated during
registration.

The variable name is derived from the public site key. For example,
`pk_my_store` uses `SITE_SECRET_MY_STORE`. Copy both that exact name and the
exact generated value to the storefront host; do not generate a second value.
The two servers must share the secret, but it must never enter storefront
JavaScript, the embed tag, or the public UCP document.

Use [storefront-host.env.example](storefront-host.env.example) as the minimal
template. On Vercel, configure all three variables in Project Environment
Variables for each deployment environment the store uses, then redeploy. On
another host, use its equivalent secret settings and restart or redeploy the
storefront.

## Provider matrix

Put secret values in the repository-root `.env`, beside
`docker-compose.yml`, then apply them with:

```bash
docker compose up -d gateway
```

Do not put provider secrets in SQLite configuration rows, storefront JavaScript, or
the embed tag.

If the gateway is directly behind one trusted reverse proxy, set
`CHAPMAN_TRUST_PROXY=1` so Chapman reconstructs the public HTTPS request and
per-client public rate limits use that proxy's first forwarded address. This is
required for dashboard form submissions through the bundled ngrok tunnel;
otherwise React Router correctly rejects the HTTP/HTTPS origin mismatch. Leave
it unset for direct exposure or an untrusted/multi-hop proxy chain; Chapman then
uses the TCP peer and ignores client-supplied `X-Forwarded-For` values.

Container stops use `CHAPMAN_SHUTDOWN_TIMEOUT_MS` as the drain deadline. It
defaults to 20,000 ms and accepts 1,000–120,000 ms. The surrounding platform
must allow longer than this (the base Compose file allows 30 seconds), or it
may kill Chapman before SQLite has checkpointed and closed.

| Dedicated page     | What it configures                      | Variables                                                                                   | Required?                                                                                         |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Assistant**      | Model-written storefront replies        | `OPENROUTER_API_KEY`                                                                        | Recommended. The bounded deterministic fallback works without it                                  |
| **Assistant**      | Model override                          | `OPENROUTER_MODEL_ASSISTANT`                                                                | Optional                                                                                          |
| **Agent front**    | `/.well-known/ucp` discovery            | none                                                                                        | No provider key; install a storefront redirect or proxy                                           |
| **Agent front**    | Razorpay checkout                       | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`                                                    | Both required for checkout; the storefront must also have been linked to these names during setup |
| **Agent front**    | Reliable settlement webhook             | `RAZORPAY_WEBHOOK_SECRET`, `PUBLIC_ORIGIN`                                                  | Strongly recommended                                                                              |
| **Analyst**        | Merchant-side reasoning                 | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_ANALYST`                                             | Primary key required; model override optional                                                     |
| **Analyst**        | Small-model tool orchestration          | `OPENROUTER_API_KEY2`, `OPENROUTER_MODEL_ORCHESTRATOR`                                       | Optional dedicated account lane and model override                                                |
| **Analyst**        | Final report presentation               | `OPENROUTER_API_KEY3`, `OPENROUTER_MODEL_PRESENTER`                                          | Optional dedicated account lane and model override                                                |
| **Shopper memory** | Memory consolidation                    | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_SUMMARISER`                                         | Optional; deterministic storage and retrieval still work                                          |
| **Recovery**       | Notice-only voice calls                 | `SARVAM_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `PUBLIC_ORIGIN` | All five required together                                                                        |
| **Recovery**       | Conversational calls and answer grading | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_ASSISTANT`, `OPENROUTER_MODEL_GRADER`               | Optional                                                                                          |
| **Recovery**       | Manual tests during quiet hours         | `VOICE_QUIET_HOURS_TEST_NUMBER`                                                             | Optional; must exactly match the E.164 test destination                                           |
| **Recovery**       | Post-call SMS / payment-link SMS         | `TWILIO_MESSAGING_FROM`, `TWILIO_MESSAGING_SERVICE_SID`                                     | Trial uses its predefined template only; a Full account is required for the unique payment link   |

Each dedicated page shows the variables it actually consumes, whether each is
present, a blank copyable `.env` block, setup steps, and links to the provider's
documentation. The server returns variable names and configured/not-configured
booleans to the page; it never returns secret values.

Current built-in routing is role-specific:

- storefront assistant and conversational recovery text: Gemma 4 26B, Gemma
  4 31B, Nemotron 3 Super, then `openrouter/free`;
- analyst tool orchestration: deterministic routing first, then Nemotron 3.5
  Lightning, Ling 3.0 Flash, Liquid LFM 2.5 2.6B, Gemma 4 31B, and
  `openrouter/free` only for questions the deterministic router cannot map;
- merchant reasoning: the configured `OPENROUTER_MODEL_ANALYST` first, then
  Ling 3.0 Flash Fin, Nemotron 3 Super, and `openrouter/free`;
- report presentation: Nemotron 3 Super, Gemma 4 31B, then `openrouter/free`;
- shopper-memory consolidation: Liquid LFM 2.5 2.6B, Gemma 4 31B, then
  `openrouter/free`;
- fast answer grading: Liquid LFM 2.5 2.6B, Nemotron 3.5 Lightning, then Gemma
  4 31B.

With three distinct keys, the preferred lanes are key 1 for deep analyst
reasoning, key 2 for orchestration/assistant requests, and key 3 for report
presentation/summarisation/grading. Every lane can fail over to another
configured key. Only environment-variable slot names and failure codes enter
the ledger; credential values never do. Account quota failures cool only that
key in the current process, while upstream provider failures cool the affected
model so the same outage is not retried against every account.

The recording stack overrides only the analyst with
`nvidia/nemotron-3-ultra-550b-a55b:free`. Embedding generation is not active
yet: shopper-memory retrieval remains deterministic lexical matching in SQLite.

### Analyst request lifecycle

Analyst key lanes are preferences, not hard partitions. Key 1 is preferred for
deep reasoning, key 2 for orchestration, and key 3 for presentation and other
small-model work; each role can fail over to another configured key. In-process
cooldowns honour provider retry guidance and stop one upstream outage from
being retried against every account. Durable cooldown state and background
analyst jobs are still planned.

The request itself is layered:

1. The deterministic router handles known analytics intents. A small
   orchestrator is called only when that router abstains.
2. The server validates the proposed read-only tool name and arguments, then
   TypeScript tools perform every count and calculation.
3. The analyst model reasons over those verified results. It cannot access the
   database, choose a tool, change data, or move money.
4. A smaller presenter receives both the verified results and strategic draft,
   and writes the final detailed report without introducing new arithmetic.
5. JSON, grounding, completion, and sentence-ending checks reject private
   planning and truncated output. The verified transcript is the fallback.

The orchestrator currently emits a strict prompt-shaped JSON call. Native
OpenRouter `tools`/`tool_calls` transport is a future migration; this does not
make the execution simulated—the named function is validated and run on the
server, and the dashboard shows its real output under **How it got there**.

## Razorpay for the bundled demo

For a basic test-mode checkout, the only credential values required are:

```dotenv
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

No Chapman command is needed for the bundled storefront checkout. Monsoon
Market consumes these two values directly when its container starts and owns
`/api/checkout`; it works while Chapman is completely unconfigured.

Select **Configure Razorpay for this storefront** during Chapman registration
only when shopping agents should also receive Chapman's hosted checkout. If
that box was skipped, open **Feature controls**, turn on **Razorpay agent
checkout**, and save. When both keys are present, that control creates the
missing Chapman-side link without putting either value in the browser. The
generic `site:enable-razorpay` command remains available for unattended setup.
Turning this control off withdraws new Chapman checkouts but does not affect the
merchant website's own cart or payment flow. Add a webhook secret and public
HTTPS origin when you want settlement to succeed even if the buyer closes the
browser after payment:

```dotenv
RAZORPAY_WEBHOOK_SECRET=
PUBLIC_ORIGIN=
```

The merchant-owned demo webhook is:

```text
https://your-public-store.example/api/razorpay/webhook
```

Chapman's separate agent-checkout webhook is:

```text
<PUBLIC_ORIGIN>/webhooks/razorpay/pk_monsoon_market
```

Use test-mode keys for the demo. Chapman only advertises Razorpay when both the
linked Key ID and Key Secret resolve to non-empty server-side values.

## Built-in integration tests

### Test chat assistant

Open **Assistant**, enter a shopper message, and choose
**Test chat assistant**. The preview uses the same live catalogue, tool
registry, router, bounds checks, and assistant pipeline as the storefront. It
is deliberately an anonymous shopper, so it cannot read a customer's orders or
memory. The result shows the reply, products, tool calls, route, reasoner, and
any blocked gates.

This test works with the deterministic fallback when no OpenRouter key is
present. An OpenRouter-backed response requires `OPENROUTER_API_KEY`.

### Place test call

Open **Recovery**, enter an E.164 number such as `+919876543210`, confirm that
the number belongs to you or someone expecting the call, and choose
**Place test call**.

The action is real: it renders speech through Sarvam, places one Twilio call,
and can consume provider credit. It uses a fixed message that identifies itself
as a Chapman integration test, never reads a customer record, and never sends
the entered number to a model or speaks it. Test calls are notice-only and are
limited to one every 30 seconds. Normal quiet hours still apply unless the
destination exactly matches `VOICE_QUIET_HOURS_TEST_NUMBER`.

The inline console reports only stages that completed. A successful run ends
with Sarvam rendering, Twilio acceptance, and `[done] Call queued`. Queueing is
not the same as answering: confirm the final call on the handset or in Twilio's
call log. An error remains beside the form and names the provider, validation,
feature control, rate limit, or quiet-hours rule that stopped the attempt.

### Send test message

On **Recovery**, enter an E.164 number, confirm the recipient expects the test,
and choose **Send test message**. A Full Twilio account receives Chapman's fixed,
non-promotional body. A Trial account automatically receives Twilio's predefined
`sms_customer_support` template. Chapman rate-limits the control to one attempt
every 30 seconds. The message body and destination are not retained in the
dashboard handoff log.

Trial accounts cannot send the custom discounted-payment message because it
contains a unique Razorpay URL. When a completed recovery call actually
announced a policy-issued grant, Chapman can instead send Twilio's predefined
template once to the configured `TWILIO_TEST_TO`. The call says only that a
discount-confirmation SMS is coming; it does not claim the template contains a
payment link.

The unique payment-link handoff requires a Full Twilio account and the dedicated
call toggle. It becomes reachable only after a conversational call has produced
a policy-issued grant and a discounted Razorpay order. Both follow-up paths are
attempted once per grant and use only the number already attached to the call.

## Docker environment lifecycle

- `docker compose down` stops the stack and keeps the `chapman-data` volume.
- `docker compose up -d --build gateway` rebuilds the gateway and keeps data.
- `docker compose --profile "*" down --volumes --remove-orphans` stops
  profile-owned services and deletes the merchant account, generated site
  secrets, orders, ledger, and configuration. Use it only when you explicitly
  want a completely fresh install.
- Changing `.env` requires recreating the affected service with
  `docker compose up -d gateway`.

Run configuration checks from the same network as the gateway:

```bash
docker compose run --rm gateway npm run doctor
docker compose run --rm gateway npm run check
```
