import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import { discoveryDocument, UCP_VERSION, capabilities, paymentHandlers } from "../lib/ucp.server";
import {
  installSnippets,
  guessHost,
  staticProfile,
  verifyInstall,
  agentActivity,
  type VerifyResult,
} from "../lib/agentfront.server";
import { announceable } from "../lib/approvals.server";
import { DEFAULT_PAYMENT_METHODS } from "../lib/razorpay.server";
import { TOOLS } from "../lib/ucptools";

/**
 * The agent-readable storefront, explained to the merchant who has to enable it.
 *
 * THE PAGE HAS ONE JOB BEYOND INSTRUCTIONS, and it is the last step, not the
 * first: Verify. Everything above it is a snippet a merchant might have pasted
 * in the wrong file, into the wrong branch, or into a config that never
 * deployed. An install nobody checked is an install that is hoped for, and this
 * one fails silently — a missing redirect rule looks exactly like nobody
 * shopping. So the button does what a shopper's agent does, in order, and says
 * which step broke.
 *
 * It also says plainly that a Shopify merchant does not need any of this.
 * Shopify already serves UCP on every store, and selling a merchant a thing
 * they were given for free is the sort of quiet dishonesty this product is
 * otherwise built to avoid. The gap is custom storefronts.
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
        const origin = s.origins[0] ?? "";
        const profileUrl = `${base}/ucp/${s.key}/profile`;

        // One cheap HEAD-ish probe on page load, for the status pill and to
        // guess their stack from what their server says about itself. The full
        // stepwise check is the Verify button — this one must not make the
        // dashboard slow to open.
        let serving = false;
        let guessed: string | null = null;
        if (origin) {
          try {
            const res = await fetch(`${origin}/.well-known/ucp`, {
              headers: { accept: "application/json" },
              signal: AbortSignal.timeout(2500),
            });
            serving = res.ok;
            guessed = guessHost(res.headers);
          } catch {
            // Unreachable is a legitimate answer and the pill says so. The
            // detail belongs to Verify, which the merchant asked for.
          }
        }

        return {
          key: s.key,
          name: s.name,
          origin,
          serving,
          guessed,
          payable: Boolean(s.razorpay),
          handlers: Object.keys(paymentHandlers(s)),
          // What agents are TOLD this store takes. Shown as the methods rather
          // than as the handler id, because "in.razorpay.checkout" tells a
          // merchant nothing about whether UPI is on.
          methods: s.razorpay ? (s.razorpay.methods ?? DEFAULT_PAYMENT_METHODS) : [],
          // The same `activeOffers` record the assistant reads and the quote
          // prices from. One source, so the page cannot show an offer that is
          // not really live.
          offers: announceable(s.key),
          activity: agentActivity(s.key),
          profileUrl,
          snippets: installSnippets(profileUrl),
          staticDoc: staticProfile(s, base),
          endpoint: discoveryDocument(s, base).ucp.services["dev.ucp.shopping"][0].endpoint,
        };
      }),
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = await requireMerchant(request);
  const form = await request.formData();
  const key = String(form.get("site") ?? "");

  // Scoped at the write, not only at the read. Verify makes this server fetch a
  // URL, so the set of URLs it will fetch has to be the merchant's OWN
  // registered origins and nothing else — a probe that took a URL from a form
  // is a request forger with a login page in front of it.
  const site = sitesForMerchant(merchant.sites).find((s) => s.key === key);
  if (!site) return { error: "not your store" as const, result: null };

  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? u.host;

  return { error: null, result: await verifyInstall(site, `${proto}://${host}`) };
};

const PILL: Record<string, string> = {
  pass: "available",
  fail: "needs_setup",
  warn: "building",
  skip: "planned",
};

function Steps({ result }: { result: VerifyResult }) {
  return (
    <div className="panel" style={{ borderColor: result.ok ? "#c9d8d0" : "var(--warn)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className={`pill ${result.ok ? "available" : "needs_setup"}`}>
          {result.ok ? "Working" : "Not working yet"}
        </span>
        <span className="mono muted">{result.origin}</span>
      </div>
      <table style={{ marginTop: 12 }}>
        <tbody>
          {result.steps.map((s, i) => (
            <tr key={i}>
              <td style={{ width: 92 }}>
                <span className={`pill ${PILL[s.state]}`}>{s.state}</span>
              </td>
              <td>
                <strong style={{ fontWeight: 550 }}>{s.label}</strong>
                <br />
                <span className="mono muted">{s.detail}</span>
                {s.why && s.state !== "pass" ? (
                  <>
                    <br />
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {s.why}
                    </span>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note" style={{ marginBottom: 0 }}>
        Checked {new Date(result.checkedAt).toLocaleString()}. Worth re-running after any deploy:
        this is the kind of thing that disappears in a redirect config and gives no error when it
        does.
      </p>
    </div>
  );
}

export default function AgentFront() {
  const d = useLoaderData<typeof loader>();
  const verified = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

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

      {d.sites.map((s) => (
        <section key={s.key}>
          <h2>{s.name}</h2>

          <div className="stats">
            <div className="stat">
              <b style={{ fontSize: 15, fontWeight: 600 }}>
                <span className={`pill ${s.serving ? "available" : "needs_setup"}`}>
                  {s.serving ? "Serving" : "Not serving"}
                </span>
              </b>
              <span>{s.origin || "no origin registered"}</span>
            </div>
            <div className="stat">
              <b style={{ fontSize: 15, fontWeight: 600 }}>
                <span className={`pill ${s.payable ? "available" : "planned"}`}>
                  {s.payable ? "Payments on" : "Payments off"}
                </span>
              </b>
              <span>
                {s.payable ? s.methods.join(", ") : "agents can browse and cart, not check out"}
              </span>
            </div>
            <div className="stat">
              <b style={{ fontSize: 15, fontWeight: 600 }}>
                <span className={`pill ${s.offers.length ? "available" : "planned"}`}>
                  {s.offers.length ? `${s.offers.length} offer${s.offers.length > 1 ? "s" : ""}` : "No offers"}
                </span>
              </b>
              <span>{s.offers.length ? "agents see these automatically" : "agents see full price"}</span>
            </div>
          </div>

          {s.payable && !s.methods.includes("upi") ? (
            <p className="note">
              <strong>UPI is not advertised to agents</strong>, because this account cannot take it
              yet — Razorpay refuses it until KYC completes. We tell agents{" "}
              <code>{s.methods.join(", ")}</code> and nothing more. Naming a method your checkout
              page will not offer sends buyers looking for a button that is not there. When KYC
              clears, add <code>methods: ["upi", …]</code> to this store in{" "}
              <code>sites.server.ts</code> and discovery, the escalation message and the payment page
              all follow from that one edit.
            </p>
          ) : null}

          {s.offers.length > 0 ? (
            <>
              <h3>Offers an agent can see right now</h3>
              <p className="muted" style={{ fontSize: 13.5, maxWidth: "64ch", margin: "4px 0 0" }}>
                These come from the same approvals the assistant reads. An agent gets the{" "}
                <em>terms</em> — which product, what percentage, until when — and never a price it
                worked out. The rupees are computed here, by the server that charges them, and
                itemised in the cart as a negative line. There is no field an agent could send a
                discount in.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Off</th>
                    <th>Until</th>
                  </tr>
                </thead>
                <tbody>
                  {s.offers.map((o) => (
                    <tr key={o.handle}>
                      <td>{o.title}</td>
                      <td className="mono">{o.percent}%</td>
                      <td className="mono muted">{o.endsAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          <h3>Step 1 — add one line</h3>
          <p className="muted" style={{ fontSize: 13.5, maxWidth: "64ch", margin: "4px 0 0" }}>
            Make <code>/.well-known/ucp</code> on <em>your</em> domain point at the document we
            serve for you. It has to be your domain: that is the only place an agent looks — nobody
            queries a directory, they ask the store. Which also means you revoke us by deleting one
            line.
          </p>
          <p className="note">
            A redirect is enough. We measured this against the <code>ucp</code> CLI, the reference
            client Shopify publishes: it follows a cross-origin redirect on this path, both 301 and
            302. So there is no file to host and nothing to keep up to date — the redirect resolves
            live, and turning on payments shows up in discovery the moment you save.
          </p>

          <Snippets snippets={s.snippets} guessed={s.guessed} />

          <h3>What agents have done here</h3>
          {s.activity.calls === 0 ? (
            <p className="note">
              Nothing yet. That is the expected state until an agent finds you — and it is also
              exactly what a broken install looks like, which is why the Verify button below exists
              and why it is worth re-running after a deploy.
            </p>
          ) : (
            <>
              <div className="stats">
                <div className="stat">
                  <b>{s.activity.calls}</b>
                  <span>calls</span>
                </div>
                <div className="stat">
                  <b>{s.activity.checkouts}</b>
                  <span>checkouts opened</span>
                </div>
                <div className="stat">
                  <b>{s.activity.orders}</b>
                  <span>orders paid</span>
                </div>
                <div className="stat">
                  <b>₹{s.activity.revenue.toLocaleString("en-IN")}</b>
                  <span>settled</span>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                From {s.activity.hosts.length === 1 ? "one agent" : `${s.activity.hosts.length} agents`}:{" "}
                <span className="mono">{s.activity.hosts.slice(0, 3).join(", ")}</span>
                {s.activity.hosts.length > 3 ? ` and ${s.activity.hosts.length - 3} more` : ""}. Every checkout is
                attributable to a host because we fetch the caller's profile before holding any
                stock — an agent that will not say who it is does not get to reserve your inventory.
              </p>
              <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
                <strong>Orders are counted only once the payment settled.</strong> An opened checkout
                is intent, and counting intent as revenue is how a dashboard flatters itself.
              </p>
              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {s.activity.recent.map((r, i) => (
                    <tr key={i}>
                      <td className="mono muted" style={{ whiteSpace: "nowrap" }}>
                        {new Date(r.ts).toLocaleTimeString()}
                      </td>
                      <td>
                        {r.message}
                        {r.amount != null ? (
                          <>
                            {" "}
                            <strong>₹{r.amount.toLocaleString("en-IN")}</strong>
                          </>
                        ) : null}
                      </td>
                      <td className="mono muted">{r.agent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note">
                The full record, including everything the assistant was stopped from saying, is in
                the <a href="/dashboard/ledger">ledger</a>.
              </p>
            </>
          )}

          <h3>Step 2 — check it</h3>
          <p className="muted" style={{ fontSize: 13.5, maxWidth: "64ch", margin: "4px 0 8px" }}>
            This does exactly what a shopper&rsquo;s agent does, against your live domain, and
            reports each step separately — so a failure tells you <em>which</em> part is wrong
            rather than that something is.
          </p>
          <Form method="post">
            <input type="hidden" name="site" value={s.key} />
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Checking…" : "Verify install"}
            </button>
          </Form>

          {verified?.error ? <p className="note">{verified.error}</p> : null}
          {verified?.result && verified.result.origin === s.origin ? (
            <Steps result={verified.result} />
          ) : null}

          <details style={{ margin: "18px 0" }}>
            <summary className="muted" style={{ fontSize: 13.5, cursor: "pointer" }}>
              Try it yourself — point a real AI at this store
            </summary>
            <p className="muted" style={{ fontSize: 13.5, maxWidth: "64ch" }}>
              The endpoint speaks MCP, so an assistant can shop here with no adapter. In Claude
              Code or Claude Desktop, add this server:
            </p>
            <pre>
              <code>{s.endpoint}</code>
            </pre>
            <p className="muted" style={{ fontSize: 13.5, maxWidth: "64ch" }}>
              Then ask it to find something, check the offers, and buy. One thing it needs from
              you, because a model asked to invent an agent profile invents one that does not
              resolve — and holding your stock requires a caller we can look up:
            </p>
            <pre>
              <code>{`Use ${d.base}/agent/testing/profile as your ucp-agent profile.`}</code>
            </pre>
            <p className="note">
              That is a real profile document, labelled as a test harness rather than dressed up as
              a shopping platform — so the rows above can tell someone trying your store from real
              agent traffic. There is also{" "}
              <code>node scripts/shop-as-agent.mjs</code>, which drives the same eight steps from a
              terminal and prints each one, for when something fails and you need to know where.
            </p>
          </details>

          <details style={{ margin: "18px 0" }}>
            <summary className="muted" style={{ fontSize: 13.5, cursor: "pointer" }}>
              My host cannot redirect — give me a file to upload
            </summary>
            <p className="note">
              Rare, and worth avoiding: a file is a <em>copy</em>. If you configure payments later,
              this one will keep telling agents you take none, and nothing will look broken — they
              will simply hand every checkout back to the buyer instead of paying. Verify compares
              your file against what we would serve today and warns you when they drift, but a
              redirect cannot drift in the first place.
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Save as <code>ucp</code> (no extension) at <code>/.well-known/ucp</code>, served as{" "}
              <code>application/json</code>:
            </p>
            <pre>
              <code>{s.staticDoc}</code>
            </pre>
          </details>
        </section>
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
          <strong>Invent an offer.</strong> Agents see the discounts <em>you</em> approved, as terms
          — never as a number they worked out. The rupees are computed here, by the same server that
          charges them, and there is no field an agent could send a discount in.
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

/**
 * The snippet picker.
 *
 * Their stack is preselected when the guess is confident, and the guess is
 * labelled as one. Header sniffing is right often enough to save a merchant a
 * scroll and wrong often enough that stating it as fact would have someone
 * paste an nginx block into a Netlify config and conclude we are broken.
 */
function Snippets({
  snippets,
  guessed,
}: {
  snippets: Array<{ host: string; where: string; lang: string; body: string; proxies?: boolean }>;
  guessed: string | null;
}) {
  const redirects = snippets.filter((s) => !s.proxies);
  const proxies = snippets.filter((s) => s.proxies);
  const initial = redirects.findIndex((s) => s.host === guessed);
  const [pick, setPick] = useState(initial >= 0 ? initial : 0);
  const chosen = redirects[pick];

  return (
    <>
      <div className="tabs" style={{ flexWrap: "wrap", marginBottom: 4 }}>
        {redirects.map((s, i) => (
          <a
            key={s.host}
            href="#pick"
            onClick={(e) => {
              e.preventDefault();
              setPick(i);
            }}
            {...(i === pick ? { "aria-current": "true" as const } : {})}
          >
            {s.host}
          </a>
        ))}
      </div>
      {guessed ? (
        <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
          Your server&rsquo;s headers look like <strong>{guessed}</strong> — a guess, so check it
          against what you actually run.
        </p>
      ) : null}
      <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
        {chosen.where}
      </p>
      <pre>
        <code>{chosen.body}</code>
      </pre>
      <details>
        <summary className="muted" style={{ fontSize: 13, cursor: "pointer" }}>
          I would rather proxy it than redirect
        </summary>
        <p className="note">
          Also fine, and slightly better in one way: the request finishes on your origin, so your
          domain stays the only host an agent talks to for discovery. It costs you a deploy and a
          little code. Cache it for a minute and serve the last good copy if we are unreachable — an
          agent that gets a 502 here concludes your store does not speak the protocol at all, which
          is far worse than a document sixty seconds stale.
        </p>
        {proxies.map((s) => (
          <div key={s.host}>
            <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
              {s.host} — {s.where}
            </p>
            <pre>
              <code>{s.body}</code>
            </pre>
          </div>
        ))}
      </details>
    </>
  );
}
