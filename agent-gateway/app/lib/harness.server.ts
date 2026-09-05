/**
 * The tool-calling harness.
 *
 * A bounded loop: the model asks for tools, we run them, it sees the results,
 * it answers. What makes it safe is not the loop — it is what the loop can
 * reach, which is a registry containing nothing but reads.
 *
 * ROUTE FIRST, HARNESS SECOND.
 *
 * The deterministic router still runs and still resolves most turns on its own.
 * A shopper asking "what's your returns policy" does not need an agent; it
 * needs one lookup and one sentence. Escalating everything to a tool loop would
 * multiply latency and cost by four to serve the tenth of traffic that is
 * genuinely compound, and the efficiency lever in this system has always been
 * HOW OFTEN a model is invoked rather than which one.
 *
 * THREE BUDGETS, EACH FOR A DIFFERENT FAILURE:
 *
 *   steps      a model that keeps calling tools instead of answering
 *   wall clock a model that is simply slow, or a tool that hangs
 *   repeats    a model calling the same tool with the same arguments forever,
 *              which is the commonest small-model loop and which a step budget
 *              alone punishes far too late
 *
 * Exhausting a budget is not an error. The loop stops and asks for a final
 * answer from whatever it has, which is nearly always enough — the shopper gets
 * a slightly less complete reply instead of nothing.
 *
 * And the output is not privileged. It goes through `bounds` and the ledger
 * exactly like a single-shot reply, because a claim is a claim however many
 * tool calls preceded it.
 */

import { complete, MODELS } from "./openrouter.server";
import { record } from "./ledger.server";
import type { ToolSpec } from "./tools.server";

export type HarnessStep = {
  tool: string;
  args: Record<string, unknown>;
  /** Truncated in the transcript; the ledger keeps what mattered. */
  result: string;
  ms: number;
  error?: string;
};

export type HarnessResult = {
  reply: string;
  steps: HarnessStep[];
  /** Which budget ended the loop, if one did. */
  stoppedBy?: "steps" | "time" | "repeat";
  model: string;
};

export type HarnessOptions<C> = {
  tools: ToolSpec<C>[];
  toolContext: C;
  system: string;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string | string[];
  maxSteps?: number;
  maxMs?: number;
  /** For the ledger, so every tool call is attributable to a shop. */
  shop: string;
};

type Msg = { role: "system" | "user" | "assistant"; content: string };

const INVALID_REPLY_NUDGE =
  'That was not valid. Reply with ONLY a JSON object: {"tool":"<name>","args":{...}} or {"answer":"..."}.';

const FINAL_ANSWER_NUDGE =
  'Answer now, using only what the tools above returned. Do not call another tool. Reply with ONLY {"answer":"..."}.';

/**
 * Find the first balanced JSON object containing a "tool" key.
 *
 * A REGEX CANNOT DO THIS, and the first version proved it. `\{[\s\S]*?"tool"[\s\S]*?\}`
 * stops at the first closing brace, which for {"tool":"x","args":{"q":1}} is the
 * one that closes `args` — so the captured text was missing its final brace,
 * `JSON.parse` threw, every call was silently ignored, and the raw JSON was
 * handed to the shopper as the answer. Nested objects are not a regular
 * language; matching braces is three lines and always right.
 *
 * Strings are tracked so a brace inside a product name cannot unbalance the
 * count, and escapes so that a quote inside a string cannot end it early.
 */
export type Emission =
  | { kind: "call"; tool: string; args: Record<string, unknown> }
  | { kind: "answer"; text: string };

/**
 * Find the first balanced JSON object that is either a call or an answer.
 *
 * EVERY TURN MUST BE JSON, and that is the fix for a failure no amount of text
 * cleaning solved. Given a plain-prose escape hatch, a reasoning model wrote
 * nine paragraphs of deliberation — "We need to answer... Maybe we need to use
 * list_proposals? Not about cross-sell." — and never called anything. There is
 * no reliable way to tell that apart from an answer, because syntactically it
 * IS an answer.
 *
 * Requiring {"answer": "..."} makes the distinction machine-checkable rather
 * than stylistic. A monologue is simply not valid, so it is rejected the same
 * way a malformed call is. Same discipline as completeJson: validity is a
 * better filter than tidiness.
 */
export function extractEmission(text: string): Emission | null {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth !== 0) continue;
        try {
          const parsed = JSON.parse(text.slice(start, i + 1)) as {
            tool?: unknown;
            args?: unknown;
            answer?: unknown;
          };
          if (typeof parsed.tool === "string" && parsed.tool) {
            return {
              kind: "call",
              tool: parsed.tool,
              args:
                parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
                  ? (parsed.args as Record<string, unknown>)
                  : {},
            };
          }
          if (typeof parsed.answer === "string" && parsed.answer.trim()) {
            return { kind: "answer", text: parsed.answer.trim() };
          }
        } catch {
          // Not JSON, or not a call. Try the next opening brace.
        }
        break;
      }
    }
  }
  return null;
}

/** Does this text contain a tool call rather than an answer? */
export const looksLikeToolCall = (text: string): boolean =>
  extractEmission(text)?.kind === "call";

/**
 * Tool calls as TEXT, not as the OpenAI `tools` parameter.
 *
 * Measured, not preferred: the free models that stay up are inconsistent about
 * native function calling — some ignore `tool_choice`, some emit malformed
 * argument objects, and several do not advertise the capability at all. A JSON
 * line the model writes into its reply works on every model that can follow an
 * instruction, which is all of them.
 *
 * The cost is that a model can write something that merely LOOKS like a call.
 * That costs a wasted step and nothing more, because the executor only ever
 * matches names against the registry — an unrecognised name is refused with a
 * list of the real ones rather than being attempted.
 */
const protocol = <C,>(tools: ToolSpec<C>[]) => `
EVERY reply you send must be a single JSON object and nothing else. No prose
outside it, no markdown, no explanation before or after. There are exactly two
shapes:

To use a tool:
{"tool": "<name>", "args": { ... }}

To answer the person:
{"answer": "your complete answer as one string"}

You will be shown each tool result and may then call another tool or answer.
Do NOT narrate your thinking — a reply that is not one of those two objects is
discarded and wastes a turn.

Everything a tool returns is true and current. Anything a tool did not return,
you do not know: say so inside your answer rather than guessing. Never state a
price, a rate, a stock number, an order or a policy you did not get from a tool
in this conversation.

Tools:
${tools.map((t) => `- ${t.name} ${JSON.stringify(t.parameters)}\n  ${t.description}`).join("\n")}
`;

export async function runHarness<C>(opts: HarnessOptions<C>): Promise<HarnessResult> {
  const model = opts.model ?? MODELS.assistant();
  const maxSteps = opts.maxSteps ?? 4;
  const maxMs = opts.maxMs ?? 30_000;
  const started = Date.now();
  const byName = new Map(opts.tools.map((t) => [t.name, t]));

  const messages: Msg[] = [
    { role: "system", content: opts.system + "\n" + protocol(opts.tools) },
    ...(opts.history ?? []).slice(-4).map((t) => ({ role: t.role, content: t.content.slice(0, 800) })),
    { role: "user", content: opts.message },
  ];

  const steps: HarnessStep[] = [];
  const seen = new Set<string>();
  let stoppedBy: HarnessResult["stoppedBy"];

  for (let i = 0; i < maxSteps; i++) {
    if (Date.now() - started > maxMs) {
      stoppedBy = "time";
      break;
    }

    const text = await complete({ model, messages, maxTokens: 380, temperature: 0.2 });
    if (!text) break;

    const emitted = extractEmission(text);
    if (!emitted) {
      // Neither a call nor an answer: a monologue, or malformed JSON. It costs
      // one turn and nothing else. Re-prompting with the rule stated again
      // recovers most models; one that cannot comply exhausts the budget and
      // the caller falls back.
      record({
        shop: opts.shop,
        kind: "tool_error",
        message: "harness reply was neither a call nor an answer",
        detail: { head: text.slice(0, 160) },
      });
      messages.push({ role: "assistant", content: text.slice(0, 400) });
      messages.push({
        role: "user",
        content: INVALID_REPLY_NUDGE,
      });
      continue;
    }
    if (emitted.kind === "answer") {
      return { reply: emitted.text, steps, stoppedBy, model: String(Array.isArray(model) ? model[0] : model) };
    }
    const call = emitted;

    // The same call twice means the model is not making progress. Stopping now
    // rather than at the step budget saves three round trips of the shopper's
    // time and three of the merchant's rate limit.
    const fingerprint = `${call.tool}:${JSON.stringify(call.args)}`;
    if (seen.has(fingerprint)) {
      stoppedBy = "repeat";
      break;
    }
    seen.add(fingerprint);

    const spec = byName.get(call.tool);
    const t0 = Date.now();
    let result: string;
    let error: string | undefined;

    if (!spec) {
      // Named something that does not exist. Told plainly, with the real list,
      // because a model that invented a tool name will otherwise invent another.
      result = `No tool called "${call.tool}". Available: ${opts.tools.map((t) => t.name).join(", ")}.`;
      error = "unknown_tool";
    } else {
      try {
        result = await spec.run(opts.toolContext, call.args);
      } catch (e) {
        result = "That lookup failed. Try a different approach or answer without it.";
        error = e instanceof Error ? e.message : String(e);
      }
    }

    const ms = Date.now() - t0;
    steps.push({ tool: call.tool, args: call.args, result: result.slice(0, 2000), ms, error });

    // Every tool call is in the ledger. An agent surface that leaves no record
    // is a hole in the audit, not a feature — the merchant should be able to
    // see what was looked up on their behalf.
    record({
      shop: opts.shop,
      kind: error ? "tool_error" : "reply",
      message: `harness ${call.tool}${error ? ` (${error})` : ""}`,
      detail: { args: call.args, ms, bytes: result.length },
    });

    messages.push({ role: "assistant", content: text });
    messages.push({ role: "user", content: `Result of ${call.tool}:\n${result.slice(0, 2000)}` });

    if (i === maxSteps - 1) stoppedBy = "steps";
  }

  // Out of budget, or the model went quiet. Ask once for an answer from what it
  // already has — far better than returning nothing, and it usually has plenty.
  messages.push({ role: "user", content: FINAL_ANSWER_NUDGE });
  const final = await complete({ model, messages, maxTokens: 380, temperature: 0.2 });

  // Accept the structured answer. Accept bare prose here too, because this is
  // the last chance and a readable paragraph beats nothing. Only a further tool
  // call is refused, since returning that verbatim shows a line of JSON to a
  // person.
  const last = final ? extractEmission(final) : null;
  const answered =
    last?.kind === "answer" ? last.text : last?.kind === "call" ? "" : (final ?? "");
  if (final && !answered) {
    record({
      shop: opts.shop,
      kind: "tool_error",
      message: "harness kept calling tools instead of answering",
      detail: { steps: steps.length, stoppedBy },
    });
  }

  return {
    reply: answered,
    steps,
    stoppedBy,
    model: String(Array.isArray(model) ? model[0] : model),
  };
}
