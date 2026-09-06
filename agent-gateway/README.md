# Chapman gateway

This directory contains the Chapman server, merchant dashboard, storefront
embed, UCP and MCP routes, provider integrations, and test scripts.

The application uses React Router and Vite. Shopify support is optional; the
custom storefront path does not require a Shopify account or Prisma at startup.

Use the repository-level [README](../README.md) for the demo and
[INSTALL.md](../INSTALL.md) for deployment.

## Development setup

Requirements: Node.js `>=20.19 <22` or `>=22.12`.

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
| `npm run demo:clean-store` | Generate the unconfigured Monsoon Market demo |
| `npm run typecheck` | Generate route types and run TypeScript checks |
| `npm run build` | Build the production client and server |
| `npm run check` | Run all assertion suites |
| `npm run probe:models` | Test the configured OpenRouter model chain |
| `npm run shop-as-agent` | Exercise the agent shopping path |

## Configuration

The native setup reads secret values from the repository-root `.env`.
`chapman.config.json` stores site settings and environment-variable names, not
provider secret values.

Important paths:

| Path | Purpose |
|---|---|
| `app/routes/` | Dashboard, embed, checkout, UCP, MCP, payment, and callback routes |
| `app/lib/` | Framework-independent policy and integration logic |
| `app/components/` | Shared dashboard components |
| `scripts/` | Setup, doctor, checks, probes, and demo generation |
| `docker/entrypoint.sh` | Idempotent container bootstrap |
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

## Verification before a change is handed off

```bash
npm run typecheck
npm run build
npm run check
```

When Docker behavior changes, also run from the repository root:

```bash
docker compose build gateway
docker compose run --rm gateway npm run doctor
```
