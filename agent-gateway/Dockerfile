# CHAPMAN gateway.
#
# One stage, deliberately. A builder/runtime split would save perhaps 200 MB,
# and it would cost the thing that makes this image worth shipping: that
#
#   docker compose run --rm gateway npm run check     1024 assertions
#   docker compose run --rm gateway npm run doctor    what is actually reachable
#   docker compose run --rm gateway npm run init      the setup interview
#
# all run INSIDE it. Those need the dev dependencies — `doctor` and `init`
# bundle the app's `.server` modules with esbuild so bare Node can import them.
# `doctor` run in the container is the only honest answer to "will this work in
# production", because it resolves the catalogue feed from where the gateway
# actually runs rather than from the laptop that built the image.
FROM node:22-alpine

# Prisma needs it. Prisma itself only runs when SHOPIFY_API_KEY is set — see
# docker/entrypoint.sh — but the binary has to be here for when it does.
RUN apk add --no-cache openssl

WORKDIR /app

# NODE_ENV is set at the END of this file, not here. `npm ci` with
# NODE_ENV=production silently omits devDependencies, and `react-router build`
# needs vite, which is one of them. That failure reads as a broken build script.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Prisma CLIENT GENERATION, at build time. Not a migration — this writes
# TypeScript into node_modules and touches no database.
#
# It has to happen even on the custom-storefront path, where Shopify is never
# used. `app/shopify.server.ts` builds Shopify lazily, but it imports
# `db.server.ts` at module scope, and that constructs a PrismaClient when the
# route manifest loads. Without a generated client the server dies on import
# with "@prisma/client did not initialize yet" — before anything it could have
# said about configuration.
#
# Constructing the client does not connect to anything, so this costs five
# seconds here and nothing at run time. The MIGRATION stays in the entrypoint,
# behind SHOPIFY_API_KEY, because that one does touch a database.
RUN npx prisma generate

RUN npm run build

# The entrypoint has to be LF. It is authored on Windows, and a CRLF shebang
# fails as `/bin/sh\r: not found` — an error that names neither the file nor
# the cause. `.gitattributes` pins the line ending; this is the second belt.
COPY docker/entrypoint.sh /usr/local/bin/chapman-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/chapman-entrypoint && chmod +x /usr/local/bin/chapman-entrypoint

ENV NODE_ENV=production
# Defaults, so `docker run` with no compose file still lands somewhere sane.
# Both are overridden by compose. /data is expected to be a volume: everything
# CHAPMAN writes goes there, and nothing it writes should survive only in a
# layer.
ENV CHAPMAN_DATA_DIR=/data
ENV CHAPMAN_CONFIG=/data/chapman.config.json

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/chapman-entrypoint"]
CMD ["npm", "start"]
