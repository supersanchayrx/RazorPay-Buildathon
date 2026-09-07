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

## Provider matrix

Put secret values in the repository-root `.env`, beside
`docker-compose.yml`, then apply them with:

```bash
docker compose up -d gateway
```

Do not put provider secrets in `chapman.config.json`, storefront JavaScript, or
the embed tag.

| Dedicated page     | What it configures                      | Variables                                                                                   | Required?                                                                                         |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Assistant**      | Model-written storefront replies        | `OPENROUTER_API_KEY`                                                                        | Recommended. The bounded deterministic fallback works without it                                  |
| **Assistant**      | Model override                          | `OPENROUTER_MODEL_ASSISTANT`                                                                | Optional                                                                                          |
| **Agent front**    | `/.well-known/ucp` discovery            | none                                                                                        | No provider key; install a storefront redirect or proxy                                           |
| **Agent front**    | Razorpay checkout                       | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`                                                    | Both required for checkout; the storefront must also have been linked to these names during setup |
| **Agent front**    | Reliable settlement webhook             | `RAZORPAY_WEBHOOK_SECRET`, `PUBLIC_ORIGIN`                                                  | Strongly recommended                                                                              |
| **Analyst**        | Merchant-side analysis                  | `OPENROUTER_API_KEY`                                                                        | Required                                                                                          |
| **Analyst**        | Model override                          | `OPENROUTER_MODEL_ANALYST`                                                                  | Optional                                                                                          |
| **Shopper memory** | Memory consolidation                    | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_SUMMARISER`                                         | Optional; deterministic storage and retrieval still work                                          |
| **Recovery**       | Notice-only voice calls                 | `SARVAM_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `PUBLIC_ORIGIN` | All five required together                                                                        |
| **Recovery**       | Conversational calls and answer grading | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_ASSISTANT`, `OPENROUTER_MODEL_GRADER`               | Optional                                                                                          |
| **Recovery**       | Manual tests during quiet hours         | `VOICE_QUIET_HOURS_TEST_NUMBER`                                                             | Optional; must exactly match the E.164 test destination                                           |

Each dedicated page shows the variables it actually consumes, whether each is
present, a blank copyable `.env` block, setup steps, and links to the provider's
documentation. The server returns variable names and configured/not-configured
booleans to the page; it never returns secret values.

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
