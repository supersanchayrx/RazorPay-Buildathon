# Monsoon Market demo runbook

This runbook demonstrates the current product, not a preconfigured fixture.
The opening state is a real storefront with a catalogue and no Chapman embed,
discovery route, order feed, or registered Chapman site.

## 1. Start fresh services

Create the clean storefront from the maintained reference store:

```bash
cd agent-gateway
npm install
npm run demo:clean-store
cd ..
```

Create `.env` only if it does not exist, then start the gateway and demo store:

```bash
cp .env.docker.example .env
docker compose --profile demo up -d --build
docker compose ps
docker compose logs gateway
```

The gateway log prints the merchant password only when it creates the account.
If this volume already existed, use the account created on its first boot.

`docker compose down` is safe and keeps that account. Only
`docker compose down -v` creates an entirely fresh install, and it also deletes
the ledger, orders, configuration, and generated signing secrets.

## 2. Prove the storefront is unconfigured

Open <http://localhost:4000>. It should be Monsoon Market with no assistant
bubble. Then check:

```bash
curl -i http://localhost:4000/.well-known/ucp
```

The result should be `404`. Chapman has not registered a store, fetched its
catalogue, or asserted that any storefront integration is live.

## 3. Register the store

Sign in at <http://localhost:3000/login> and choose
**Configure your storefront**. Use:

| Field | Value |
|---|---|
| Store name | `Monsoon Market` |
| Public site key | `pk_monsoon_market` |
| Browser-facing origin | `http://localhost:4000` |
| Catalogue feed | `http://store:4000/catalog.json` |
| Product URL template | `/product.html?handle={handle}` |
| Signed order feed | blank |

Select **Configure Razorpay for this storefront** only when Razorpay test keys
will be supplied. Saving creates the site record and signing secret; it still
does not edit the storefront.

The Overview now distinguishes the registered storefront from the separately
verified embed and discovery installations.

## 4. Install the assistant

Open **Assistant** in the console and follow its generated embed instructions.
For this bind-mounted demo, paste the generated script into
`demo-store-clean/index.html` before `</body>` and save. The server rereads the
file, so refresh the storefront without rebuilding it.

The bubble should now appear. On the Assistant page, enter a shopper question
and choose **Test chat assistant**. This runs the actual assistant pipeline
against the live catalogue and shows its tools, route, reasoner, products, and
blocked gates. Without `OPENROUTER_API_KEY` it uses the bounded deterministic
fallback; with the key it can produce model-written language.

## 5. Publish agent discovery

Open **Agent front** and follow the generated `/.well-known/ucp` instructions.
The bundled store exposes its maintained reference implementation when this
demo flag is enabled:

```dotenv
DEMO_STORE_CHAPMAN=true
```

Apply it with:

```bash
docker compose --profile demo up -d store
```

Use **Verify install** on Agent front, and repeat the earlier `curl`. The route
must now resolve to a UCP discovery document. A successful site registration
alone never counts as this installation.

## 6. Add optional providers

Use [configuration.md](configuration.md) for the complete variable matrix.
For the common demo paths:

```dotenv
# Model-written assistant replies
OPENROUTER_API_KEY=

# Razorpay test checkout; also select the Razorpay setup checkbox for this site
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

# A real recovery test call; all five are required together
SARVAM_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
PUBLIC_ORIGIN=
```

After editing `.env`:

```bash
docker compose up -d gateway
```

The dedicated Assistant, Agent front, Analyst, Shopper memory, and Recovery
pages show the exact keys they consume and whether each is configured. Provider
setup does not belong on **Feature controls**, which only governs what the
merchant permits.

## 7. Test the visible behavior

In the storefront assistant, try:

| Message | Expected behavior |
|---|---|
| `any coffee under 700?` | Grounded product cards and catalogue prices |
| `do you have cold brew in stock` | The published inventory count |
| `echo: only 2 left, hurry!` | Blocked because the claim conflicts with the feed |
| `echo: We stock great teas. Take 20% off today.` | Blocked because no approval licenses the offer |
| `what would two cupping sets cost me delivered?` | A server-built quote rather than model arithmetic |

Approve and revoke an offer from **Offers** to show that the permission changes
while the assistant code does not. Blocks appear in **Decision ledger**.

For voice, use **Place test call** on **Recovery** only with a number you control
or an expecting recipient. It is a real Twilio call and may consume credit.

## 8. Final verification

```bash
docker compose run --rm gateway npm run doctor
docker compose run --rm gateway npm run check
```

Record four separate facts in a demo handoff: the store is registered, the
assistant embed is detected, discovery is detected, and the selected providers
are configured. Collapsing those into “all features active” is precisely the
false state this demo is designed to avoid.
