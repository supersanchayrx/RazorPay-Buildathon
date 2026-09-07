# The demo storefront.
#
# Not part of the product. This is the reference merchant site — the thing
# CHAPMAN gets installed INTO — and it is here so that `docker compose
# --profile demo up` gives you something to point the gateway at.
#
# The storefront FILES are deliberately not baked in. They are bind-mounted
# from ./demo-store-clean, because pasting the embed tag into a file on the host
# and seeing it appear on the next refresh is the whole demonstration; a copy
# inside the image would make that a rebuild. The files copied in below are a
# fallback, so `docker run` with no mount still serves a shop.

# ---- build ---------------------------------------------------------------
FROM golang:1.26-alpine AS build

WORKDIR /src

# No third-party dependencies: this store is net/http and nothing else, which is
# the point being made by it. So there is no module download step to cache.
COPY go.mod ./
COPY *.go ./

RUN go vet ./... \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/store .

# ---- run -----------------------------------------------------------------
#
# Static binary, no libc needed. wget comes from busybox and is what the
# healthcheck uses.
FROM alpine:3.21

RUN adduser -D -u 10001 store
WORKDIR /store

RUN mkdir -p /store-data && chown store:store /store-data

COPY --from=build /out/store /usr/local/bin/store

# The fallback copy. Overlaid by the bind mount in the demo profile.
COPY index.html product.html account.html catalog.json ./
COPY assets ./assets

# rootDir() resolves to a source path baked in at compile time, which does not
# exist here. -dir is how the binary is told where the shop actually is, and
# STORE_DIR is the same thing through compose.
ENV STORE_DIR=/store
ENV STORE_ADDR=0.0.0.0:4000
ENV STORE_DATA_DIR=/store-data

USER store
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --spider -q http://127.0.0.1:4000/catalog.json || exit 1

ENTRYPOINT ["store"]
