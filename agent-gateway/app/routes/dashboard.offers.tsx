import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { runProposals } from "../lib/proposals.server";
import { decide, activeOffers, history } from "../lib/approvals.server";

/**
 * The offer proposer, as a merchant sees it.
 *
 * Three things this page does that most "AI suggestions" screens do not:
 *
 * 1. IT SHOWS WHAT IT STOPPED. Every rejected candidate is listed with the gate
 *    that caught it and why. A proposer that silently discards is
 *    indistinguishable from one that never looked, and a merchant who sees
 *    "this would have ranked first and sells at a loss" trusts the rest more.
 *
 * 2. IT SEPARATES INCIDENTS FROM OFFERS. A payment outage is not a suggestion
 *    to weigh against a cross-sell; it is a thing that is broken and is costing
 *    money today.
 *
 * 3. IT NEVER FORECASTS. Every markdown states what volume it would need to
 *    break even and then stops. This store has never changed a price, so there
 *    is no variation to estimate elasticity from — the arithmetic is ours and
 *    the judgment stays with the merchant.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site) return { site: null, run: null, offers: [], decisions: [] };

  const run = await runProposals({
    shop: site.key,
    catalog: jsonFeedCatalog(site.catalogFeedUrl),
  });

  return {
    site: { key: site.key, name: site.name },
    run,
    offers: activeOffers(site.key),
    decisions: history(site.key, 20),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  if (!merchant.sites.includes(shop)) {
    // Scoped at the write, not only at the read. A page that filters what it
    // shows but not what it accepts is one crafted POST away from a merchant
    // approving an offer on somebody else's store.
    return { ok: false, error: "not your store" };
  }

  const action = String(form.get("act") ?? "") as "approve" | "reject" | "revoke";
  const candidateId = String(form.get("candidateId") ?? "");

  if (action === "approve") {
    const depth = Number(form.get("depth"));
    const result = decide({
      shop,
      candidateId,
      action: "approve",
      by: merchant.email,
      offer: {
        handle: String(form.get("handle") ?? ""),
        title: String(form.get("title") ?? ""),
        depth,
        endsAt: String(form.get("endsAt") ?? ""),
        maxUnits: Number(form.get("maxUnits")),
      },
    });
    return result;
  }

  return decide({ shop, candidateId, action, by: merchant.email, note: String(form.get("note") ?? "") || undefined });
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const GATE_LABEL: Record<string, string> = {
  sample_floor: "Too little evidence",
  margin_floor: "Below your margin floor",
  depth_cap: "Deeper than your cap",
  never_discount: "On your never-discount list",
  false_discovery: "Probably noise",
  no_effect: "No measurable effect",
};

export default function Offers() {
  const d = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!d.site || !d.run) {
    return (
      <>
        <h1>Offer proposals</h1>
        <p className="lede">No store is connected to this account yet.</p>
      </>
    );
  }

  const { run } = d;
  // A month out, as a sensible default the merchant can change. Long enough to
  // measure something at this store's volume, short enough to be a real end.
  const defaultEnd = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <h1>Offer proposals</h1>
      <p className="lede">
        Worked out from your own orders. Every number here was counted, not estimated by a language
        model — and nothing is published until you approve it.
      </p>

      <div className="stats">
        <div className="stat">
          <b>{run.scale.monthlyOrders.toFixed(0)}</b>
          <span>orders a month</span>
        </div>
        <div className="stat">
          <b>{inr(run.scale.monthlyGrossMargin)}</b>
          <span>monthly gross margin</span>
        </div>
        <div className="stat">
          <b>{run.incidents.length}</b>
          <span>needs attention</span>
        </div>
        <div className="stat">
          <b>{run.actions.length}</b>
          <span>ideas ranked</span>
        </div>
        <div className="stat">
          <b>{run.rejected.length}</b>
          <span>stopped</span>
        </div>
      </div>

      {run.emptyReason && <p className="note">{run.emptyReason}</p>}

      {/* ---------------- live offers ---------------- */}
      {d.offers.length > 0 && (
        <>
          <h2>Live now</h2>
          <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px" }}>
            The assistant may tell shoppers these exist. It cannot invent one, change a percentage,
            or add a deadline — and the discount itself is applied by the server at checkout, not by
            anything the assistant says.
          </p>
          {d.offers.map((o) => (
            <div key={o.candidateId} className="panel">
              <div className="card-name" style={{ fontWeight: 600 }}>
                {Math.round(o.depth * 100)}% off {o.title}
              </div>
              <p className="muted" style={{ fontSize: 13, margin: "6px 0" }}>
                Until {o.endsAt}, capped at {o.maxUnits} units. Approved by {o.approvedBy} on{" "}
                {o.approvedAt.slice(0, 10)}.
              </p>
              <Form method="post">
                <input type="hidden" name="shop" value={d.site.key} />
                <input type="hidden" name="candidateId" value={o.candidateId} />
                <input type="hidden" name="act" value="revoke" />
                <button type="submit" disabled={busy} className="btn-secondary">
                  Stop this offer
                </button>
              </Form>
            </div>
          ))}
        </>
      )}

      {/* ---------------- incidents ---------------- */}
      {run.incidents.length > 0 && (
        <>
          <h2>Needs attention</h2>
          <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px" }}>
            Not suggestions. These are things that appear to be broken, and they are kept out of the
            ranked list on purpose — a payment failure does not belong in a queue next to
            &ldquo;consider pairing these two teas&rdquo;.
          </p>
          {run.incidents.map((c) => (
            <div key={c.id} className="panel" style={{ borderLeft: "3px solid #8a6d2f" }}>
              <div style={{ fontWeight: 600 }}>{c.title}</div>
              <p style={{ fontSize: 13.5, margin: "8px 0", color: "#3a4a43" }}>{c.rationale}</p>
              <FactRow facts={c.facts} />
            </div>
          ))}
        </>
      )}

      {/* ---------------- this week's digest ---------------- */}
      <h2>This week</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px" }}>
        {run.digest.length} of {run.actions.length} ranked ideas, chosen to cover different products
        rather than to be the three highest scores. None of these costs you any margin.
      </p>
      {run.digest.map((c) => (
        <div key={c.id} className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontWeight: 600 }}>{c.title}</div>
            <span className="mono muted" title="priority score">
              {c.priority.toFixed(0)}
            </span>
          </div>
          <p style={{ fontSize: 13.5, margin: "8px 0", color: "#3a4a43" }}>{c.rationale}</p>
          <FactRow facts={c.facts} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Form method="post">
              <input type="hidden" name="shop" value={d.site.key} />
              <input type="hidden" name="candidateId" value={c.id} />
              <input type="hidden" name="act" value="reject" />
              <button type="submit" disabled={busy} className="btn-secondary">
                Not interested
              </button>
            </Form>
          </div>
        </div>
      ))}

      {/* ---------------- price experiments ---------------- */}
      {run.experiments.length > 0 && (
        <>
          <h2>Price experiments</h2>
          <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "62ch" }}>
            These give up margin, so they are kept apart and only one should run at a time. We can
            tell you exactly what a cut costs and how much extra volume it would need to pay for
            itself. <strong>We cannot tell you whether it will</strong> — you have never changed a
            price, so there is nothing in your data to estimate that from.
          </p>
          {run.experiments.map((c) => {
            const depth = Number(/@(\d+(?:\.\d+)?)%/.exec(c.id)?.[1] ?? 10) / 100;
            return (
              <div key={c.id} className="panel">
                <div style={{ fontWeight: 600 }}>{c.title}</div>
                <p style={{ fontSize: 13.5, margin: "8px 0", color: "#3a4a43" }}>{c.rationale}</p>
                <FactRow facts={c.facts} />
                <Form method="post" style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <input type="hidden" name="shop" value={d.site.key} />
                  <input type="hidden" name="candidateId" value={c.id} />
                  <input type="hidden" name="handle" value={c.products[0]} />
                  <input type="hidden" name="title" value={c.title.replace(/^Consider \d+% off /, "")} />
                  <input type="hidden" name="depth" value={depth} />
                  <label style={{ fontSize: 12.5 }}>
                    Ends
                    <br />
                    <input type="date" name="endsAt" defaultValue={defaultEnd} required />
                  </label>
                  <label style={{ fontSize: 12.5 }}>
                    Max units
                    <br />
                    <input type="number" name="maxUnits" defaultValue={40} min={1} required style={{ width: 90 }} />
                  </label>
                  <button type="submit" name="act" value="approve" disabled={busy} className="btn-primary">
                    Approve this offer
                  </button>
                  <button type="submit" name="act" value="reject" disabled={busy} className="btn-secondary">
                    No
                  </button>
                </Form>
              </div>
            );
          })}
        </>
      )}

      {/* ---------------- what was stopped ---------------- */}
      <h2>Considered and stopped</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "62ch" }}>
        Shown rather than hidden. A proposer that quietly discards is
        indistinguishable from one that never looked.
      </p>
      <table>
        <thead>
          <tr>
            <th>Idea</th>
            <th>Why it was stopped</th>
          </tr>
        </thead>
        <tbody>
          {run.rejected.map((r) => (
            <tr key={r.candidate.id}>
              <td>
                {r.candidate.title}
                <br />
                <span className="pill planned">{GATE_LABEL[r.rejected!.gate] ?? r.rejected!.gate}</span>
              </td>
              <td className="muted">{r.rejected!.why}</td>
            </tr>
          ))}
          {run.rejected.length === 0 && (
            <tr>
              <td colSpan={2} className="muted">
                Nothing was stopped this run.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ---------------- classification ---------------- */}
      <h2>Your catalogue, classified</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "62ch" }}>
        A by revenue, not by units — a product can be slow on the shelf and still be a tenth of the
        business, and treating it as a slow mover is how a healthy line ends up discounted. X, Y and
        Z are how steady the monthly demand is; <strong>?</strong> means too few months to say.
      </p>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Class</th>
            <th>Share of revenue</th>
            <th>Units/mo</th>
            <th>Cover</th>
          </tr>
        </thead>
        <tbody>
          {run.classification.map((c) => (
            <tr key={c.handle}>
              <td>{c.title}</td>
              <td className="mono">
                {c.abc}
                {c.xyz}
              </td>
              <td>{(c.revenueShare * 100).toFixed(1)}%</td>
              <td>{c.unitsPerMonth.toFixed(1)}</td>
              <td>{c.monthsOfCover === null ? "—" : `${c.monthsOfCover.toFixed(1)} mo`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {d.decisions.length > 0 && (
        <>
          <h2>Your decisions</h2>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Proposal</th>
              </tr>
            </thead>
            <tbody>
              {d.decisions.map((x, i) => (
                <tr key={i}>
                  <td className="muted">{x.ts.slice(0, 16).replace("T", " ")}</td>
                  <td>{x.action}</td>
                  <td className="mono muted">{x.candidateId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function FactRow({ facts }: { facts: Array<{ label: string; value: string }> }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12.5 }}>
      {facts.map((f) => (
        <span key={f.label} className="muted">
          {f.label} <strong style={{ color: "#16211c" }}>{f.value}</strong>
        </span>
      ))}
    </div>
  );
}
