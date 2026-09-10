# Chapman gateway

This directory contains the Chapman server, merchant dashboard, storefront
embed, UCP and MCP routes, provider integrations, and test scripts.

The application uses React Router and Vite. Shopify support is optional; the
custom storefront path does not require a Shopify account or Prisma at startup.

Use the repository-level [README](../README.md) for the demo and
[INSTALL.md](../INSTALL.md) for deployment.

## Development setup

Requirements: Node.js `>=22.12`.

For a fresh dashboard with no registered storefront:

```bash
npm install
npm run bootstrap
npm run dev:gateway
```

Open <http://localhost:3000/login> and use the first-boot credentials printed
by `bootstrap`.

For command-line storefront configuration:

```bash
npm install
npm run init
npm run doctor
npm run dev:gateway
```

## Main commands

| Command | Purpose |
|---|---|
| `npm run dev:gateway` | Run the custom-storefront gateway on port 3000 |
| `npm run bootstrap` | Create a merchant account without registering a site |
| `npm run init` | Configure a storefront through the command line |
| `npm run doctor` | Check config, catalogue reachability, and optional providers |
| `npm run db:migrate` | Apply pending versioned SQLite migrations |
| `npm run db:backup` | Create and verify a consistent SQLite snapshot |
| `npm run db:restore -- PATH --yes` | Restore a verified snapshot, preserving the previous database |
| `npm run demo:clean-store` | Generate the unconfigured Monsoon Market demo |
| `npm run typecheck` | Generate route types and run TypeScript checks |
| `npm run build` | Build the production client and server |
| `npm run check` | Run all assertion suites |
| `npm run probe:models` | Test the configured OpenRouter model chain |
| `npm run shop-as-agent` | Exercise the agent shopping path |

## Configuration

The native setup reads secret values from the repository-root `.env`. Durable
state and site settings live in `data/chapman.sqlite`; rows contain only
environment-variable names, never provider secret values.

Important paths:

| Path | Purpose |
|---|---|
| `app/routes/` | Dashboard, embed, checkout, UCP, MCP, payment, and callback routes |
| `app/lib/` | Framework-independent policy and integration logic |
| `app/components/` | Shared dashboard components |
| `scripts/` | Setup, doctor, checks, probes, and demo generation |
| `docker/entrypoint.sh` | Idempotent container bootstrap |
| `data/chapman.sqlite` | Native-development database; Docker uses `/data/chapman.sqlite` |
| `chapman.config.example.json` | Commented custom storefront example |
| `chapman.config.demo.json` | Explicit test fixture; never an automatic fallback |

Provider setup is documented in
[docs/configuration.md](../docs/configuration.md). The dashboard shows setup
instructions on Assistant, Agent front, Analyst, Shopper memory, and Recovery.

## First-store behavior

A fresh instance creates a merchant account with no site grants. The merchant
registers the first store from the dashboard. Site registration does not count
as installation; the Overview separately checks the assistant embed and public
agent discovery route.

The **Feature controls** page governs allowed capabilities. It does not claim
that provider keys or storefront code exist.

## Runtime health

`/health/live` confirms that the HTTP process is alive. `/health/ready` checks
the SQLite schema version, foreign keys, WAL mode, and database writeability.
It deliberately does not make storefront or third-party provider calls.

Every application response includes `X-Request-ID`. Runtime logs are emitted as
one JSON object per line with the request method, path (never the query string),
status, duration, and matching `request_id`. HTTP 4xx/5xx and application
failures use level `error` and always include a stable `error_code`, such as
`HTTP_404`, `HTTP_UNHANDLED_ERROR`, or `HTTP_RENDER_FAILED`. Known secret fields,
credentials, email addresses, and phone numbers are redacted.

When investigating a failure, copy the response's `X-Request-ID` and search the
gateway logs for the same `request_id`. The accompanying `error_code` identifies
the failure class without exposing the request body or credentials.

Internet-facing routes also have per-surface body ceilings and process-local
token-bucket rate limits. Oversized requests return `413 HTTP_BODY_TOO_LARGE`;
exhausted buckets return `429 HTTP_RATE_LIMITED` with `Retry-After`. The limits
cover chat, MCP/UCP, cart and identity, checkout, recovery, voice callbacks, and
payment/application webhooks. Set `CHAPMAN_TRUST_PROXY=1` only when Chapman is
directly behind one trusted reverse proxy that replaces `X-Forwarded-For`;
otherwise the gateway deliberately keys limits from the direct socket address.

`SIGTERM` and `SIGINT` start a graceful drain: new keep-alive work receives
`503 HTTP_SERVER_SHUTTING_DOWN`, in-flight responses finish, tracked background
model/TTS work settles, Prisma disconnects, and SQLite checkpoints its WAL and
closes. The sequence is emitted as structured `process.shutdown.*` logs. Its
default 20-second deadline can be changed with
`CHAPMAN_SHUTDOWN_TIMEOUT_MS` (1,000–120,000 ms); keep the value below the
container platform's termination grace period. A second signal or expired
deadline forces a non-zero exit with a stable shutdown error code.

## Deployment roadmap

The current image deliberately bundles the merchant dashboard and runtime
gateway. The future design separates an independently hosted Chapman
dashboard/control plane from each merchant's independently deployed gateway,
while retaining standalone Docker operation. The gateway remains beside the
merchant's shopper and payment data; the two services exchange signed,
versioned configuration rather than copying that data into the dashboard.

Catalogue ingestion currently supports CSV and a bounded Schema.org crawler.
A future optional Firecrawl acquisition adapter will cover more
JavaScript-rendered storefronts, but its output will still require Chapman's
missing-field validation and explicit merchant review. See the
[feature checklist](../docs/feature-checklist.md) for milestone order.

## Verification before a change is handed off

```bash
npm run typecheck
npm run build
npm run check
```

Run the focused lifecycle regression suite with `npm run check:shutdown`.

When Docker behavior changes, also run from the repository root:

```bash
docker compose build gateway
docker compose run --rm gateway npm run doctor
```
