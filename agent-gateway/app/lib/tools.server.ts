/**
 * The tool registry — the security boundary, written down.
 *
 * TWO REGISTRIES, NOT ONE WITH A PERMISSION FLAG.
 *
 * A single registry serving both surfaces would need a check on every tool
 * asking "is this caller a merchant?", and that check is one forgotten line
 * from handing a storefront visitor the merchant's unit costs — which are their
 * negotiating position, not a product attribute. Two disjoint registries make
 * the separation structural rather than careful. It is the same reasoning that
 * keeps the shop cortex and a shopper's memory in different stores.
 *
 * EVERY TOOL HERE IS A READ.
 *
 * There is no `checkout.start`, no `offer.approve`, no `publish`, no `refund`.
 * That is not an oversight to be filled in later — it is the architecture:
 * reads are tools a reasoner may call freely, while speech and money are
 * CHOKEPOINTS its output merely passes through. A model that can call a tool
 * that moves money is a model you are trusting with money.
 *
 * Because the registry is data, it can be printed. A merchant can read the
 * complete list of things the assistant is able to do, which is a much stronger
 * assurance than any sentence about guardrails.
 */

import type { CatalogSource, CatalogProduct, ShopPolicies } from "./catalog.server";
import type { OrderSource } from "./orders.server";
import { describeOrder } from "./orders.server";
import { buildQuote } from "./quote.server";
import { announceable } from "./approvals.server";

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

export type ToolSpec<C> = {
  name: string;
  /** Read by the model when choosing. This is prompt text, not documentation. */
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  /**
   * Runs the tool. Returns text the model will read as fact.
   *
   * Never throws: a tool that throws mid-loop leaves the harness with a dangling
   * call and no way to continue, so failures come back as readable strings the
   * model can act on ("that product does not exist") instead of as exceptions.
   */
  run: (ctx: C, args: Record<string, unknown>) => Promise<string>;
};

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
});

const money = (n: string | number, cur: string) =>
  (cur === "INR" ? "₹" : cur === "USD" ? "$" : cur + " ") + Number(n).toLocaleString("en-IN");

/**
 * A product as the model may see it.
 *
 * `unitCost` is absent, and its absence is the point — there is no shopper-side
 * tool that returns it, so no prompt injection can ask for it and no model
 * mistake can leak it. The cost lives in `merchant-inputs.json` and only the
 * merchant registry can reach it.
 */
function renderProduct(p: CatalogProduct): string {
  const price =
    p.minPrice === p.maxPrice
      ? money(p.minPrice, p.currency)
      : `${money(p.minPrice, p.currency)}–${money(p.maxPrice, p.currency)}`;
  const stock =
    p.totalInventory === 0
      ? "out of stock"
      : p.totalInventory !== null
        ? `${p.totalInventory} in stock`
        : "stock unknown";
  const variants = p.variants
    .filter((v) => v.sku)
    .map((v) => `${v.sku} "${v.title}" ${money(v.price, v.currency)}${v.availableForSale ? "" : " unavailable"}`)
    .join("; ");
  return `${p.handle} | ${p.title} | ${price} | ${stock}${variants ? ` | variants: ${variants}` : ""}`;
}

const list = (ps: CatalogProduct[]) =>
  ps.length ? ps.map((p) => "- " + renderProduct(p)).join("\n") : "(no matches)";

/* ------------------------------------------------------------------ *
 * Shopper registry
 * ------------------------------------------------------------------ */

export type ShopperToolContext = {
  shop: string;
  shopName: string;
  catalog: CatalogSource;
  /**
   * ALREADY SCOPED to the verified shopper, or null.
   *
   * The harness is handed the scoped source rather than a source plus an id, so
   * there is no argument the model could pass that returns someone else's
   * orders. The narrowing happened before the model was involved.
   */
  orders: { available: boolean; identified: boolean; source: OrderSource | null; sub: string | null };
};

export const SHOPPER_TOOLS: ToolSpec<ShopperToolContext>[] = [
  {
    name: "search_products",
    description:
      "Search this shop's catalogue. Use for any question about what is sold, what something costs, or what is in stock. Prices and stock come back live and are authoritative — never state a price you did not get from here.",
    parameters: obj(
      {
        query: { type: "string", description: "Words to match: product name, type, flavour, tag." },
        price_min: { type: "number", description: "Lowest price, in whole rupees." },
        price_max: { type: "number", description: "Highest price, in whole rupees." },
        in_stock_only: { type: "boolean", description: "Exclude items with no stock." },
        limit: { type: "integer", description: "How many to return. Default 6." },
      },
      [],
    ),
    async run(ctx, a) {
      const found = await ctx.catalog
        .search({
          query: typeof a.query === "string" ? a.query : undefined,
          priceMin: typeof a.price_min === "number" ? a.price_min : undefined,
          priceMax: typeof a.price_max === "number" ? a.price_max : undefined,
          inStockOnly: a.in_stock_only === true,
          limit: Math.min(Number(a.limit) || 6, 12),
        })
        .catch(() => []);
      return list(found);
    },
  },
  {
    name: "get_product",
    description:
      "Full detail for one product by its handle, including every size or variant with its own price, SKU and availability. Use after a search when the shopper is choosing between sizes.",
    parameters: obj({ handle: { type: "string" } }, ["handle"]),
    async run(ctx, a) {
      const p = await ctx.catalog.get(String(a.handle ?? "")).catch(() => null);
      return p ? renderProduct(p) + (p.description ? `\ndescription: ${p.description}` : "") : "No product with that handle.";
    },
  },
  {
    name: "products_that_go_with",
    description:
      "Real products that share tags with the given one. This is retrieval, not persuasion — it returns what the catalogue actually relates, and it is the ONLY basis for suggesting a pairing.",
    parameters: obj({ handle: { type: "string" } }, ["handle"]),
    async run(ctx, a) {
      const also = await ctx.catalog.complements(String(a.handle ?? ""), 3).catch(() => []);
      return list(also);
    },
  },
  {
    name: "get_policies",
    description:
      "The shop's returns, shipping and cash-on-delivery policies, in the merchant's own words. Quote them as written — a reworded return window is a new promise the merchant never made.",
    parameters: obj({}),
    async run(ctx) {
      const p: ShopPolicies = await ctx.catalog.policies().catch(() => ({}) as ShopPolicies);
      const rows = [
        p.returns && `Returns: ${p.returns}`,
        p.shipping && `Shipping: ${p.shipping}`,
        p.cod && `Cash on delivery: ${p.cod}`,
      ].filter(Boolean);
      return rows.length ? rows.join("\n") : "This shop has not published any policies.";
    },
  },
  {
    name: "price_basket",
    description:
      "Price a basket exactly, including shipping and any offer the merchant has approved. Use this whenever the shopper asks what a combination would cost — do NOT add prices up yourself, because shipping thresholds and offers are applied here and only here.",
    parameters: obj(
      {
        items: {
          type: "array",
          items: obj({ handle: { type: "string" }, sku: { type: "string" }, qty: { type: "integer" } }, ["handle", "qty"]),
        },
      },
      ["items"],
    ),
    async run(ctx, a) {
      const items = Array.isArray(a.items)
        ? (a.items as Array<Record<string, unknown>>).map((i) => ({
            handle: String(i.handle ?? ""),
            sku: i.sku ? String(i.sku) : undefined,
            qty: Number(i.qty),
          }))
        : [];
      // No `shop` passed, so this prices against the raw catalogue without
      // subtracting anyone's held stock. It is a quote for a conversation, not
      // a checkout — it reserves nothing and commits nobody.
      const r = await buildQuote({ catalog: ctx.catalog, items, shop: ctx.shop });
      if (!r.ok) return "Could not price that: " + r.problems.map((p) => p.message).join(" ");
      const q = r.quote;
      const lines = q.lines.map((l) => `  ${l.qty}x ${l.title} (${l.sku}) = ${money(l.lineTotal, q.currency)}`);
      const offers = q.offers.map((o) => `  offer applied: ${o.percent}% off ${o.title} = -${money(o.amount, q.currency)}`);
      return [
        ...lines,
        ...offers,
        `  shipping ${money(q.shipping, q.currency)}`,
        `  TOTAL ${money(q.total, q.currency)}`,
      ].join("\n");
    },
  },
  {
    name: "get_my_orders",
    description:
      "The signed-in shopper's own orders. Only works when they are signed in. If it says they are not, ask them to sign in — never ask for an email or phone number to identify them, because anyone can type one.",
    parameters: obj({}),
    async run(ctx) {
      if (!ctx.orders.available) return "This merchant has not connected an order system. You cannot look up any order.";
      if (!ctx.orders.identified || !ctx.orders.source || !ctx.orders.sub) {
        return "This shopper is NOT signed in, so no order can be looked up. Ask them to sign in. Do not ask for an email or phone number.";
      }
      const rows = await ctx.orders.source.forShopper(ctx.orders.sub, 5).catch(() => []);
      return rows.length ? rows.map((o) => "- " + describeOrder(o)).join("\n") : "This shopper has no orders yet.";
    },
  },
  {
    name: "get_live_offers",
    description:
      "Offers the merchant has approved and that are still running. If this returns none, there are NO offers and you must not suggest otherwise. Only a percentage returned here may be stated, exactly as given.",
    parameters: obj({}),
    async run(ctx) {
      const live = announceable(ctx.shop);
      return live.length
        ? live.map((o) => `- ${o.percent}% off ${o.title} until ${o.endsAt}`).join("\n")
        : "There are no approved offers. Do not mention or imply any discount.";
    },
  },
];

/* ------------------------------------------------------------------ *
 * The list, as a merchant can read it
 * ------------------------------------------------------------------ */

/**
 * Every capability, as plain sentences.
 *
 * A merchant can read this and know exactly what the assistant is able to do —
 * a far stronger assurance than a paragraph promising it behaves. The list is
 * generated from the registry itself, so it cannot drift out of date the way a
 * hand-written one would.
 */
export const describeRegistry = <C,>(tools: ToolSpec<C>[]) =>
  tools.map((t) => ({ name: t.name, description: t.description.split(".")[0] + "." }));

export { closeDatabase as _closeDatabase } from "./database.server";
