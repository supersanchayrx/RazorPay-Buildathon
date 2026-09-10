# Synthetic demo data

Chapman's demo history is a deterministic, labelled fixture for Monsoon
Market. It exists to make the Analyst, Offers, and Recovery pages useful in a
presentation without passing invented numbers off as merchant data.

Do not enable it for a real merchant evaluation. Every generated order and cart
has `synthetic: true` and seed `20260911` so it remains distinguishable from
live data.

## Fieldnote Home Vercel demo

Fieldnote has a separate deterministic fixture for the integrated Vercel
storefront. It uses the presenter identity already present in the root `.env`:

```dotenv
TWILIO_TEST_TO=+91YOUR_CONTROLLED_NUMBER
USERNAME=Your Demo Name
```

`TWILIO_TEST_TO` must be a number the presenter controls. The script resolves
Fieldnote's existing signing secret inside Chapman and derives the same
pseudonymous customer ID as the Vercel login. It never prints the destination.
Do not pass the signing secret or phone number on the command line.

Build and seed it from the repository root:

```powershell
docker compose up -d --build gateway
docker compose exec -T gateway node scripts/check-fieldnote-seed.mjs
docker compose exec -T gateway node scripts/seed-fieldnote-demo.mjs
docker compose exec -T gateway node scripts/configure-demo-recovery.mjs --shop pk_fieldnote_home
```

The seed command writes only Fieldnote's `seed.orders`, `seed.carts`,
`seed.customer_profiles`, `merchant.inputs`, and labelled shopper-memory rows
to SQLite. It also clears prior outreach/grant/conversation state for those
synthetic Fieldnote identities, making a rehearsal repeatable. It does not
place a call, send a message, or alter the Vercel deployment.

The current Fieldnote fixture contains:

- 355 orders and payment attempts across six months;
- 145 abandoned baskets, with Sola Lamp abandonment deliberately
  overrepresented for analysis;
- 49 named shoppers and 100 durable synthetic memories;
- a planted Dune Throw + Moss Cushion co-purchase pattern;
- recent HDFC payment failures for service-recovery analysis;
- one prominent controlled shopper, named from `USERNAME`, with 14 completed
  orders, six current baskets, and four memories.

Only that prominent shopper uses `TWILIO_TEST_TO`. Every supporting shopper has
a distinct name, a non-deliverable `example.invalid` email, and a number in the
NANPA-reserved fictional `+1 202-555-01xx` range. Recovery still applies its
one-message-per-person rule: it selects the controlled shopper's highest-margin
basket and reports the other five as `duplicate_customer` suppressions. The
merchant dashboard shows the synthetic display name, but identity and memory
remain keyed by the signed pseudonymous customer ID.

For the recording, sign into the Vercel storefront with the same `USERNAME`
and `TWILIO_TEST_TO`, then open **Shopper memory** and **Recovery** in Chapman.
Opening either page sends nothing. A real call or message occurs only after an
explicit send action, and should only target the controlled shopper.

## Load or refresh the fixture

For Docker, set this in the root `.env`:

```dotenv
CHAPMAN_SEED=true
# Optional: route every synthetic recovery contact to your test handset.
TWILIO_TEST_TO=+919876543210
```

When testing during the configured quiet hours, set
`VOICE_QUIET_HOURS_TEST_NUMBER` to the same E.164 number. This exception admits
only that one handset; it does not disable quiet hours for a campaign.

After the storefront has been registered, recreate the gateway. On a new data
volume with `CHAPMAN_SEED=true`, it creates the fixture once; it deliberately
does not seed before a Chapman storefront configuration exists:

```powershell
docker compose up -d --force-recreate gateway
```

If the gateway is already running, or to deliberately refresh an existing demo
volume, run the seed explicitly:

```powershell
docker compose exec -T gateway npm run seed
docker compose --profile demo up -d --force-recreate store
```

The first command replaces only the deterministic `seed.orders`, `seed.carts`,
and `merchant.inputs` document rows in SQLite. Live captured carts, placed
checkout orders, offer decisions, recovery grants, conversations, and decision
ledger rows are separate records and are not rewritten. The store restart
reloads the refreshed order history used by its sample account page.

For a native gateway, run `npm run seed` from `agent-gateway/`.

## What the seed contains

The current fixture covers 15 March through 11 September 2026:

- 782 synthetic payment attempts: 731 placed and 51 payment failures;
- 246 abandoned carts;
- INR 7,10,110 of placed-order revenue;
- merchant-only unit costs and safety floors for every demo SKU.

The volume is intentionally larger than a handful of orders. Offers require a
minimum sample of 30, and the Analyst needs enough history to distinguish a
pattern from an anecdote.

The fixture plants these presentation stories:

| Story | Evidence to show |
| --- | --- |
| Cross-sell | Masala Chai Blend and Single Estate Assam CTC are the strongest co-purchase pair. |
| Replenishment | Twelve customers reorder Masala Chai Blend on an approximately monthly rhythm. This supports reminders, not a discount. |
| Payment incident | Recent HDFC netbanking failures are materially above the other banks. It appears as an incident, not an offer. |
| Cart recovery | Copper Chai Kettle appears in 93 abandoned carts but only three orders. Recovery can draft messages while showing why most carts are suppressed. |
| Slow mover with room | Ceramic Cupping Set clears the sample floor and has a 57% gross margin, making discount economics discussable. |
| Thin-sample trap | Two of three kettle orders used COD. The system must refuse to call that a preference because `n=3` is below the merchant's floor. |
| Margin trap | Cold Brew Concentrate sells quickly but has only a 14% gross margin and is on the never-discount list. |
| Festival trap | Raksha Bandhan gifting demand rises 2.0x. Discounting it would pay for demand that was already arriving. |
| Current-month slowdown | September 1–11 revenue is INR 23,480 versus an INR 50,623 average for the same first 11 days of the prior three months. The feed still has a completed order on September 11, so missing recent data did not manufacture the decline. |
| Marketing audience | Declared synthetic profiles make age 25–34 the largest band (`n=63`) and Instagram the largest observed acquisition source (`n=49`). No spend or impression data is planted, so the analyst must frame this as a test and refuse to promise ROAS. |
| Loyal-shopper recovery | A planted shopper has 12 completed orders and a fresh ₹1,140 Masala Chai Blend + Single Estate Assam CTC basket, ₹60 short of free delivery. |

## Suggested presentation flow

### Analyst

The Analyst needs a configured OpenRouter model. For the complete growth
showcase, ask this as one compound question:

> How many customers did we have in the past month compared with previous
> months? Revenue this month looks stale—what are the three highest-impact
> actions I should take now, and what evidence supports each one?

The deterministic router selects `growth_snapshot` and `list_proposals`. Code
counts unique customers, compares trailing 30-day periods, shows the last six
calendar months, and calculates the ranked opportunities. Ultra sees only those
verified results and reasons about priority; a smaller presenter forms the
final detailed report. The current month is compared only with the same first
11 days of prior months, never projected into a made-up full-month forecast.

The verified fixture should support a response that includes 86 customers in
the latest trailing 30 days versus 89 previously (down 3.4%), and INR 1,29,060
revenue versus INR 1,39,840 (down 7.7%). The leading measured opportunities
include an Araku Valley Filter Coffee cross-sell for Cold Brew buyers, recovery
of 93 abandoned Copper Chai Kettle baskets, and a Nilgiri Frost action. Exact
wording may vary, but numbers must come from the transcript and the final answer
must retain uncertainty and a measurement plan.

Continue with the other questions if the recording needs more depth:

1. `Design a practical marketing and PR campaign to grow store reach. Which channel and age range should I test, for how long, and what should I measure?`
2. `Which customer cohorts retain best after 30, 60, and 90 days, and who should I re-engage?`
3. `Are we too dependent on a few customers or products?`
4. `Is anything wrong with my payments right now?`
5. `Which two products are most worth cross-selling, and how much is it worth a month?`
6. `Do people reorder the masala chai on a regular cycle?`
7. `What would 10% off the ceramic cupping set actually cost me?`

Open **How it got there** after each answer. The useful proof is that the
deterministic router or small orchestrator selects read-only tools, the server
validates the calls, and code performs the arithmetic with sample sizes and
caveats. Ultra performs strategy only after those results exist.

### Offers

Open **Offers** and show the three separate outcomes:

1. HDFC netbanking is shown as something broken now, outside the ranked offers.
2. Cross-sell and replenishment are margin-safe actions.
3. Price changes are experiments and require a human approval.

Also show the stopped candidates. The kettle preference is rejected for its
sample size, and cold brew is rejected by the merchant's margin policy. Approve
one experiment during the demo, then verify that the storefront assistant and
agent profile can state only that exact approved percentage. Revoke it to show
that the permission disappears without changing the assistant.

### Recovery

Open **Recovery** before enabling outreach. The seeded data produces a dry run:
eligible baskets are drafted, while every basket left alone has a named reason.
Some payment-step carts receive a service treatment because they overlap the
payment incident; they never receive a discount for a service failure.

Approving an offer changes only baskets containing that product from a plain
reminder to an exact offer announcement. A recovery-specific discount is a
different path: it can be issued only after a shopper says an allowed reason
and the configured tier, margin, quantity, expiry, and monthly caps all pass.

For the voice-call golden path, choose the ₹1,140 **Masala Chai Blend + Single
Estate Assam CTC** basket. Say `delivery charges bahut jyada hai, discount de
sakte ho`. With delivery-cost discounts enabled, the shopper's 12 completed
orders qualify as `regular`, every safety gate passes, and Priya announces the
merchant-approved 8% grant. The same complaint from a new shopper still gets
the published delivery policy rather than money.

Three additional loyal shoppers provide clean repeatable baskets. Recovery
labels them **regular · discount eligible** and shows their completed-order
count. Use the Chai + Assam or Coffee + Chai card for the clearest recovery
recording; the Nilgiri card may also demonstrate a separately approved promo.

Seeded phone numbers and emails are presentation placeholders. Do not place a
real call to one. Use **Place test call** only with a number you control or with
an expecting recipient, as described in [Fresh storefront setup](fresh-store-setup.md#12-basket-recovery-test-calls-and-post-call-sms).

### Shopper order history

On the Monsoon Market account page, sign in with
`farhan8@example.invalid`. It has 14 synthetic orders in this seed. Ask the
assistant `where is my order?`, then sign out and ask again to demonstrate that
personal order access depends on signed identity rather than a typed email or
order number.

## Verify the fixture

From `agent-gateway/`, the focused provenance check is:

```powershell
node scripts/check-history.mjs
node scripts/check-analyst-growth.mjs
```

The complete project check also exercises the offer and recovery pipelines:

```powershell
npm run check
```

The generator is [seed-history.mjs](../agent-gateway/scripts/seed-history.mjs).
Its comments document the planted signals and the deliberate false-positive
traps in detail.
