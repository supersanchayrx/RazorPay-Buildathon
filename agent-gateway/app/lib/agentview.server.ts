/**
 * Tier C — the machine view of a storefront page, for LLMs that BROWSE.
 *
 * WHO THIS IS FOR, AND WHY IT IS A SEPARATE TIER.
 *
 * A protocol agent reads `/.well-known/ucp`, gets an MCP endpoint, and never
 * looks at the merchant's HTML again. Tiers A and B serve that agent completely.
 * This tier serves the other kind: Claude or ChatGPT handed a product URL by a
 * person, fetching it the way a browser would, with no idea UCP exists. It has
 * one shot at the HTML and whatever else it can guess the URL of.
 *
 * So Tier C adds nothing transactable. It adds LEGIBILITY:
 *
 *   - JSON-LD `Product` + `Offer`, injected before `</head>`
 *   - `/llms.txt`, the store described in prose it will actually read
 *   - `<link rel="ucp">` and a `Link:` header, so a client that DOES know the
 *     protocol can upgrade itself from any page
 *   - content negotiation, so the same URL can answer with data
 *
 * WHY THE MERCHANT'S MIDDLEWARE DOES NOT COMPUTE ANY OF THIS.
 *
 * It cannot. The live offers are in an approval ledger here, the policies are in
 * the catalogue feed we read, the payment handler depends on their Razorpay
 * configuration. A middleware that built JSON-LD locally would be a second place
 * prices and offers come from, and two places means they can disagree — which is
 * exactly the bug that made a cart say Rs 740 and a checkout charge Rs 672.
 *
 * So the merchant's side is deliberately stupid: send us the path, get back a
 * head fragment and a machine view, cache it, inject it. One round trip, and
 * everything it says is computed by the same server that will charge for it.
 *
 * WHAT THIS FILE WILL NOT DO: publish a discounted price.
 *
 * A live offer appears here as TERMS — a title, a percentage, an end date — and
 * never as a number. The number depends on the basket: shipping thresholds move
 * with the discounted subtotal, a recovery grant is capped in units, and two
 * offers on one line do not stack. Only `buildQuote` knows all of that, and it
 * runs on the request that takes the money. schema.org's `Offer.price` therefore
 * carries the LIST price, which is a true fact about the variant, and the offer
 * rides in `Offer.description` where a browsing model will read it as the
 * condition it is.
 */

import type { Site } from "./sites.server";
import type { CatalogProduct, CatalogSource, ShopPolicies } from "./catalog.server";
import { announceable } from "./approvals.server";
import { UCP_VERSION, toUcpProduct, toUcpPolicies, type ProductPromotion } from "./ucp.server";

/* ------------------------------------------------------------------ *
 * Whose storefront are we describing?
 * ------------------------------------------------------------------ */

/**
 * The merchant's own origin, taken from the request only when it is one we
 * already know.
 *
 * The middleware has to tell us which origin it is serving, because behind a
 * tunnel or a CDN the store's public address is not one we can derive. But this
 * endpoint mints absolute URLs and a JSON-LD document that gets INJECTED INTO A
 * PAGE, so an endpoint that stamps whatever domain you name into a merchant's
 * markup is a phishing kit with a cache header on it. Honoured only if it is
 * already in the site registry; anything else falls back to the registered
 * origin, which is the same rule `verifyInstall` runs under.
 */
export function storefrontOriginOf(site: Site, asked: string | null | undefined): string {
  const fallback = site.origins[0] ?? "";
  if (!asked) return fallback;
  try {
    const o = new URL(asked).origin;
    return site.origins.includes(o) ? o : fallback;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ *
 * Which page is this?
 * ------------------------------------------------------------------ */

/**
 * `productUrlTemplate` run backwards.
 *
 * The merchant already told us how to BUILD a product URL — `/products/{handle}`
 * or `/product.html?handle={handle}`. Tier C needs the inverse: given the path
 * the middleware is serving, which product is it? That is the one derived input
 * this tier needs and the reason it needs no new merchant field.
 *
 * Both shapes are handled properly rather than by string surgery, because the
 * two differ in a way that matters: a handle in the PATH is positional and can
 * be matched with a prefix and a suffix, while a handle in a QUERY PARAM is not
 * — `?handle=x&utm_source=y` and `?utm_source=y&handle=x` are the same page, and
 * a prefix match would resolve one and miss the other. A product page that
 * silently stops being recognised because a campaign tag was appended is the
 * kind of failure nobody reports; they just conclude the feature does not work.
 */
export function handleFromPath(template: string | undefined, pathAndQuery: string): string | null {
  if (!template || !template.includes("{handle}")) return null;

  // The TEMPLATE is split by hand rather than parsed as a URL, and that is not
  // fussiness. `new URL("/products/{handle}")` percent-encodes the braces into
  // `/products/%7Bhandle%7D`, so a search for `{handle}` finds nothing and every
  // path-shaped template silently resolves no product pages at all. It slipped
  // through first time because the query-param shape survives — URLSearchParams
  // decodes the value back — so the store we happen to develop against worked
  // while the `/products/{handle}` shape most merchants use did not.
  const q = template.indexOf("?");
  const tplPath = q >= 0 ? template.slice(0, q) : template;
  const tplQuery = q >= 0 ? template.slice(q + 1) : "";

  let req: URL;
  try {
    req = new URL(pathAndQuery, "http://x.invalid");
  } catch {
    return null;
  }
  const reqPath = decodeOrRaw(req.pathname);

  // Case 1: the handle is a query parameter value.
  if (tplQuery.includes("{handle}")) {
    if (reqPath !== tplPath) return null;
    for (const [k, v] of new URLSearchParams(tplQuery)) {
      if (!v.includes("{handle}")) continue;
      const got = req.searchParams.get(k);
      if (!got) return null;
      // The template may wrap it, e.g. `?id=p-{handle}`.
      const [pre, post] = v.split("{handle}");
      if (got.length < pre.length + post.length) return null;
      if (!got.startsWith(pre) || !got.endsWith(post)) return null;
      return got.slice(pre.length, got.length - post.length) || null;
    }
    return null;
  }

  // Case 2: the handle is a path segment.
  const [pre, post] = tplPath.split("{handle}");
  if (reqPath.length < pre.length + post.length) return null;
  if (!reqPath.startsWith(pre) || !reqPath.endsWith(post)) return null;
  const h = reqPath.slice(pre.length, reqPath.length - post.length);
  // A handle is one segment. Without this, `/products/a/b/c` resolves to the
  // handle "a/b/c" and we would go looking for a product that cannot exist.
  if (!h || h.includes("/")) return null;
  return h;
}

/** A malformed escape is not a reason to stop recognising the page. */
function decodeOrRaw(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Is this the storefront's front page? */
function isHome(pathAndQuery: string): boolean {
  const p = pathAndQuery.split("?")[0];
  return p === "/" || p === "" || p === "/index.html";
}

/* ------------------------------------------------------------------ *
 * JSON-LD
 * ------------------------------------------------------------------ */

const num = (s: string) => {
  const n = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const abs = (origin: string, u: string | null | undefined): string | undefined => {
  if (!u) return undefined;
  try {
    return new URL(u, origin).toString();
  } catch {
    return undefined;
  }
};

/**
 * The offer, restated in the merchant's own approved terms.
 *
 * Every part of this sentence comes from the approval record — the title they
 * read, the depth they agreed, the date they set — and the only thing added is
 * grammar. "Applied automatically" is likewise a fact about how `buildQuote`
 * works, not a promise invented for the copy: there is no code to enter, and
 * saying nothing would leave a model to invent one.
 *
 * `maxUnits` is absent on purpose. It is the merchant's exposure budget, and
 * published on a product page it becomes "only 40 left at this price" —
 * manufactured urgency made out of an internal control.
 */
function offerSentence(promos: ProductPromotion[]): string | undefined {
  if (!promos.length) return undefined;
  return promos
    .map((o) => `${o.percent}% off until ${o.endsAt.slice(0, 10)}, applied automatically at checkout`)
    .join(". ");
}

function productNode(
  p: CatalogProduct,
  promos: ProductPromotion[],
  origin: string,
  shopName: string,
): Record<string, unknown> {
  const cur = (p.currency || "INR").toUpperCase();
  const url = abs(origin, p.url);
  const note = offerSentence(promos);

  // Variants without a SKU are dropped for the same reason `toUcpProduct` drops
  // them: every step that could act on one — quote, hold, receipt — is keyed on
  // the SKU, so publishing it advertises something nobody can buy.
  const offers = p.variants
    .filter((v) => v.sku)
    .map((v) => ({
      "@type": "Offer",
      "@id": url ? `${url}#${v.sku}` : undefined,
      name: v.title,
      sku: v.sku,
      price: num(v.price).toFixed(2),
      priceCurrency: (v.currency || cur).toUpperCase(),
      availability: v.availableForSale
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      ...(url ? { url } : {}),
      ...(note ? { description: note } : {}),
      seller: { "@type": "Organization", name: shopName },
    }));

  return prune({
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    description: p.description || undefined,
    ...(url ? { url } : {}),
    image: abs(origin, p.image),
    sku: p.variants.find((v) => v.sku)?.sku ?? undefined,
    category: p.productType ?? undefined,
    brand: p.vendor ? { "@type": "Brand", name: p.vendor } : undefined,
    keywords: p.tags?.length ? p.tags.join(", ") : undefined,
    offers: offers.length === 1 ? offers[0] : offers.length ? offers : undefined,
  });
}

function organizationNode(site: Site, origin: string, tagline?: string): Record<string, unknown> {
  return prune({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    url: origin,
    description: tagline,
  });
}

function itemListNode(products: CatalogProduct[], origin: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: products.length,
    itemListElement: products.map((p, i) =>
      prune({
        "@type": "ListItem",
        position: i + 1,
        url: abs(origin, p.url),
        name: p.title,
      }),
    ),
  };
}

/**
 * Drop every key whose value is undefined, recursively.
 *
 * The rule the whole install runs on: absent means the field is OMITTED, never
 * guessed and never emitted empty. A `brand` of `null` in JSON-LD is a claim
 * that the product has no brand; leaving the key out says we do not know, which
 * is the truth.
 */
function prune<T>(o: T): T {
  if (Array.isArray(o)) return o.map(prune) as unknown as T;
  if (o && typeof o === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = prune(v);
    }
    return out as unknown as T;
  }
  return o;
}

/**
 * JSON-LD, wrapped and safe to paste into a document.
 *
 * `<` is escaped because product descriptions come from the merchant's feed and
 * a description containing `</script>` would otherwise end the block and let the
 * rest of it run as markup. This is injected into the merchant's page, on the
 * merchant's origin, next to their session cookie — so it gets escaped even
 * though the feed is nominally trusted. A script tag closed by data is the
 * oldest injection there is.
 */
function scriptTag(nodes: Array<Record<string, unknown>>): string {
  if (!nodes.length) return "";
  const body = nodes.length === 1 ? nodes[0] : nodes;
  const json = JSON.stringify(body).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/* ------------------------------------------------------------------ *
 * The view
 * ------------------------------------------------------------------ */

export type AgentView = {
  /** Which page we decided this was. */
  page: "product" | "home" | "other";
  /** Ready to inject verbatim before `</head>`. Empty when there is nothing true to say. */
  head: string;
  /** The JSON-LD alone, so middleware that already injects a `<link>` can skip it. */
  jsonld: string;
  /** Value for the `Link:` response header. */
  link: string;
  /** The machine view, returned for `Accept: application/json` or `?format=json`. */
  json: Record<string, unknown>;
  /** Seconds the merchant's middleware may cache this path. */
  maxAge: number;
};

/**
 * `<link rel="ucp">` — and an honest note about what it is worth.
 *
 * NOTHING IN THE MEASURED TOOLCHAIN READS IT. `ucp` CLI v0.8.0 fetches
 * `/.well-known/ucp` once and gives up; it has no `<link>` fallback and no
 * `Link:` header fallback. That measurement is why this is Tier C rather than
 * the one-line install an earlier draft proposed.
 *
 * It stays because it costs one tag, it is where a future client would look, and
 * a browsing model that has been told to find the machine endpoint has somewhere
 * to find it. `rel="ucp"` is not an IANA-registered relation — no invented URL is
 * dressed up as a spec here, and the tag is not load-bearing for anything.
 */
const linkHref = "/.well-known/ucp";

export async function agentView(opts: {
  site: Site;
  catalog: CatalogSource;
  /** Path plus query, as the merchant's middleware received it. */
  path: string;
  /**
   * The origin the middleware says it is serving — UNVALIDATED, as it arrived.
   *
   * Checked in here rather than by the caller. A guard the caller has to
   * remember is a guard that gets forgotten by the second caller, and this one
   * decides which domain gets stamped into markup injected on a merchant's page.
   */
  askedOrigin?: string | null;
  /** Ours, for the MCP endpoint. */
  gatewayBaseUrl: string;
}): Promise<AgentView> {
  const { site, catalog, path } = opts;
  const storefrontOrigin = storefrontOriginOf(site, opts.askedOrigin);
  const base = opts.gatewayBaseUrl.replace(/\/$/, "");

  const offers = announceable(site.key);
  const promosFor = (handle: string): ProductPromotion[] =>
    offers
      .filter((o) => o.handle === handle)
      .map((o) => ({ title: o.title, percent: o.percent, endsAt: o.endsAt }));

  const ucpBlock = {
    version: UCP_VERSION,
    profile: `${storefrontOrigin}${linkHref}`,
    transport: "mcp",
    endpoint: `${base}/ucp/${site.key}/mcp`,
  };

  const link = `<${linkHref}>; rel="ucp"; type="application/json"`;
  const linkTag = `<link rel="ucp" type="application/json" href="${linkHref}">`;

  const handle = handleFromPath(site.productUrlTemplate, path);

  if (handle) {
    const product = await catalog.get(handle).catch(() => null);
    if (product) {
      const promos = promosFor(product.handle);
      const jsonld = scriptTag([productNode(product, promos, storefrontOrigin, site.name)]);
      const policies = await catalog.policies().catch((): ShopPolicies => ({}));
      return {
        page: "product",
        head: jsonld + linkTag,
        jsonld,
        link,
        json: {
          ucp: ucpBlock,
          page: "product",
          shop: { name: site.name, url: storefrontOrigin },
          product: toUcpProduct(product, promos),
          policies: toUcpPolicies(policies),
          notice: BUY_NOTICE,
        },
        maxAge: 300,
      };
    }
    // The path LOOKED like a product page and the handle resolved to nothing.
    // Falling through to the generic view is right: emitting an empty Product
    // node would publish a product that does not exist.
  }

  if (isHome(path)) {
    const products = await catalog.search({ limit: 20 }).catch((): CatalogProduct[] => []);
    const policies = await catalog.policies().catch((): ShopPolicies => ({}));
    const nodes: Array<Record<string, unknown>> = [organizationNode(site, storefrontOrigin)];
    if (products.length) nodes.push(itemListNode(products, storefrontOrigin));
    const jsonld = scriptTag(nodes);
    return {
      page: "home",
      head: jsonld + linkTag,
      jsonld,
      link,
      json: {
        ucp: ucpBlock,
        page: "home",
        shop: { name: site.name, url: storefrontOrigin },
        products: products.map((p) => toUcpProduct(p, promosFor(p.handle))),
        promotions: offers.map((o) => ({
          title: o.title,
          type: "percentage",
          value: o.percent,
          ends_at: o.endsAt,
          automatic: true,
        })),
        policies: toUcpPolicies(policies),
        notice: BUY_NOTICE,
      },
      maxAge: 300,
    };
  }

  // Any other page — a cart, an about page, a blog post. We know the store, we
  // do not know the page, and pretending otherwise is how a returns policy ends
  // up published as a product.
  const jsonld = scriptTag([organizationNode(site, storefrontOrigin)]);
  return {
    page: "other",
    head: jsonld + linkTag,
    jsonld,
    link,
    json: {
      ucp: ucpBlock,
      page: "other",
      shop: { name: site.name, url: storefrontOrigin },
      notice: BUY_NOTICE,
    },
    maxAge: 600,
  };
}

/**
 * How to actually buy, said once and factually.
 *
 * The prices above are list prices. Everything that turns them into a total —
 * an approved offer, a shipping threshold, a stock hold — happens in
 * `create_cart` and `create_checkout`, on the server. A browsing model that
 * quotes a total from a catalogue page will be wrong the moment any of those
 * apply, so it is told where the real number comes from.
 */
const BUY_NOTICE =
  "Prices here are list prices. Discounts, shipping and the final total are computed by the store " +
  "at cart time: connect to the MCP endpoint in `ucp.endpoint` and call create_cart, then " +
  "create_checkout. Payment is completed by the shopper at the URL the checkout returns.";

/* ------------------------------------------------------------------ *
 * /llms.txt
 * ------------------------------------------------------------------ */

/**
 * The store, in prose, at a URL a model will guess.
 *
 * Format follows llmstxt.org: an H1, a blockquote summary, then sections of
 * links. Markdown rather than JSON because the reader is a language model that
 * was handed a domain, not a client that was handed a schema — and because the
 * one thing this has to convey is not in any product schema: THAT THE STORE CAN
 * BE TRANSACTED WITH, and how.
 *
 * Note what the "For agents" section tells it to do. `?format=json` is there
 * because the model that reads this file usually CANNOT SET REQUEST HEADERS —
 * a browsing tool fetches a URL and that is all. Content negotiation via
 * `Accept` is correct and invisible to exactly the audience this file is for, so
 * the query parameter is the discoverable half of the same mechanism.
 */
export async function llmsTxt(opts: {
  site: Site;
  catalog: CatalogSource;
  /** As it arrived, unvalidated. Same rule as `agentView`. */
  askedOrigin?: string | null;
  gatewayBaseUrl: string;
  /** The feed's shop block, when the caller already has it. */
  tagline?: string;
}): Promise<string> {
  const { site, catalog } = opts;
  const storefrontOrigin = storefrontOriginOf(site, opts.askedOrigin);
  const base = opts.gatewayBaseUrl.replace(/\/$/, "");
  const products = await catalog.search({ limit: 50 }).catch((): CatalogProduct[] => []);
  const policies = await catalog.policies().catch((): ShopPolicies => ({}));
  const offers = announceable(site.key);

  const L: string[] = [];
  L.push(`# ${site.name}`, "");
  if (opts.tagline) L.push(`> ${opts.tagline}`, "");
  L.push(
    `This store is transactable by agents. It publishes a UCP profile at ` +
      `${storefrontOrigin}${linkHref}, and an agent can search the catalogue, apply the ` +
      `merchant's live offers, build a cart and open a checkout without a human in the loop. ` +
      `Payment is authorised by the shopper at a link the checkout returns.`,
    "",
  );

  if (products.length) {
    L.push("## Products", "");
    for (const p of products) {
      const url = abs(storefrontOrigin, p.url) ?? storefrontOrigin;
      const cur = (p.currency || "INR").toUpperCase();
      const variants = p.variants
        .filter((v) => v.sku)
        .map((v) => `${v.title} ${cur} ${num(v.price)}${v.availableForSale ? "" : " (out of stock)"}`)
        .join(", ");
      const bits = [p.productType, variants].filter(Boolean).join(". ");
      L.push(`- [${p.title}](${url})${bits ? `: ${bits}` : ""}`);
    }
    L.push("");
  }

  // Offers get their own section rather than being folded into the product
  // lines, because a model summarising a store reads section headings and this
  // is the part the merchant actually approved and wants said.
  if (offers.length) {
    L.push("## Current offers", "");
    for (const o of offers) {
      L.push(
        `- **${o.title}** — ${o.percent}% off, until ${o.endsAt.slice(0, 10)}. ` +
          `Applied automatically when the item is added to a cart. There is no code to enter.`,
      );
    }
    L.push(
      "",
      "The discount is calculated by the store when a cart is created, not here. " +
        "Do not compute a discounted total from the list prices above.",
      "",
    );
  }

  const pol: Array<[string, string | undefined]> = [
    ["Returns", policies.returns],
    ["Shipping", policies.shipping],
    ["Cash on delivery", policies.cod],
  ];
  if (pol.some(([, v]) => v)) {
    L.push("## Policies", "");
    // The merchant's own words, quoted rather than paraphrased. A return policy
    // summarised by a model is a promise the merchant never made.
    for (const [k, v] of pol) if (v) L.push(`- **${k}:** ${v}`);
    L.push("");
  }

  L.push(
    "## For agents",
    "",
    `- [UCP profile](${storefrontOrigin}${linkHref}) — discovery document, UCP ${UCP_VERSION}.`,
    `- MCP endpoint: \`${base}/ucp/${site.key}/mcp\` — JSON-RPC 2.0 over HTTP POST. ` +
      `\`tools/list\` returns the Shopping methods.`,
    "- Any page on this store returns its machine view when fetched with " +
      "`?format=json`, or with an `Accept: application/json` header.",
    "- Reads are open to anyone. Holding stock or taking money requires a " +
      "resolvable `ucp-agent` profile, so identify yourself before calling `create_checkout`.",
    "",
  );

  return L.join("\n");
}
