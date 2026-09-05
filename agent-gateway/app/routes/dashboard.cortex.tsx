import { Link, useLoaderData } from "react-router";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { buildCortex, isStale, shopperView } from "../lib/cortex.server";
import type { LoaderFunctionArgs } from "react-router";
import { sitesForMerchant } from "../lib/sites.server";
import { requireMerchant } from "../lib/auth.server";

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
  } };
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
                {shopper.voice ?? (
                  <span className="muted">not set — the assistant sounds generic without it</span>
                )}
              </td>
            </tr>
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
