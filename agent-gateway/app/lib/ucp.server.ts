/**
 * UCP — the agent-readable front.
 *
 * WE DID NOT INVENT A FORMAT. This speaks the Universal Commerce Protocol,
 * version 2026-08-25, the same one every Shopify store already serves at
 * `/.well-known/ucp`. Verified live against allbirds.com and gymshark.com while
 * building this: both advertise `dev.ucp.shopping` over MCP.
 *
 * That decision is the whole point of the feature. A Shopify merchant gets an
 * agent-readable storefront for free, and a custom store gets nothing. CHAPMAN's
 * job is to close exactly that gap — not to define a rival manifest that no
 * shopper's agent would ever have heard of.
 *
 * Three things in the spec turned out to match rules this codebase already had,
 * which is the strongest evidence we were on the right track:
 *
 *   1. `totals`, `currency` and `id` are all marked `ucp_request: "omit"`. The
 *      protocol FORBIDS the client from sending a price. That is
 *      `quote.server.ts`'s "the client sends WHAT, the server decides HOW MUCH"
 *      written into a schema by someone else.
 *
 *   2. `status: "requires_escalation"` with a `continue_url` is a first-class
 *      checkout state. Handing off to the merchant's own payment page is not a
 *      shortfall to apologise for — it is a defined outcome.
 *
 *   3. `meta["ucp-agent"].profile` is mandatory on every call, and the merchant
 *      is expected to FETCH it. Allbirds refuses with `profile_unreachable`
 *      when it cannot. So agent identity is a resolvable document under the
 *      caller's control — weak proof, but a real, loggable one, and better than
 *      the unauthenticated free-for-all we would otherwise have.
 *
 * This file is the wire layer: types, money, identifiers, envelopes, and the
 * discovery document. The business logic lives in `ucpmethods.server.ts`.
 */

import type { CatalogProduct, ShopPolicies } from "./catalog.server";
import type { Site } from "./sites.server";

export const UCP_VERSION = "2026-08-25";
const SPEC = `https://ucp.dev/${UCP_VERSION}`;

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/**
 * ISO 4217 minor-unit exponents.
 *
 * UCP amounts are integers in minor units — 2500 INR-paise is ₹25.00. Getting
 * this wrong is not a rounding bug, it is a factor of one hundred in a real
 * charge, so the exponent is looked up rather than assumed to be 2. Only the
 * currencies this gateway can actually price in are listed; anything else is a
 * currency we have no business quoting.
 */
const MINOR_UNIT_EXPONENT: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  SGD: 2,
  JPY: 0,
};

export function toMinor(amountMajor: number, currency: string): number {
  const exp = MINOR_UNIT_EXPONENT[currency.toUpperCase()];
  if (exp === undefined) {
    throw new Error(`no minor-unit exponent known for currency ${currency}`);
  }
  // Round, never truncate. Truncating loses a paise per line and the totals
  // stop reconciling against Razorpay, which charges the rounded figure.
  return Math.round(amountMajor * 10 ** exp);
}

export const price = (amountMajor: number, currency: string) => ({
  amount: toMinor(amountMajor, currency),
  currency: currency.toUpperCase(),
});

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

/**
 * UCP asks for a "Global ID (GID)" per product and variant. Ours are derived
 * from the handle and SKU the merchant already uses, so nothing new has to be
 * stored and an id is legible to the merchant reading a log.
 *
 * `parseId` also accepts a bare handle or SKU, which the spec explicitly
 * permits ("MAY support secondary identifiers"). Agents paste what they were
 * given; refusing a plain SKU would be pedantry that costs a sale.
 */
export const productGid = (handle: string) => `gid://chapman/Product/${handle}`;
export const variantGid = (sku: string) => `gid://chapman/Variant/${sku}`;

export type ParsedId =
  | { kind: "product"; value: string }
  | { kind: "variant"; value: string }
  | { kind: "unknown"; value: string };

export function parseId(raw: string): ParsedId {
  const m = /^gid:\/\/chapman\/(Product|Variant)\/(.+)$/.exec(raw.trim());
  if (m) return { kind: m[1] === "Product" ? "product" : "variant", value: m[2] };
  // Not one of ours. Let the caller try it as both a handle and a SKU rather
  // than guessing here on the shape of the string.
  return { kind: "unknown", value: raw.trim() };
}

/* ------------------------------------------------------------------ *
 * The `ucp` envelope every response carries
 * ------------------------------------------------------------------ */

type Registry = Record<string, Array<Record<string, unknown>>>;

const capability = (name: string, schema: string, extra: Record<string, unknown> = {}) => ({
  version: UCP_VERSION,
  spec: `${SPEC}/specification/${name}`,
  schema: `${SPEC}/schemas/shopping/${schema}.json`,
  ...extra,
});

/**
 * Capabilities we actually implement. Advertising one we do not honour is worse
 * than advertising nothing: an agent will compose a request against it, and the
 * failure surfaces halfway through a purchase instead of at discovery.
 *
 * `dev.ucp.shopping.discount` is deliberately ABSENT until the offer proposer
 * ships. There is currently no way for a discount to exist in this system —
 * `bounds.server.ts` blocks every price claim precisely because no approval
 * store backs one — so claiming the capability would be a lie told in JSON.
 */
export function capabilities(): Registry {
  return {
    "dev.ucp.shopping.cart": [capability("cart", "cart")],
    "dev.ucp.shopping.checkout": [capability("checkout", "checkout")],
    "dev.ucp.shopping.order": [capability("order", "order")],
    "dev.ucp.shopping.catalog.search": [capability("catalog", "catalog_search")],
    "dev.ucp.shopping.catalog.lookup": [capability("catalog", "catalog_lookup")],
  };
}

/**
 * Payment handlers, advertised only when the merchant has actually configured
 * keys. A store with no Razorpay credentials advertises none, which tells an
 * agent to expect escalation rather than letting it discover the same fact by
 * failing at the last step.
 *
 * Razorpay is registered under a reverse-domain name we control. Shopify
 * advertises `com.google.pay` and `dev.shopify.card` the same way; UPI is not
 * in that list and never will be, which is the gap this handler exists to fill.
 */
export function paymentHandlers(site: Site): Registry {
  if (!site.razorpay) return {};
  return {
    "in.razorpay.checkout": [
      {
        id: "razorpay",
        version: "2026-09-05",
        spec: "https://razorpay.com/docs/api/orders/",
        config: {
          // Methods Razorpay will present. UPI is the reason this handler
          // exists: it is a redirect to the payer's own banking app, so it can
          // never be completed by an agent holding a token. The escalation
          // path is a property of Indian rails, not a limitation of ours.
          payment_methods: ["upi", "card", "netbanking", "wallet"],
          requires_buyer_presence: true,
        },
      },
    ],
  };
}

/** The `ucp` block on a successful cart or catalog response. */
export function okEnvelope(extra: Record<string, unknown> = {}) {
  return { version: UCP_VERSION, status: "success", capabilities: capabilities(), ...extra };
}

/** Checkout responses additionally REQUIRE `payment_handlers` — schema-enforced. */
export function checkoutEnvelope(site: Site) {
  return {
    version: UCP_VERSION,
    status: "success",
    capabilities: capabilities(),
    payment_handlers: paymentHandlers(site),
  };
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * Severity is not decoration — it tells the agent what to do next, and the spec
 * ties it to checkout status: anything `requires_*` contributes to
 * `requires_escalation`.
 *
 *   recoverable            change the request and retry (out of stock, bad qty)
 *   requires_buyer_input   a human must supply something we cannot ask for
 *   requires_buyer_review  a human must authorise before the order is placed
 *   unrecoverable          nothing here to act on; start over
 */
export type Severity =
  | "recoverable"
  | "requires_buyer_input"
  | "requires_buyer_review"
  | "unrecoverable";

export type UcpMessage = {
  type: "error" | "warning" | "info";
  code?: string;
  path?: string;
  content: string;
  content_type?: "plain" | "markdown";
  severity?: Severity;
};

export const errorMessage = (
  code: string,
  content: string,
  severity: Severity,
  path?: string,
): UcpMessage => ({ type: "error", code, content, severity, ...(path ? { path } : {}) });

export function errorResponse(
  code: string,
  content: string,
  severity: Severity,
  continueUrl?: string,
) {
  return {
    ucp: { version: UCP_VERSION, status: "error", capabilities: capabilities() },
    messages: [errorMessage(code, content, severity)],
    ...(continueUrl ? { continue_url: continueUrl } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Agent identity
 * ------------------------------------------------------------------ */

export type AgentIdentity = {
  /** The profile URL the caller claimed. */
  profile: string;
  /** Host of that URL — what we log, and what a rate limit would key on. */
  host: string;
  /** True when the document was fetched and parsed as a UCP profile. */
  verified: boolean;
  reason?: string;
};

const agentCache = new Map<string, { at: number; identity: AgentIdentity }>();
const AGENT_TTL_MS = 10 * 60_000;

/**
 * Resolve the calling agent's profile document.
 *
 * This is the only identity an agent has in UCP, and it is worth being precise
 * about what it proves: that whoever is calling controls, or can at least
 * reach, a URL serving a UCP profile. It is not authentication. It does not
 * bind the agent to a person, and a determined caller can stand one up in a
 * minute.
 *
 * What it IS good for: attribution and rate limiting. Every action taken
 * against a merchant is stamped with a host we can name in the ledger, and an
 * abusive caller has something we can block that costs them more than rotating
 * an IP. Allbirds enforces it strictly enough to refuse `search_catalog`
 * outright, so being lenient here would make us the softer target.
 *
 * Failure to fetch is NOT fatal for reads — a catalogue search is public
 * information and refusing it protects nothing. It is fatal for anything that
 * holds stock or moves money, which `ucpmethods.server.ts` enforces.
 */
export async function resolveAgent(meta: unknown): Promise<AgentIdentity | null> {
  const profile = (meta as { "ucp-agent"?: { profile?: string } } | null)?.["ucp-agent"]?.profile;
  if (!profile || typeof profile !== "string") return null;

  let host: string;
  try {
    const u = new URL(profile);
    // Only over HTTP(S). A `file://` or `data:` profile would have us reading
    // our own disk on a stranger's instruction.
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return { profile, host: u.host, verified: false, reason: "profile must be http(s)" };
    }
    host = u.host;
  } catch {
    return { profile, host: "", verified: false, reason: "profile is not a URL" };
  }

  const hit = agentCache.get(profile);
  if (hit && Date.now() - hit.at < AGENT_TTL_MS) return hit.identity;

  let identity: AgentIdentity;
  try {
    // Bounded: an agent profile that takes longer than this to serve is not one
    // we should keep a merchant's request waiting on.
    const res = await fetch(profile, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      identity = { profile, host, verified: false, reason: `profile returned ${res.status}` };
    } else {
      const doc = (await res.json()) as { ucp?: { version?: string } };
      identity = doc?.ucp?.version
        ? { profile, host, verified: true }
        : { profile, host, verified: false, reason: "not a UCP profile document" };
    }
  } catch (e) {
    identity = {
      profile,
      host,
      verified: false,
      reason: e instanceof Error ? e.message : "profile unreachable",
    };
  }

  agentCache.set(profile, { at: Date.now(), identity });
  return identity;
}

/** Test seam: clears the profile cache so a check can vary the same URL. */
export function _resetAgentCache(): void {
  agentCache.clear();
}

/* ------------------------------------------------------------------ *
 * Catalogue mapping
 * ------------------------------------------------------------------ */

/**
 * One of our catalogue products as a UCP product.
 *
 * `inventoryQuantity` is deliberately NOT published. UCP has a place for
 * availability as a boolean and a status, and that is all an agent needs to
 * decide whether to add to cart. An exact on-hand count is a merchant's
 * business intelligence — competitors read agent-readable endpoints too — and
 * publishing it would also hand a shopper-facing agent the raw material for
 * "only 3 left!", which is the one sentence this whole system exists to stop
 * being said without grounds.
 */
export function toUcpProduct(p: CatalogProduct): Record<string, unknown> {
  const cur = (p.currency || "INR").toUpperCase();

  // Catalogue prices arrive as strings, because that is how both Shopify and a
  // JSON feed hand them over. Parse once, here, rather than letting a string
  // that looks like a number travel any further into money code.
  const num = (s: string) => {
    const n = Number(String(s).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  // A variant with no SKU cannot be ordered — every downstream step, from the
  // quote to the stock hold to the Razorpay receipt, is keyed on it. Publishing
  // one would advertise something an agent could add to a cart and never buy.
  const variants = p.variants.filter((v) => v.sku);

  return {
    id: productGid(p.handle),
    handle: p.handle,
    title: p.title,
    description: { plain: p.description ?? "" },
    ...(p.url ? { url: p.url } : {}),
    price_range: { min: price(num(p.minPrice), cur), max: price(num(p.maxPrice), cur) },
    ...(p.tags?.length ? { tags: p.tags } : {}),
    ...(p.image ? { media: [{ type: "image", url: p.image }] } : {}),
    variants: variants.map((v) => ({
      id: variantGid(v.sku as string),
      sku: v.sku,
      handle: p.handle,
      title: v.title,
      description: { plain: p.description ?? "" },
      price: price(num(v.price), (v.currency || cur).toUpperCase()),
      ...(p.url ? { url: p.url } : {}),
      availability: {
        available: Boolean(v.availableForSale),
        status: v.availableForSale ? "in_stock" : "out_of_stock",
      },
    })),
  };
}

/**
 * Merchant policies as UCP policy objects.
 *
 * These ride on cart, checkout and order responses so a shopper's agent can
 * answer "can I return this?" from the merchant's own words rather than from a
 * language model's impression of what a tea shop's returns policy probably
 * says. Same principle as the assistant: quote the merchant, do not paraphrase
 * them into a promise they never made.
 */
export function toUcpPolicies(policies: ShopPolicies): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (policies.returns) {
    out.push({ type: "dev.ucp.shopping.policy.return", description: { plain: policies.returns } });
  }
  if (policies.shipping) {
    out.push({
      type: "dev.ucp.shopping.policy.fulfillment",
      description: { plain: policies.shipping },
    });
  }
  if (policies.cod) {
    out.push({ type: "in.chapman.policy.cod", description: { plain: policies.cod } });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

/**
 * The document a merchant serves at `/.well-known/ucp`.
 *
 * It must live on the MERCHANT'S origin, not ours — an agent told to shop at
 * nilgiripost.example looks there and nowhere else. So the merchant's entire
 * integration is to make that one path return this, which is a proxy handler of
 * about fifteen lines in whatever language their store is written in.
 *
 * `endpoint` then points back here, and every subsequent call is ours to
 * answer. One file on their side; the protocol on ours.
 */
export function discoveryDocument(site: Site, gatewayBaseUrl: string) {
  const base = gatewayBaseUrl.replace(/\/$/, "");
  return {
    ucp: {
      version: UCP_VERSION,
      status: "success",
      services: {
        "dev.ucp.shopping": [
          {
            version: UCP_VERSION,
            spec: `${SPEC}/specification/overview/`,
            transport: "mcp",
            endpoint: `${base}/ucp/${site.key}/mcp`,
            schema: `${SPEC}/services/shopping/mcp.openrpc.json`,
          },
        ],
      },
      capabilities: capabilities(),
      payment_handlers: paymentHandlers(site),
    },
  };
}
