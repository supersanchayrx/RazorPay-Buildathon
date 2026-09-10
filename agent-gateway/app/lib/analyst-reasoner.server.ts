/**
 * Deep reasoning over facts that code has already measured.
 *
 * This is intentionally not a tool harness. Ultra is valuable for connecting
 * evidence to strategy, not for choosing between function names. It receives
 * no database access and no unverified planner prose: only the merchant's
 * question and the successful, read-only tool transcript.
 */

import { extractEmission, type HarnessStep } from "./harness.server";
import { complete, MODELS } from "./openrouter.server";
import { verifiedAnalystTranscript } from "./analyst-presenter.server";

const looksLikePrivatePlan = (text: string): boolean =>
  /^(?:we need to|the user (?:asks|wants)|we must|i need to|let me (?:think|analy[sz]e))/i.test(
    text.trim(),
  );

export async function reasonAboutAnalystResults(input: {
  shop: string;
  question: string;
  steps: HarnessStep[];
}): Promise<string> {
  const verified = verifiedAnalystTranscript(input.steps);
  if (!verified) return "";

  const messages = [
    {
      role: "system" as const,
      content: `You are Chapman's senior commerce strategist. The code has already selected and run every needed analytics tool. Reason only over VERIFIED RESULTS; do not select tools or ask for more data.

Find the most decision-useful interpretation and actions. Separate observations from hypotheses. Do not redo arithmetic, introduce a number absent from the results, infer causation from correlation, or promise an outcome. Preserve sample sizes, confidence limits, and missing-data caveats.

Write a concise strategic draft of at most 450 words. Start directly with the conclusion and recommendations. Do not wrap it in JSON, XML, markdown fences, or commentary about your process.`,
    },
    {
      role: "user" as const,
      content: `QUESTION\n${input.question}\n\nVERIFIED RESULTS\n${verified}`,
    },
  ];

  // Validate each model's draft before moving on. Transport-level fallback is
  // not enough here: a successful response can still be a private plan or a
  // half-written JSON envelope, neither of which should reach the presenter.
  for (const model of MODELS.analyst()) {
    const raw = await complete({
      shop: input.shop,
      model,
      messages,
      maxTokens: 1_100,
      temperature: 0.15,
      reasoningEffort: "low",
      keyRole: "analyst",
      timeoutMs: 75_000,
    });
    if (!raw) continue;

    const emitted = extractEmission(raw);
    if (emitted?.kind === "answer") return emitted.text;

    const clean = raw.trim();
    if (
      clean.length >= 40 &&
      !clean.startsWith("{") &&
      /[.!?)](?:[*_])?$/.test(clean) &&
      !looksLikePrivatePlan(clean)
    ) {
      return clean;
    }
  }

  return "";
}
