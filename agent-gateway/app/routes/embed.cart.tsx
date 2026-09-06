import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { allowedOrigin, findSite } from "../lib/sites.server";
import { verifySessionToken } from "../lib/identity.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { jsonFeedContact } from "../lib/orders.server";
import { captureCart, liveCarts, markRecovered, type CaptureLine } from "../lib/carts.server";
import { record } from "../lib/ledger.server";
import fs from "node:fs";
import path from "node:path";

/**
 * Basket capture for custom sites — the missing wire into the recovery loop.
 *
 * Before this route existed, every abandoned basket in CHAPMAN came out of
 * `npm run seed`. The recovery agent was finished and had no input: a shopper
 * could fill a cart on the storefront, close the tab, and nothing anywhere
 * would know it had happened.
 *
 * THREE THINGS THIS ROUTE REFUSES TO TAKE FROM THE BROWSER.
 *
 * 1. A PRICE. A posted line is `{handle, sku, qty}` and there is no field a
 *    price could arrive in — the same rule as `quote.server.ts`. Otherwise a
 *    basket could be inflated in the console into a recovery target worth
 *    chasing, and the margin floor that protects the merchant would be
 *    computed from a number the shopper chose.
 *
 * 2. A PHONE NUMBER OR AN EMAIL. Accepting contact details from a page would
 *    let anyone aim our outreach at somebody else's handset. The page may prove
 *    who it is with a signed session token; resolving that to a way of reaching
 *    them is the merchant's job, done server-to-server. No token means no
 *    contact, which means the recovery agent suppresses the basket as
 *    `no_channel` and says so — the correct outcome, not a gap.
 *
 * 3. AN IDENTITY IT MERELY ASSERTS. `verifySessionToken` or nothing.
 *
 * It is also deliberately quiet on failure. This is a background beacon fired
 * while somebody is shopping, and a shop whose cart page shows an error because
 * our capture endpoint was slow has been made worse by a feature it cannot see.
 * Every path returns a 200-shaped answer the page ignores.
 */

function cors(origin: string | null): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    ...(origin
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-max-age": "86400",
          vary: "Origin",
        }
      : {}),
  };
}

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: cors(origin) });

/**
 * CORS preflight, answered without knowing the site.
 *
 * The site key travels in the POST body and a preflight carries no body, so
 * answering this must not depend on resolving a site — the mistake that made
 * the chat widget fail with `NetworkError` while every curl passed.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  return json({ ok: true, endpoint: "cart", method: "POST" }, 200, origin);
};

/**
 * Unit costs, so a captured basket has a margin and not just a total.
 *
 * Keyed by SKU, which is how `merchant-inputs.json` keys them. Missing is a
 * valid state and means the basket carries no margin — the recovery agent then
 * cannot weigh it against the merchant's floor and leaves it alone, which is
 * the right way to fail.
 */
function unitCosts(): Record<string, number> {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "merchant-inputs.json"), "utf8"),
    ) as { unitCost?: Record<string, number> };
    return raw.unitCost ?? {};
  } catch {
    return {};
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get("Origin");

  let body: {
    site?: string;
    /** The browser's own handle for this basket. Hashed with the site key before storage. */
    ref?: string;
    lines?: unknown;
    session?: string;
    op?: "capture" | "recovered";
    lastStep?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "expected a JSON body" }, 400, origin);
  }

  const site = findSite(body.site ?? null);
  if (!site) return json({ ok: false, error: "unknown site key" }, 404, origin);

  const ok = allowedOrigin(site, origin);
  if (!ok) return json({ ok: false, error: "origin not allowed for this site" }, 403, origin);

  const ref = String(body.ref ?? "").trim().slice(0, 120);
  if (!ref) return json({ ok: false, error: "ref is required" }, 400, ok);

  if (body.op === "recovered") {
    markRecovered(site.key, ref);
    return json({ ok: true }, 200, ok);
  }

  const raw = Array.isArray(body.lines) ? body.lines : [];
  const lines: CaptureLine[] = raw
    .map((l) => l as { handle?: unknown; sku?: unknown; qty?: unknown })
    .filter((l) => typeof l.handle === "string")
    .map((l) => ({
      handle: String(l.handle),
      sku: typeof l.sku === "string" ? l.sku : undefined,
      qty: Number(l.qty ?? 1),
    }));

  // Identity, if the merchant's own site vouched for one. A failed check is not
  // an error: it means the basket is captured anonymously and never written to.
  const verified = verifySessionToken(body.session, { site: site.key, secret: site.secret });
  const sub = verified.ok ? verified.identity.sub : null;

  const contact =
    sub && site.orders?.feedUrl
      ? await jsonFeedContact(site.orders.feedUrl, site.secret, sub)
      : null;

  const res = await captureCart({
    shop: site.key,
    clientRef: ref,
    lines,
    catalog: jsonFeedCatalog(site.catalogFeedUrl),
    sub,
    contact,
    lastStep: typeof body.lastStep === "string" ? body.lastStep.slice(0, 40) : "cart",
    unitCosts: unitCosts(),
  });

  if (!res.ok) {
    record({ shop: site.key, kind: "tool_error", message: `cart capture: ${res.error}` });
    return json({ ok: false, error: res.error }, 200, ok);
  }

  return json(
    {
      ok: true,
      cartId: res.cart.id,
      // Echoed so the storefront can show what the server priced it at, and so
      // a mismatch with the page's own total is visible rather than silent.
      subtotal: res.cart.subtotal,
      currency: res.cart.currency,
      /**
       * Whether this basket could be recovered at all.
       *
       * Told plainly, because it is the honest version of what an abandoned-cart
       * tool usually hides: with nobody signed in there is no way to reach this
       * shopper, and nothing will be sent.
       */
      recoverable: Boolean(sub && (contact?.phone || contact?.email)),
      known: liveCarts(site.key).length,
    },
    200,
    ok,
  );
};
