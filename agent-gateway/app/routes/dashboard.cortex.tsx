import { Form, Link, useLoaderData, useNavigation } from "react-router";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { buildCortex, isStale, shopperView } from "../lib/cortex.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { sitesForMerchant } from "../lib/sites.server";
import { requireMerchant } from "../lib/auth.server";
import { writeSettings } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const site = sitesForMerchant(requireMerchant(request).sites)[0];
  if (!site) throw new Response("no storefront on this account", { status: 404 });
  const cortex = await buildCortex({
    site,
    catalog: jsonFeedCatalog(site.catalogFeedUrl),
  });
  return { cortex, shopper: shopperView(cortex), stale: {
    policies: isStale(cortex.policies),
    catalogue: isStale(cortex.catalogue),
    commerce: cortex.commerce ? isStale(cortex.commerce) : false,
    findings: cortex.findings ? isStale(cortex.findings) : false,
    notices: isStale(cortex.serviceNotices),
  } };
};

/**
 * The one thing on this page a merchant can write.
 *
 * Everything else in the cortex is derived, and deliberately so — a typed
 * number goes stale silently while looking authoritative. The voice is the
 * exception because there is no data anywhere that could tell us how a shop
 * wants to sound. Until this form existed, `buildCortex` accepted a voice that
 * nothing ever supplied, so the cortex reported the same gap forever.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  if (!merchant.sites.includes(shop)) return { ok: false, error: "not your store" };
  const res = writeSettings(shop, { voice: String(form.get("voice") ?? "") }, merchant.email);
  return { ok: res.ok, error: res.error };
};

const age = (at: string) => {
  const m = Math.round((Date.now() - Date.parse(at)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

function Src({ from, at, stale }: { from: string; at: string; stale?: boolean }) {
  return (
    <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
      {" "}
      · {from}, {age(at)}
      {stale ? <span style={{ color: "#8a6d2f" }}> · stale</span> : null}
    </span>
  );
}

export default function Cortex() {
  const { cortex: c, shopper, stale } = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <p className="muted" style={{ marginTop: 22, fontSize: 13.5 }}>
        <Link to="/dashboard" style={{ textDecoration: "none" }}>
          ← Features
        </Link>
      </p>
      <h1>What CHAPMAN knows about {c.name}</h1>
      <p className="lede">
        One shared memory of the shop, which every tool reads from instead of each keeping its own
        half-view. Almost all of it is worked out from your catalogue, orders and history — you type
        only what we genuinely cannot compute.
      </p>

      <h2>The assistant can see this</h2>
      <p className="muted" style={{ fontSize: 13.5, marginTop: -4 }}>
        Everything a shopper-facing reply could possibly be built from.
      </p>
      <div className="panel">
        <table>
          <tbody>
            <tr>
              <td style={{ width: 150 }}>
                <b>Shop</b>
              </td>
              <td>
                {shopper.name} · {shopper.currency} · sells{" "}
                {shopper.sells.categories.join(", ") || "—"} ({shopper.sells.products} products)
                <Src from={c.catalogue.from} at={c.catalogue.at} stale={stale.catalogue} />
              </td>
            </tr>
            <tr>
              <td>
                <b>Voice</b>
              </td>
              <td>
                {shopper.voice ? (
                  <>
                    “{shopper.voice}”
                    {c.voice ? <Src from={c.voice.from} at={c.voice.at} /> : null}
                  </>
                ) : (
                  <span className="muted">not set — the assistant sounds generic without it</span>
                )}
              </td>
            </tr>
            {shopper.serviceNotices.length > 0 && (
              <tr>
                <td>
                  <b>Service notices</b>
                </td>
                <td>
                  {shopper.serviceNotices.map((n) => (
                    <div key={n.text}>“{n.text}”</div>
                  ))}
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    Written here, not by the model. The assistant may repeat one word for word when it
                    is relevant, and cannot reach the finding underneath it — not the failure rate,
                    not the date.
                    <Src from={c.serviceNotices.from} at={c.serviceNotices.at} stale={stale.notices} />
                  </div>
                </td>
              </tr>
            )}
            {(["returns", "shipping", "cod"] as const).map((k) => (
              <tr key={k}>
                <td>
                  <b style={{ textTransform: "capitalize" }}>{k}</b>
                </td>
                <td>
                  {shopper.policies[k] ?? <span className="muted">—</span>}
                  {k === "cod" ? (
                    <Src from={c.policies.from} at={c.policies.at} stale={stale.policies} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Note what is not on that list: costs, margins, floors, order volumes, rejected proposals.
        The assistant is not asked to keep them secret — it is never handed them, which is a
        stronger guarantee.
      </p>

      <h3>How should this shop sound?</h3>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 8px", maxWidth: "62ch" }}>
        The one thing here we cannot work out from your data. It changes the register of a reply and
        nothing else — every limit still applies, whatever you write, and the checks that stop a
        fabricated discount do not read this at all.
      </p>
      <Form method="post" className="panel">
        <input type="hidden" name="shop" value={c.key} />
        <textarea
          name="voice"
          rows={3}
          defaultValue={c.voice?.value ?? ""}
          placeholder="Plain and unhurried. We are a small estate, not a supermarket — no exclamation marks, no pressure."
          style={{
            width: "100%",
            font: "inherit",
            fontSize: 13.5,
            padding: "8px 10px",
            border: "1px solid var(--line)",
            borderRadius: 7,
            background: "var(--bg)",
            color: "var(--ink)",
            resize: "vertical",
          }}
        />
        <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: 10 }}>
          Save voice
        </button>
      </Form>

      <h2>Only you can see this</h2>
      <div className="panel">
        <table>
          <tbody>
            <tr>
              <td style={{ width: 150 }}>
                <b>Limits you set</b>
              </td>
              <td>
                {c.constraints ? (
                  <>
                    never below {c.constraints.value.minMarginPct}% margin · never more than{" "}
                    {c.constraints.value.maxDiscountPct}% off · never discount{" "}
                    {c.constraints.value.neverDiscount.join(", ") || "—"} · never advise on fewer
                    than {c.constraints.value.minSampleSize} data points
                    <Src from={c.constraints.from} at={c.constraints.at} />
                  </>
                ) : (
                  <span className="muted">not set</span>
                )}
              </td>
            </tr>
            <tr>
              <td>
                <b>Trade</b>
              </td>
              <td>
                {c.commerce ? (
                  <>
                    ~{c.commerce.value.ordersPerMonth} orders/month · average{" "}
                    {shopper.currency} {c.commerce.value.avgOrderValue} · best sellers:{" "}
                    {c.commerce.value.bestsellers.join(", ")}
                    <Src from={c.commerce.from} at={c.commerce.at} stale={stale.commerce} />
                  </>
                ) : (
                  <span className="muted">no order history connected</span>
                )}
              </td>
            </tr>
            <tr>
              <td>
                <b>Out of stock</b>
              </td>
              <td>{c.catalogue.value.outOfStock.join(", ") || <span className="muted">nothing</span>}</td>
            </tr>
            <tr>
              <td>
                <b>Last analysis</b>
              </td>
              <td>
                {c.findings ? (
                  <>
                    {c.findings.value.incidents.length} incident
                    {c.findings.value.incidents.length === 1 ? "" : "s"} ·{" "}
                    {c.findings.value.topActions.length} ideas ranked · {c.findings.value.stopped} stopped
                    {c.findings.value.recovery ? (
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                        basket recovery: {c.findings.value.recovery.wouldContact} to write to,{" "}
                        {c.findings.value.recovery.suppressed} left alone, ₹
                        {c.findings.value.recovery.marginAtStake.toLocaleString("en-IN")} of margin at stake
                      </div>
                    ) : null}
                    {c.findings.value.incidents.map((i) => (
                      <div key={i.id} className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                        {i.title} · began around {i.onsetAt}, confirmed {i.detectedAt}
                      </div>
                    ))}
                    <Src from={c.findings.from} at={c.findings.at} stale={stale.findings} />
                  </>
                ) : (
                  <span className="muted">
                    never run — open Offers once and the proposer publishes what it finds back to here
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td>
                <b>Said &amp; stopped</b>
              </td>
              <td>
                {c.decisions.value.replies} replies · {c.decisions.value.refusals} claims blocked
                {Object.keys(c.decisions.value.byGate).length ? (
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                    {Object.entries(c.decisions.value.byGate)
                      .map(([g, n]) => `${g} ×${n}`)
                      .join(" · ")}
                  </div>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>What is still missing</h2>
      <p className="muted" style={{ fontSize: 13.5, marginTop: -4 }}>
        The gaps the agent keeps about itself, and who has to close each one.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Who</th>
              <th>What</th>
              <th>Unlocks</th>
            </tr>
          </thead>
          <tbody>
            {c.gaps.map((g, i) => (
              <tr key={i}>
                <td>
                  <span className={`pill ${g.who === "merchant" ? "needs_setup" : "planned"}`}>
                    {g.who === "merchant" ? "you" : "us"}
                  </span>
                </td>
                <td>{g.what}</td>
                <td className="muted">{g.unlocks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">
        This cortex belongs to <code className="mono">{c.key}</code> and nothing else reads it. Run
        two shops and you get two, with no path between them — even if the same person owns both.
      </p>
    </>
  );
}
