# Fresh storefront setup

This guide starts with a real, unconfigured Monsoon Market and adds one Chapman
capability at a time. Do not treat a feature switch, an installed route, and a
configured provider as the same state. Verify each separately.

## 1. Start Docker and reset the demo

Run the following from the repository root. On Windows, start Docker Desktop
first if its engine is not already running:

```powershell
$dockerDesktop = Join-Path $Env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (-not (docker info 2>$null)) {
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw "Docker Desktop was not found at $dockerDesktop"
  }
  Start-Process -FilePath $dockerDesktop
  do {
    Start-Sleep -Seconds 2
    docker info *> $null
  } until ($LASTEXITCODE -eq 0)
}
docker version
```

Docker Desktop may take a minute to make the engine available. The loop waits
for that engine; it does not create or change any Chapman containers.

The first command deletes the current Docker data volumes: merchant accounts,
store registration, generated signing secrets, orders, memories, settings and
the ledger. It does not delete the repository-root `.env`.

```powershell
docker compose --profile "*" down --volumes --remove-orphans
Set-Location agent-gateway
npm.cmd run demo:clean-store
Set-Location ..
docker compose --profile demo up -d --build
docker compose ps
docker compose logs gateway
```

For an ordinary restart that preserves existing data, use:

```powershell
docker compose --profile demo up -d
```

The `"*"` matters: it activates the `demo` and `tunnel` profiles for cleanup.
Without it, `docker compose down -v` can leave a profile-owned store or tunnel
container running, and Docker then reports that the volume and network are
still in use.

If an interrupted Compose run still leaves project containers behind, use this
PowerShell fallback from the repository root. It force-removes only resources
carrying this Compose project's label:

```powershell
$composeProject = (docker compose config --format json | ConvertFrom-Json).name
if (-not $composeProject) { throw "Could not resolve the Compose project name." }
docker ps -aq --filter "label=com.docker.compose.project=$composeProject" |
  ForEach-Object { docker rm --force $_ }
docker volume ls -q --filter "label=com.docker.compose.project=$composeProject" |
  ForEach-Object { docker volume rm --force $_ }
docker network ls -q --filter "label=com.docker.compose.project=$composeProject" |
  ForEach-Object { docker network rm $_ }
```

This fallback is destructive: it deletes the Chapman account and state plus
Monsoon Market's pending and test-order records. It still does not delete
`.env` or source files.

The first gateway boot prints the generated merchant password once. Open:

- storefront: <http://localhost:4000>
- Chapman: <http://localhost:3000/login>

Before registration, the storefront must have no assistant bubble and this
must return `404`:

```powershell
curl.exe -i http://localhost:4000/.well-known/ucp
```

### Optional: start the bundled ngrok tunnel

The tunnel exposes the **Chapman gateway**, not the Monsoon Market storefront.
It is required for inbound Razorpay webhooks and Twilio voice callbacks. A
local-only assistant and UCP recording does not need it.

Put your ngrok token in the repository-root `.env` before starting the tunnel:

```dotenv
NGROK_AUTHTOKEN=your-ngrok-authtoken
```

Start the demo and tunnel profiles, then read the assigned HTTPS URL from
ngrok's local inspector:

```powershell
docker compose --profile demo --profile tunnel up -d --build

$tunnels = (Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels").tunnels
$publicOrigin = $tunnels |
  Where-Object { $_.proto -eq "https" } |
  Select-Object -First 1 -ExpandProperty public_url
if (-not $publicOrigin) { throw "ngrok has not published an HTTPS tunnel." }
$publicOrigin = $publicOrigin.TrimEnd("/")
$publicOrigin
```

Copy the printed value into both entries in `.env`:

```dotenv
PUBLIC_ORIGIN=https://your-current-ngrok-host.ngrok-free.app
GATEWAY_ORIGIN=https://your-current-ngrok-host.ngrok-free.app
```

Recreate the gateway and store so generated embed tags, payment links, TwiML
callbacks and storefront substitutions all use the same public origin:

```powershell
docker compose --profile demo --profile tunnel up -d --force-recreate gateway store
docker compose ps
curl.exe -I $publicOrigin/embed.js
```

With a free ephemeral ngrok domain, repeat the URL lookup and `.env` update
whenever the tunnel hostname changes. Keep `http://localhost:4000` as the
storefront browser origin during the Docker demo; the ngrok URL above belongs
to Chapman, not to the store.

## 2. Register the storefront

Sign in to Chapman and choose **Configure your storefront**.

| Field                | Value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| Store name           | `Monsoon Market`                                                                 |
| Public site key      | `pk_monsoon_market`                                                              |
| Browser origin       | `http://localhost:4000`                                                          |
| Catalogue feed       | `http://store:4000/catalog.json`                                                 |
| Product URL template | `/product.html?handle={handle}`                                                  |
| Signed order feed    | `http://store:4000/api/orders` for the full demo; blank for catalogue-only setup |

Leave the Razorpay checkbox clear if you want to demonstrate the terminal
linker later. Saving creates the site registration and signing secret. It does
not install the assistant or agent route.

The two hostnames are intentional. The browser reaches the store at
`localhost:4000`; the gateway container reaches it through the Compose service
name `store:4000`.

## 3. Feature controls

**Feature controls** are permissions. An on switch means Chapman may expose
that capability after its dependencies exist. It does not prove that HTML,
routes, keys, identity or data have been connected.

Start with the capability you are installing and leave unrelated capabilities
off if you want each transition to be obvious.

## 4. Storefront assistant

The assistant can run in either mode:

- Leave `OPENROUTER_API_KEY` blank for the deterministic bounded fallback.
- For model-written language, set the key and one funded model that the account
  can access. This is more predictable than a chain of free models.

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL_ASSISTANT=
```

Apply environment changes:

```powershell
docker compose up -d --force-recreate gateway
```

Open **Assistant** and copy its generated tag. In this static demo, put the
same block in all three files before `</body>`:

- `demo-store-clean/index.html`
- `demo-store-clean/product.html`
- `demo-store-clean/account.html`

For the full signed-in demo, put this marker immediately before the generated
tag on each page:

```html
<!--CHAPMAN_SESSION-->
```

The marker is a convenience implemented by the demo server. A real merchant
site must generate the equivalent short-lived token from its own authenticated
session and must keep the site signing secret on the server.

Refresh the store, then use **Test chat assistant** on the Assistant page.
Try `Which tea would you recommend for cold brew?`.

If every free model reports `429`, the key is valid but the OpenRouter free
daily quota is exhausted. Either fund the account and select an accessible
model, or remove the key and use Chapman's deterministic fallback. A `404`
saying a model is unavailable for free means that free model slug changed; it
is not an embed failure.

## 5. Agent-readable storefront

No provider key is needed. An external agent discovers a store only through
`/.well-known/ucp` on the merchant's own domain.

For Monsoon Market, set:

```dotenv
DEMO_STORE_CHAPMAN=true
```

Then recreate the store:

```powershell
docker compose --profile demo up -d --force-recreate store
```

Open **Agent-readable storefront** and choose **Verify install**. The discovery
route, profile and tool endpoint must pass individually.

Then exercise discovery and MCP from PowerShell without reserving stock or
creating a Razorpay order:

```powershell
Set-Location agent-gateway
npm.cmd run shop-as-agent -- --store http://localhost:4000 --query chai --no-checkout
Set-Location ..
```

That command starts from the merchant URL, reads `/.well-known/ucp`, follows the
advertised MCP endpoint, calls `tools/list`, searches the catalogue, and creates
a server-priced cart. Remove `--no-checkout` only after Agent front reports a
Razorpay payment handler ready; the full flow creates a test checkout and stops
at the human Razorpay handoff.

The standalone `ucp` CLI requires an HTTPS merchant URL. Use the bundled
`shop-as-agent` harness for localhost, or expose the storefront through HTTPS
before running `ucp.cmd discover --business https://your-store.example`.

For a real custom website, do not use `DEMO_STORE_CHAPMAN`. Select the matching
host on the feature page, copy its generated redirect or proxy rule, deploy it,
and verify the public `/.well-known/ucp` URL.

## 6. Razorpay checkout

Initial-release boundary: the merchant is assumed to already have Razorpay
Checkout integrated on the website and to register the Chapman webhook in the
Razorpay dashboard. Monsoon Market already loads Razorpay's Checkout script.
The steps below link Chapman to that existing test-mode setup; they do not
create an account, complete KYC, enable methods, install Checkout, or register
the webhook automatically.

Put test-mode credentials in the root `.env`:

```dotenv
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

That is the complete storefront setup. Start or recreate the demo normally:

```powershell
docker compose --profile demo up -d --build
```

Monsoon Market reads the keys directly. Refresh a product page: **Add to cart**
opens a quote priced by the merchant server and **Pay** creates a Razorpay test
order. This works before registering Monsoon Market in Chapman and does not add
the Assistant, agent discovery, signed identity, memory, or recovery.

When Chapman is later registered, select **Configure Razorpay for this
storefront** only if shopping agents should also be able to create a hosted
checkout. That links the same server-side variables to Chapman; it is not what
makes the merchant's ordinary cart work.

If that checkbox was skipped, open **Feature controls**, turn on **Razorpay
agent checkout**, and save. The control links the already registered storefront
when the two server-side keys are available. Turning it off later stops only new
Chapman-hosted checkouts; Monsoon Market's native Razorpay checkout remains on.
For unattended setup, the equivalent command is:

```powershell
docker compose run --rm gateway npm run site:enable-razorpay -- --site pk_monsoon_market
docker compose up -d --force-recreate gateway
```

The browser callback verifies and records a completed test payment while the
page remains open. A webhook is still required for reliable settlement when a
buyer closes the page before that callback completes.

For reliable settlement after the buyer closes the tab, also set:

```dotenv
RAZORPAY_WEBHOOK_SECRET=
PUBLIC_ORIGIN=https://your-public-gateway.example
```

Register this URL in Razorpay using the same webhook secret:

```text
https://your-public-gateway.example/webhooks/razorpay/pk_monsoon_market
```

Localhost is sufficient for an interactive test checkout, but an external
webhook provider cannot call localhost.

## 7. Signed identity and order access

These are foundations for personal order answers, shopper memory and
recoverable carts.

For Monsoon Market they are enabled by all of the following:

1. The store was registered with `http://store:4000/api/orders` as its signed
   order feed.
2. `DEMO_STORE_CHAPMAN=true` is applied to the store container.
3. `<!--CHAPMAN_SESSION-->` and the embed tag exist on every relevant page.
4. The shopper signs in on <http://localhost:4000/account.html>.

The passwordless form accepts any valid email and creates a local demo account.
A fresh reset has no synthetic customers or orders, so order-bearing shortcut
accounts appear only after test orders exist or history is explicitly seeded.

The store signs the feed and shopper token with the secret Chapman generated
during registration. The browser never receives that secret.

## 8. Shopper memory

No model is required to store or recall a safe memory. OpenRouter is optional
for condensing a long list.

1. Enable **Shopper memory** in Feature controls.
2. Complete signed identity setup from the previous section.
3. Sign in on the storefront.
4. Tell the assistant `I prefer low-caffeine tea.`
5. Reload **Shopper memory** and confirm that exact shopper-scoped statement is
   visible.

Optional consolidation variables are:

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL_SUMMARISER=
```

Anonymous visitors are never remembered. Prices, stock, offers, order states,
payment details and delivery dates are rejected as memory.

## 9. Shop cortex

The cortex does not need a provider key. It assembles its view from the live
catalogue, policies, merchant voice, settled orders, ledger and the last
analysis run.

1. Open **Shop cortex** after registration to confirm catalogue and policy
   facts.
2. Enter and save the store voice.
3. Read **What is still missing**. A fresh store should honestly report absent
   order history, merchant costs or analysis instead of inventing them.
4. Open Offers after its evidence is available; its aggregate findings return
   to the cortex.

Shopper memory and the shop cortex are separate stores. Personal memory never
becomes merchant-wide shop knowledge.

## 10. Offers

Offers need no model key. They need evidence:

- unit cost per SKU;
- merchant margin, discount and sample-size floors;
- at least 30 settled orders;
- current stock from the catalogue.

A real new store should show **too little evidence** until those facts exist.
Chapman checkout orders enter local history automatically. The current Docker
build reads costs and floors from `/data/merchant-inputs.json`.

For a presentation, the deterministic seed supplies synthetic orders, carts,
costs and floors. Enable it only after registration and label the data as
synthetic:

```dotenv
CHAPMAN_SEED=true
```

```powershell
docker compose up -d --force-recreate gateway
```

The seed includes four deliberately loyal recovery shoppers. Each has at least
six completed orders and a fresh abandoned basket that remains profitable at
8% off. On the Recovery page these baskets are labelled
**regular · discount eligible**; ordinary new shoppers remain labelled
**new · no recovery discount**.

To apply the presentation-safe recovery policy after registering Monsoon
Market, run:

```powershell
docker compose exec -T gateway node scripts/configure-demo-recovery.mjs --shop pk_monsoon_market
```

This enables conversational voice recovery, permits an 8% grant for price and
delivery-cost objections from returning or regular shoppers, and keeps the
full payment-link handoff off. It does not place a call.

Open **Offers**, inspect stopped candidates, and approve one experiment. The
assistant and agent profile may advertise only that approved offer. Keep
`CHAPMAN_SEED=false` for a real merchant evaluation.

## 11. Analyst

The Analyst is the one feature that requires OpenRouter because the model
chooses among read-only merchant tools. The statistics and arithmetic still
come from code.

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL_ANALYST=
```

Use a funded accessible model for a predictable demo, recreate the gateway,
then open **Analyst** and choose a suggested question. Verify that the answer
shows at least one tool call. It cannot change a price or approve an offer.

## 12. Basket recovery, test calls, and post-call SMS

Recovery needs a captured cart before it needs a phone provider.

1. Enable **Recovery** in Feature controls.
2. Complete signed identity and order/contact access.
3. Sign in, add an item to the cart, and leave without checkout.
4. Open **Recovery** and confirm the basket appears as recoverable.
5. Configure and save limits. Keep outreach off while testing.

For a real notice-only call, all five values are required:

```dotenv
SARVAM_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
PUBLIC_ORIGIN=https://your-public-gateway.example
```

Apply them, then use **Place test call** only with a number you control or an
expecting recipient. The action is real and can consume provider credit. During
quiet hours the destination must exactly match:

```dotenv
VOICE_QUIET_HOURS_TEST_NUMBER=+919876543210
```

After pressing the button, read the inline test-call console rather than
looking at the top of the page. It reports every stage that actually completed:
E.164 validation, voice configuration, rate limiting, speech bounds, Sarvam
rendering, and Twilio acceptance. An `[error]` line names the first stage or
policy that stopped the call. `[done] Call queued` means Twilio accepted the
request; verify that the handset received it or inspect the Twilio call log to
confirm final completion.

If `.env` was changed, apply it before testing:

```bash
docker compose up -d --force-recreate gateway
```

OpenRouter is optional for conversational call turns and free-form grading:

```dotenv
OPENROUTER_MODEL_ASSISTANT=
OPENROUTER_MODEL_GRADER=
```

Use **Send test message** with the same consent confirmation before enabling
the automated handoff. A Full Twilio account receives Chapman's fixed neutral
body. A Trial account automatically receives Twilio's predefined
`sms_customer_support` template. Neither is a recovery offer. By default SMS is
sent from `TWILIO_FROM`; optionally set one of:

```dotenv
TWILIO_MESSAGING_FROM=
TWILIO_MESSAGING_SERVICE_SID=
```

To test the complete recovery flow on either account type:

1. Enable Recovery and Voice in **Feature controls**.
2. Use the demo configuration command above, or configure the same policy in
   Recovery: 8%, `price_too_high` and `shipping_cost`, returning shoppers or
   better, plus explicit monthly grant and margin caps.
3. Under **On the telephone**, choose **Hold a conversation**.
4. Refresh Recovery and choose a card labelled
   **regular · discount eligible**. The Chai + Assam and Coffee + Chai fixtures
   are clean recovery examples. Send only to your configured test handset.
5. On the call say `Can you give me a discount?` or
   `Delivery charges bahut jyada thi.` Chapman classifies that first durable
   answer, checks tier, cost, margin floor, quantity, expiry and monthly caps,
   and issues exactly the configured 8% grant when every gate passes.
6. The fixed spoken response confirms that 8% was approved. If the post-call
   Trial template is available, it also says a discount-confirmation SMS will
   arrive after the call. If no grant is issued, the call makes no SMS promise.

For a **Twilio Trial account**, leave **Send an approved discounted-payment
link by SMS** off. After Twilio reports the call completed, Chapman sends the
permitted predefined template once to `TWILIO_TEST_TO`. Trial templates cannot
carry a unique Razorpay URL or custom promotional body, so the call does not
claim that a payment link was sent.

For a **Full Twilio account**, first link Razorpay for this Chapman storefront
and confirm the Agent front page says checkout is configured. Then enable
**Send an approved discounted-payment link by SMS**. After the grant and
Razorpay checkout both succeed, Chapman sends the unique discounted payment
link and the fixed voice line says it was sent.
Paying it in Razorpay test mode records the order, closes the abandoned cart,
adds a non-sensitive shopper outcome memory, and updates aggregate recovery
results.

The model can hold the Hinglish conversation but cannot choose a percentage.
Exact offer terms come only from the grant written by server policy. The SMS
handoff is attempted once per grant. A manual integration test call never
creates a discount, message, or order; use a labelled recovery basket for this
demo.

## 13. Ledger and test bench

Neither needs an external key.

- **Decision ledger** records replies, blocks, tool failures, payment events
  and approvals for audit.
- **Test bench** probes the live store endpoints and attacks the live assistant
  guardrails. Run it after each integration change.

Finish with container-network diagnostics and the complete automated suite:

```powershell
docker compose run --rm gateway npm run doctor
docker compose run --rm gateway npm run check
```

## Setup matrix

| Capability                | Storefront change                      | Server data or key                                          | Direct test                             |
| ------------------------- | -------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| Assistant                 | Embed on every page                    | OpenRouter optional                                         | Test chat assistant                     |
| Agent-readable storefront | `/.well-known/ucp` route               | No provider key                                             | Verify install                          |
| Razorpay checkout         | Already integrated in Monsoon Market   | Key ID and Key Secret; Chapman link only for agent checkout | Add to cart and Razorpay test checkout  |
| Personal orders           | Signed session and order feed          | Generated site secret                                       | Signed-in order question                |
| Shopper memory            | Signed session                         | OpenRouter summariser optional                              | State a preference, inspect Memory      |
| Shop cortex               | None beyond connected sources          | Catalogue, voice, history                                   | Inspect gaps and projections            |
| Offers                    | None                                   | Costs, floors, 30 orders                                    | Review and approve one proposal         |
| Analyst                   | None                                   | OpenRouter required                                         | Ask and inspect tool transcript         |
| Recovery                  | Cart capture and signed contact lookup | Voice keys; Twilio SMS sender; Razorpay for payment links   | Test call, test SMS, then eligible cart |
| Ledger and test bench     | None                                   | None                                                        | Run the page actions                    |
