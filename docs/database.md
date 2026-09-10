# SQLite operations

Chapman's self-hosted gateway keeps durable application state in one SQLite
database. Docker uses `/data/chapman.sqlite`; native development defaults to
`agent-gateway/data/chapman.sqlite`. Override it with
`CHAPMAN_DATABASE_PATH`. `DATABASE_URL` points Prisma's optional Shopify session
storage at the same file.

The gateway requires Node 22.12 or newer. At every container start it applies
versioned migrations before bootstrap or HTTP traffic. Foreign keys, WAL mode,
normal synchronous durability, and a 5-second busy timeout are enabled whenever
the database opens. `/health/ready` checks the current migration, foreign keys,
WAL mode, and volume write permissions; it does not call storefronts, models,
Razorpay, Sarvam, or Twilio.

## Fresh installs and old demo files

There is intentionally no importer for the former JSON/JSONL persistence files.
We chose a clean database for this hackathon build, so existing files are
ignored and left untouched. `npm run seed` is an explicit opt-in that writes
synthetic fixtures into SQLite; it is not a migration command.

Secrets still belong in environment variables or `/data/.env`. Database rows
store only their environment-variable names.

## What is persisted

The schema keeps tenant ownership explicit: a store is the root, merchant
access is represented by merchant/store grants, and store-scoped records carry
foreign keys back to that root. The current migrations cover:

- stores, allowed origins, merchant accounts, grants, settings, and feature
  flags;
- catalogue snapshots, products, variants, tags, and policies;
- carts and immutable cart events, pending checkouts, placed orders, payment
  events, and normalized line items;
- offer decisions, recovery grants and events, conversations, outreach,
  transcript turns, and the decision ledger;
- shopper-memory text, future embedding vectors and jobs, and synthetic seed
  documents.

Catalogue activation, cart state/event writes, checkout/order line writes,
settlement, grants, and recovery transitions use database transactions. Stock
reservations that exist only while a request is in flight are still
process-local; persisting those reservations is a remaining Milestone 1 item.

The memory tables are ready for vectors, including model and dimension
metadata, but the current retrieval path is lexical. OpenRouter embedding
generation and cosine-similarity retrieval belong to Milestone 2.

## Shutdown safety

The production wrapper treats `SIGTERM` and `SIGINT` as a drain request. It
stops new work, waits for active HTTP responses and registered background jobs,
disconnects Prisma, runs `PRAGMA wal_checkpoint(TRUNCATE)`, and closes the
authoritative SQLite connection. Shutdown tasks run in that order so no worker
can write after the database closes. An expired deadline forces a non-zero exit;
SQLite WAL still provides crash recovery, but the forced event is logged as
`PROCESS_SHUTDOWN_TIMEOUT` and should be investigated.

The current detached voice model/TTS promise is registered with the lifecycle
tracker. Future embedding workers must use the same tracker; queued embedding
rows remain durable and can resume after restart even when an upstream call is
interrupted.

## Migrations and startup

Run migrations manually with:

```sh
npm run db:migrate
```

The Docker entrypoint runs this command before bootstrap and before accepting
HTTP traffic. Migrations are ordered, recorded in `schema_migrations`, and safe
to rerun. Application startup refuses readiness when the schema is behind the
version expected by the image.

## Backup

With Docker running:

```sh
docker compose exec gateway npm run db:backup
```

The command uses SQLite `VACUUM INTO`, verifies both source and snapshot with
`integrity_check`, and writes a timestamped file under `/data/backups`. To choose
an explicit destination:

```sh
docker compose exec gateway npm run db:backup -- /data/backups/before-upgrade.sqlite
```

Copy important snapshots off the Docker host as a separate operational step.
The `/data/.env` secret file is not inside the database backup and must be
backed up separately in a secret manager or protected archive.

## Restore drill

Stop the server before replacement, then run the one-off restore command:

```sh
docker compose stop gateway
docker compose run --rm --no-deps gateway npm run db:restore -- /data/backups/before-upgrade.sqlite --yes
docker compose up -d gateway
```

Restore refuses an unverified or missing snapshot. Before replacement it also
creates and verifies `/data/backups/chapman-before-restore-*.sqlite`, so the
immediately previous database remains recoverable. Confirm the result with:

```sh
docker compose exec gateway npm run doctor
docker compose exec gateway wget -qO- http://127.0.0.1:3000/health/ready
```

`npm run check` performs this backup → mutate → restore drill against a disposable
database; it never restores the live development or Docker database.

## Verification status

As of 10 September 2026, the host-side full assertion suite, type check,
production build, clean migration test, populated v1-to-v2 upgrade test, and
backup/restore drill pass. The development database reports
`integrity_check = ok` at schema version 2.

The Compose definition and entrypoint regression checks also pass. A final
clean-volume, container-recreation, and image-upgrade run is still required on
a machine with a running Docker daemon.
