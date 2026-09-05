/**
 * The reasoning model, behind the seam.
 *
 * OpenRouter is OpenAI-compatible, so this is plain `fetch` — no SDK, no new
 * dependency, and nothing to keep in step with someone else's release cadence.
 *
 * THREE MODELS, NOT ONE, because there are three different jobs:
 *
 *   assistant  a shopper's message plus products the router already fetched,
 *              turned into two sentences. Grounded rewriting, not reasoning.
 *              Latency is visible to a human, so this one is small and fast.
 *   analyst    the weekly offer digest: read ~3 KB of candidates, pick three,
 *              write the case. Runs once a week and nobody is watching, so it
 *              can be slow and careful.
 *   grader     yes/no classification. A 550B model for a binary decision is
 *              pure latency tax.
 *
 * WHAT THE MODEL IS NOT TRUSTED WITH, and this is the whole architecture:
 *
 * Every price, every stock figure, every order and every total in the prompt is
 * already true — fetched by the router from the catalogue. The model's job is
 * to say them well. It cannot look anything up, cannot compute a discount, and
 * cannot reach the checkout. Whatever it returns goes through `bounds` and the
 * ledger before a shopper sees a word of it.
 *
 * So the system prompt below is a BELT. `bounds.server.ts` is the braces. A
 * bound that lives inside the reasoner is not a bound, and a prompt that says
 * "never invent a discount" is a request, not a guarantee.
 */

import type { Reasoner, ReasonerContext, ReasonerResult } from "./reasoner.server";
import type { CatalogProduct } from "./catalog.server";
import { describeOrder } from "./orders.server";
import { secret } from "./env.server";
import { record } from "./ledger.server";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * A CHAIN PER JOB, NOT A MODEL PER JOB.
 *
 * Measured, not assumed: `npm run probe:models` asked twelve free models to say
 * one word, and SIX WERE DOWN — rate-limited upstream, right then, on a quiet
 * afternoon. A single model id as a default would mean the assistant is broken
 * half the time for reasons nobody can see.
 *
 * So each job is an ordered list, tried in turn. The first that answers wins,
 * and if none do, the deterministic reasoner takes over. Order is by measured
 * latency and output cleanliness, not by parameter count.
 *
 * `openrouter/free` sits LAST in each chain and only there. It picks a free
 * model at random, which destroys reproducibility — but a random answer beats
 * no answer, and by the time we reach it every deliberate choice has failed.
 */
const chain = (name: string, fallbacks: string[]): string[] => {
  const override = secret(name);
  return override ? [override, ...fallbacks] : fallbacks;
};

export const MODELS = {
  // Clean, fast, instruction-tuned. Latency here is watched by a human.
  assistant: () =>
    chain("OPENROUTER_MODEL_ASSISTANT", [
      "google/gemma-4-26b-a4b-it:free",
      "minimax/minimax-m3:free",
      "google/gemma-4-31b-it:free",
      "openrouter/free",
    ]),
  // Weekly, unwatched, and the output is read by a merchant before they act on
  // it — so slow and careful is the right trade. The 550B model took twenty
  // seconds to say one word, which is fine once a week and absurd in a chat.
  analyst: () =>
    chain("OPENROUTER_MODEL_ANALYST", [
      // INSTRUCT MODELS FIRST, even though the analyst's job is the one that
      // most rewards reasoning. A reasoning model cannot drive a tool loop:
      // given a prose escape hatch, glm-5.2 wrote nine paragraphs of
      // deliberation and never called anything. Requiring structured output
      // demotes that from ugly to invalid, but an instruct model gets to the
      // answer first and for a fraction of the tokens.
      "google/gemma-4-26b-a4b-it:free",
      "minimax/minimax-m3:free",
      "z-ai/glm-5.2:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "openrouter/free",
    ]),
  // Binary classification. Smallest thing that can answer.
  grader: () =>
    chain("OPENROUTER_MODEL_GRADER", [
      "google/gemma-4-26b-a4b-it:free",
      "liquid/lfm-2.5-2.6b:free",
      "nvidia/nemotron-3.5-lightning:free",
    ]),
};

/**
 * Strip a leaked chain of thought.
 *
 * Reasoning models are supposed to keep their working in a separate
 * `reasoning` field, and `reasoning: { exclude: true }` asks for it to be
 * dropped. Two of the free models ignore both and put it straight in
 * `content`: asked to say "OK", nemotron-3.5-lightning replied "Here's a
 * thinking process: 1. **Ana…".
 *
 * A shopper reading the assistant's private deliberation is bad on its own.
 * It is also a leak of the FACTS block's framing back at them. So this is
 * belt-and-braces with the API flag, and it is deliberately conservative:
 * it removes a recognised preamble and never truncates an ordinary reply.
 */
export function stripReasoning(text: string): string {
  let out = text;

  // Explicit think tags, the common convention.
  out = out.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "");

  // A preamble that announces itself, up to the first blank line after it.
  const preamble =
    /^\s*(?:(?:here'?s|here is)\s+(?:my|a|the)\s+(?:thinking|thought|reasoning)\s*(?:process|steps?)?|okay,?\s+(?:so\s+)?the\s+user\s+(?:is|wants|asked)|let me think|thinking:|reasoning:)\b[\s\S]*?(?:\n\s*\n|$)/i;
  if (preamble.test(out)) {
    const cut = out.replace(preamble, "").trim();
    // Only accept the strip if something substantial survives. A reply that is
    // ENTIRELY preamble is a failed generation, and returning "" lets the
    // caller fall back rather than showing a fragment.
    if (cut.length >= 12) out = cut;
  }

  return out.trim();
}

export const isConfigured = (): boolean => Boolean(secret("OPENROUTER_API_KEY"));

type Msg = { role: "system" | "user" | "assistant"; content: string };

function headers(): HeadersInit {
  const key = secret("OPENROUTER_API_KEY");
  return {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    // Optional attribution headers OpenRouter uses for its own listings. They
    // carry no secret and identify the app, not the merchant or the shopper.
    "http-referer": "https://github.com/chapman-gateway",
    "x-title": "CHAPMAN",
  };
}

export type CompleteOptions = {
  /** One model id, or a chain tried in order until one answers. */
  model: string | string[];
  messages: Msg[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the model for a JSON object. Not every free model honours it. */
  json?: boolean;
  timeoutMs?: number;
};

const asChain = (m: string | string[]): string[] => (Array.isArray(m) ? m : [m]);

/** What every request sends, so streaming and blocking cannot drift apart. */
function requestBody(model: string, opts: CompleteOptions, stream: boolean) {
  return {
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 400,
    temperature: opts.temperature ?? 0.3,
    // Keep the model's working out of `content`. Honoured by most, ignored by
    // some — `stripReasoning` is the second line for those.
    reasoning: { exclude: true },
    ...(stream ? { stream: true } : {}),
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  };
}

/**
 * One blocking completion, trying each model in the chain.
 *
 * Returns null rather than throwing on ANY failure — rate limit, timeout,
 * malformed response, model withdrawn. Every caller has a deterministic path
 * that works without a model, and a shopper seeing a stack trace because a free
 * tier hit its daily cap would be the worst possible way to spend that failure.
 */
export async function complete(opts: CompleteOptions): Promise<string | null> {
  if (!isConfigured()) return null;

  for (const model of asChain(opts.model)) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: headers(),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
        body: JSON.stringify(requestBody(model, opts, false)),
      });
      if (!res.ok) {
        // The body carries the reason — a 429 names which limit, a 404 says the
        // model id is wrong. Both belong in the ledger, because "the assistant
        // went quiet" is undiagnosable without them.
        const detail = await res.text().catch(() => "");
        throw new Error(`${res.status} ${detail.slice(0, 160)}`);
      }
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = stripReasoning(body.choices?.[0]?.message?.content ?? "");
      if (text) return text;
      throw new Error("empty completion");
    } catch (e) {
      record({
        shop: "-",
        kind: "tool_error",
        message: `openrouter ${model} failed`,
        detail: { error: e instanceof Error ? e.message : String(e) },
      });
      // Next in the chain. Half the free catalogue is rate-limited at any
      // moment, so one failure is ordinary rather than exceptional.
    }
  }
  return null;
}

/**
 * A streaming completion, as text pieces.
 *
 * Yields nothing at all on failure, which lets the caller fall back cleanly.
 * Note what this does NOT do: it does not decide when text reaches the shopper.
 * `createStreamGuard` does that, releasing only at checked sentence boundaries,
 * so a streaming model gains no route around a bound that a blocking one lacks.
 */
export async function* completeStream(opts: CompleteOptions): AsyncGenerator<string> {
  if (!isConfigured()) return;

  for (const model of asChain(opts.model)) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: headers(),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
        body: JSON.stringify(requestBody(model, opts, true)),
      });
      if (!res.ok || !res.body) {
        const detail = res.ok ? "no body" : await res.text().catch(() => "");
        throw new Error(`${res.status} ${detail.slice(0, 160)}`);
      }
    } catch (e) {
      record({
        shop: "-",
        kind: "tool_error",
        message: `openrouter stream ${model} failed`,
        detail: { error: e instanceof Error ? e.message : String(e) },
      });
      continue;
    }

    /**
     * A leaked chain of thought cannot be stripped after the fact once it has
     * been streamed — the shopper has already read it. So the opening of the
     * stream is HELD BACK until enough has arrived to recognise a preamble,
     * and only then released.
     *
     * The delay is bounded by a small character count, which at typical token
     * rates is a fraction of a second. That is a cheap price for never showing
     * a shopper the assistant's private deliberation, and it composes with the
     * bounds guard downstream, which holds text back for its own reasons.
     */
    const HOLD = 220;
    let head = "";
    let releasedHead = false;
    let produced = false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by newlines, and a frame can arrive split
        // across chunks. Parsing per-chunk instead of per-line drops tokens on
        // exactly the messages long enough to be worth streaming.
        let cut: number;
        while ((cut = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            if (!releasedHead && head) {
              const clean = stripReasoning(head);
              if (clean) {
                produced = true;
                yield clean;
              }
            }
            if (produced) return;
            throw new Error("stream produced nothing usable");
          }
          try {
            const frame = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const piece = frame.choices?.[0]?.delta?.content;
            if (!piece) continue;

            if (releasedHead) {
              produced = true;
              yield piece;
              continue;
            }
            head += piece;
            if (head.length >= HOLD) {
              const clean = stripReasoning(head);
              releasedHead = true;
              if (clean) {
                produced = true;
                yield clean;
              }
            }
          } catch {
            // OpenRouter sends `: OPENROUTER PROCESSING` keep-alives and the
            // occasional non-JSON frame. Skipping one is correct; failing the
            // stream over it would drop a reply that was arriving fine.
          }
        }
      }

      // Ended without [DONE] — release whatever was held.
      if (!releasedHead && head) {
        const clean = stripReasoning(head);
        if (clean) {
          produced = true;
          yield clean;
        }
      }
      if (produced) return;
      throw new Error("stream closed with no content");
    } catch (e) {
      record({
        shop: "-",
        kind: "tool_error",
        message: `openrouter stream ${model} ended badly`,
        detail: { error: e instanceof Error ? e.message : String(e) },
      });
      // Only worth trying the next model if this one gave us nothing. Once text
      // has reached the caller, restarting would repeat half a sentence.
      if (produced) return;
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * A completion that must parse as JSON.
 *
 * The right filter for any structured job, and a better one than
 * `stripReasoning`. Asked to say "OK", one free model replied
 * "1. **Analyze User Input:** The user sent "ping…" — a chain of thought with
 * no announcing preamble to recognise, so no regex catches it without also
 * eating legitimate numbered lists.
 *
 * Requiring parseable JSON sidesteps the whole problem: a model that monologues
 * fails to parse and the next in the chain is tried. Reasoning leakage stops
 * being a text-cleaning problem and becomes a validity check, which is the kind
 * of problem that has a right answer.
 *
 * The fenced-block strip is because models wrap JSON in markdown constantly,
 * even when told not to, even with response_format set.
 */
export async function completeJson<T>(
  opts: CompleteOptions,
  validate: (v: unknown) => v is T,
): Promise<T | null> {
  for (const model of asChain(opts.model)) {
    const text = await complete({ ...opts, model, json: true });
    if (!text) continue;
    const cleaned = text
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    // A leading monologue often still ends with the object. Take the outermost
    // braces rather than giving up on an answer that is in there somewhere.
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first < 0 || last <= first) continue;
    try {
      const parsed = JSON.parse(cleaned.slice(first, last + 1)) as unknown;
      if (validate(parsed)) return parsed;
    } catch {
      // Next model.
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Grounding
 * ------------------------------------------------------------------ */

const money = (n: string | number, cur: string) =>
  (cur === "INR" ? "₹" : cur === "USD" ? "$" : cur + " ") + Number(n).toLocaleString("en-IN");

/**
 * A product as the model may see it.
 *
 * Prices and stock are the catalogue's, verbatim. `inventoryQuantity` is
 * included because a TRUE stock count is sayable — "only 3 left" when there
 * really are 3 is a fact, and `bounds` lets it through by checking the number
 * against what the tools returned. Withholding it would make the assistant less
 * useful without making it any safer.
 */
function productLine(p: CatalogProduct): string {
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
    .map((v) => `${v.title} ${money(v.price, v.currency)}${v.availableForSale ? "" : " (unavailable)"}`)
    .join("; ");
  return `- ${p.title} — ${price}, ${stock}${variants ? ` [${variants}]` : ""}${p.description ? `\n  ${p.description.slice(0, 220)}` : ""}`;
}

const SYSTEM = `You are the shopping assistant embedded on {SHOP}'s own website. You work for {SHOP}.

Answer only from the FACTS below. They were fetched from {SHOP}'s live catalogue and order system a moment ago and are the only things you know.

Hard rules:
- Never offer, invent, imply or hint at a discount, coupon, deal or price reduction. You have no authority over prices. If asked, say {SHOP} sets its prices and offer to help find something within their budget.
- Never invent urgency. No "hurry", no "selling fast", no deadlines, no "prices going up". You may state a stock number ONLY if it appears verbatim in the FACTS.
- Never assume what a shopper celebrates, believes or observes.
- Never mention another customer, or any order that is not in the FACTS.
- If the FACTS do not answer the question, say so plainly and say what you can help with instead. Do not guess a product, a price, a policy or a delivery date.
- Quote policies as written. Do not paraphrase a return window or a shipping rule into a new promise.

Style: warm, brief, concrete. Two or three sentences unless listing products. No emoji. No markdown headings. Prices exactly as written in the FACTS.`;

function factsBlock(ctx: ReasonerContext): string {
  const parts: string[] = [];

  if (ctx.prefetched.length) {
    parts.push(
      `PRODUCTS matching this shopper's request (${ctx.prefetched.length}):\n` +
        ctx.prefetched.slice(0, 8).map(productLine).join("\n"),
    );
  } else {
    parts.push("PRODUCTS matching this shopper's request: none were found.");
  }

  const pol = [
    ctx.policies.returns && `Returns: ${ctx.policies.returns}`,
    ctx.policies.shipping && `Shipping: ${ctx.policies.shipping}`,
    ctx.policies.cod && `Cash on delivery: ${ctx.policies.cod}`,
  ].filter(Boolean);
  parts.push(pol.length ? `POLICIES (quote these as written):\n${pol.join("\n")}` : "POLICIES: none published.");

  // Already scoped to the verified shopper before it reached us — there is no
  // call the model could make that returns anyone else's. Rendered through the
  // same `describeOrder` the deterministic path uses, which carries no email,
  // no phone and no customer id: the shopper is asking about their own order,
  // so the model needs the order, not the person.
  if (!ctx.orders.available) {
    parts.push("ORDERS: this merchant has not connected an order system. You cannot look up any order.");
  } else if (!ctx.orders.identified) {
    parts.push(
      "ORDERS: this shopper is NOT signed in. You cannot look up any order. Do not ask for their email or phone — an identifier someone types is not proof of who they are. Ask them to sign in.",
    );
  } else if (ctx.orders.rows.length === 0) {
    parts.push("ORDERS: this shopper is signed in and has no orders yet.");
  } else {
    parts.push(
      `ORDERS for this signed-in shopper:\n` + ctx.orders.rows.slice(0, 5).map((o) => `- ${describeOrder(o)}`).join("\n"),
    );
  }

  return parts.join("\n\n");
}

function buildMessages(ctx: ReasonerContext): Msg[] {
  const system = SYSTEM.replaceAll("{SHOP}", ctx.shopName);
  const msgs: Msg[] = [{ role: "system", content: `${system}\n\n---\nFACTS\n---\n${factsBlock(ctx)}` }];
  // Recent turns only. A long history is mostly tokens, and the facts are
  // re-fetched every turn anyway, so an old one is a stale fact waiting to be
  // repeated.
  for (const t of ctx.history.slice(-6)) msgs.push({ role: t.role, content: t.content.slice(0, 1000) });
  msgs.push({ role: "user", content: ctx.message });
  return msgs;
}

/* ------------------------------------------------------------------ *
 * The reasoner
 * ------------------------------------------------------------------ */

/**
 * Cards are built from `products`, which are the CATALOGUE's rows — never from
 * anything the model wrote. So a model that hallucinates a product name changes
 * the prose, which `bounds` sees, and cannot change the card, the price or the
 * link. That separation is why a card can be trusted even when the sentence
 * above it cannot.
 */
const productsFor = (ctx: ReasonerContext): CatalogProduct[] => ctx.prefetched.slice(0, 5);

const toolCallsFor = (ctx: ReasonerContext): string[] => [
  `route(${ctx.route.kind})`,
  `catalog.search(${JSON.stringify({
    q: ctx.route.search.query ? "…" : undefined,
    priceMin: ctx.route.search.priceMin,
    priceMax: ctx.route.search.priceMax,
    inStockOnly: ctx.route.search.inStockOnly,
  })})`,
  ...(ctx.orders.identified ? ["orders.forShopper(<verified>)"] : []),
];

export function openRouterReasoner(model: string | string[] = MODELS.assistant()): Reasoner {
  const chainName = Array.isArray(model) ? model[0] : model;
  const reasoner: Reasoner = {
    name: `openrouter:${chainName}`,

    async run(ctx): Promise<ReasonerResult> {
      const text = await complete({ model, messages: buildMessages(ctx), maxTokens: 320 });
      if (text === null) {
        // The caller decides what to do about it. Returning an empty reply
        // rather than throwing keeps the failure a routing decision instead of
        // a 500 on a shopper's screen.
        return { reply: "", toolCalls: toolCallsFor(ctx), products: [] };
      }
      return { reply: text, toolCalls: toolCallsFor(ctx), products: productsFor(ctx) };
    },

    stream(ctx) {
      let full = "";
      const chunks = (async function* () {
        for await (const piece of completeStream({ model, messages: buildMessages(ctx), maxTokens: 320 })) {
          full += piece;
          yield piece;
        }
      })();
      return {
        chunks,
        // Resolved by the pipeline only after `chunks` is exhausted, so `full`
        // is complete by the time anything reads it.
        result: (async () => ({
          reply: full,
          toolCalls: toolCallsFor(ctx),
          products: full ? productsFor(ctx) : [],
        }))(),
      };
    },
  };
  return reasoner;
}

/**
 * The model, with the deterministic reasoner underneath it.
 *
 * A free tier has a daily cap and a rate limit, and it will be hit — probably
 * during a demo. When it is, the shopper gets the deterministic answer, which
 * is plainer but true, instead of an error. The fallback is recorded so the
 * degradation is visible in the ledger rather than being a mystery.
 *
 * Streaming falls back too, and has to: a stream that yields nothing would
 * otherwise render as an empty bubble, which looks far more broken than a
 * short answer.
 */
export function withFallback(primary: Reasoner, fallback: Reasoner): Reasoner {
  return {
    name: `${primary.name}+${fallback.name}`,

    async run(ctx) {
      const out = await primary.run(ctx).catch(() => null);
      if (out && out.reply.trim()) return out;
      record({
        shop: "-",
        kind: "tool_error",
        message: `${primary.name} produced nothing; falling back to ${fallback.name}`,
        detail: { route: ctx.route.kind },
      });
      return fallback.run(ctx);
    },

    stream(ctx) {
      const upstream = primary.stream?.(ctx);
      if (!upstream) return fallback.stream!(ctx);

      let produced = false;
      // The executor runs synchronously, so `settle` is assigned before the
      // generator below can ever reach it — but TypeScript cannot prove that,
      // and silencing it with a non-null assertion would hide a real ordering
      // bug if this were ever restructured.
      let settle: ((r: ReasonerResult) => void) | null = null;
      const result = new Promise<ReasonerResult>((r) => {
        settle = r;
      });
      const finish = (r: ReasonerResult) => settle?.(r);

      const chunks = (async function* () {
        for await (const piece of upstream.chunks) {
          if (piece) produced = true;
          yield piece;
        }
        if (produced) {
          finish(await upstream.result);
          return;
        }
        // Nothing arrived. Fall back and stream the deterministic answer
        // instead — the shopper has been watching an empty bubble and is owed
        // an answer, not an explanation.
        record({
          shop: "-",
          kind: "tool_error",
          message: `${primary.name} streamed nothing; falling back to ${fallback.name}`,
          detail: { route: ctx.route.kind },
        });
        const alt = fallback.stream!(ctx);
        for await (const piece of alt.chunks) yield piece;
        finish(await alt.result);
      })();

      return { chunks, result };
    },
  };
}
