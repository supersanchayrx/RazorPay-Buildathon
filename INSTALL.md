# Installing Chapman

Chapman runs as a self-hosted gateway. A custom storefront connects to it with
a script tag and, optionally, a discovery route for shopping agents.

## Requirements

Choose one runtime:

| Runtime | Requirement                        |
| ------- | ---------------------------------- |
| Docker  | Docker Desktop and Docker Compose  |
| Native  | Node.js `>=22.12`                   |

A real storefront also needs a public origin and a JSON catalogue feed. HTTPS
is required in production. The feed format is documented in
[docs/catalog-format.md](docs/catalog-format.md).

Chapman is deliberately adaptable to different custom storefront stacks, but
the demo and initial release assume Razorpay is already integrated by the
merchant: Razorpay Checkout is loaded on the website and the Chapman settlement
webhook has been registered in Razorpay. The setup below links credentials to
that existing integration; it does not provision a Razorpay account, KYC,
payment-method access, Checkout, or the webhook.

OpenRouter, Razorpay, Sarvam, Twilio, Shopify, and a database are not required
for the basic custom-storefront assistant. The Analyst requires OpenRouter.

## Docker installation

Run Docker commands from the repository root.

### 1. Prepare `.env`

If `.env` does not exist, copy `.env.docker.example` and name it `.env`. Do not
overwrite an existing file.

For a clean first run, keep:

```dotenv
CHAPMAN_AUTO_INIT=false
CHAPMAN_SEED=false
DEMO_STORE_CHAPMAN=false
```

All provider values may be blank. A new merchant should start with no site and
no sample history.

### 2. Start the gateway

```bash
docker compose up -d --build
docker compose ps
docker compose logs gateway
```

Open <http://localhost:3000/login>. On the first boot, the gateway log prints a
merchant email and generated password. They are stored in the persistent
`chapman-data` volume.

### 3. Start the optional demo store

The demo requires a generated copy of Monsoon Market with Chapman removed:

```bash
cd agent-gateway
npm install
npm run demo:clean-store
cd ..
docker compose --profile demo up -d --build
```

Open <http://localhost:4000>. It should have no assistant bubble, and this
request should return 404:

```bash
curl -i http://localhost:4000/.well-known/ucp
```

This is the intended pre-install state.

## Register the first storefront

Sign in and select **Configure your storefront**.

For the Docker demo, use:

| Field                | Value                            |
| -------------------- | -------------------------------- |
| Store name           | `Monsoon Market`                 |
| Public site key      | `pk_monsoon_market`              |
| Browser origin       | `http://localhost:4000`          |
| Catalogue URL        | `http://store:4000/catalog.json` |
| Product URL template | `/product.html?handle={handle}`  |
| Order feed           | leave blank                      |

The browser uses `localhost`. The gateway container uses the Compose service
name `store`.

Select **Configure Razorpay for this storefront** only if this site should use
the Razorpay variables in `.env`. The checkbox stores variable names, not
credential values.

Saving registers the site and creates its signing secret. It does not edit the
storefront, install discovery, import orders, or create analytics.

Chapman keeps three states separate:

| State               | Meaning                                       |
| ------------------- | --------------------------------------------- |
| Registered          | The merchant saved the site in Chapman        |
| Installed           | Chapman detected the embed or discovery route |
| Provider configured | Required server-side keys are present         |

**Feature controls** are policy switches. A switch being on does not prove that
an integration is installed.

## Install the storefront interfaces

For the bundled demo and a page-by-page verification of every capability, see
[Fresh storefront setup](docs/fresh-store-setup.md).

### Assistant embed

Open **Assistant** and copy the generated script tag. Its basic form is:

```html
<script
  src="https://your-gateway.example/embed.js"
  data-site="pk_yourstore"
  defer
></script>
```

Place it before `</body>` on each page that should show the assistant. For the
demo, paste it into `demo-store-clean/index.html` and refresh. No rebuild is
needed.

If the bubble is missing, check the exact browser origin, site key, Assistant
feature control, and gateway URL.

### Agent discovery

Open **Agent front** for a generated `/.well-known/ucp` redirect or proxy and a
live verification button.

Examples:

| Server             | Rule                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Netlify            | `/.well-known/ucp https://gateway.example/ucp/pk_yourstore/profile 302`                        |
| nginx              | `location = /.well-known/ucp { return 302 https://gateway.example/ucp/pk_yourstore/profile; }` |
| Apache             | `Redirect 302 /.well-known/ucp https://gateway.example/ucp/pk_yourstore/profile`               |
| Application server | Return a 302 redirect from the route                                                           |

For the bundled demo only, set:

```dotenv
DEMO_STORE_CHAPMAN=true
```

Then run:

```bash
docker compose --profile demo up -d store
```

Use **Verify install** on Agent front. A real store should add its generated
route instead of using the demo flag.

## Configure provider keys

Provider values belong in the repository-root `.env` or a production secret
manager. Never put them in storefront code or `chapman.config.json`.

Apply `.env` changes with:

```bash
docker compose up -d gateway
```

### Key groups

| Feature page         | Variables                                                                                   | Requirement                                         |
| -------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Assistant            | `OPENROUTER_API_KEY`                                                                        | Optional; fallback works without it                 |
| Analyst              | `OPENROUTER_API_KEY`                                                                        | Required                                            |
| Shopper memory       | OpenRouter key and summariser model                                                         | Optional                                            |
| Agent front          | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`                                                    | Both required for checkout                          |
| Agent front          | `RAZORPAY_WEBHOOK_SECRET`, `PUBLIC_ORIGIN`                                                  | Recommended for reliable settlement                 |
| Recovery voice       | `SARVAM_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `PUBLIC_ORIGIN` | All required for voice                              |
| Recovery SMS handoff | `TWILIO_MESSAGING_FROM` or `TWILIO_MESSAGING_SERVICE_SID`                                   | Optional; `TWILIO_FROM` is used when neither is set |

Optional model variables are:

```dotenv
OPENROUTER_MODEL_ASSISTANT=
OPENROUTER_MODEL_ANALYST=
OPENROUTER_MODEL_SUMMARISER=
OPENROUTER_MODEL_GRADER=
```

Each dedicated page shows its variables, setup steps, and configured status.
The browser receives names and status booleans, never secret values.

### Razorpay

For Monsoon Market's ordinary test checkout, paste only:

```dotenv
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

Then start the demo normally. No Chapman registration, checkbox, embed, or
payment setup command is required for the storefront cart.

The Razorpay checkbox during Chapman registration is a separate choice: enable
it only when shopping agents should also receive Chapman's hosted checkout. If
that checkbox was skipped, the Chapman-side link can be added afterward with:

```bash
docker compose run --rm gateway npm run site:enable-razorpay -- --site pk_yourstore
docker compose up -d --force-recreate gateway
```

The linker stores variable names, never credential values. It is not needed for
Monsoon Market's own checkout. The bundled store reads the two test credentials
directly from Docker and already implements server-side quote, Razorpay order
creation, and payment confirmation.

For reliable settlement, configure:

```dotenv
RAZORPAY_WEBHOOK_SECRET=
PUBLIC_ORIGIN=https://chapman.example
```

Register:

```text
https://chapman.example/webhooks/razorpay/pk_yourstore
```

### Voice calls

Voice requires:

```dotenv
SARVAM_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
PUBLIC_ORIGIN=https://chapman.example
```

`TWILIO_FROM` must include the country code. `PUBLIC_ORIGIN` must be public
HTTPS so Twilio can fetch Chapman's call instructions.

For one approved test handset during quiet hours:

```dotenv
VOICE_QUIET_HOURS_TEST_NUMBER=+919876543210
```

The value must exactly match the number entered in the Recovery test form.

### Local public tunnel

Razorpay webhooks and Twilio cannot reach localhost. The optional ngrok profile
provides a public URL.

```dotenv
NGROK_AUTHTOKEN=
```

```bash
docker compose --profile tunnel up -d
curl http://localhost:4040/api/tunnels
```

Put the returned HTTPS URL in both variables and restart the gateway:

```dotenv
GATEWAY_ORIGIN=https://your-name.ngrok-free.app
PUBLIC_ORIGIN=https://your-name.ngrok-free.app
CHAPMAN_TRUST_PROXY=1
```

```bash
docker compose up -d gateway
```

See [docs/configuration.md](docs/configuration.md) for the full matrix.

## Test the installation

### Assistant test

Open **Assistant**, enter a shopper message, and select
**Test chat assistant**. It uses the live catalogue and normal assistant
pipeline. The result shows the reply, product cards, tools, route, reasoner,
and blocked checks.

The preview is anonymous and cannot read personal orders or shopper memory.

### Voice test

Open **Recovery**, enter an E.164 number, confirm that the recipient expects the
call, and select **Place test call**.

This is a real provider call and can consume credit. It uses a fixed notice,
does not read customer data, allows one call every 30 seconds, and follows quiet
hours.

A small console appears below the button after submission:

- `[working]` means Chapman is validating and contacting the configured
  providers.
- `[ok]` records a stage that actually completed, including Sarvam audio
  rendering and Twilio acceptance.
- `[error]` is the exact stage or policy that stopped the call.
- `[done] Call queued` means Twilio accepted the outbound request. Confirm the
  final answered/completed result on the test handset or in Twilio's call log.

The result stays beside the form. During quiet hours, an error also points to
`VOICE_QUIET_HOURS_TEST_NUMBER`; its value must exactly match the E.164 number
entered in the form. After changing `.env`, recreate the gateway before trying
again.

### SMS test and recovery follow-up

Open **Recovery**, enter a verified E.164 test number, confirm it expects the
message, and select **Send test message**. A Full Twilio account receives
Chapman's fixed integration text. A Trial account automatically receives
Twilio's predefined `sms_customer_support` template. Neither creates or claims
a discount. The inline console ends with `[done] Message queued` only after
Twilio accepts it.

`TWILIO_FROM` is the default SMS sender. If voice and SMS use different Twilio
numbers, set `TWILIO_MESSAGING_FROM`; a Messaging Service can instead be set as
`TWILIO_MESSAGING_SERVICE_SID`.

To enable the real recovery flow:

1. Link Razorpay to the Chapman storefront and verify its keys.
2. Enable Recovery and Voice in **Feature controls**.
3. In **Recovery**, choose **Hold a conversation**.
4. Enable **Recovery discounts**, set the eligible reason, customer tier,
   percentage, lifetime, grant count, and margin budget.
5. For a Full account, enable **Send an approved discounted-payment link by
   SMS**. Leave it off for a Trial account.

The call defaults to Roman-script Hinglish. If the first recorded reason passes
the policy, Chapman issues one cart-bound grant and announces its exact depth.
On a Trial account, a completed call queues Twilio's predefined template once
to `TWILIO_TEST_TO`; it does not claim to send a unique payment URL. On a Full
account, Chapman creates the server-priced Razorpay order and sends its payment
page to the number on the call. Production messaging in India still requires
the applicable DLT registration and approved templates.

### Automated checks

```bash
docker compose run --rm gateway npm run doctor
docker compose run --rm gateway npm run check
```

For native development, also run `npm run typecheck` and `npm run build` inside
`agent-gateway`.

## Install with a coding agent

Paste this into a coding agent working at the repository root:

```text
Install and verify Chapman with Docker. Read README.md, INSTALL.md,
docs/configuration.md, .env.docker.example, docker-compose.yml, and applicable
AGENTS.md first. Preserve my .env, worktree, and Docker volume. Do not enable
CHAPMAN_AUTO_INIT or CHAPMAN_SEED, load a demo fixture, invent or expose keys,
or run docker compose down -v without approval.

Generate and start the clean Monsoon Market demo. Prove it initially has no
assistant and returns 404 at /.well-known/ucp. Pause for me to confirm the
first-store form. Then follow the Assistant and Agent front instructions. Ask
only for keys needed by selected features. Do not place a real call without an
E.164 number, an expecting recipient, and my explicit request. Run doctor and
tests. Report registration, installation, provider readiness, fallback, and
manual steps separately without printing secrets.
```

The full version is in
[docs/agentic-install.md](docs/agentic-install.md).

## Native installation

Run commands from `agent-gateway`.

For dashboard-first setup:

```bash
npm install
npm run bootstrap
npm run dev:gateway
```

`bootstrap` creates a merchant account but no site. Register the store from the
dashboard.

For command-line site setup:

```bash
npm install
npm run init
npm run doctor
npm run dev:gateway
```

`npm run init` writes the storefront and merchant grant to SQLite, appends
generated secrets to the root `.env`, and creates the merchant account. It does
not overwrite existing secret values or create a legacy JSON registry.

Production build:

```bash
npm run build
npm start
```

## Optional order access

Order access stays off until the merchant provides both:

1. a short-lived signed shopper token in `window.CHAPMAN_SESSION`;
2. a signed, read-only order feed.

Chapman calls the feed with the verified customer identifier and signs the
request using the site's secret. The feed must verify the signature and return
orders only for that customer.

Do not authorize order lookup from a shopper-typed email, phone number, or order
number. See [demo-store/accounts.go](demo-store/accounts.go) for the reference
implementation.

## Production setup

Use HTTPS and persistent storage. Important variables are:

| Variable                 | Purpose                              |
| ------------------------ | ------------------------------------ |
| `NODE_ENV=production`    | Disables development fallbacks       |
| `CHAPMAN_DATA_DIR`       | Persistent application data          |
| `CHAPMAN_DATABASE_PATH`  | SQLite path (Docker: `/data/chapman.sqlite`) |
| `DATABASE_URL`           | Prisma URL for the same SQLite file  |
| `CONSOLE_SESSION_SECRET` | Stable merchant sessions             |
| `GATEWAY_ORIGIN`         | Browser-facing public gateway URL    |
| `SITE_SECRET_<KEY>`      | Per-site shopper and feed signatures |
| `CHAPMAN_TRUST_PROXY=1`  | Trust one replacing reverse proxy for client-IP rate limits |
| `CHAPMAN_SHUTDOWN_TIMEOUT_MS=20000` | Drain deadline before a restart is forced |

Store production credentials in a secret manager. Back up SQLite and secrets
separately; see [SQLite operations](docs/database.md). Run:

```bash
npm run doctor -- --url https://chapman.example
npm run check
```

Public chat, agent, identity, payment, recovery, voice, and webhook routes have
route-specific request-size ceilings and process-local token-bucket limits.
Oversized bodies return `413 HTTP_BODY_TOO_LARGE`; exhausted buckets return
`429 HTTP_RATE_LIMITED` with `Retry-After`. Leave `CHAPMAN_TRUST_PROXY` unset
when Chapman is directly exposed. Set it to `1` only when one trusted reverse
proxy immediately fronts Chapman and replaces `X-Forwarded-For`.

Compose gives Chapman a 30-second stop grace period. On `SIGTERM` the gateway
stops accepting requests, finishes active responses and tracked background
work, disconnects Prisma, then checkpoints and closes SQLite. Keep
`CHAPMAN_SHUTDOWN_TIMEOUT_MS` below the host's stop grace period. Normal drain
progress appears as `process.shutdown.*` JSON logs; timeout or a second signal
exits non-zero with `PROCESS_SHUTDOWN_TIMEOUT` or `PROCESS_SHUTDOWN_FORCED`.

## Data and resets

| Command                                                        | Result                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `docker compose down`                                          | Stops services and keeps data                                                                               |
| `docker compose up -d --build gateway`                         | Rebuilds the gateway and keeps data                                                                         |
| `docker compose --profile "*" down --volumes --remove-orphans` | Stops every profile and deletes the merchant account, configuration, secrets, ledger, and demo-store orders |

Use the all-profile `down --volumes` command only for an intentional complete
reset. If Docker still reports a resource in use, use the project-scoped force
cleanup in [Fresh storefront setup](docs/fresh-store-setup.md#1-start-docker-and-reset-the-demo).

Native state defaults to `agent-gateway/data/`. Set `CHAPMAN_DATA_DIR` or
`CHAPMAN_DATABASE_PATH` to persistent storage in production.

## Upgrades

Docker:

```bash
git pull
docker compose up -d --build gateway
docker compose run --rm gateway npm run doctor
docker compose run --rm gateway npm run check
```

Native:

```bash
git pull
cd agent-gateway
npm install
npm run db:migrate
npm run doctor
npm run check
```

Do not replace `.env`, `chapman.sqlite`, or the data directory during an
upgrade. Container startup applies schema migrations before serving traffic.
The application does not import former JSON/JSONL state during an upgrade.

## Troubleshooting

Start with:

```bash
docker compose ps
docker compose logs gateway
docker compose run --rm gateway npm run doctor
```

For a failed HTTP call, copy its `X-Request-ID` response header and find the
same `request_id` in `docker compose logs gateway`. Error records are JSON and
include a stable `error_code`; Chapman omits query strings and redacts known
secrets, credentials, email addresses, and phone numbers.

| Symptom                  | Check                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| Bubble is missing        | Exact browser origin, site key, Assistant control, and `embed.js`   |
| Chat fails               | Assistant test, gateway logs, and container-reachable catalogue URL |
| Discovery is uninstalled | The storefront's own `/.well-known/ucp` route                       |
| Razorpay is absent       | Setup checkbox plus both required keys                              |
| Test call is disabled    | All five voice variables, E.164 number, and consent                 |

More fixes are in [docs/troubleshooting.md](docs/troubleshooting.md).
