import { Link, useLoaderData, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { readLedger } from "../lib/ledger.server";
import { sitesForMerchant } from "../lib/sites.server";
import { requireMerchant } from "../lib/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // The snippet must carry the origin the merchant will actually call. Printing
  // a hardcoded localhost here is how a copy-paste install silently fails once
  // the tunnel URL rotates.
  const base = `${url.protocol}//${url.host}`;
  const site = sitesForMerchant(requireMerchant(request).sites)[0] ?? null;
  const ledger = readLedger(2000);

  const gates: Record<string, number> = {};
  for (const e of ledger) if (e.kind === "refusal" && e.gate) gates[e.gate] = (gates[e.gate] ?? 0) + 1;

  return {
    base,
    site,
    counts: {
      replies: ledger.filter((e) => e.kind === "reply").length,
      refusals: ledger.filter((e) => e.kind === "refusal").length,
      errors: ledger.filter((e) => e.kind === "tool_error").length,
    },
    gates,
    recent: ledger.slice(-8).reverse(),
  };
};

const GATE_LABEL: Record<string, string> = {
  unverifiable_discount: "invented a discount",
  unverifiable_urgency: "invented a deadline",
  unapproved_event: "invented festive scarcity",
  assumed_observance: "assumed what someone celebrates",
  ungrounded_claim: "unsupported claim",
  insufficient_data: "too little data",
};

export default function Chatbot() {
  const { base, site, counts, gates, recent } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const platform = params.get("platform") === "shopify" ? "shopify" : "custom";

  const snippet = `<script src="${base}/embed.js"
        data-site="${site?.key ?? "YOUR_SITE_KEY"}"
        data-greeting="${site?.greeting ?? "Ask me anything about our products."}"
        data-accent="${site?.accent ?? "#1f4037"}"
        defer></script>`;

  return (
    <>
      <p className="muted" style={{ marginTop: 22, fontSize: 13.5 }}>
        <Link to="/dashboard" style={{ textDecoration: "none" }}>
          ← Features
        </Link>
      </p>
      <h1>Storefront assistant</h1>
      <p className="lede">
        Answers from your live catalogue and your own policy text. It cannot offer a discount you
        have not approved, and it cannot invent a deadline — those are blocked in code, outside the
        model, where the model cannot argue with them.
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
          <b>{counts.errors}</b>
          <span>errors</span>
        </div>
      </div>

      {Object.keys(gates).length ? (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>What was blocked</h3>
          <table>
            <tbody>
              {Object.entries(gates)
                .sort((a, b) => b[1] - a[1])
                .map(([g, n]) => (
                  <tr key={g}>
                    <td style={{ width: 60 }}>
                      <b>{n}</b>
                    </td>
                    <td>{GATE_LABEL[g] ?? g}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h2>Install</h2>
      <div className="tabs">
        <a href="?platform=custom" {...(platform === "custom" ? { "aria-current": "page" } : {})}>
          Custom website
        </a>
        <a href="?platform=shopify" {...(platform === "shopify" ? { "aria-current": "page" } : {})}>
          Shopify
        </a>
      </div>

      {platform === "custom" ? (
        <div className="panel">
          <ol className="steps">
            <li>
              Paste this one tag before <code>&lt;/body&gt;</code> on every page you want the
              assistant on. Nothing else changes, and there is no build step.
              <pre>
                <code>{snippet}</code>
              </pre>
            </li>
            <li>
              Publish a catalogue feed at a URL we can read — prices, stock and your policy text as
              JSON. Currently reading{" "}
              <code className="mono">{site?.catalogFeedUrl ?? "not set"}</code>.
            </li>
            <li>
              Tell us which origins may embed it. Registered:{" "}
              {(site?.origins ?? []).map((o) => (
                <code key={o} className="mono">
                  {o}{" "}
                </code>
              ))}
            </li>
          </ol>
          <p className="note">
            The site key sits in your public HTML and is an identifier, not a secret. What actually
            gates the widget is the origin list above — a browser sets that header itself and page
            scripts cannot forge it. Rate limits, not secrecy, are what stop a non-browser client
            burning your quota, and those are not built yet.
          </p>
        </div>
      ) : (
        <div className="panel">
          <ol className="steps">
            <li>Install the CHAPMAN app on your store.</li>
            <li>
              In <b>Online Store → Themes → Customise → App embeds</b>, turn on{" "}
              <b>CHAPMAN assistant</b>. Shopify requires you to do this yourself — an app cannot
              switch on its own embed, which is why this is one toggle rather than zero.
            </li>
            <li>
              Nothing else. Your catalogue, prices, stock and policies come through the Shopify
              Admin API, and requests reach us through the App Proxy at{" "}
              <code className="mono">/apps/agent/*</code>, signed by Shopify.
            </li>
          </ol>
          <p className="note">
            No theme code is edited and no file is added to your theme. Removing the app removes the
            assistant.
          </p>
        </div>
      )}

      <h2>Where conversations are stored</h2>
      <div className="panel">
        <p style={{ marginTop: 0 }}>
          Right now, in an append-only file on this server — every reply, every blocked claim, and
          the message that prompted it. It moves to a real database next.
        </p>
        <p>
          <b>We do not ask for credentials to your database.</b> Handing an app write access to your
          production data is a large, permanent risk in exchange for a log file, and it would make
          installing CHAPMAN a far bigger decision than it needs to be. Conversations are ours to
          keep and yours to take: export them, or have them pushed to a webhook or bucket you own.
        </p>
        <p style={{ marginBottom: 0 }}>
          Reading <i>your</i> data — orders, carts — is the opposite case and works the other way
          round. See <b>Order &amp; cart access</b> on the features page.
        </p>
      </div>

      <h2>Recent activity</h2>
      <div className="panel">
        {recent.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing yet. Send a message through the widget and it will appear here.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e, i) => (
                <tr key={i}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>
                    {e.ts.slice(5, 16).replace("T", " ")}
                  </td>
                  <td>
                    {e.kind === "refusal" ? (
                      <span className="pill needs_setup">blocked</span>
                    ) : e.kind === "tool_error" ? (
                      <span className="pill planned">error</span>
                    ) : (
                      <span className="pill available">reply</span>
                    )}
                  </td>
                  <td>{e.message.length > 90 ? e.message.slice(0, 90) + "…" : e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
