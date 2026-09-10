# Chapman feature checklist

Last reviewed: 10 September 2026

This is the working checklist for the project. It separates decisions we have
already made from code that is actually implemented.

- In **Decisions**, `[x]` means the direction is agreed.
- In **Implementation**, `[x]` means the capability exists in the repository.
- An unchecked **Partial** item names both the working part and the remaining
  work.
- The active priority is **Milestone 1: a dependable Docker self-hosted
  gateway**. Later milestones should not distract from it.

### Latest verified state

- [x] Every subsystem that previously used application JSON/JSONL persistence
  now uses SQLite; the former files are neither read nor migrated.
- [x] The database is at schema version 2 and passes `PRAGMA integrity_check`.
- [x] Clean migration, populated v1-to-v2 migration, backup, mutation, guarded
  restore, and pre-restore recovery-snapshot tests pass.
- [x] The full application assertion suite, TypeScript check, and production
  build pass on the host.
- [x] Built-server checks return healthy responses from `/health/live` and
  `/health/ready`.
- [x] Built-server requests carry `X-Request-ID`; success and error responses
  emit structured JSON logs, and HTTP/application errors include stable error
  codes with secret and contact-data redaction.
- [x] The current gateway image rebuilds and restarts against the persistent
  Docker volume, and `/health/ready` reports healthy. A destructive clean-volume
  rehearsal remains separate from the live demo volume.

## Decisions

### Product and deployment

- [x] Chapman does not host or replace the merchant's storefront.
- [x] The storefront may be hosted independently on Vercel or any other host
  that can publish a script tag and a rewrite, redirect, or proxy route.
- [x] A fresh storefront remains unaware of Chapman until the merchant installs
  the assistant embed and/or agent-discovery route.
- [x] Registration, assistant installation, agent-front installation, payment
  readiness, and optional integrations are reported as separate states.
- [x] The first deployment target is a fully self-hosted Docker gateway that
  includes the merchant dashboard and runtime server.
- [x] The possible future split into a hosted dashboard/control plane and a
  merchant-hosted gateway/data plane is deferred until the self-hosted gateway
  is dependable.
- [x] Razorpay remains merchant-owned. Chapman links to an existing Razorpay
  setup; it does not create the account, complete KYC, or enable payment
  methods.

### Catalogue ingestion

- [x] Chapman's runtime catalogue contract is a documented `catalog.json`
  shape rather than arbitrary storefront HTML.
- [x] A merchant who already publishes that feed can give Chapman its public
  URL directly.
- [x] A merchant without a feed can upload CSV during onboarding or later from
  Store configuration.
- [x] Chapman validates the CSV, explains the required columns, previews the
  generated catalogue, and lets the merchant download `catalog.json`.
- [x] The merchant publishes the reviewed file on the storefront for the first
  version. On Vercel, that normally means placing it in the site's public
  directory.
- [x] A quick crawler is also available during onboarding and later from the
  dashboard.
- [x] The quick crawler is deliberately bounded and extracts structured
  Schema.org Product/Offer data. It is not presented as a universal crawler.
- [x] Firecrawl-backed and general JavaScript-rendered crawling are skipped for
  the current hackathon milestone. Revisit them only after the core self-hosted
  gateway is dependable and real storefront tests justify the added service.
  The future adapter should use Firecrawl for acquisition only, then reuse
  Chapman's deterministic normalization, missing-field report, merchant review,
  and atomic catalogue publication flow.
- [x] Generated prices, stock, products, and variants must be reviewed by the
  merchant. Checkout still revalidates authoritative price and availability.

### Data and memory

- [x] Merchant data is kept with the self-hosted gateway, in its persistent
  Docker volume.
- [x] SQLite is the authoritative store for configuration, merchants,
  catalogue snapshots, carts, orders, decisions, offers, recovery state, and
  shopper memories.
- [x] The first semantic-memory implementation will keep embeddings locally
  with SQLite and use exact similarity search. A separate vector service is
  unnecessary at hackathon scale.
- [x] Embedding generation may use OpenRouter. The hackathon dataset is fake,
  so external model privacy is not a release blocker for this demo.
- [x] Every stored vector records its embedding model and dimensions.
- [x] Vectors from different embedding models must never be mixed in one
  similarity index.
- [x] If embedding generation is unavailable, Chapman stores the source text,
  uses lexical search, and retries embedding later instead of losing memory.
- [x] Direct merchant database connections are a later adapter feature, not a
  requirement for the first Docker release.

### Models

- [x] Text embeddings: `nvidia/nemotron-3-embed-1b:free`.
- [x] Agent and native tool calling: `google/gemma-4-26b-a4b-it:free`, with
  `minimax/minimax-m3:free` as the first fallback.
- [x] Deeper analysis and reasoning: `minimax/minimax-m3:free`, with Gemma 4 as
  fallback.
- [x] Low-latency voice response text: `liquid/lfm-2.5-2.6b:free`, with Gemma 4
  as fallback.
- [x] `openrouter/free` is only a last-resort chat fallback.
- [x] Assistant, agent/tool, analyst, embedding, and voice jobs have distinct
  model roles even when some roles temporarily share a model.
- [x] Free endpoint reliability is handled with fallbacks and deterministic
  degradation; privacy is not the current concern.
- [x] Embeddings do not fall through into a different vector space. Failed
  items remain pending or lexical until the selected embedding model returns.
- [x] Chapman will use OpenRouter's native `tools`/`tool_calls` protocol rather
  than asking a model to imitate tool calls in plain JSON.

## Implementation snapshot

### Storefront integration

- [x] Storefront assistant embed with server-grounded catalogue answers.
- [x] Agent-readable UCP/MCP surface.
- [x] Generated `/.well-known/ucp` instructions for custom hosts, including
  Vercel rewrites.
- [x] Separate verification for the assistant embed and agent discovery.
- [x] Feature controls can withdraw individual capabilities and tools.
- [x] Shopify remains optional for the custom-storefront path.
- [x] A Chapman-free Vercel demo-store scaffold exists for a clean integration
  exercise.
- [x] The clean Fieldnote demo store is deployed to Vercel at
  `https://chapman-vercel-demo.vercel.app`.
- [x] The deployed before-state was used to exercise installation from a site
  with no Chapman code.
- [x] The integrated store now has the assistant embed, catalogue, UCP
  discovery, MCP, `llms.txt`, Razorpay test checkout, pseudonymous login, and
  signed cart capture. The reproducible setup and ngrok details are documented
  in the integration guides.

### Catalogue

- [x] The accepted JSON shape and field rules are documented in
  [Catalogue format](catalog-format.md).
- [x] CSV template, column guide, validation, multi-variant grouping, preview,
  and download.
- [x] CSV import is available during first-store onboarding.
- [x] CSV import is available later from Store configuration and Catalogue.
- [x] Bounded crawler with sitemap discovery and same-host page traversal.
- [x] The crawler reads JSON-LD Product/Offer data and omits unsupported facts
  instead of inventing them.
- [x] Crawler protections include public-address checks, same-host redirects,
  response limits, timeouts, page limits, and an authenticated/cooldown route.
- [x] Crawler result preview, warnings, and `catalog.json` download.
- [x] Vercel-specific file-hosting instructions.
- [ ] **Partial — catalogue publication:** generation and verification exist,
  but the merchant must still copy the generated file to the storefront and
  paste its URL into Chapman.
- [x] Store validated catalogue snapshots, products, variants, tags, and
  policies in SQLite, switching the active snapshot atomically.
- [ ] Optional Chapman-hosted catalogue endpoint for merchants who cannot
  publish a static file on their storefront.
- [ ] Scheduled recrawl/import, change preview, and merchant approval.
- **Skipped for now — Firecrawl and general JavaScript-rendered crawling.** The
  existing bounded JSON-LD crawler and CSV importer remain the supported paths;
  platform-specific connectors can be reconsidered after real store testing.

### Commerce and merchant features

- [x] Server-grounded assistant with deterministic fallback.
- [x] Server-authoritative quotes and Razorpay order creation.
- [x] Razorpay signature verification, webhook settlement, reservations, and
  idempotent settlement paths.
- [x] Signed shopper identity for personal orders and memory.
- [x] Order/cart integration contract for custom storefronts.
- [x] Offer detection, merchant approval, and claim enforcement.
- [x] Basket recovery policy, suppression reasons, and bounded remedies.
- [x] Sarvam/Twilio recovery calls and controlled SMS handoff.
- [x] Shop cortex and read-only analyst.
- [x] Decision ledger and test bench.
- [x] Deterministic Fieldnote demo history: six months of labelled commerce,
  distinct fictional shoppers and contacts, shopper preferences, and one
  prominent controlled identity derived from `USERNAME`, `TWILIO_TEST_TO`, and
  the storefront's existing signing secret.
- [ ] WhatsApp delivery after template/business registration work.
- [ ] Production Indian SMS delivery after DLT sender/template registration.
- [ ] Diagnostics page for unanswered or unsupported tool requests.

### Models and semantic memory

- [x] OpenRouter chat-completions client with per-role fallback chains.
- [x] Deterministic assistant behavior when OpenRouter is missing or fails.
- [x] Bounded shopper-memory write rules and store/shopper isolation.
- [x] Lexical shopper-memory retrieval.
- [ ] Add explicit `agent`, `voice`, and `embedding` model configuration roles.
- [ ] Apply the agreed primary and fallback model order to Docker configuration
  and documentation.
- [ ] Replace the current prompt-shaped JSON tool loop with native OpenRouter
  `tools`, `tool_choice`, assistant `tool_calls`, and tool-result messages.
- [ ] Add an OpenRouter embeddings client with batching, timeouts, retry
  classification, and dimension validation.
- [ ] **Partial — SQLite memory:** memory text and embedding job/vector tables
  are in SQLite; generating and retrieving Nemotron vectors is Milestone 2.
- [ ] Implement exact cosine-similarity retrieval with lexical fallback.
- [ ] Queue and retry memories whose embedding is pending.
- [ ] Add a Chapman-specific benchmark for tool-call correctness, grounded
  answers, time-to-first-token, and short voice responses.

## Milestone 1 — dependable Docker self-hosted gateway

This remains the active implementation milestone. Its SQLite persistence and
recovery slice is complete; the remaining work is container hardening and an
actual Docker lifecycle smoke test.

### What already works

- [x] `docker compose up -d` starts the gateway without requiring the demo
  storefront or tunnel profiles.
- [x] A fresh volume creates a merchant login but no invented storefront,
  catalogue, orders, or analytics.
- [x] `CHAPMAN_AUTO_INIT` and synthetic seed data are explicit opt-ins.
- [x] Application data, generated secrets, and site configuration live in the
  persistent `chapman-data` volume.
- [x] Existing environment secrets win over generated values, and bootstrap is
  safe to rerun.
- [x] Secrets, data files, host configuration, and development databases are
  excluded from image layers.
- [x] The gateway has a Compose health check and `unless-stopped` restart
  policy.
- [x] Optional demo-store and ngrok services are isolated behind Compose
  profiles.
- [x] The demo storefront waits for a healthy gateway and mounts gateway data
  read-only.
- [x] The entrypoint uses `exec`, so stop signals reach the server process.
- [x] Shopify migrations run only when Shopify is configured.
- [x] `npm run doctor`, the automated check suite, and Docker-specific
  regression checks run inside the gateway image.
- [x] Docker installation, upgrades, reset behavior, and troubleshooting are
  documented.

### Persistence and upgrades

- [x] Replace application JSON and JSONL persistence with
  `/data/chapman.sqlite`; synthetic seed documents are opt-in database rows.
- [x] Define and run versioned SQLite migrations for every current durable
  subsystem before the gateway accepts traffic.
- [x] Enable WAL mode, foreign keys, a 5-second busy timeout, and indexed
  merchant/site/shopper boundaries.
- [ ] **Partial — transactional commerce:** settlements, grants, catalogue
  activation, cart state/event pairs, and normalized line writes are
  transactional; in-flight stock reservations are still process-local.
- [x] Deliberately do not migrate former JSON/JSONL demo data; old files are
  ignored and left untouched, as agreed for this clean hackathon build.
- [x] Add automated clean-install and populated version-to-version migration
  tests.
- [x] Add `db:backup` and guarded `db:restore` commands using SQLite
  `VACUUM INTO`, integrity checks, and a pre-restore recovery snapshot.
- [x] Document and test a complete backup → mutate test instance → restore
  drill without exposing secrets.
- [x] Expose database path, schema version, foreign-key state, WAL state, and
  writeability through `npm run doctor` and readiness checks.

### Container hardening and operations

- [ ] **Deferred for the hackathon — non-root runtime:** running the gateway as
  a dedicated non-root user with verified ownership of `/data` is desirable
  production hardening, but is not part of the immediate build.
- [x] Replace the asset-based health probe with explicit lightweight
  `/health/live` and dependency-aware `/health/ready` endpoints.
- [x] Make readiness report database migration and writable-volume state
  without calling external model/payment providers.
- [x] Add request IDs and structured logs with mandatory error codes and
  secret/contact-data redaction.
- [x] Add streaming-safe, route-specific HTTP request-size ceilings and
  process-local token-bucket rate limits for public agent, chat, identity,
  payment, recovery, voice, and webhook surfaces. Rejections return stable
  `HTTP_BODY_TOO_LARGE` or `HTTP_RATE_LIMITED` codes and rate responses include
  `Retry-After`; forwarded client addresses are trusted only when explicitly
  configured for one proxy hop.
- [x] Pass the explicit one-hop proxy setting into Docker so HTTPS dashboard
  actions work through ngrok without relaxing React Router's CSRF checks, and
  generate assistant snippets from the pinned public gateway origin even when
  the merchant administers Chapman through localhost.
- [x] Implement bounded graceful shutdown: reject late keep-alive work with a
  coded 503, drain active responses and registered background jobs, disconnect
  Prisma, checkpoint/close SQLite, and force a coded non-zero exit on deadline
  or a second signal. Detached voice model/TTS work is tracked now; future
  embedding workers must use the same lifecycle registry, while their queued
  database rows remain restart-safe.
- [ ] Add a production reverse-proxy/TLS example while keeping localhost as the
  default developer path.
- [ ] Add an optional production Compose override for ports, domain, and secret
  injection without changing the base demo file.
- [ ] Pin and document third-party image versions used by optional profiles.
- [ ] Add an image build smoke test that starts from an empty volume, waits for
  readiness, signs in, and preserves data across container recreation.
- [ ] Add an upgrade smoke test that proves an existing database survives a new
  image and its migrations.
- [ ] Produce a release image/tag rather than requiring every merchant to build
  `chapman-gateway:local`.

### Docker model configuration

- [ ] Pass `OPENROUTER_MODEL_AGENT`, `OPENROUTER_MODEL_VOICE`, and
  `OPENROUTER_MODEL_EMBEDDING` through Compose.
- [ ] Put the agreed free model defaults in application code, with environment
  overrides for merchants who fund or pin another model.
- [ ] Include model-role and fallback status in `npm run doctor` without
  printing the API key.
- [ ] Ensure model failure never prevents the gateway, catalogue, dashboard,
  deterministic assistant, or payment checks from starting.

### Milestone 1 acceptance criteria

- [ ] A new merchant can start Chapman with one documented Compose command and
  reach an empty, truthful onboarding dashboard.
- [ ] Restarting or recreating the container preserves accounts, sites,
  catalogues, carts, orders, memory, ledger entries, and generated secrets.
- [x] Upgrading the image applies database schema migrations automatically
  before traffic; former JSON/JSONL data is intentionally outside this promise.
- [x] Backup and restore are both documented and proven by an automated test.
- [ ] **Partially deferred for the hackathon:** the image must not contain host
  data or secrets in its layers; switching the runtime to a non-root user is
  deferred production hardening.
- [x] Liveness, readiness, logs, and doctor output identify failures without
  exposing sensitive values.
- [x] Public routes have bounded inputs and rate limits appropriate for an
  internet-facing demo, including chunked-body and client-isolation checks.
- [ ] The full automated suite, clean-volume smoke test, restart test, migration
  test, and restore test pass from inside Docker.

The unchecked Docker acceptance items are validation gaps, not known database
failures. They require a running Docker daemon and must be completed before the
Milestone 1 release is called dependable.

## Milestone 2 — semantic memory and native tool calling

- [ ] Complete the model-role, native-tool, embedding, and vector-search items
  above after SQLite is authoritative.
- [ ] Confirm that voice uses the low-latency role and never waits on embedding
  work.
- [ ] Evaluate model order with Chapman-specific probes rather than a generic
  “say OK” test.
- [ ] Show embedding status, pending retries, and lexical degradation in
  diagnostics.

## Milestone 3 — hosted storefront integration exercise

- [ ] Deploy the clean Vercel demo store with no Chapman code.
- [ ] Record the before-state and confirm its existing commerce behavior.
- [ ] Add only the generated assistant embed and Vercel discovery rewrite.
- [ ] Publish or connect its reviewed catalogue.
- [ ] Verify assistant, UCP discovery, catalogue search, cart, checkout, and
  removal of the integration.
- [ ] Turn the exercise into a short Vercel installation guide and regression
  test.

## Milestone 4 — optional control-plane/data-plane split

Deferred until Milestones 1–3 are stable.

- [ ] Separate the dashboard/control plane from the runtime gateway so each can
  be deployed and upgraded independently.
- [ ] Let Chapman host the dashboard while a merchant hosts the configured
  gateway on a durable container platform and keeps the storefront on Vercel
  or its existing host.
- [ ] Define which settings belong to the hosted dashboard and which data must
  remain in the merchant gateway.
- [ ] Create a versioned, signed gateway configuration bundle.
- [ ] Add gateway registration, key rotation, revocation, and heartbeat without
  granting the control plane access to shopper data by default.
- [ ] Support Railway, Render, Fly.io, and similar container hosts before
  considering serverless runtimes that do not provide durable local storage.
- [ ] Preserve fully standalone Docker operation with no Chapman-hosted control
  plane dependency.
- [ ] Design read-only merchant data-source adapters with explicit field
  mapping instead of accepting arbitrary database access.
- [ ] Start with signed HTTP feeds and Shopify; evaluate read-only Postgres and
  MySQL connectors only when a merchant test case requires them.
- [ ] Store connector credentials in the merchant's secret manager or gateway
  environment, never in a hosted dashboard database by default.
- [ ] Add an optional Firecrawl acquisition provider for JavaScript-rendered
  storefronts, with bounded jobs, issue reporting, merchant correction, and
  explicit draft approval before publication.

## Not part of the immediate milestone

- A universally reliable crawler for every storefront framework.
- Replacing the merchant's checkout or payment account.
- A mandatory hosted Chapman service.
- A separate vector-database container at hackathon scale.
- Arbitrary write access to a merchant's operational database.
- Production privacy/compliance certification for the fake hackathon dataset.
