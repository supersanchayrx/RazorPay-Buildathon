/**
 * The reasoner seam.
 *
 * This is the ONLY place an LLM is allowed to live. Catalogue reads, routing,
 * bounds and the ledger have no dependency on it — which is the point: a bound
 * that lives inside the reasoner is not a bound.
 *
 * `stubReasoner` is deterministic and needs no model. It exists so the whole
 * pipeline — transport, auth, catalogue, routing, bounds, ledger — is verifiable
 * before any model is wired, and so that when one is, a failure is unambiguously
 * the model's.
 *
 * Adding your own reasoner:
 *   - if it does tool calling, use `ctx.catalog` directly and ignore `prefetched`
 *   - if it does not, `prefetched` already holds the products the router found,
 *     so you can prompt in one round trip
 * Either way, return text. What happens to that text is not yours to decide —
 * it goes through `bounds` and the ledger on the way to the shopper.
 */
import type { CatalogProduct, CatalogSource, ShopPolicies } from "./catalog.server";
import { route, type Route } from "./router.server";
import { describeOrder, type Order } from "./orders.server";
import { isConfigured, openRouterReasoner, withFallback } from "./openrouter.server";

export type Turn = { role: "user" | "assistant"; content: string };

export type ReasonerContext = {
  /** Public site key, used to attribute provider failures to the right shop. */
  shop?: string;
  message: string;
  history: Turn[];
  shopName: string;
  currency: string;
  policies: ShopPolicies;
  /** For tool-calling reasoners. */
  catalog: CatalogSource;
  /** For retrieve-then-prompt reasoners — the router already ran. */
  prefetched: CatalogProduct[];
  route: Route;

  /**
   * How this shop sounds, in the merchant's own words. Style only.
   *
   * It can change the register of a sentence and nothing else — every bound
   * still applies, and a voice note asking for urgency buys none. The cortex
   * has always been able to hold this; until there was somewhere to type it, it
   * was always null.
   */
  voice?: string | null;

  /**
   * What this shop remembers about the signed-in shopper, if anyone is.
   *
   * Deliberately NOT part of the FACTS block. FACTS are things fetched a moment
   * ago and framed as "the only things you know, quote them as written"; a
   * memory is none of those — it is weeks old, it may be wrong, and quoting one
   * as a fact is the failure this whole feature has to avoid. It supplies the
   * QUESTION ("still after something low-caffeine?") and the tools supply the
   * answer. Empty for anonymous shoppers, always.
   */
  memories?: string[];


  /**
   * The verified shopper's orders, or null.
   *
   * Null covers three different situations and the reply differs for each:
   * nobody is signed in, the merchant has not connected a source, or the
   * lookup failed. The reasoner is handed the ALREADY-SCOPED result rather than
   * a source plus an id, so there is no call it could make that returns someone
   * else's orders.
   */
  orders: {
    available: boolean;
    identified: boolean;
    rows: Order[];
  };
};

export type ReasonerResult = {
  reply: string;
  toolCalls: string[];
  products: CatalogProduct[];
};

export interface Reasoner {
  readonly name: string;
  run(ctx: ReasonerContext): Promise<ReasonerResult>;
  /**
   * Optional. A reasoner that can emit text progressively implements this; one
   * that cannot simply omits it and the pipeline falls back to sending the
   * whole reply as a single chunk.
   *
   * Yielding text does NOT mean the shopper sees it. Everything yielded goes
   * through `createStreamGuard`, which releases only at checked sentence
   * boundaries — so a streaming reasoner gains no ability to route around the
   * bounds that a blocking one lacks.
   */
  stream?(ctx: ReasonerContext): {
    /** Text as it is produced. */
    chunks: AsyncIterable<string>;
    /**
     * The finished result — tool calls and the products the reply refers to.
     * Separate from the chunks because cards are built from catalogue data, not
     * from anything the model wrote, so the pipeline needs the products even
     * though it never needs the model to name them.
     */
    result: Promise<ReasonerResult>;
  };
}

/* ------------------------------------------------------------------ */

const sym = (cur: string) => (cur === "INR" ? "₹" : cur === "USD" ? "$" : cur + " ");
const money = (n: string | number, cur: string) => sym(cur) + Number(n).toLocaleString("en-IN");

function describe(p: CatalogProduct): string {
  const price =
    p.minPrice === p.maxPrice
      ? money(p.minPrice, p.currency)
      : `${money(p.minPrice, p.currency)}–${money(p.maxPrice, p.currency)}`;
  const stock =
    p.totalInventory === 0
      ? " (out of stock)"
      : p.totalInventory !== null && p.totalInventory <= 5
        ? ` (only ${p.totalInventory} left)`
        : "";
  return `${p.title} — ${price}${stock}`;
}

/**
 * A deterministic stand-in for a reasoning model.
 *
 * Not smart, and not meant to be. It answers exactly what the router could
 * establish and declines to invent the rest.
 */
export const stubReasoner: Reasoner = {
  name: "stub",
  async run(ctx) {
    const toolCalls: string[] = [];
    const msg = ctx.message.trim();

    // Test affordance: `echo: <text>` returns <text> verbatim, so the bounds
    // layer can be exercised with a reply the stub would never produce itself.
    if (/^echo:/i.test(msg)) {
      return { reply: msg.replace(/^echo:\s*/i, ""), toolCalls, products: [] };
    }

    switch (ctx.route.kind) {
      case "policy_returns":
        if (ctx.policies.returns) return { reply: ctx.policies.returns, toolCalls, products: [] };
        break;
      case "policy_shipping":
        if (ctx.policies.shipping) return { reply: ctx.policies.shipping, toolCalls, products: [] };
        break;
      case "policy_cod":
        if (ctx.policies.cod) return { reply: ctx.policies.cod, toolCalls, products: [] };
        break;
      case "order_status":
      case "order_history": {
        toolCalls.push("orders.forShopper(<verified>)");
        if (!ctx.orders.available) {
          return {
            reply:
              `I can't look up orders for ${ctx.shopName} — they haven't connected their order system to me yet. ` +
              `Their team can help with that directly. I can answer anything about the catalogue.`,
            toolCalls,
            products: [],
          };
        }
        if (!ctx.orders.identified) {
          // Deliberately does not ask for an email. Asking would teach the
          // shopper that typing one works, and the whole point is that it does
          // not — an identifier a stranger can type is not an identity.
          return {
            reply:
              `I can only pull up an order once you're signed in to ${ctx.shopName} — that way I know it's yours. ` +
              `Sign in and ask me again, and I'll have it. Anything about the catalogue I can answer right now.`,
            toolCalls,
            products: [],
          };
        }
        if (ctx.orders.rows.length === 0) {
          return {
            reply: `I can see your account, but there are no orders on it yet.`,
            toolCalls,
            products: [],
          };
        }
        if (ctx.route.kind === "order_status") {
          const latest = ctx.orders.rows[0];
          const more =
            ctx.orders.rows.length > 1
              ? `\n\nYou have ${ctx.orders.rows.length - 1} earlier order${ctx.orders.rows.length > 2 ? "s" : ""} too — say “my past orders” for those.`
              : "";
          return {
            reply: `Your most recent order:\n• ${describeOrder(latest)}${more}`,
            toolCalls,
            products: [],
          };
        }
        const shown = ctx.orders.rows.slice(0, 5);
        return {
          reply:
            `Your last ${shown.length} order${shown.length > 1 ? "s" : ""}:\n` +
            shown.map((o) => "• " + describeOrder(o)).join("\n"),
          toolCalls,
          products: [],
        };
      }
      case "discount_request":
        return {
          reply:
            `${ctx.shopName} sets its own prices and I can't change them or apply a code. ` +
            `I can help you find something within a budget though — tell me what you'd like to spend.`,
          toolCalls,
          products: [],
        };
      default:
        break;
    }

    const { search } = ctx.route;
    toolCalls.push(
      `catalog.search(${JSON.stringify({
        q: search.query ? "…" : undefined,
        priceMin: search.priceMin,
        priceMax: search.priceMax,
        inStockOnly: search.inStockOnly,
        sort: search.sort,
      })})`,
    );

    let products = ctx.prefetched;

    // Only fall back to browsing when the shopper named nothing at all — and
    // carry every filter they DID state. Dropping them here silently discards
    // a stated preference: "the most expensive item" fell through to browse and
    // came back in catalogue order, sort and all.
    if (products.length === 0 && !search.priceMin && !search.priceMax) {
      const bare = search.query ?? "";
      if (bare.split(/\s+/).filter(Boolean).length <= 2) {
        toolCalls.push("catalog.search(browse)");
        products = await ctx.catalog.search({
          ...search,
          query: undefined,
          inStockOnly: true,
          limit: 6,
        });
      }
    }

    if (products.length === 0) {
      const bound =
        search.priceMax !== undefined
          ? ` under ${money(search.priceMax, ctx.currency)}`
          : search.priceMin !== undefined
            ? ` over ${money(search.priceMin, ctx.currency)}`
            : "";
      return {
        reply: `I couldn't find anything matching that${bound}. Ask me about what ${ctx.shopName} does stock and I'll tell you.`,
        toolCalls,
        products: [],
      };
    }

    const shown = products.slice(0, 5);
    // Say what is on screen. "Found 8:" above a list of five is a small lie,
    // and an assistant that miscounts in the first sentence has spent the
    // credibility it needs for the price it quotes in the second.
    const more = products.length > shown.length ? ` (top ${shown.length} of ${products.length})` : "";

    let head: string;
    if (search.priceMin !== undefined && search.priceMax !== undefined) {
      head = `Between ${money(search.priceMin, ctx.currency)} and ${money(search.priceMax, ctx.currency)}${more}:`;
    } else if (search.priceMax !== undefined) {
      head = `Under ${money(search.priceMax, ctx.currency)}${more}:`;
    } else if (search.priceMin !== undefined) {
      head = `Over ${money(search.priceMin, ctx.currency)}${more}:`;
    } else if (shown.length === 1) {
      head = "Found one:";
    } else {
      head = more ? `Top ${shown.length} of ${products.length}:` : `Found ${shown.length}:`;
    }
    const lines = shown.map((p) => "• " + describe(p));

    // Cross-sell is retrieval, not persuasion: real, in-stock products that
    // share tags with the one the shopper is looking at. No urgency, no
    // discount, nothing the catalogue cannot support.
    if (shown.length === 1) {
      toolCalls.push(`catalog.complements(${shown[0].handle})`);
      const also = await ctx.catalog.complements(shown[0].handle, 2);
      if (also.length) {
        lines.push("", "People pair it with:", ...also.map((p) => "• " + describe(p)));
        return { reply: [head, ...lines].join("\n"), toolCalls, products: [...shown, ...also] };
      }
    }

    return { reply: [head, ...lines].join("\n"), toolCalls, products: shown };
  },
};

/**
 * The stub has nothing to stream — it computes its whole answer at once — so
 * this paces the finished text out in word-sized pieces.
 *
 * That is a TEST FIXTURE, not a capability, and it is labelled as one for the
 * same reason seeded orders carry `synthetic: true`: it exists so the streaming
 * transport, the guard's boundary logic and the widget can all be verified
 * before a real model arrives, and so that when one does, a failure is
 * unambiguously the model's. Delete this and the interface is unchanged.
 */
async function* pace(text: string): AsyncIterable<string> {
  const pieces = text.match(/\S+\s*|\s+/g) ?? [text];
  for (const p of pieces) {
    yield p;
    await new Promise((r) => setTimeout(r, 18));
  }
}

stubReasoner.stream = function (ctx) {
  const pending = this.run(ctx);
  return {
    chunks: (async function* () {
      yield* pace((await pending).reply);
    })(),
    result: pending,
  };
};

/**
 * Which reasoner answers a shopper.
 *
 * A model when one is configured, ALWAYS with the deterministic reasoner
 * underneath it. Free tiers have daily caps and rate limits and they will be
 * hit — probably mid-demo — and a shopper who gets a plainer but true answer
 * has had a worse experience, while one who gets an error has had no experience
 * at all.
 *
 * With no key configured this returns `stubReasoner` unchanged, so a
 * deployment without a model is a complete product rather than a broken one.
 */
export function pickReasoner(): Reasoner {
  if (!isConfigured()) return stubReasoner;
  return withFallback(openRouterReasoner(), stubReasoner);
}

export { route };
