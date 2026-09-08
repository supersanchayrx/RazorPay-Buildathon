# The catalogue feed

One JSON document at a URL you control. It is the source of every number
CHAPMAN says out loud — every price, every stock figure, every total — so the
shape below is not a convenience, it is the contract.

Point `catalogFeedUrl` at it in `chapman.config.json`, then run
`npm run doctor` to have it fetched and checked.

A working example ships in the repository:
[demo-store/catalog.json](../demo-store/catalog.json).

Merchants who do not already publish this format can open **Store
Configuration** in the Chapman console, download the CSV template, import their
products, and download a generated `catalog.json`.

The merchant dashboard also has a dedicated **Catalogue** page. It checks the
configured feed, reports empty or unreachable sources on the overview, and
offers storefront crawling and CSV import as two reviewable generation paths.

## Importing from a storefront

The quick storefront crawler accepts a public homepage URL, checks its
`/sitemap.xml`, and scans up to 30 same-host pages. It reads Schema.org
`Product` and `Offer` JSON-LD, including `hasVariant` products, then presents a
preview and a generated `catalog.json` for merchant review.

The crawler does not execute storefront JavaScript or infer missing commerce
facts. A product without a structured price, three-letter currency, and stock
availability is omitted. Private network destinations and cross-host redirects
are refused. If the storefront does not expose usable structured data, use the
CSV importer.

## Importing CSV

The CSV importer uses one row per variant. Repeat the same `handle`, `title`,
and product-level fields on each row when a product has several variants.

```csv
handle,title,description,type,vendor,tags,image,url,variant_title,price,sku,in_stock,inventory,currency
nilgiri-green-tea,Nilgiri Green Tea,Bright whole-leaf tea,Green Tea,Monsoon Market,tea|green,/images/green-tea.jpg,/products/nilgiri-green-tea,100 g,480,NFG-100,true,42,INR
nilgiri-green-tea,Nilgiri Green Tea,Bright whole-leaf tea,Green Tea,Monsoon Market,tea|green,/images/green-tea.jpg,/products/nilgiri-green-tea,250 g,1080,NFG-250,true,18,INR
```

`handle`, `title`, and `price` are required. Tags are separated with `|`.
Currency defaults to `INR`, `in_stock` defaults to `true`, and a blank
`inventory` means the merchant does not publish an exact count. All rows must
use the same currency, and every non-empty SKU must be unique.

Conversion happens in the merchant's browser; Chapman does not retain the CSV.
After downloading `catalog.json`, publish it on the storefront, confirm its URL
works without authentication, and save that absolute URL under **Catalogue feed
URL**.

---

## The shape

```json
{
  "shop": {
    "currency": "INR",
    "policies": {
      "returns":  "Unopened packs may be returned within 7 days of delivery...",
      "shipping": "Dispatched within 2 working days from Coonoor...",
      "cod":      "Cash on delivery available on orders under 3000 INR..."
    }
  },
  "products": [
    {
      "handle": "nilgiri-frost-green-tea",
      "title": "Nilgiri Frost Green Tea",
      "description": "Hand-plucked during the frost season...",
      "type": "Green Tea",
      "vendor": "Monsoon Market",
      "tags": ["tea", "green", "single-estate"],
      "image": "/assets/img/nilgiri-frost-green-tea.svg",
      "url": "/products/nilgiri-frost-green-tea",
      "variants": [
        { "title": "100 g", "price": 480,  "sku": "NFG-100", "inStock": true, "inventory": 42 },
        { "title": "250 g", "price": 1080, "sku": "NFG-250", "inStock": true, "inventory": 18 }
      ]
    }
  ]
}
```

**The top level must be an object with a `products` list.** A bare JSON array is
the natural guess and it is the one shape that fails silently: the feed loads,
nothing throws, and the assistant knows about no products at all. `npm run
doctor` calls that out by name.

---

## Fields

### `shop`

| Field | Required | Notes |
|---|---|---|
| `currency` | no | ISO code. Defaults to `INR`. Applies to every price in the feed — there is no per-product currency |
| `policies.returns` | no | Prose. Quoted to shoppers as written |
| `policies.shipping` | no | Prose |
| `policies.cod` | no | Prose |

Policies are **quoted, never summarised**. A policy CHAPMAN paraphrased would be
a promise you did not make, so what you write here is what a shopper is told,
and a policy you leave out is one the assistant declines to answer on.

Anything else under `shop` is ignored, so extra keys are harmless.

### `products[]`

| Field | Required | Notes |
|---|---|---|
| `handle` | **yes** | Stable, unique, URL-safe. It is how every other surface refers to the product, so changing one orphans carts and stored recommendations |
| `title` | **yes** | What a shopper is told the product is called |
| `description` | no | **Truncated to 600 characters.** Write the first two sentences for a reader, not for search |
| `type` | no | A category, e.g. `Green Tea`. Used for ranking and complements |
| `vendor` | no | Brand |
| `tags` | no | List of strings. Used for search and for finding complements |
| `image` | no | Absolute, or a path resolved against the feed URL |
| `url` | no | The product page. Absolute, or a path resolved against the feed URL. Overrides `productUrlTemplate` in your config |
| `variants` | no, in practice yes | See below. A product with no variants has no price and no stock |

### `products[].variants[]`

| Field | Required | Notes |
|---|---|---|
| `price` | **yes** | A number in **major units** — 480 means ₹480. Not paise |
| `title` | no | The variant name, e.g. `100 g`. Defaults to `Default` |
| `sku` | no | Your own identifier. Passed through untouched |
| `inStock` | no | Boolean. **Only an explicit `false` marks it out of stock** — absent means available |
| `inventory` | no | A number. Omit it rather than guessing: absent means "we do not publish a count", and the assistant then never quotes one |

---

## Three things that go wrong

**Prices in paise.** `price: 48000` for a ₹480 product undercharges nothing and
overcharges by a hundred — the shopper is quoted ₹48,000 and leaves. Major
units, always. (The *checkout* API works in minor units; the feed does not.
`toMinorUnits` handles the conversion on the way to Razorpay.)

**An inventory number you cannot stand behind.** `inventory: 3` licenses the
assistant to say *"only 3 left"*, and it will. That sentence is allowed
precisely because the feed asserted it. If your count is approximate, leave the
field out — the assistant then says the product is available and stops there.

**A handle that changes.** Handles are how baskets, recommendations and stored
recovery rows refer to products. A rename that changes the handle is a new
product as far as everything downstream is concerned.

---

## How it is read

- **Fetched over plain HTTP GET, unsigned.** A catalogue is public — it is the
  same information your product pages already show. Nothing here needs a
  secret. (The *order* feed is the opposite case, and is signed.)
- **Cached for 60 seconds.** One shopper conversation makes several reads, and
  60 seconds is short enough that a price change is live before anyone notices
  and long enough that a conversation does not hammer your origin.
- **It must be reachable from wherever CHAPMAN runs**, which is not necessarily
  from your laptop. `npm run doctor` fetches it from the machine the gateway is
  on, which is the answer that matters.
- **Search that matches nothing returns nothing.** There is no fallback to
  "here is everything", because that is how an assistant ends up confidently
  recommending an unrelated product.

---

## On Shopify

None of this applies. The Shopify path reads the Admin GraphQL API directly and
there is no feed to publish — `catalogFeedUrl` is a custom-storefront field.
