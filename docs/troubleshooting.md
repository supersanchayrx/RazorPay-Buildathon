# Troubleshooting

Things that have actually gone wrong here, what caused them, and the fix. Each
entry states the symptom first, because that is what you will have in front of
you.

---

## A fresh dashboard says features are active before a store is configured

**Expected current behavior.** A fresh Docker volume creates a merchant account
with no site grant. The dashboard sends the merchant to **Configure your
storefront** and must not show a catalogue, installed embed, discovery route, or
provider as ready.

If an old store appears, the named Docker volume already contains a previous
configuration. Check:

```bash
docker compose ps
docker compose logs gateway
```

`docker compose down` does not clear the volume. If the existing data is wanted,
keep it. If this is intentionally a disposable demo and a complete reset is
required, back up anything important before using the all-profile reset in
[Fresh storefront setup](fresh-store-setup.md#1-start-docker-and-reset-the-demo).

Also confirm these values have not opted into a fixture:

```dotenv
CHAPMAN_AUTO_INIT=false
CHAPMAN_SEED=false
```

`chapman.config.demo.json` must only be selected explicitly for tests.

---

## `down -v` says a volume or network is still in use

A service started under the `demo` or `tunnel` profile is probably still
running. Activate every profile while tearing the project down:

```powershell
docker compose --profile "*" down --volumes --remove-orphans
```

This is a complete reset and deletes Chapman and demo-store Docker data. If an
interrupted run still leaves resources behind, use the project-labeled force
cleanup in [Fresh storefront setup](fresh-store-setup.md#1-start-docker-and-reset-the-demo).

---

## The assistant bubble opens but a message times out

Start with the feature's own **Test chat assistant** action. It uses the same
catalogue, router, tools, bounds checks, and response pipeline as the widget.

Then check:

```bash
docker compose logs gateway
docker compose run --rm gateway npm run doctor
```

Common causes are:

- the catalogue URL uses `localhost` even though the gateway is in Docker;
- the configured OpenRouter request is slow or rejected;
- the root `.env` changed but the gateway was not recreated;
- the browser origin does not exactly match the registered scheme and host.

If activity says `free daily quota reached (429)`, the key was accepted but the
OpenRouter account exhausted its free-model allowance. Use a funded accessible
model via `OPENROUTER_MODEL_ASSISTANT`, or remove the key to use Chapman's
deterministic fallback. A `404` saying a model is unavailable for free means
that model slug left the free tier.

For the bundled demo, the catalogue URL must be
`http://store:4000/catalog.json`. OpenRouter is optional for the storefront
assistant; removing an invalid key should leave the deterministic fallback
available.

---

## Monsoon Market says test checkout is not configured

Monsoon Market's cart does not depend on a Chapman tag or registration. Confirm
both `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are non-empty in the root
`.env`, then recreate the store so Docker applies them:

```powershell
docker compose --profile demo up -d --build --force-recreate store
```

Do not run the Chapman Razorpay linker for this problem.

## Chapman does not advertise agent checkout

Both `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` must be non-empty, and the
Chapman site must be linked to those variable names. For first-store onboarding,
that link is created by selecting **Configure Razorpay for this storefront**.

After editing `.env`, run:

```bash
docker compose up -d gateway
```

If the site was registered without the Razorpay checkbox, link Chapman's agent
checkout with:

```bash
docker compose run --rm gateway npm run site:enable-razorpay -- --site pk_monsoon_market
docker compose up -d --force-recreate gateway
```

Open **Agent front** and inspect its Razorpay setup status. A webhook secret is
recommended for settlement reliability but is not required to advertise basic
checkout.

---

## The Place test call button is disabled or appears to do nothing

Recovery voice requires all of these values:

```dotenv
SARVAM_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
PUBLIC_ORIGIN=
```

The form also requires an E.164 destination and confirmation that the recipient
expects the call. During quiet hours, the destination must exactly match
`VOICE_QUIET_HOURS_TEST_NUMBER`.

The action makes a real provider call and can consume credit. A successful UI
render alone does not verify Twilio or Sarvam.

After pressing the button, use the inline console directly below it:

- No console means the form was not submitted. Check that all five variables
  show as configured, the number is present, and the consent box is selected.
- `[working]` means the request is still running.
- `[error]` gives the exact validation, provider, feature-control,
  rate-limit, or quiet-hours refusal.
- `[done] Call queued` means Twilio accepted the request. It does not by itself
  prove the handset answered; check the phone or Twilio call log for the final
  result.

If the console reports quiet hours, add the exact test destination to `.env`
and recreate the gateway:

```dotenv
VOICE_QUIET_HOURS_TEST_NUMBER=+919876543210
```

```bash
docker compose up -d --force-recreate gateway
```

---

## The Send test message button is disabled or the SMS fails

Twilio messaging needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and an
SMS-capable sender. Chapman uses `TWILIO_MESSAGING_SERVICE_SID` first,
`TWILIO_MESSAGING_FROM` second, and `TWILIO_FROM` as the default fallback.
`PUBLIC_ORIGIN` is additionally required for real discounted payment links.

The test form needs an E.164 destination and the consent checkbox. A Twilio
Trial account can send only a predefined template to a verified destination.
Chapman detects `type: Trial` and automatically uses Twilio's
`sms_customer_support` template for this test. Read the inline console: it
reports validation, rate limiting, account type, and Twilio acceptance. After
changing `.env`, recreate the gateway.

If you see `Invalid template. Trial accounts can only use pre-defined
templates`, rebuild the current gateway and try once more. Chapman recognizes
that exact provider error and retries the test once with the predefined
template. It does not retry a unique discounted payment-link message: that link
requires a Full Twilio account. A completed Trial recovery call that actually
announced a grant uses the predefined template instead and records the attempt
under **Recent SMS handoffs**.

If a real recovery handoff fails, inspect **Recent SMS handoffs**. Chapman does
not automatically retry a grant after a provider attempt because a lost Twilio
response could otherwise send the same payment link twice.

---

## `TypeError: Cannot read properties of null (reading 'use')`

**Symptom.** A dashboard page renders "Application Error" with a stack running
through an Astryx component into `react-dom_client.js`:

```
TypeError: Cannot read properties of null (reading 'use')
  at exports.use (http://localhost:3000/node_modules/.vite/deps/chunk-JHYWF6JX.js:894:35)
  at useSize (http://localhost:3000/node_modules/.vite/deps/chunk-56P32BR4.js?v=36bae9d4:13:42)
  at SegmentedControl (.../@astryxdesign_core_SegmentedControl.js?v=36bae9d4:122:16)
```

**How to confirm it is this and not a bug in the component.** Compare the query
strings. One chunk has **no `?v=`** while every other chunk carries the same
`?v=<hash>`. That is two generations of Vite's dependency cache being executed
in one page, which means two copies of React. Hooks read their dispatcher off
module-level state, so the second copy finds `null` — hence "reading 'use'" on
nothing.

**Cause.** Someone added an import of a package subpath that Vite had not
pre-bundled yet — in the case above, `@astryxdesign/core/SegmentedControl`
appearing in `dashboard.chatbot.tsx`. Vite re-optimizes on discovering a new
dependency and normally reloads the page to match. If the browser is holding a
page from before that re-optimization, it keeps the old chunk and fetches the
rest new.

**Fix, cheapest first.**

1. Hard reload: `Ctrl+Shift+R`. This is usually all it takes.
2. If it persists, stop the dev server and clear the cache:

   ```
   rmdir /s /q node_modules\.vite
   npm run dev:gateway
   ```

   Windows will refuse to delete the directory while Vite has the files open,
   so the server must be stopped first.

Expect one automatic reload on the next page load — the cache rebuilds lazily
and Vite will print `new dependencies optimized` before reloading itself. That
reload is the healthy version of what went wrong.

---

## The same error, but it never goes away

**Cause.** A second copy of React may be included in the dashboard bundle.
This can happen when a package is installed from two different workspace
locations or when a local package brings its own React dependency.

Identical version numbers do not save you. Two copies on disk are two module
instances, and `react@19.2.8` in one directory cannot see the hook dispatcher
set by `react@19.2.8` in another.

**How to check.**

```bash
cd agent-gateway
npm ls react react-dom
```

**Fix.** Remove only the duplicate dependency or incorrect workspace link that
the command identifies, then reinstall inside `agent-gateway`. Do not delete a
root package or lock file merely because it exists; inspect whether another
tool in the repository owns it first.

---

## The dev server is running but no terminal owns it

**Symptom.** Port 3000 is in use, `npm run dev:gateway` fails with
`Port 3000 is already in use`, and the window you started it in is closed.

Closing a terminal does not always take its child processes with it. Find and
kill the orphan:

```
netstat -ano | findstr :3000
taskkill /PID <pid> /T /F
```

`/T` matters — it kills the process tree, and Vite runs children.

The same thing bites when a check script or a manual `react-router-serve` test
is interrupted. If a port behaves strangely, assume an orphan before assuming a
code change.

---

## `npm` fails in PowerShell with `UnauthorizedAccess`

**Symptom.**

```
npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running
scripts is disabled on this system.
```

Nothing to do with this project. PowerShell resolves bare `npm` to `npm.ps1`,
and the default execution policy refuses unsigned scripts.

**Fix,** either:

```powershell
npm.cmd run dev:gateway                              # per-command
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned  # permanently
```

Or use `cmd.exe`, where `npm` resolves to `npm.cmd` and none of this applies.

---

## Shell commands in this repo's docs

Most instructions here are written for a POSIX shell. On Windows:

| POSIX        | cmd.exe           | PowerShell                      |
| ------------ | ----------------- | ------------------------------- |
| `rm -rf x`   | `rmdir /s /q x`   | `Remove-Item -Recurse -Force x` |
| `rm x`       | `del x`           | `Remove-Item x`                 |
| `cp -r a b`  | `xcopy /e /i a b` | `Copy-Item -Recurse a b`        |
| `export X=1` | `set X=1`         | `$env:X = "1"`                  |
| `X=1 cmd`    | `set X=1 && cmd`  | `$env:X="1"; cmd`               |
| `which node` | `where node`      | `(Get-Command node).Source`     |

`rm -rf` in PowerShell is a particularly nasty one: `rm` is aliased to
`Remove-Item`, so the command is _found_ and then fails on the flags, which
reads as a broken command rather than a wrong one.

---

## `CHAPMAN could not start: the site configuration is not valid`

**Symptom.** Every route that resolves a site returns 500 under `npm start`,
while `npm run dev:gateway` is fine:

```
- sites[0].devSecret: refused in production. Set SITE_SECRET_NILGIRIPOST in
  your environment, or run "npm run init" to generate one.
```

**This is deliberate.** `chapman.config.demo.json` is an explicit test fixture
that carries a `devSecret`, and `app/lib/config.server.ts` refuses to honour it
when `NODE_ENV=production`. It is not an automatic fallback. A throwaway secret
must not be able to reach a live shop.

**Fix.** Set a real one before starting:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

then put `SITE_SECRET_<SITEKEY>=...` in your `.env`, or run `npm run init`.

The default Docker path starts with no site at all. Its authenticated onboarding
flow generates a real site secret when the merchant connects the first store.

---

## A public request returns 413 or 429

`413 HTTP_BODY_TOO_LARGE` means the request exceeded the route-specific body
ceiling. Reduce chat history, cart lines, webhook payload size, or other posted
input; do not retry the same body unchanged.

`429 HTTP_RATE_LIMITED` means that client exhausted the process-local bucket
for chat, agent, identity/payment, recovery, voice, or webhook traffic. Honour
the response's `Retry-After` header. If every user behind a reverse proxy appears
to share one bucket, set `CHAPMAN_TRUST_PROXY=1` only when exactly one trusted
proxy immediately fronts Chapman and replaces `X-Forwarded-For`. Never enable
it merely to trust an address header sent directly by the public internet.

Both responses include `X-Request-ID`; use it to find the matching structured
log entry and stable error code.

---

## A restart logs `PROCESS_SHUTDOWN_TIMEOUT`

Chapman could not finish an active response, tracked background job, or server
connection before `CHAPMAN_SHUTDOWN_TIMEOUT_MS` elapsed. Look at the preceding
`process.shutdown.*` records to see whether HTTP or background drain was the
last completed stage. Increase the deadline only if the container platform's
termination grace period is longer; the base Compose values are 20 seconds for
Chapman and 30 seconds for Docker. Repeated timeouts usually indicate a hung
provider request that needs its own tighter timeout.

`PROCESS_SHUTDOWN_FORCED` means a second `SIGTERM`/`SIGINT` arrived during the
drain. SQLite remains WAL-protected, but investigate the orchestrator or manual
stop sequence rather than treating it as a clean restart.
