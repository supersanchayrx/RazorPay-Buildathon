#!/bin/sh
# CHAPMAN container entrypoint.
#
# A few things stand between `docker compose up` and a working gateway, and
# they are invisible until the first boot:
#
#   1. A fresh merchant must be able to sign in before a storefront exists.
#      The dashboard, not the container entrypoint, owns first-site setup.
#   2. /app and / are image layers. Anything written there is gone on the next
#      `docker compose up --build`, including the console account — which means
#      nobody can sign in.
#   3. Prisma is Shopify session storage and nothing else. Running a migration
#      against a throwaway SQLite file on the custom-storefront path can only
#      fail; it cannot help.
#   4. loadRootEnv() reads ../.env, which in this container is /.env. Generated
#      secrets go in the volume instead, and are exported here so the process
#      environment — which always wins — carries them.
#
# It is idempotent. Every boot after the first changes nothing unless the
# merchant has deliberately changed configuration.
#
# It also stays out of the way of anything that is not the server:
#
#   docker compose run --rm gateway npm run doctor
#   docker compose run --rm -it gateway npm run init
#   docker compose run --rm gateway npm run check
#
# all get the environment and skip the bootstrap, so `init` is never racing a
# bootstrap that is writing the same file.
set -e

DATA_DIR="${CHAPMAN_DATA_DIR:-/data}"
ENV_FILE="${CHAPMAN_ENV_FILE:-$DATA_DIR/.env}"
DB_FILE="${CHAPMAN_DATABASE_PATH:-$DATA_DIR/chapman.sqlite}"
export CHAPMAN_DATA_DIR="$DATA_DIR"
export CHAPMAN_ENV_FILE="$ENV_FILE"
export CHAPMAN_DATABASE_PATH="$DB_FILE"
export DATABASE_URL="${DATABASE_URL:-file:$DB_FILE}"

mkdir -p "$DATA_DIR"
npm run --silent db:migrate

# ------------------------------------------------------------------ #
# 0. Payments, made a two-line job.
# ------------------------------------------------------------------ #
#
# Outside a container, `secretEnv`-style indirection is the whole point: the
# config names a variable and never holds a value, so a merchant with four
# storefronts keeps four key pairs straight and none of them is in a file that
# gets committed. Inside a container with one shop in it, that indirection is a
# second thing to learn before the first thing works.
#
# So: paste two values into the .env beside docker-compose.yml
#
#   RAZORPAY_KEY_ID=rzp_test_...
#   RAZORPAY_KEY_SECRET=...
#
# and payments are configured. The names above become the names in the config,
# which is what keeps the indirection intact — the config still holds no secret,
# it just no longer asks anyone to invent a variable name to get started.
#
# A merchant token is NOT needed. razorpay.server.ts derives the Basic auth
# header from the key id and secret itself, so a pasted `BASE_64_MERCHANT_TOKEN`
# would be a third secret that nothing reads.
#
# The aliases below exist so that a repository .env written for local
# development — which names these RAZORPAY_TEST_API_KEY_ID1 and friends — works
# in the container with nothing renamed.
if [ -z "$RAZORPAY_KEY_ID" ] && [ -n "$RAZORPAY_TEST_API_KEY_ID1" ]; then
  export RAZORPAY_KEY_ID="$RAZORPAY_TEST_API_KEY_ID1"
  export RAZORPAY_KEY_SECRET="${RAZORPAY_KEY_SECRET:-$RAZORPAY_TEST_API_KEY_SECRET1}"
  export RAZORPAY_WEBHOOK_SECRET="${RAZORPAY_WEBHOOK_SECRET:-$RAZORPAY_WEBHOOK_SECRET1}"
fi

# Naming the variables in the config is then automatic, rather than a third
# thing to configure. Set CHAPMAN_RAZORPAY_KEY_ID_ENV yourself if your variables
# are called something else.
if [ -n "$RAZORPAY_KEY_ID" ] && [ -z "$CHAPMAN_RAZORPAY_KEY_ID_ENV" ]; then
  CHAPMAN_RAZORPAY_KEY_ID_ENV=RAZORPAY_KEY_ID
  CHAPMAN_RAZORPAY_KEY_SECRET_ENV=RAZORPAY_KEY_SECRET
  CHAPMAN_RAZORPAY_WEBHOOK_SECRET_ENV=RAZORPAY_WEBHOOK_SECRET
  export CHAPMAN_RAZORPAY_KEY_ID_ENV CHAPMAN_RAZORPAY_KEY_SECRET_ENV CHAPMAN_RAZORPAY_WEBHOOK_SECRET_ENV
fi

# ------------------------------------------------------------------ #
# Are we starting the server, or running a one-off command?
# ------------------------------------------------------------------ #
IS_SERVER=0
if [ "$1" = "npm" ] && { [ "$2" = "start" ] || { [ "$2" = "run" ] && [ "$3" = "start" ]; }; }; then
  IS_SERVER=1
fi

AUTO_INIT=0
case "${CHAPMAN_AUTO_INIT:-0}" in
  1|true|TRUE|yes|YES) AUTO_INIT=1 ;;
esac

SEED_DEMO=0
case "${CHAPMAN_SEED:-0}" in
  1|true|TRUE|yes|YES) SEED_DEMO=1 ;;
esac

# ------------------------------------------------------------------ #
# 1. Config. Written by the same `npm run init` a merchant runs.
# ------------------------------------------------------------------ #
#
# The container path and the merchant path being the same path is worth more
# than a bespoke setup script: one cannot rot while the other works. The flags
# below are just the interview's answers, supplied by compose instead of typed.
if [ "$IS_SERVER" = "1" ] && [ "$AUTO_INIT" = "1" ] && ! node scripts/db-has-store.mjs; then
  echo "chapman: no configured store in $CHAPMAN_DATABASE_PATH — running the setup interview with defaults."

  # Built up one argument at a time rather than in one expansion. A greeting has
  # spaces in it, and `${VAR:+--greeting "$VAR"}` splits on them: the shop ends
  # up called "Ask" and init dies on the rest. Optional flags go through `if`
  # rather than `[ x ] && set --`, because under `set -e` a test that fails at
  # the end of an && list exits the script.
  set -- npm run init -- --yes \
    --name "${CHAPMAN_SITE_NAME:-My Store}" \
    --origins "${CHAPMAN_SITE_ORIGINS:-http://localhost:4000}" \
    --catalog "${CHAPMAN_SITE_CATALOG:-http://localhost:4000/catalog.json}" \
    --product-url "${CHAPMAN_SITE_PRODUCT_URL:-/products/{handle}}" \
    --gateway "${GATEWAY_ORIGIN:-http://localhost:3000}" \
    --email "${CHAPMAN_CONSOLE_EMAIL:-merchant@example.com}"
  if [ -n "$CHAPMAN_SITE_KEY" ]; then set -- "$@" --key "$CHAPMAN_SITE_KEY"; fi
  if [ -n "$CHAPMAN_SITE_GREETING" ]; then set -- "$@" --greeting "$CHAPMAN_SITE_GREETING"; fi
  if [ -n "$CHAPMAN_SITE_ACCENT" ]; then set -- "$@" --accent "$CHAPMAN_SITE_ACCENT"; fi
  if [ -n "$CHAPMAN_SITE_ORDERS_FEED" ]; then set -- "$@" --orders-feed "$CHAPMAN_SITE_ORDERS_FEED"; fi
  if [ -n "$CHAPMAN_SITE_RECOVER_PATH" ]; then set -- "$@" --recover-path "$CHAPMAN_SITE_RECOVER_PATH"; fi
  if [ -n "$CHAPMAN_SITE_RESTORE_PATH" ]; then set -- "$@" --restore-path "$CHAPMAN_SITE_RESTORE_PATH"; fi
  if [ -n "$CHAPMAN_CONSOLE_PASSWORD" ]; then set -- "$@" --password "$CHAPMAN_CONSOLE_PASSWORD"; fi

  # Payments are named, never valued. These are variable NAMES going into the
  # config; their values are already in this environment or they are not, and
  # `npm run doctor` is what says which. Skipped entirely unless asked for, so a
  # gateway that takes no payment does not advertise a checkout it cannot honour.
  if [ -n "$CHAPMAN_RAZORPAY_KEY_ID_ENV" ]; then
    set -- "$@" --razorpay \
      --razorpay-key-id-env "$CHAPMAN_RAZORPAY_KEY_ID_ENV" \
      --razorpay-key-secret-env "${CHAPMAN_RAZORPAY_KEY_SECRET_ENV:-RAZORPAY_KEY_SECRET}" \
      --razorpay-webhook-secret-env "${CHAPMAN_RAZORPAY_WEBHOOK_SECRET_ENV:-RAZORPAY_WEBHOOK_SECRET}"
  fi

  if ! "$@"; then
    echo "chapman: setup failed. The gateway will not start without a valid site registry."
    exit 1
  fi
  set -- npm start
fi

if [ "$IS_SERVER" = "1" ] && [ "$AUTO_INIT" = "0" ] && ! node scripts/db-has-store.mjs; then
  echo "chapman: no configured store in $CHAPMAN_DATABASE_PATH — starting merchant onboarding."
fi

# ------------------------------------------------------------------ #
# 2. Secrets and a console account, for a config that already exists.
# ------------------------------------------------------------------ #
#
# Covers the merchant who mounts their own chapman.config.json, and the demo
# profile falling back to the committed chapman.config.demo.json. Both leave a
# config with no resolvable secret, which is exactly the state production mode
# refuses to start on.
if [ "$IS_SERVER" = "1" ]; then
  npm run --silent bootstrap || {
    echo "chapman: bootstrap failed — see above. Not starting."
    exit 1
  }
fi

# ------------------------------------------------------------------ #
# 3. Export what was generated, so the process environment carries it.
# ------------------------------------------------------------------ #
#
# CHAPMAN_ENV_FILE means the server would read this file anyway. Exporting is
# belt and braces, and it also reaches anything the server shells out to.
# Existing values are not touched: an orchestrator that injects a real secret
# must win over a file we generated months ago.
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    name="${line%%=*}"
    value="${line#*=}"
    # A name with a space in it is a line that is not a variable assignment.
    case "$name" in
      *[!A-Za-z0-9_]*|'') continue ;;
    esac
    if [ -z "$(eval "printf '%s' \"\${$name:-}\"")" ]; then
      export "$name=$value"
    fi
  done < "$ENV_FILE"
fi

# ------------------------------------------------------------------ #
# 4. Prisma, and only when there is something for it to do.
# ------------------------------------------------------------------ #
#
# Since Shopify became lazily constructed, nothing touches Prisma unless
# Shopify is actually in use. Running it unconditionally is a migration against
# a throwaway SQLite file that can fail and take the container down with it,
# protecting nothing.
# The CLIENT is generated at image build time — see the Dockerfile — because the
# server cannot import its own route manifest without it. What is left here is
# the MIGRATION, which is the half that touches a database.
if [ -n "$SHOPIFY_API_KEY" ]; then
  echo "chapman: SHOPIFY_API_KEY is set — migrating Shopify session storage."
  npx prisma migrate deploy
fi

# ------------------------------------------------------------------ #
# 5. Optional deterministic demo history, once.
# ------------------------------------------------------------------ #
#
# Real merchants must never see invented orders. Seed data is therefore
# opt-in, even after a storefront has been registered, and it is never written
# over an existing order history.
if [ "$IS_SERVER" = "1" ] && [ "$SEED_DEMO" = "1" ] && node scripts/db-has-store.mjs && ! node scripts/db-has-store.mjs seed.orders; then
  echo "chapman: seeding opt-in synthetic commercial history."
  npm run --silent seed
fi

if [ "$IS_SERVER" = "1" ]; then
  echo "chapman: starting on ${GATEWAY_ORIGIN:-http://localhost:3000}"
fi

exec "$@"
