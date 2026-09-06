import type { LoaderFunctionArgs } from "react-router";
import { findSite } from "../lib/sites.server";
import { verifyRecoveryToken } from "../lib/identity.server";
import { liveCarts } from "../lib/carts.server";
import fs from "node:fs";
import path from "node:path";

/**
 * What was in the basket, so the merchant's storefront can put it back.
 *
 * A recovery message that points at a product page is honest and leaves the
 * shopper to add everything again — one avoidable step between them and the
 * thing we just asked them to do. This closes it: the storefront proxies
 * `/restore/<token>`, gets the lines back, and merges them into whatever cart
 * the browser is holding.
 *
 * THREE PROPERTIES, EACH DELIBERATE.
 *
 * 1. NO PRICES. The response is `{handle, sku, qty}` — exactly the shape the
 *    storefront cart can hold, and exactly the shape it posts back. A restore
 *    endpoint that returned totals would be the single place a price could
 *    creep into a cart that is otherwise structurally unable to hold one.
 *
 * 2. THE SAME AUTHORITY AS THE ASK PAGE, AND NO MORE. It takes the same signed
 *    recovery token, checks the same customer match, and shows the same one
 *    basket. It is not a login, it mints no session, and it reveals nothing
 *    about the person beyond what they already had in their hands.
 *
 * 3. IT IS A GET THAT CHANGES NOTHING. Restoring is the browser's business.
 *    Nothing here writes, so a link followed twice, prefetched by a mail
 *    client, or opened by a scanner has no effect at all.
 */

type CartRow = {
  id: string;
  customer?: { id: string };
  lines: Array<{ handle: string; sku: string; qty: number }>;
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // One person's basket. Nothing in between may keep a copy.
      "cache-control": "no-store, private",
    },
  });

function readCart(shop: string, cartId: string): CartRow | null {
  const live = liveCarts(shop).find((c) => c.id === cartId);
  if (live) return live as CartRow;
  try {
    return (
      fs
        .readFileSync(path.join(process.cwd(), "data", "carts.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as CartRow)
        .find((c) => c.id === cartId) ?? null
    );
  } catch {
    return null;
  }
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const site = findSite(params.site ?? null);
  if (!site) return json({ error: "unknown shop" }, 404);

  const v = verifyRecoveryToken(params.token, { site: site.key, secret: site.secret });
  if (!v.ok) return json({ error: v.reason === "expired" ? "expired" : "invalid" }, 403);

  const cart = readCart(site.key, v.claim.cart);
  if (!cart) return json({ error: "no such basket" }, 404);
  // The token names a customer and so does the basket. They must agree, or a
  // token minted for one basket has been pointed at another.
  if (cart.customer?.id && cart.customer.id !== v.claim.sub) {
    return json({ error: "invalid" }, 403);
  }

  return json(
    {
      cart: cart.id,
      lines: cart.lines.map((l) => ({ handle: l.handle, sku: l.sku, qty: l.qty })),
    },
    200,
  );
};
