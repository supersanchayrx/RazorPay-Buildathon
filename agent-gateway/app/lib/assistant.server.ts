/**
 * The pipeline.
 *
 * ground -> reason -> bound -> log
 *
 * Every integration surface (Shopify App Proxy, the CORS'd embed, and later the
 * agent-readable front) funnels through this one function. Two renderers, one
 * core — and the bounds sit outside the reasoner where they cannot be argued
 * with.
 */
import type { CatalogSource } from "./catalog.server";
import { pickReasoner, type ReasonerResult, type Turn } from "./reasoner.server";
import { route } from "./router.server";
import { checkReply, createStreamGuard, refusalFor, type Violation } from "./bounds.server";
import { announceable } from "./approvals.server";
import type { CatalogProduct } from "./catalog.server";
import { runHarness } from "./harness.server";
import { SHOPPER_TOOLS } from "./tools.server";
import { featureOn, filterShopperTools } from "./featureflags.server";
import { isConfigured } from "./openrouter.server";
import { record } from "./ledger.server";
import { getCortex, shopperView } from "./cortex.server";
import { methodsMentioned } from "./findings.server";
import type { ShopperIdentity } from "./identity.server";
import { learn, recall } from "./memory.server";
import type { Order, OrderSource } from "./orders.server";

export type AssistantResult = {
  reply: string;
  violations: Violation[];
  toolCalls: string[];
  reasoner: string;
  route: string;
  /** Server-resolved cards. The reasoner never emits markup, links or images. */
  cards: Array<{
    handle: string;
    title: string;
    price: string;
    currency: string;
    image: string | null;
    url: string | null;
    inStock: boolean;
  }>;
};

export type AssistantOptions = {
  catalog: CatalogSource;
  shop: string;
  shopName?: string;
  message: string;
  history?: Turn[];
  /** Verified by `identity.server.ts`. Never derived from anything the shopper typed. */
  identity?: ShopperIdentity | null;
  /** Present only when the merchant turned order access on and pointed at a source. */
  orderSource?: OrderSource | null;
};

/**
 * Everything up to the reasoner: ground, route, pre-fetch, scope orders.
 *
 * Shared by the blocking and streaming paths so they cannot diverge. Two
 * pipelines that both claim to enforce the same bounds is how one of them
 * quietly stops.
 */
async function prepare(opts: AssistantOptions) {
  const reasoner = pickReasoner();

  // The shop cortex, projected down to what a shopper-facing surface may know.
  // Margins, floors, order volumes and rejected proposals are not present in
  // this object at all — the assistant cannot leak what it was never handed,
  // which is a stronger guarantee than instructing it not to.
  const cortex = await getCortex({
    site: { key: opts.shop, name: opts.shopName ?? opts.shop },
    catalog: opts.catalog,
  });
  const shop = shopperView(cortex);
  const policies = shop.policies;

  // Client-supplied history is untrusted input, not authority.
  const history = (opts.history ?? []).slice(-12).map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: String(m.content).slice(0, 4000),
  }));

  // Route first, reason second. The router extracts structured arguments and
  // pre-fetches, so a deterministic question never reaches a model and a model
  // that does get invoked arrives with products already in hand.
  const decided = route(opts.message);
  const prefetched =
    decided.kind === "catalog_query" || decided.kind === "open"
      ? await opts.catalog.search(decided.search).catch(() => [])
      : [];

  // Orders are fetched ONLY for a route that asked for them, and only for a
  // verified `sub`. The reasoner receives rows, never a source and an id — so
  // there is no call it could make, or be talked into making, that returns
  // somebody else's orders.
  const wantsOrders = decided.kind === "order_status" || decided.kind === "order_history";
  let orderRows: Order[] = [];
  if (wantsOrders && opts.orderSource && opts.identity) {
    try {
      orderRows = await opts.orderSource.forShopper(opts.identity.sub, 10);
    } catch (e) {
      record({ shop: opts.shop, kind: "tool_error", message: `orders: ${String(e)}` });
    }
  }

  /**
   * What this shop remembers about this person, if it knows who they are.
   *
   * Scoped to (shop, verified sub) inside `recall`, and empty for anybody who
   * is not signed in — an anonymous shopper has no memory to retrieve because
   * none was ever written. Scored against THIS message rather than returned
   * wholesale, so a question about kettles does not drag in what they said
   * about decaf in March.
   *
   * Failure is soft: a memory store that is unreadable costs a slightly less
   * personal reply, and must never cost the reply.
   */
  let memories: string[] = [];
  try {
    // A merchant who switched memory off gets a shop that does not recall.
    // Checked here rather than inside `recall` so the stored rows stay exactly
    // as they were — off withholds them from the conversation, it does not
    // reach into the store, and switching back on restores what was there.
    if (featureOn(opts.shop, "memory")) {
      memories = recall({ shop: opts.shop, sub: opts.identity?.sub, query: opts.message }).map((m) => m.text);
    }
  } catch {
    /* enrichment, never a dependency */
  }

  return {
    reasoner,
    decided,
    shop,
    ctx: {
      shop: opts.shop,
      message: opts.message,
      memories,
      history,
      shopName: shop.name,
      currency: "INR",
      policies,
      catalog: opts.catalog,
      prefetched,
      route: decided,
      voice: shop.voice,
      orders: {
        available: Boolean(opts.orderSource),
        identified: Boolean(opts.identity),
        rows: orderRows,
      },
    },
  };
}

/**
 * Real inventory numbers the catalogue actually returned, so a true stock
 * statement is not mistaken for manufactured scarcity.
 */
function groundedStock(products: ReasonerResult["products"]): number[] {
  const out: number[] = [];
  for (const p of products) {
    if (typeof p.totalInventory === "number") out.push(p.totalInventory);
    for (const v of p.variants) {
      if (typeof v.inventoryQuantity === "number") out.push(v.inventoryQuantity);
    }
  }
  return out;
}

/** Cards are built from catalogue data only — never from anything the reasoner wrote. */
function toCards(products: ReasonerResult["products"]): AssistantResult["cards"] {
  return products.slice(0, 4).map((p) => ({
    handle: p.handle,
    title: p.title,
    price: p.minPrice === p.maxPrice ? p.minPrice : `${p.minPrice}–${p.maxPrice}`,
    currency: p.currency,
    image: p.image,
    url: p.url,
    inStock: (p.totalInventory ?? 0) > 0,
  }));
}

/**
 * One ledger writer for both pipelines.
 *
 * The record of what was said, and what was stopped, must not depend on which
 * transport carried it — a blocked claim that goes unrecorded because it came
 * down a stream is a hole in the only audit trail we have.
 */
function writeLedger(
  opts: AssistantOptions,
  o: {
    reasoner: string;
    decided: ReturnType<typeof route>;
    result: Pick<ReasonerResult, "toolCalls" | "products" | "reply">;
    violations: Violation[];
  },
) {
  if (o.violations.length > 0) {
    for (const v of o.violations) {
      record({
        shop: opts.shop,
        kind: "refusal",
        gate: v.gate,
        message: `blocked: ${v.matched}`,
        detail: { suppressedReply: o.result.reply, userMessage: opts.message, reasoner: o.reasoner },
      });
    }
    return;
  }
  record({
    shop: opts.shop,
    kind: "reply",
    message: opts.message,
    detail: {
      reasoner: o.reasoner,
      route: o.decided.kind,
      because: o.decided.because,
      // Whether we knew who this was, not who it was. The ledger is a record of
      // what the assistant did, and it does not need to become a second copy of
      // the customer list to serve that purpose.
      identified: Boolean(opts.identity),
      identityVia: opts.identity?.via ?? null,
      toolCalls: o.result.toolCalls,
      products: o.result.products.map((p) => p.handle),
    },
  });
}

/**
 * Keep what this turn said about the person, if anything.
 *
 * Called alongside the ledger write and for the same reason: it must happen on
 * BOTH transports, or the widget — which streams — quietly stops learning while
 * every curl and every check keeps working. That exact shape of bug has been
 * shipped here twice already, once for tools and once for bounds.
 *
 * Every gate is inside `learn`: no verified identity means nothing is written,
 * a message with no first-person statement is discarded before any model is
 * involved, and a candidate carrying a price, a stock level, an offer or an
 * order state is refused. So there is nothing to decide here.
 */
function learnFromTurn(opts: AssistantOptions, decided: ReturnType<typeof route>): void {
  // The write half of the same switch. Off means nothing new is remembered,
  // which is the half a merchant is actually asking for when they turn memory
  // off — withholding recall while still collecting would be the worst of both.
  if (!featureOn(opts.shop, "memory")) return;
  try {
    learn({
      shop: opts.shop,
      sub: opts.identity?.sub,
      said: opts.message,
      route: decided.kind,
      source: "chat",
    });
  } catch {
    /* never let bookkeeping break a conversation */
  }
}

/**
 * Whether this turn needs a tool loop.
 *
 * ROUTE FIRST, HARNESS SECOND. The router resolves most messages on its own — a
 * policy question needs one lookup and one sentence, not an agent. Escalating
 * everything would multiply latency and rate-limit burn by four to serve the
 * fraction of traffic that is genuinely compound.
 *
 * The test is not "is this hard" but a much more answerable one: DOES ANSWERING
 * IT REQUIRE COMPOSING TWO TOOLS? Only three shapes do, and each names a pair
 * the single-shot path cannot chain because the second call's arguments come
 * out of the first call's results:
 *
 *   pairing   search → products_that_go_with     "something to go with chai"
 *   totalling search → price_basket              "what would two of those cost"
 *   unrouted  the router could not decide at all, which is its own signal
 *
 * A first version escalated only on the unrouted case, and missed the question
 * that prompted this comment: "a gift under 2000 that goes well with masala
 * chai — what would two cost delivered?" carries a price bound, so the router
 * confidently called it a catalogue query and the single-shot path answered
 * without ever looking for a pairing. Confident and narrow is the failure mode
 * a deterministic router has.
 */
export function wantsHarness(routeKind: string, message: string): boolean {
  if (!isConfigured()) return false;
  const m = message.toLowerCase();

  // Needs the catalogue's own relations, then a second look at what came back.
  const pairing =
    /\b(?:go(?:es)? (?:well )?with|pairs? with|to go with|along ?side|complements?|goes nicely with|what else)\b/.test(m);

  // Needs an exact total, which only `price_basket` can produce — shipping
  // thresholds and approved offers are applied there and nowhere else.
  const totalling =
    /\b(?:what would .{0,40}\bcost|how much (?:would|is|are|for)|altogether|in total|\btotal\b|delivered|including shipping|both of|two of|all three)\b/.test(m);

  if (pairing || totalling) return true;

  // The router could not decide. A bare greeting lands here too, and a tool
  // loop for "hi" would be four model calls to say hello.
  return routeKind === "open" && message.trim().split(/\s+/).length >= 5;
}

/**
 * Run the tool loop, or return null if it is not wanted or produced nothing.
 *
 * SHARED BY BOTH TRANSPORTS, and it has to be. The first version wired the
 * harness into `runAssistant` only, so the widget — which streams — quietly ran
 * a different pipeline from every curl and every check. Two paths that both
 * claim to do the same thing is how one of them stops doing it without anyone
 * noticing, which is the exact failure this file already warns about for
 * bounds.
 */
async function tryHarness(
  opts: AssistantOptions,
  ctx: Awaited<ReturnType<typeof prepare>>["ctx"],
  decided: Awaited<ReturnType<typeof prepare>>["decided"],
): Promise<{ reply: string; toolCalls: string[]; products: CatalogProduct[] } | null> {
  if (!wantsHarness(decided.kind, opts.message)) return null;

  const out = await runHarness({
    shop: opts.shop,
    // The shopper's tool set, minus whatever this shop switched off. A tool
    // the merchant disabled must not be offered to the reasoner at all: given
    // one, a model will call it, and the refusal would arrive as a tool error
    // in the middle of a conversation rather than as a capability that was
    // never advertised.
    tools: filterShopperTools(opts.shop, SHOPPER_TOOLS),
    toolContext: {
      shop: opts.shop,
      shopName: ctx.shopName,
      catalog: opts.catalog,
      // The SCOPED source and the verified sub, or nulls. There is no argument
      // the model can pass that widens this — the narrowing already happened,
      // before the model was involved.
      orders: {
        available: Boolean(opts.orderSource),
        identified: Boolean(opts.identity),
        source: opts.orderSource ?? null,
        sub: opts.identity?.sub ?? null,
      },
    },
    system:
      `You are the shopping assistant on ${ctx.shopName}'s own website. You work for them. ` +
      `Be warm, brief and concrete. Never offer or imply a discount, never invent urgency or a ` +
      `deadline, never assume what a shopper celebrates, and never mention another customer.`,
    message: opts.message,
    history: ctx.history,
  }).catch(() => null);

  if (!out || !out.reply.trim()) return null;
  return {
    reply: out.reply,
    // What the model actually looked up, rather than what the router guessed
    // it would need.
    toolCalls: out.steps.map((s) => `${s.tool}(${JSON.stringify(s.args)})`),
    // Cards still come from the CATALOGUE, never from the model's text.
    products: ctx.prefetched.slice(0, 5),
  };
}

/**
 * A payment failed, and the shop already knows why.
 *
 * Answered here, deterministically, and never handed to a model. The sentence
 * was written by `findings.server.ts` from the incident detector, checked
 * against the bounds layer before it was ever stored, and carries no failure
 * rate and no date — one approved sentence, or nothing.
 *
 * The alternative was tried and failed in the obvious way: the notice was put
 * in the FACTS block with an instruction that it "may be repeated when
 * relevant", and a shopper who said their netbanking payment had just failed
 * was told that payment troubleshooting is handled by the support team. The
 * model was not wrong to be cautious; it simply had no way to know that the
 * sentence in front of it was the answer. Relevance is a routing decision, and
 * routing is not a thing to delegate to whichever free model is up today.
 *
 * Returns null when there is nothing to say, which is the common case: with no
 * live incident this route falls straight through to the reasoner.
 */
function serviceAnswer(
  shop: Awaited<ReturnType<typeof prepare>>["shop"],
  decided: Awaited<ReturnType<typeof prepare>>["decided"],
  message: string,
): { reply: string; toolCalls: string[]; products: CatalogProduct[] } | null {
  if (decided.kind !== "payment_trouble") return null;

  /**
   * Match the notice to what they actually said.
   *
   * A shopper who names no method ("my payment failed") is told about whatever
   * is live. A shopper who names one is told only about THAT one — handing
   * somebody whose card was declined a sentence about netbanking is worse than
   * saying nothing, because it is confidently about the wrong thing. When
   * nothing matches, this returns null and the reasoner answers normally.
   */
  const named = methodsMentioned(message);
  const notice = named.length
    ? shop.serviceNotices.find((n) => n.about.some((a) => named.includes(a)))
    : shop.serviceNotices[0];
  if (!notice) return null;
  return {
    // The notice verbatim, then an offer of the one thing we can actually do.
    // Nothing here is generated, so nothing here can drift.
    reply: `${notice.text} Nothing was charged for an attempt that failed. If you'd like, tell me what you were buying and I'll check it's still there.`,
    toolCalls: ["service_notice()"],
    products: [],
  };
}

export async function runAssistant(opts: AssistantOptions): Promise<AssistantResult> {
  const { reasoner, decided, ctx, shop } = await prepare(opts);

  let result: { reply: string; toolCalls: string[]; products: CatalogProduct[] } | null =
    serviceAnswer(shop, decided, opts.message) ?? (await tryHarness(opts, ctx, decided));

  // No usable answer from the loop falls through to the single-shot path, which
  // falls through again to the deterministic reasoner. Three layers, each
  // simpler and more certain than the one above it.
  if (!result) {
    try {
      result = await reasoner.run(ctx);
    } catch (e) {
      record({ shop: opts.shop, kind: "tool_error", message: String(e) });
      throw e;
    }
  }

  const violations = checkReply(result.reply, {
    groundedStockClaims: groundedStock(result.products),
    // The ONE thing that can make a price claim sayable: an offer this merchant
    // approved, read fresh so a revocation takes effect on the next reply
    // rather than whenever a cache happens to expire.
    approvedOffers: announceable(opts.shop),
  });
  const reply = violations.length ? refusalFor(violations) : result.reply;
  writeLedger(opts, { reasoner: reasoner.name, decided, result, violations });
  learnFromTurn(opts, decided);
  const cards = violations.length ? [] : toCards(result.products);

  return {
    reply,
    violations,
    toolCalls: result.toolCalls,
    reasoner: reasoner.name,
    route: decided.kind,
    cards,
  };
}

/* ------------------------------------------------------------------ *
 * Streaming
 * ------------------------------------------------------------------ */

export type StreamEvent =
  | { type: "meta"; route: string; reasoner: string }
  /** Text that has already passed the bounds check. Safe to display. */
  | { type: "delta"; text: string }
  /** A gate fired. Discard everything shown so far and display this instead. */
  | { type: "replace"; reply: string; gates: string[] }
  | { type: "cards"; cards: AssistantResult["cards"] }
  | { type: "done"; bounded: boolean; gates: string[] };

/**
 * The same pipeline, delivered progressively.
 *
 * The ordering here is the whole point, and it is the opposite of the obvious
 * one. Text is NOT forwarded as it arrives and checked at the end — by then the
 * shopper has read it, and a guarantee enforced after the fact is not a
 * guarantee. Instead the guard holds everything until a sentence completes,
 * runs the full bounds check, and only then releases.
 *
 * So a streaming reasoner and a blocking one are subject to identical bounds.
 * The stream is a delivery detail; it buys no latitude.
 */
export async function* runAssistantStream(
  opts: AssistantOptions,
): AsyncGenerator<StreamEvent> {
  const { reasoner, decided, ctx, shop } = await prepare(opts);
  yield { type: "meta", route: decided.kind, reasoner: reasoner.name };

  /**
   * The tool loop, when this turn needs one.
   *
   * A loop cannot be streamed as it runs — half of what a model emits mid-loop
   * is tool calls, which are not for the shopper to read. So the loop runs to
   * completion and its ANSWER is then pushed through the same guard, sentence
   * by sentence. The shopper waits a little longer before the first word and
   * then sees ordinary streamed text; the widget covers the wait.
   */
  const viaTools = serviceAnswer(shop, decided, opts.message) ?? (await tryHarness(opts, ctx, decided));
  if (viaTools) {
    const guard = createStreamGuard({
      groundedStockClaims: groundedStock(viaTools.products),
      approvedOffers: announceable(opts.shop),
    });
    let stopped: Violation[] = [];
    // Split on sentence ends and keep the delimiter, which is the granularity
    // the guard checks at anyway.
    for (const piece of viaTools.reply.match(/[^.!?\n]+[.!?\n]*/g) ?? [viaTools.reply]) {
      const step = guard.push(piece);
      if (step.violations.length) {
        stopped = step.violations;
        break;
      }
      if (step.release) yield { type: "delta", text: step.release };
    }
    if (!stopped.length) {
      const end = guard.end();
      if (end.violations.length) stopped = end.violations;
      else if (end.release) yield { type: "delta", text: end.release };
    }

    const violations = stopped;
    if (violations.length) {
      yield { type: "replace", reply: refusalFor(violations), gates: violations.map((v) => v.gate) };
    } else if (viaTools.products.length) {
      yield { type: "cards", cards: toCards(viaTools.products) };
    }
    writeLedger(opts, {
      reasoner: `harness+${reasoner.name}`,
      decided,
      result: viaTools,
      violations,
    });
    learnFromTurn(opts, decided);
    yield { type: "done", bounded: violations.length > 0, gates: violations.map((v) => v.gate) };
    return;
  }

  // A reasoner without `stream` is not a problem: run it and emit one chunk.
  // Every surface then behaves the same whether or not the model can stream.
  if (!reasoner.stream) {
    const full = await runAssistant(opts);
    if (full.violations.length) {
      yield { type: "replace", reply: full.reply, gates: full.violations.map((v) => v.gate) };
    } else {
      yield { type: "delta", text: full.reply };
      if (full.cards.length) yield { type: "cards", cards: full.cards };
    }
    yield {
      type: "done",
      bounded: full.violations.length > 0,
      gates: full.violations.map((v) => v.gate),
    };
    return;
  }

  let chunks: AsyncIterable<string>;
  let pending: Promise<ReasonerResult>;
  try {
    ({ chunks, result: pending } = reasoner.stream(ctx));
  } catch (e) {
    record({ shop: opts.shop, kind: "tool_error", message: String(e) });
    throw e;
  }

  // The grounded stock numbers come from the products the reasoner resolved,
  // which are known before any text is released — so "only 3 left" can be
  // judged true or invented at the moment it is about to be shown.
  // A fallback stream cannot settle its final result until it knows whether the
  // primary stream produced anything. That fact is only known after `chunks`
  // has been consumed. Awaiting `pending` first creates a circular wait:
  //
  //   pipeline waits for result -> result waits for chunks -> nobody reads chunks
  //
  // Buffer the model output first, then obtain the catalogue-backed result and
  // run every buffered piece through the same sentence guard. Nothing reaches
  // the shopper before the grounding required to check it is available.
  const buffered: string[] = [];
  for await (const chunk of chunks) buffered.push(chunk);
  const settled = await pending;
  const guard = createStreamGuard({
    groundedStockClaims: groundedStock(settled.products),
    // Identical licence to the blocking path. Streaming must not be a way round
    // a bound, and it must not be a way into a stricter one either.
    approvedOffers: announceable(opts.shop),
  });

  let violations: Violation[] = [];
  for (const chunk of buffered) {
    const step = guard.push(chunk);
    if (step.violations.length) {
      violations = step.violations;
      break;
    }
    if (step.release) yield { type: "delta", text: step.release };
  }

  if (!violations.length) {
    const step = guard.end();
    if (step.violations.length) violations = step.violations;
    else if (step.release) yield { type: "delta", text: step.release };
  }

  // Ledger the text the reasoner actually produced, not the fragment that
  // happened to be released — otherwise a blocked claim is recorded truncated.
  writeLedger(opts, {
    reasoner: reasoner.name,
    decided,
    result: { ...settled, reply: guard.text },
    violations,
  });
  learnFromTurn(opts, decided);

  if (violations.length) {
    yield { type: "replace", reply: refusalFor(violations), gates: violations.map((v) => v.gate) };
  } else {
    const cards = toCards(settled.products);
    if (cards.length) yield { type: "cards", cards };
  }

  yield { type: "done", bounded: violations.length > 0, gates: violations.map((v) => v.gate) };
}
