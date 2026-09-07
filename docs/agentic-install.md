# Agent-assisted installation

This page is for a tester who has cloned Chapman and wants a coding agent to do
the mechanical setup without hiding the parts that require a merchant's
decision.

## Copy-paste prompt

Paste the block below into a coding agent while its workspace is the root of
this repository. Replace the bracketed mode if necessary.

```text
Install and verify Chapman in this repository for [the bundled Monsoon Market
demo / my existing storefront]. Work autonomously through safe, reversible
steps, and ask me only when a real credential or merchant decision is required.

Before changing anything, read README.md, INSTALL.md,
docs/configuration.md, .env.docker.example, docker-compose.yml, and any
AGENTS.md that applies to files you touch. Inspect the existing worktree and
preserve unrelated changes.

Use the Docker path unless this repository cannot run Docker. The truthful
initial state is important:
- do not enable CHAPMAN_AUTO_INIT or CHAPMAN_SEED;
- do not load chapman.config.demo.json;
- do not invent, print, or commit provider keys;
- do not claim the storefront is installed just because a feature switch is on;
- never run docker compose down -v, delete a named volume, or replace an
  existing .env without my explicit approval.

If using the bundled demo:
1. Create .env from .env.docker.example only if .env does not already exist.
   Preserve every existing value.
2. From agent-gateway, install dependencies if needed and run
   npm run demo:clean-store.
3. From the repository root run
   docker compose --profile demo up -d --build.
4. Wait for gateway and store health. Obtain the one-time merchant login from
   docker compose logs gateway without exposing unrelated secrets.
5. Confirm http://localhost:4000 works, has no Chapman assistant embed, and
   http://localhost:4000/.well-known/ucp returns 404.
6. Tell me to sign in at http://localhost:3000/login and use Configure your
   storefront with:
   name Monsoon Market
   key pk_monsoon_market
   browser origin http://localhost:4000
   catalogue http://store:4000/catalog.json
   product URL /product.html?handle={handle}
   order feed http://store:4000/api/orders for the full signed-in demo, or
   blank for catalogue-only setup
   Select Configure Razorpay only if I am supplying Razorpay test keys.
7. After registration, use the Assistant page's generated embed instructions
   in index.html, product.html and account.html, not only the home page. Keep
   the CHAPMAN_SESSION marker for the full signed-in demo. Use the Agent front page's generated
   discovery instructions; for the demo this may require setting
   DEMO_STORE_CHAPMAN=true and recreating the store service as documented.

If using my existing storefront, first inspect its framework and identify the
smallest correct changes for the generated embed tag and /.well-known/ucp
redirect or proxy. Ask me for the public origin and catalogue URL only if they
cannot be determined safely. Do not add order access unless I explicitly ask
for it and a signed server-side feed exists.

Credentials belong only in the repository-root .env or the deployment secret
manager. Explain and request only the group needed for the feature I choose:
- OpenRouter: OPENROUTER_API_KEY; model override variables are optional.
- Razorpay checkout: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET; webhook secret
  and PUBLIC_ORIGIN are recommended for reliable settlement.
- Recovery calls: SARVAM_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
  TWILIO_FROM, and PUBLIC_ORIGIN are all required together.
- Recovery SMS may reuse TWILIO_FROM. TWILIO_MESSAGING_FROM or
  TWILIO_MESSAGING_SERVICE_SID is optional when messaging uses another sender.
Leave unknown values blank. After a Razorpay env change in the bundled demo,
recreate both consumers with
`docker compose --profile demo up -d --force-recreate gateway store`.

For bundled Monsoon Market, do not install checkout code. Confirm the two
Razorpay test values are in `.env`; Docker passes them to the merchant-owned
checkout automatically. Use the safe `site:enable-razorpay` linker only when
Chapman's agent checkout was omitted during registration. Do not install the
Assistant or discovery as a payment side effect.

Verify with evidence, not assumptions:
- docker compose ps
- docker compose run --rm gateway npm run doctor
- the storefront and /embed.js return successfully
- the pre-install discovery path is 404 and the post-install path serves a UCP
  discovery document
- the Assistant page Test chat assistant action returns a grounded result
- never place a real test phone call unless I give an E.164 destination,
  confirm the recipient expects it, and explicitly ask you to place it
- never send a real test SMS unless I give an E.164 destination, confirm the
  recipient expects it, and explicitly ask you to send it
- run the relevant checks, and report any check you could not run.

At the end, report: services and URLs, what is registered, what is actually
installed, which integrations are configured versus using a fallback/off,
tests run, and the exact remaining manual steps. Never include secret values in
the report.
```

## Why the prompt pauses at the dashboard

Registering a merchant's store grants Chapman access to that store and creates
its signing secret. A coding agent can prepare and verify the environment, but
the merchant should see and confirm the origin, catalogue, optional order feed,
and payment linkage. The pause is a permission boundary, not missing
automation.

The prompt also prevents two easy false positives: starting from the explicit
preconfigured demo fixture, and treating an enabled feature control as proof
that storefront code or provider credentials exist.
