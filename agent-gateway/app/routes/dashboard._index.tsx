import { Link, useLoaderData } from "react-router";
import { FEATURES, STATUS_LABEL } from "../lib/features.server";
import { readLedger } from "../lib/ledger.server";
import type { LoaderFunctionArgs } from "react-router";
import { sitesForMerchant } from "../lib/sites.server";
import { requireMerchant } from "../lib/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Scoped to this merchant, never allSites(): a console page that forgets to
  // filter is how one merchant sees another.
  const merchant = requireMerchant(request);
  const ledger = readLedger(2000);
  return {
    features: FEATURES,
    sites: sitesForMerchant(merchant.sites).map((s) => ({ key: s.key, name: s.name, origins: s.origins })),
    counts: {
      replies: ledger.filter((e) => e.kind === "reply").length,
      refusals: ledger.filter((e) => e.kind === "refusal").length,
    },
  };
};

export default function Features() {
  const { features, sites, counts } = useLoaderData<typeof loader>();
  const live = features.filter((f) => f.status === "available");
  const rest = features.filter((f) => f.status !== "available");

  return (
    <>
      <h1>What CHAPMAN can do for {sites[0]?.name ?? "your store"}</h1>
      <p className="lede">
        One feature is live. The rest are listed with the exact thing standing in the way, because
        a roadmap you can check is worth more than a page of “coming soon”.
      </p>

      <div className="stats">
        <div className="stat">
          <b>{counts.replies}</b>
          <span>replies sent</span>
        </div>
        <div className="stat">
          <b>{counts.refusals}</b>
          <span>claims blocked</span>
        </div>
        <div className="stat">
          <b>{sites.length}</b>
          <span>storefront{sites.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <h2>Live now</h2>
      <div className="grid">
        {live.map((f) => (
          <div className="card live" key={f.key}>
            <div className="name">
              {f.name}
              <span className={`pill ${f.status}`}>{STATUS_LABEL[f.status]}</span>
            </div>
            <p className="blurb">{f.blurb}</p>
            {f.href ? (
              <Link className="open" to={f.href}>
                Open →
              </Link>
            ) : null}
          </div>
        ))}
      </div>

      <h2>Not yet</h2>
      <div className="grid">
        {rest.map((f) => (
          <div className="card" key={f.key}>
            <div className="name">
              {f.name}
              <span className={`pill ${f.status}`}>{STATUS_LABEL[f.status]}</span>
            </div>
            <p className="blurb">{f.blurb}</p>
            {f.unlockedBy ? <div className="unlock">{f.unlockedBy}</div> : null}
          </div>
        ))}
      </div>

      <p className="note">
        This console is not authenticated yet — it reads a single development merchant. That is the
        next thing it needs, and saying so here is cheaper than discovering it in a demo.
      </p>
    </>
  );
}
