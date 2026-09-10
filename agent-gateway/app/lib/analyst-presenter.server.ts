/**
 * Turn an analyst tool transcript into the merchant-facing brief.
 *
 * Read-only tools have already run before this layer. Some free reasoning
 * providers put private planning in `content` or exhaust the completion before
 * emitting a usable draft, so the presentation pass receives both verified
 * results and only a validated strategic draft. The verified results remain
 * authoritative and no presentation model is asked to redo maths.
 */

import type { HarnessStep } from "./harness.server";
import { completeJson, MODELS } from "./openrouter.server";

type PresentedAnswer = { answer: string };

const isPresentedAnswer = (value: unknown): value is PresentedAnswer => {
  if (!value || typeof value !== "object") return false;
  const answer = (value as { answer?: unknown }).answer;
  const trimmed = typeof answer === "string" ? answer.trim() : "";
  return (
    typeof answer === "string" &&
    trimmed.length >= 20 &&
    answer.length <= 6_000 &&
    // A valid JSON envelope can still contain text cut off mid-sentence. The
    // final brief must close with sentence punctuation before it is accepted.
    /[.!?)](?:[*_])?$/.test(trimmed) &&
    !/^(?:we need to|the user (?:asks|wants)|we must|i need to)/i.test(
      trimmed,
    )
  );
};

export const verifiedAnalystTranscript = (steps: HarnessStep[]): string =>
  steps
    .filter((step) => !step.error && step.result.trim())
    .map((step) => step.result.trim())
    .join("\n\n");

export async function presentAnalystAnswer(input: {
  shop: string;
  question: string;
  steps: HarnessStep[];
  reasonedAnswer?: string;
}): Promise<string> {
  const verified = verifiedAnalystTranscript(input.steps);

  if (verified) {
    const presented = await completeJson<PresentedAnswer>(
      {
        shop: input.shop,
        model: MODELS.presenter(),
        messages: [
          {
            role: "system",
            content: `You are Chapman's report editor. Write a concise, coherent answer to the merchant's question using VERIFIED RESULTS and the senior analyst's STRATEGIC DRAFT. The verified results were computed by code and contain all permitted numbers.

Do not perform new arithmetic, promise outcomes, or use any number unless it appears in VERIFIED RESULTS. Label inferences as recommendations rather than facts, and retain stated sample sizes and caveats.

Write a useful, detailed answer of up to 650 words. Start with a short conclusion, then use the number of prioritized actions the merchant requested (or at most four if they did not specify). For every action explain: the supporting evidence, why it matters, the concrete next step, and the main uncertainty or measurement to watch. End with a brief measurement plan. Never mention tools, models, prompts, drafts, JSON, or this instruction.

Reply only as {"answer":"the complete merchant-facing answer"}.`,
          },
          {
            role: "user",
            content: `QUESTION\n${input.question}\n\nVERIFIED RESULTS\n${verified}\n\nSTRATEGIC DRAFT\n${input.reasonedAnswer?.trim() || "No strategic draft was available; edit the verified results directly."}`,
          },
        ],
        maxTokens: 3_200,
        temperature: 0.1,
        reasoningEffort: "minimal",
        keyRole: "presenter",
        timeoutMs: 25_000,
        json: true,
      },
      isPresentedAnswer,
    );
    if (presented) return presented.answer.trim();
  }

  if (input.reasonedAnswer?.trim()) return input.reasonedAnswer.trim();
  return verified
    ? `Here are the verified findings from Chapman’s analytics tools:\n\n${verified}`
    : "";
}
