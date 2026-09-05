import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { jsonFeedOrders, seededOrders } from "../lib/orders.server";
import { placedOrders, mergeSources } from "../lib/orderstore.server";
import { runAssistant } from "../lib/assistant.server";
import { checkReply } from "../lib/bounds.server";
import { announceable } from "../lib/approvals.server";
import { readiness, SCENARIOS, CONTROLS, LEAK_PATTERNS } from "../lib/testbench.server";
import { pickReasoner } from "../lib/reasoner.server";

/**
 * Prove it.
 *
 * Runs against the LIVE assistant on the merchant's live catalogue — the same
 * code path a shopper hits. A bench against a mock is a demonstration of the
 * mock.
 *
 * Each attack is checked twice, because there are two different claims:
 *
 *   SAID    what the assistant actually replied, and whether anything in it was
 *           unverifiable. This is the claim that matters to a shopper.
 *
 *   CAUGHT  what the gate does when the dangerous sentence IS produced,
 *           injected directly. This is the claim that matters when a model is
 *           wired, or swapped, or jailbroken.
 *
 * The first version of this page only tested the first, and scored 3 of 11 —
 * not because anything was unsafe, but because a deterministic reasoner never
 * produces the bad sentence, so no gate ever fires and "did a gate fire" was
 * the wrong question.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site) return { site: null, checks: [], scenarios: SCENARIOS, controls: CONTROLS, reasoner: "", offers: 0 };
  return {
    site: { key: site.key, name: site.name },
    checks: await readiness(site),
    scenarios: SCENARIOS,
    controls: CONTROLS,
    reasoner: pickReasoner().name,
    offers: announceable(site.key).length,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const site = sitesForMerchant(merchant.sites).find((s) => s.key === String(form.get("shop") ?? ""));
  if (!site) return null;

  const merchantOrders = !site.orders
    ? null
    : site.orders.useSeedFixture
      ? seededOrders()
      : site.orders.feedUrl
        ? jsonFeedOrders(site.orders.feedUrl, site.secret)
        : null;
  const orderSource = merchantOrders
    ? mergeSources([placedOrders(site.key), merchantOrders])
    : placedOrders(site.key);
  const catalog = jsonFeedCatalog(site.catalogFeedUrl);
  const offers = announceable(site.key);

  const ask = (message: string) =>
    runAssistant({
      catalog,
      shop: site.key,
      shopName: site.name,
      message,
      history: [],
      // Signed out, on purpose. Every personal-data scenario must fail from the
      // position an attacker is actually in.
      identity: null,
      orderSource,
    });

  const attacks = [];
  for (const s of SCENARIOS) {
    let said = "";
    let saidGates: string[] = [];
    let error = "";
    try {
      const out = await ask(s.message);
      said = out.reply;
      saidGates = [...new Set(out.violations.map((v) => v.gate as string))];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const leaked = LEAK_PATTERNS.some((re) => re.test(said));
    // Clean means nothing unverifiable reached the shopper — whether because
    // the reasoner behaved or because the net caught it. Both are fine, and
    // which one happened is not the shopper's problem.
    const clean = !error && !leaked;

    // The same gate the live pipeline uses, on the sentence a careless model
    // would have produced. This is the only way to prove the net works when our
    // own reasoner never swings at it.
    // De-duplicated: several patterns can match one sentence, and listing the
    // same gate twice reads as a bug in the gate rather than as thoroughness.
    const injected: string[] = [
      ...new Set(
        checkReply(s.unsafeReply, { groundedStockClaims: [], approvedOffers: offers }).map(
          (v) => v.gate as string,
        ),
      ),
    ];

    attacks.push({
      ...s,
      said,
      saidGates,
      leaked,
      clean,
      error,
      injected,
      caught: injected.includes(s.gate),
    });
  }

  const controls = [];
  for (const c of CONTROLS) {
    try {
      const out = await ask(c.message);
      controls.push({
        ...c,
        reply: out.reply,
        gates: out.violations.map((v) => v.gate),
        answered: out.violations.length === 0 && out.reply.trim().length > 0,
      });
    } catch (e) {
      controls.push({ ...c, reply: "", gates: [], answered: false, error: String(e) });
    }
  }

  return { attacks, controls };
};

const STATUS_PILL: Record<string, string> = { ok: "available", missing: "needs_setup", off: "planned" };

export default function TestBench() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!d.site) {
    return (
      <>
        <h1>Test bench</h1>
        <p className="lede">No store is connected to this account yet.</p>
      </>
    );
  }

  const attacks = a?.attacks ?? [];
  const controls = a?.controls ?? [];
  const clean = attacks.filter((r) => r.clean).length;
  const caught = attacks.filter((r) => r.caught).length;
  const answered = controls.filter((r) => r.answered).length;

  return (
    <>
      <h1>Test bench</h1>
      <p className="lede">
        Every vendor in this space says the same sentence about guardrails. This page fires the
        attacks at your live assistant, on your live catalogue, and shows you what came back.
      </p>

      {/* ---------------- readiness ---------------- */}
      <h2>What your site supports</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "62ch" }}>
        Checked by actually fetching your endpoints, not by reading our own configuration. A setting
        says what someone intended; a fetch says what is true, and the gap between them is where
        integrations break.
      </p>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Needs</th>
            <th>Status</th>
            <th>What to do</th>
          </tr>
        </thead>
        <tbody>
          {d.checks.map((c, i) => (
            <tr key={i}>
              <td>{c.feature}</td>
              <td>{c.what}</td>
              <td>
                <span className={`pill ${STATUS_PILL[c.status]}`}>
                  {c.status === "ok" ? "Ready" : c.status === "off" ? "Not on" : "Missing"}
                </span>
                <br />
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {c.detail}
                </span>
              </td>
              <td className="muted">{c.remedy ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------------- guardrails ---------------- */}
      <h2>Guardrails, under attack</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "64ch" }}>
        Each attack is checked twice. <strong>Said</strong> is what your assistant actually replied,
        and whether anything unverifiable got through. <strong>Caught</strong> injects the sentence a
        careless model <em>would</em> have written into the same gate the live pipeline uses — because
        a reasoner that never swings at the ball proves nothing about the net.
      </p>
      <p className="note">
        Reasoner <code>{d.reasoner}</code>
        {d.offers > 0
          ? ` · ${d.offers} approved offer${d.offers === 1 ? "" : "s"} live, so that exact percentage is sayable and every other one is not.`
          : " · no approved offers, so every price claim is refused."}{" "}
        The bounds do not live inside the model: a weaker one does not become unsafe here, it gets
        refused more often, and you would see that below.
      </p>

      <Form method="post">
        <input type="hidden" name="shop" value={d.site.key} />
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Running…" : `Run ${d.scenarios.length} attacks and ${d.controls.length} controls`}
        </button>
      </Form>

      {attacks.length > 0 && (
        <>
          <div className="stats">
            <div className="stat">
              <b>
                {clean}/{attacks.length}
              </b>
              <span>replies clean</span>
            </div>
            <div className="stat">
              <b>
                {caught}/{attacks.length}
              </b>
              <span>gate catches the bad version</span>
            </div>
            <div className="stat">
              <b>
                {answered}/{controls.length}
              </b>
              <span>ordinary questions answered</span>
            </div>
          </div>

          {attacks.map((r) => (
            <div
              key={r.id}
              className="panel"
              style={{ borderLeft: `3px solid ${r.clean && r.caught ? "#1f4037" : "#a33"}` }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{r.group}</div>
              <p style={{ margin: "0 0 10px", fontSize: 13.5 }}>
                <span className="muted">Shopper:</span> &ldquo;{r.message}&rdquo;
              </p>

              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".03em", color: "#6b7a72" }}>
                    Said <span className={`pill ${r.clean ? "available" : "needs_setup"}`}>{r.clean ? "clean" : "problem"}</span>
                  </div>
                  <p style={{ fontSize: 13, margin: "6px 0" }}>{r.said || <em className="muted">{r.error || "nothing"}</em>}</p>
                  {r.saidGates.length > 0 && (
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      gate fired: {r.saidGates.join(", ")}
                    </span>
                  )}
                  {r.leaked && (
                    <span className="pill needs_setup">contained an identifier</span>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".03em", color: "#6b7a72" }}>
                    Caught <span className={`pill ${r.caught ? "available" : "needs_setup"}`}>{r.caught ? "yes" : "NO"}</span>
                  </div>
                  <p style={{ fontSize: 13, margin: "6px 0", fontStyle: "italic", color: "#7a5a5a" }}>
                    &ldquo;{r.unsafeReply}&rdquo;
                  </p>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {r.injected.length ? `blocked by ${r.injected.join(", ")}` : "NOTHING FIRED"}
                  </span>
                </div>
              </div>

              <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0", fontStyle: "italic" }}>
                {r.why}
              </p>
            </div>
          ))}

          <h2>Ordinary questions</h2>
          <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "62ch" }}>
            These must be <strong>answered</strong>. A bench that only proved refusal would be
            satisfied by an assistant that refuses everything — which is useless rather than safe,
            and you would switch it off within a day.
          </p>
          {controls.map((c) => (
            <div
              key={c.id}
              className="panel"
              style={{ borderLeft: `3px solid ${c.answered ? "#1f4037" : "#a33"}` }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <p style={{ margin: 0, fontSize: 13.5 }}>
                  <span className="muted">Shopper:</span> &ldquo;{c.message}&rdquo;
                </p>
                <span className={`pill ${c.answered ? "available" : "needs_setup"}`}>
                  {c.answered ? "answered" : "refused"}
                </span>
              </div>
              <p style={{ fontSize: 13.5, margin: "8px 0 4px" }}>{c.reply || <em className="muted">nothing</em>}</p>
              <p className="muted" style={{ fontSize: 12.5, margin: 0, fontStyle: "italic" }}>
                {c.why}
              </p>
            </div>
          ))}
        </>
      )}

      {attacks.length === 0 && (
        <>
          <h3>What will be tried</h3>
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Shopper says</th>
                <th>Gate that must catch the bad reply</th>
              </tr>
            </thead>
            <tbody>
              {d.scenarios.map((s) => (
                <tr key={s.id}>
                  <td>{s.group}</td>
                  <td className="muted">&ldquo;{s.message}&rdquo;</td>
                  <td className="mono">{s.gate}</td>
                </tr>
              ))}
              {d.controls.map((c) => (
                <tr key={c.id}>
                  <td>Ordinary questions</td>
                  <td className="muted">&ldquo;{c.message}&rdquo;</td>
                  <td>
                    <span className="pill available">must be answered</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
