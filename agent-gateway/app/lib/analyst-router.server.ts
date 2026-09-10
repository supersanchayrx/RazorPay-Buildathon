/**
 * Deterministic safety net for the analyst's common merchant questions.
 *
 * Deterministic routing is preferred for common analyst questions. A small
 * orchestrator runs only when this router abstains. Its vocabulary is
 * intentionally small and every destination is still a read-only merchant
 * tool; an unmatched question stays unmatched instead of being guessed at.
 * Ultra is downstream and sees only the verified results.
 */

import type { HarnessStep } from "./harness.server";
import {
  MERCHANT_TOOLS,
  type MerchantToolContext,
} from "./merchanttools.server";
import { record } from "./ledger.server";

type PlannedCall = { tool: string; args: Record<string, unknown> };

function plan(question: string): PlannedCall[] {
  const q = question.toLowerCase();
  const calls: PlannedCall[] = [];
  const add = (tool: string, args: Record<string, unknown> = {}) => {
    if (!calls.some((call) => call.tool === tool)) calls.push({ tool, args });
  };

  const growth = /\b(customers?|revenue|sales|months?|month-to-date|mtd|stale|slowdown)\b/.test(q);
  const asksForAction =
    /\b(increase|improve|grow|recommend|recommendation|actions?|what (?:can|should) i do)\b/.test(q);

  if (growth) add("growth_snapshot", { months: 6 });
  if (/\b(marketing|campaign|advertis(?:e|ing)|instagram|audience|age range|reach|\bpr\b)\b/.test(q)) {
    add("marketing_campaign_brief");
  }
  if (/\b(retention|retain|cohorts?|reactivat(?:e|ion)|re-engage|repeat customers?)\b/.test(q)) {
    add("customer_retention_cohorts");
  }
  if (/\b(concentration|dependent|dependency|whales?|few customers|few products|broad-based)\b/.test(q)) {
    add("revenue_concentration");
  }
  if (/\b(payments?|failures?|failing|hdfc|netbanking|upi)\b/.test(q)) {
    add("detect_change", {});
    add("list_proposals", {});
  }
  if (/\b(cross[- ]?sell|pairing|bought together|go together|attach rate)\b/.test(q)) {
    add("cross_sell_opportunities", {});
  }
  if (growth && asksForAction) add("list_proposals", {});

  return calls;
}

export async function deterministicAnalystSteps(
  question: string,
  context: MerchantToolContext,
): Promise<HarnessStep[]> {
  const specs = new Map(MERCHANT_TOOLS.map((tool) => [tool.name, tool]));
  const steps: HarnessStep[] = [];

  for (const call of plan(question)) {
    const spec = specs.get(call.tool);
    if (!spec) continue;
    const started = Date.now();
    try {
      const result = await spec.run(context, call.args);
      const ms = Date.now() - started;
      steps.push({
        tool: call.tool,
        args: call.args,
        result: result.slice(0, 2_000),
        ms,
      });
      record({
        shop: context.shop,
        kind: "reply",
        message: `deterministic analyst ${call.tool}`,
        detail: { args: call.args, ms, bytes: result.length },
      });
    } catch (error) {
      steps.push({
        tool: call.tool,
        args: call.args,
        result: "That lookup failed.",
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return steps;
}
