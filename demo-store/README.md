# Monsoon Market — a reference integration

**This is not part of CHAPMAN.** It is a small storefront that has been
integrated with one, kept in the repository so that every claim about how easy
the integration is can be read as code rather than taken on trust.

Nothing here is a dependency. Delete this directory and the gateway is
unaffected.

## Reference store and clean demo

`demo-store/` is the maintained, fully integrated reference. The onboarding
demo does not serve these HTML files directly. It generates
`demo-store-clean/` with every marked Chapman block removed:

```bash
cd ../agent-gateway
npm run demo:clean-store
```

Docker bind-mounts that generated directory. With
`DEMO_STORE_CHAPMAN=false`, the server also leaves the discovery, recovery, and
order-feed routes unregistered. This creates a real pre-install state: no
assistant tag and a 404 at `/.well-known/ucp`.

After the merchant registers the store, the Assistant page provides the embed
tag to paste into the generated HTML. Setting `DEMO_STORE_CHAPMAN=true` enables
the Go reference routes for the discovery part of the demo. That flag is a demo
fixture; a real merchant installs the redirect or proxy generated on Agent
front.

It is deliberately small: Go, static files, no templating and no database. It
already has a merchant-owned Razorpay test checkout, because this release
assumes payments exist before Chapman is installed. A storefront exists here to
be integrated *with*, not to be impressive.

```bash
go run . -agent http://localhost:3000
# -> http://127.0.0.1:4000
```

For Docker test checkout, the entire payment setup is two values in the root
`.env` before the services start:

```dotenv
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

The store creates orders from `/api/checkout` and confirms successful payments
against Razorpay. `RAZORPAY_WEBHOOK_SECRET` is optional for local interaction;
using it requires registering the store's public
`/api/razorpay/webhook` URL in Razorpay.

| Flag | Default | What |
|---|---|---|
| `-addr` | `127.0.0.1:4000` | listen address |
| `-agent` | `http://localhost:3000` | the gateway to point at |
| `-site` | `pk_monsoon_market` | the site key this store is registered under |
| `-secret` | a committed development value | shared with the gateway. Signs session tokens and the order feed |
| `-orders` | `../agent-gateway/data/orders.jsonl` | order history a merchant would normally read from their own database |
| `-tierc` | `true` | serve the optional legibility layer. `-tierc=false` to prove the store still transacts without it |

---

## The integration, in the order a merchant would do it

Each of these is a separate, optional layer. The store works with only the
first, and every one after it adds reach rather than capability.

### 1. The assistant — one tag

In [index.html](index.html), [product.html](product.html) and
[account.html](account.html), before `</body>`:

```html
<script src="AGENT_BASE/embed.js" data-site="..." defer></script>
```

`AGENT_BASE` is rewritten at serve time by [main.go](main.go) so the gateway
port can move without editing three files. That substitution is a **dev
convenience and not part of the integration** — a real merchant pastes their
gateway URL in once and never thinks about it again.

That tag is the whole of tier A. Everything below is optional.

### 2. Agent access — fifteen lines

[ucp.go](ucp.go) proxies `/.well-known/ucp` to the gateway.

Most merchants do not need this file: a **redirect** on that path is followed by
conforming clients, and every host already has a way to write one. The proxy is
here for the case where you would rather the request ended on your own origin,
and to show how little it takes.

### 3. Basket recovery — two proxied paths

[recovery.go](recovery.go) forwards `/recover/<token>` and `/restore/<token>`.

The point is whose domain the shopper is on. A basket left on `monsoonmarket` is
asked about on `monsoonmarket`, not on a gateway domain they have never seen.
Omit both and the flow still works from our origin — worse, and never wrong.

### 4. Order access — the two halves

[accounts.go](accounts.go) does both, and they are the two things only the
merchant can do:

- `mintSession` puts a short-lived signed token on the page for a signed-in
  shopper, and nothing at all for a signed-out one.
- `verifyRequest` checks the HMAC on our request to `/api/orders`, so the feed
  is not an open endpoint that hands every customer to whoever guesses the URL.

The sign-in form itself is a fixture — a real merchant already has a login. It
accepts any valid email and creates a passwordless local demo account so a
fresh, deliberately unseeded store is still testable. Accounts with existing
test orders appear as shortcuts. It exists so the signed-in and signed-out
paths can both be demonstrated.

### 5. Legibility — one wrapper

[agentfront.go](agentfront.go) is tier C: JSON-LD injected before `</head>`, a
generated `/llms.txt`, a `Link:` header, and `?format=json` on the same URL.

Installed at the **outermost** layer, where it can see the HTML on the way out —
one line in `main.go`, which is exactly how a merchant installs it.

It computes nothing. It sends the gateway a path and injects what comes back,
because the live offers are in an approval ledger there and the policies come
from the catalogue feed the gateway reads. Middleware that built its own JSON-LD
would be a second place prices come from.

`-tierc=false` turns it off in one restart, so "does the store still work
without it?" is a thing anyone can check rather than a thing we assert.

---

## The two files worth reading for their own sake

**[catalog.json](catalog.json)** — the feed format, as a working example. Spec
in [docs/catalog-format.md](../docs/catalog-format.md).

**[assets/cart.js](assets/cart.js)** — the cart cannot hold a price. Every line
is `{handle, sku, qty}` and nothing more, so there is no field for a tampered
client to put a number in and no number for the server to be tempted to trust.
Every total shown comes back from the merchant's `/api/checkout`, which reads
the catalogue and creates the Razorpay test order. Chapman is not in that path.
That is not caution about our own code; it is the oldest bug in
e-commerce, and the insecure version is easier to write and looks identical when
you test it honestly.

---

## Tests

```bash
go test ./...
```

[agentfront_test.go](agentfront_test.go) covers the legibility layer, including
the failure that matters: an upstream that is slow or down must serve the page
exactly as it would have been, and assets must never enter the buffer at all. An
early draft served a 5 MB file as its first 4 MB with a `200` — the kind of
failure that reaches a customer and never reaches a log.
