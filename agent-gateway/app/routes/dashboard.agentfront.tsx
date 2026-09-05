import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import { discoveryDocument, UCP_VERSION, capabilities, paymentHandlers } from "../lib/ucp.server";
import { TOOLS } from "../lib/ucptools.server";

/**
 * The agent-readable storefront, explained to the merchant who has to enable it.
 *
 * The page has one job beyond instructions: to say plainly that a Shopify
 * merchant does not need this. Shopify already serves UCP on every store, and
 * selling a merchant a thing they were given for free is the sort of quiet
 * dishonesty that this product is otherwise built to avoid. The gap is custom
 * storefronts, and that is what the page offers to close.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = await requireMerchant(request);
  const sites = sitesForMerchant(merchant.sites);

  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? u.host;
  const base = `${proto}://${host}`;

  return {
    base,
    version: UCP_VERSION,
    toolCount: TOOLS.length,
    capabilityNames: Object.keys(capabilities()),
    sites: await Promise.all(
      sites.map(async (s) => {
        // The merchant's own origin is the one that matters — a discovery
        // document only we can serve is a document no agent will ever look for.
        // So the status shown is the result of actually fetching theirs.
        const origin = s.origins[0] ?? "";
        let live: { ok: boolean; detail: string } = { ok: false, detail: "not checked" };
        if (origin) {
          try {
            const res = await fetch(`${origin}/.well-known/ucp`, {
              headers: { accept: "application/json" },
              signal: AbortSignal.timeout(2500),
            });
            if (!res.ok) {
              live = { ok: false, detail: `returned ${res.status}` };
            } else {
              const doc = (await res.json()) as {
                ucp?: { version?: string; services?: Record<string, Array<{ endpoint?: string }>> };
              };
              const ep = doc.ucp?.services?.["dev.ucp.shopping"]?.[0]?.endpoint;
              live = ep
                ? { ok: true, detail: `points at ${ep}` }
                : { ok: false, detail: "served, but names no shopping endpoint" };
            }
          } catch (e) {
            live = { ok: false, detail: e instanceof Error ? e.message : "unreachable" };
          }
        }
        return {
          key: s.key,
          name: s.name,
          origin,
          live,
          payable: Boolean(s.razorpay),
          handlers: Object.keys(paymentHandlers(s)),
          profileUrl: `${base}/ucp/${s.key}/profile`,
          endpoint: discoveryDocument(s, base).ucp.services["dev.ucp.shopping"][0].endpoint,
        };
      }),
    ),
  };
};

export default function AgentFront() {
  const d = useLoaderData<typeof loader>();

  return (
    <>
      <h1>Agent-readable storefront</h1>
      <p className="lede">
        When a shopper asks their AI assistant to buy from you, the assistant needs a machine
        surface to talk to. This gives your store one — the same protocol the largest stores
        already speak, so an agent that has never heard of you can still find, price and buy
        your products.
      </p>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>If you are on Shopify, you already have this</h3>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>
          Shopify serves UCP on every store at <code>/.well-known/ucp</code> — we checked
          allbirds.com and gymshark.com while building this and both answer. You do not need us for
          it, and we are not going to charge you for something you were given. What follows is for
          custom storefronts, which get nothing by default.
        </p>
      </div>

      <h2>Your stores</h2>
      <table>
        <thead>
          <tr>
            <th>Store</th>
            <th>Discovery on your origin</th>
            <th>Agent payments</th>
          </tr>
        </thead>
        <tbody>
          {d.sites.map((s) => (
            <tr key={s.key}>
              <td>
                <strong>{s.name}</strong>
                <br />
                <span className="mono muted">{s.origin || "no origin registered"}</span>
              </td>
              <td>
                <span className={`pill ${s.live.ok ? "available" : "needs_setup"}`}>
                  {s.live.ok ? "Live" : "Not serving"}
                </span>
                <br />
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {s.live.detail}
                </span>
              </td>
              <td>
                {s.payable ? (
                  <>
                    <span className="pill available">Enabled</span>
                    <br />
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {s.handlers.join(", ")}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pill planned">Off</span>
                    <br />
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      agents can browse and build carts, but not open a checkout
                    </span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>What you have to add</h2>
      <p className="muted" style={{ fontSize: 13.5, maxWidth: "62ch" }}>
        One route. Make <code>/.well-known/ucp</code> on <em>your</em> domain return the document we
        serve for you. It has to be your domain because that is the only place an agent looks — nobody
        queries a directory, they ask the store. Which also means you revoke us by deleting the route.
      </p>

      {d.sites.map((s) => (
        <div key={s.key} className="panel">
          <h3 style={{ marginTop: 0 }}>{s.name}</h3>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
            Proxy this URL:
          </p>
          <pre>
            <code>{s.profileUrl}</code>
          </pre>

          <h3>Go</h3>
          <pre>
            <code>{`http.HandleFunc("/.well-known/ucp", func(w http.ResponseWriter, r *http.Request) {
    res, err := http.Get("${s.profileUrl}")
    if err != nil { http.Error(w, "discovery unavailable", 502); return }
    defer res.Body.Close()
    w.Header().Set("Content-Type", "application/json")
    io.Copy(w, res.Body)
})`}</code>
          </pre>

          <h3>Express</h3>
          <pre>
            <code>{`app.get("/.well-known/ucp", async (_req, res) => {
  const r = await fetch("${s.profileUrl}");
  res.type("application/json").send(await r.text());
});`}</code>
          </pre>

          <h3>Nginx, with no application change at all</h3>
          <pre>
            <code>{`location = /.well-known/ucp {
    proxy_pass ${s.profileUrl};
    proxy_set_header Host $host;
}`}</code>
          </pre>

          <p className="note">
            Cache it for a minute or so, and serve the last good copy if we are unreachable. An agent
            that gets a 502 here concludes your store does not speak the protocol at all, which is a
            much worse outcome than a document that is sixty seconds stale.
          </p>
        </div>
      ))}

      <h2>What an agent can then do</h2>
      <p className="muted" style={{ fontSize: 13.5, maxWidth: "62ch" }}>
        {d.toolCount} operations, version {d.version}. Reads are open to anyone. Anything that holds
        your stock or opens a payment requires the agent to publish a profile document we can fetch,
        so every hold and every checkout is attributable to a host you can see in the ledger.
      </p>
      <table>
        <thead>
          <tr>
            <th>Operation</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {TOOLS.map((t) => (
            <tr key={t.name}>
              <td className="mono">{t.name}</td>
              <td className="muted">{t.description.split(".")[0]}.</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>What it cannot do</h2>
      <ul className="muted" style={{ fontSize: 13.5, maxWidth: "64ch", paddingLeft: 20 }}>
        <li>
          <strong>Set a price.</strong> Every basket is re-priced from your catalogue at the moment
          of checkout. An agent may send a price; it is read past and discarded.
        </li>
        <li>
          <strong>Hold stock by browsing.</strong> Carts reserve nothing. Only a checkout holds
          units, for fifteen minutes, and cancelling releases them at once.
        </li>
        <li>
          <strong>Read your customers.</strong> An agent can read back an order it placed itself.
          Your own order history needs the shopper&rsquo;s verified sign-in — an order number is
          printed on a receipt and is not proof of who is asking.
        </li>
        <li>
          <strong>Complete a UPI payment.</strong> UPI authenticates the payer inside their own
          banking app. The agent gets a link and hands it to the buyer. That is a defined outcome in
          the protocol, not a shortfall — and it is the only honest one on Indian rails.
        </li>
      </ul>
    </>
  );
}
