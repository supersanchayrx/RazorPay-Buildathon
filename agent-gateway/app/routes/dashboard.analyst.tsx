import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { runHarness } from "../lib/harness.server";
import { MERCHANT_TOOLS } from "../lib/merchanttools.server";
import { describeRegistry } from "../lib/tools.server";
import { MODELS, isConfigured } from "../lib/openrouter.server";

/**
 * Ask your own data a question.
 *
 * The merchant half of the harness. Same loop as the shopper's, different
 * registry — and the difference IS the security model, not a setting. These
 * tools return unit costs, margins, rejected proposals and the ledger, none of
 * which a storefront surface can reach, because there is no code path from one
 * registry to the other.
 *
 * The numbers are never the model's. It chooses which question to ask;
 * `stats.server.ts` answers it. A model asked "what is the attach rate between
 * chai and assam" would reply fluently and wrongly and you could not tell
 * which time — asked to CALL `association_rules`, it gets 158 of 258 with a
 * Wilson bound because a real function counted them.
 *
 * The transcript is shown in full, every time. A merchant about to act on an
 * answer is entitled to see which tools produced it and what they returned.
 */

const SYSTEM = `You are an analyst working for {SHOP}. You answer the merchant's questions about their own shop using the tools below, and only the tools.

Rules:
- NEVER compute a statistic yourself. If you catch yourself dividing two numbers, call rate_with_confidence instead. Arithmetic in your head is where a confident wrong answer comes from.
- Never state a rate without its sample size. "67%" on three orders is three orders, not a rate.
- Never predict what a price change will do. This shop has never changed a price, so there is nothing to estimate it from. State the break-even and let the merchant judge.
- If a tool says a sample is too small or a measurement is unavailable, say so plainly. "I cannot tell you that yet" is a real answer.
- Be brief and concrete. The merchant is busy and can read numbers.`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  return {
    site: site ? { key: site.key, name: site.name } : null,
    tools: describeRegistry(MERCHANT_TOOLS),
    model: isConfigured() ? MODELS.analyst()[0] : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const site = sitesForMerchant(merchant.sites).find((s) => s.key === String(form.get("shop") ?? ""));
  if (!site) return { error: "not your store" };

  const question = String(form.get("question") ?? "").trim().slice(0, 500);
  if (!question) return { error: "ask something" };
  if (!isConfigured()) {
    return {
      error:
        "No reasoning model is configured, so the analyst cannot run. Every tool it would call still works — the offers page uses them directly.",
    };
  }

  const out = await runHarness({
    shop: site.key,
    tools: MERCHANT_TOOLS,
    toolContext: {
      shop: site.key,
      shopName: site.name,
      catalog: jsonFeedCatalog(site.catalogFeedUrl),
      // Shared across the whole loop: the proposal pipeline is expensive, and
      // a model that calls list_proposals then explain_proposal should not pay
      // for it twice.
      cache: {},
    },
    system: SYSTEM.replaceAll("{SHOP}", site.name),
    message: question,
    // The analyst is unwatched and its answers are acted on, so it gets a
    // bigger budget than the shopper-facing loop, which a human is waiting on.
    model: MODELS.analyst(),
    maxSteps: 6,
    maxMs: 90_000,
  });

  return { question, ...out, error: null };
};

const SUGGESTIONS = [
  "Which two products are most worth cross-selling, and how much is it worth a month?",
  "Is anything wrong with my payments right now?",
  "What would 10% off the ceramic cupping set actually cost me?",
  "Which products are a big share of revenue but slow in units?",
  "Do people reorder the masala chai on a regular cycle?",
  "What has the assistant been stopped from saying this week?",
];

export default function Analyst() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!d.site) {
    return (
      <>
        <h1>Analyst</h1>
        <p className="lede">No store is connected to this account yet.</p>
      </>
    );
  }

  return (
    <>
      <h1>Ask your data</h1>
      <p className="lede">
        Questions about your own shop, answered by calling the same statistics the offer proposer
        uses. The model chooses which question to ask; the code answers it — so no figure here was
        produced by a language model.
      </p>

      <Form method="post">
        <input type="hidden" name="shop" value={d.site.key} />
        <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
          <input
            type="text"
            name="question"
            defaultValue={a && "question" in a ? a.question : ""}
            placeholder="e.g. which pairing is worth the most a month?"
            style={{
              flex: 1,
              font: "inherit",
              fontSize: 14,
              padding: "9px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--panel)",
              color: "var(--ink)",
            }}
          />
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Thinking…" : "Ask"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="submit"
              name="question"
              value={s}
              disabled={busy}
              className="btn-secondary"
              style={{ fontSize: 12.5, padding: "5px 10px" }}
            >
              {s}
            </button>
          ))}
        </div>
      </Form>

      {a?.error && <p className="note">{a.error}</p>}

      {a && "reply" in a && (
        <>
          <div className="panel">
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".03em", color: "#6b7a72" }}>
              Answer
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontSize: 14 }}>
              {a.reply || <em className="muted">The model did not produce an answer. The transcript below shows how far it got.</em>}
            </p>
            {a.stoppedBy && (
              <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
                Stopped by the {a.stoppedBy} budget — answered from what it had rather than continuing.
              </p>
            )}
          </div>

          <h2>How it got there</h2>
          <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "62ch" }}>
            Every tool call and what it returned. Shown in full because you are about to act on the
            answer above, and an answer you cannot check is an opinion.
          </p>
          {a.steps.length === 0 && (
            <p className="note">It answered without calling anything — which for a question about your data is usually a sign the answer is not grounded. Treat it with suspicion.</p>
          )}
          {a.steps.map((s, i) => (
            <div key={i} className="panel" style={{ borderLeft: `3px solid ${s.error ? "#a33" : "#1f4037"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {s.tool}({Object.keys(s.args).length ? JSON.stringify(s.args) : ""})
                </span>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {s.ms}ms
                </span>
              </div>
              {s.error && <span className="pill needs_setup">{s.error}</span>}
              <pre style={{ marginTop: 8, maxHeight: 260 }}>{s.result}</pre>
            </div>
          ))}
        </>
      )}

      <h2>What the analyst can call</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "64ch" }}>
        The complete list — {d.tools.length} tools, and there is no other way for it to reach your
        data. Every one is a <strong>read</strong>. There is no tool here that approves an offer,
        changes a price or writes anything, because an analyst that could approve its own proposal
        would make the floors decorative.
        {d.model ? ` Running on ${d.model}.` : " No model is configured, so this page is inert."}
      </p>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {d.tools.map((t) => (
            <tr key={t.name}>
              <td className="mono">{t.name}</td>
              <td className="muted">{t.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
