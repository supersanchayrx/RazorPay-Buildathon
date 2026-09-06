/**
 * Live baskets, captured from a real storefront.
 *
 * Until this file existed, every abandoned basket in CHAPMAN came out of
 * `npm run seed`. The recovery agent was complete and had no input: a shopper
 * could fill a cart on Nilgiri Post, close the tab, and nothing anywhere would
 * know. This is the missing wire between the storefront and the loop.
 *
 * WHY THIS IS A SEPARATE FILE FROM `carts.jsonl`.
 *
 * `npm run seed` REWRITES `data/carts.jsonl` from scratch — that is what makes
 * the fixture deterministic, and `check-history` asserts its exact contents. A
 * live basket written into that file survives until the next seed and then
 * silently disappears, which is the worst kind of data loss: intermittent, and
 * only in the direction that makes the demo look fine. So live rows live here,
 * and readers fold the two together.
 *
 * APPEND-ONLY, FOLDED AT READ TIME.
 *
 * A basket changes as the shopper shops. Rewriting a row in place would mean
 * this file could be read mid-write, and it would throw away the sequence — the
 * useful fact that somebody added a kettle, removed it, and added it again. So
 * every change appends, and `liveCarts()` keeps the LAST row per id. The empty
 * cart is a real state and is recorded as one: it means they cleared it, which
 * is not the same thing as abandoning it, and it is suppressed rather than
 * chased.
 *
 * WHAT THE BROWSER MAY SAY, AND WHAT IT MAY NOT.
 *
 * The same rule as `quote.server.ts`: the client sends WHAT, the server decides
 * everything else. A posted line is `{handle, sku, qty}`. Prices, titles, costs
 * and the margin all come from the catalogue at capture time, so a basket
 * cannot be inflated into a recovery target worth chasing by editing a
 * JavaScript object.
 *
 * And contact is NOT accepted from the browser, ever. A phone number in a POST
 * body is a phone number anyone can put there — capturing it would let a
 * stranger point our outreach at someone else's handset. The browser may prove
 * WHO it is with a signed session token; resolving that `sub` to a way of
 * reaching them is the merchant's job, done server-to-server. No token means no
 * contact, which means recovery suppresses the basket as `no_channel` and says
 * so. That is the correct outcome, not a gap.
 */
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths.server";
import crypto from "node:crypto";
import type { CatalogSource } from "./catalog.server";

/** One captured basket. Shaped to match the seeded rows so readers need no branch. */
export type LiveCart = {
  id: string;
  shop: string;
  ts: string;
  /** Always false. Present rather than absent so a grep for it finds both kinds. */
  synthetic: false;
  source: "storefront";
  customer?: { id: string; phone?: string | null; email?: string | null };
  lines: Array<{
    handle: string;
    title: string;
    sku: string;
    qty: number;
    unitPrice: number;
    unitCost?: number;
    lineTotal: number;
  }>;
  subtotal: number;
  currency: string;
  /** How far they got. `cart` until a checkout starts and tells us otherwise. */
  lastStep: string;
  recovered: boolean;
};

const FILE = dataPath("live-carts.jsonl");

function append(row: LiveCart): boolean {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(row) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function readAll(): LiveCart[] {
  try {
    return fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LiveCart);
  } catch {
    return [];
  }
}

/**
 * The current state of every live basket for one shop.
 *
 * Last row per id wins, and emptied baskets are dropped — a cart with no lines
 * is a shopper who changed their mind before leaving, and there is nothing to
 * remind them of.
 */
export function liveCarts(shop: string): LiveCart[] {
  const latest = new Map<string, LiveCart>();
  for (const row of readAll()) {
    if (row.shop !== shop) continue;
    latest.set(row.id, row);
  }
  return [...latest.values()].filter((c) => c.lines.length > 0);
}

/**
 * A stable id for one browser's basket at one shop.
 *
 * The browser supplies a random handle it keeps in `localStorage`. That handle
 * is hashed with the site key rather than used directly, so the id in our files
 * is not a value a page can also read — and two shops cannot collide on one.
 */
export function cartId(shop: string, clientRef: string): string {
  return (
    "crt_live_" +
    crypto.createHash("sha256").update(`${shop}::${clientRef}`).digest("hex").slice(0, 16)
  );
}

export type CaptureLine = { handle: string; sku?: string; qty: number };

export type CaptureResult =
  | { ok: true; cart: LiveCart }
  | { ok: false; error: string };

/**
 * Price a posted basket from the catalogue and record it.
 *
 * `unitCost` is looked up from merchant inputs when they exist, because the
 * recovery agent's margin floor is meaningless without it — a basket whose
 * margin cannot be computed is one the merchant cannot decide about. It is
 * written into the live row and never leaves the server: the same figure the
 * cortex refuses to project to a shopper.
 */
export async function captureCart(input: {
  shop: string;
  clientRef: string;
  lines: CaptureLine[];
  catalog: CatalogSource;
  /** A VERIFIED sub, or null. Never a value the browser simply asserted. */
  sub?: string | null;
  /** Resolved server-side from the merchant's own records, never from the page. */
  contact?: { phone?: string | null; email?: string | null } | null;
  lastStep?: string;
  /** Keyed by SKU, as `merchant-inputs.json` keys it. */
  unitCosts?: Record<string, number>;
  now?: Date;
}): Promise<CaptureResult> {
  const id = cartId(input.shop, input.clientRef);
  const now = input.now ?? new Date();

  const lines: LiveCart["lines"] = [];
  let subtotal = 0;
  let currency = "INR";

  for (const raw of input.lines.slice(0, 50)) {
    // Quantities are whole units. A fractional qty is refused rather than
    // floored: silently turning 1.5 into 1 is the bug `quote.server.ts` already
    // found once, and it is worse here because nobody is watching a capture.
    if (!Number.isInteger(raw.qty) || raw.qty < 1 || raw.qty > 99) continue;

    const product = await input.catalog.get(String(raw.handle)).catch(() => null);
    if (!product) continue;

    const variant =
      product.variants.find((v) => v.sku === raw.sku) ?? product.variants[0] ?? null;
    if (!variant) continue;

    const unitPrice = Number(variant.price);
    if (!Number.isFinite(unitPrice)) continue;
    currency = product.currency || currency;

    const sku = variant.sku ?? product.handle;
    const unitCost = input.unitCosts?.[sku];
    lines.push({
      handle: product.handle,
      title: product.title,
      sku,
      qty: raw.qty,
      unitPrice,
      ...(typeof unitCost === "number" ? { unitCost } : {}),
      lineTotal: unitPrice * raw.qty,
    });
    subtotal += unitPrice * raw.qty;
  }

  const cart: LiveCart = {
    id,
    shop: input.shop,
    ts: now.toISOString(),
    synthetic: false,
    source: "storefront",
    ...(input.sub
      ? {
          customer: {
            id: input.sub,
            phone: input.contact?.phone ?? null,
            email: input.contact?.email ?? null,
          },
        }
      : {}),
    lines,
    subtotal,
    currency,
    lastStep: input.lastStep ?? "cart",
    recovered: false,
  };

  if (!append(cart)) return { ok: false, error: "could not write the basket" };
  return { ok: true, cart };
}

/**
 * Mark a basket as completed.
 *
 * Called from the settlement path, which is the only place that knows money
 * actually moved. A basket left flagged open after it was bought is a shopper
 * who gets chased for something already sitting in their hallway — the single
 * most embarrassing failure this feature has, and the cheapest to prevent.
 *
 * Appends rather than edits, for the same reason everything else here does: the
 * record that it WAS abandoned and then recovered is worth more than a row that
 * looks like it was never abandoned at all.
 */
export function markRecovered(shop: string, clientRefOrId: string): boolean {
  const id = clientRefOrId.startsWith("crt_live_") ? clientRefOrId : cartId(shop, clientRefOrId);
  const current = liveCarts(shop).find((c) => c.id === id);
  if (!current) return false;
  return append({ ...current, recovered: true, ts: new Date().toISOString() });
}

/** Test seam. */
export function _file(): string {
  return FILE;
}
