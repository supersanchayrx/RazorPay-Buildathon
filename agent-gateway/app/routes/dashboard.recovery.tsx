import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useNavigation } from "react-router";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import { runRecovery, toDraft, recoverySummary, type RecoveryTarget } from "../lib/recovery.server";
import { CHANNELS, readDrafts, readSends, send } from "../lib/outreach.server";
import { callTranscript, calls } from "../lib/voicetalk.server";
import { readSettings, writeSettings } from "../lib/settings.server";
import { answerRate, conversations, reasonHistogram } from "../lib/conversations.server";
import { REASON_LABEL, REASONS } from "../lib/reasons";
import { allGrants, monthlySpend } from "../lib/grants.server";

/**
 * The recovery campaign, as a merchant sees it before anything goes out.
 *
 * The layout is the argument. A conventional campaign screen leads with reach —
 * "82 shoppers, ₹1.2 lakh in abandoned baskets!" — and buries the exclusions in
 * a settings tab. This one puts what would be SENT and what was SUPPRESSED at
 * the same size, because the second list is the one that decides whether this
 * feature is safe to leave running: 214 of 226 baskets are not written to, and
 * a merchant who cannot see why has no way to tell a careful system from a
 * broken one.
 *
 * Two other deliberate choices:
 *
 * - The full text of every message is on the page. Not a template with
 *   placeholders — the actual sentence that would reach that person, already
 *   through the bounds check. If a merchant would not send it themselves, they
 *   should find that out here rather than from a screenshot.
 *
 * - Sending is a separate, explicit act from drafting, and the default channel
 *   writes to a file and delivers nothing. Turning outreach "on" does not mean
 *   messages start moving; it means the run stops being labelled a dry run.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site) return { site: null, run: null, drafts: [], sent: 0, channels: CHANNELS };

  const run = runRecovery({
    shop: site.key,
    shopName: site.name,
    storefrontOrigin: site.origins[0],
    productUrlTemplate: site.productUrlTemplate,
    // Taken from the request rather than configured, so a tunnel, a preview
    // deploy and localhost all produce links that actually resolve.
    gatewayOrigin: new URL(request.url).origin,
    siteSecret: site.secret,
  });

  const convs = conversations(site.key);

  return {
    conversations: convs
      .slice()
      .sort((a, b) => (b.answeredAt ?? "").localeCompare(a.answeredAt ?? ""))
      .slice(0, 20)
      .map((c) => ({
        cartId: c.cartId,
        state: c.state,
        reason: c.reason,
        reasonLabel: c.reason ? REASON_LABEL[c.reason] : null,
        answeredAt: c.answeredAt,
        // The shopper's own words, merchant-only. Kept so a merchant reading
        // "unknown x7" can see whether the classifier is failing or the answers
        // are genuinely vague.
        text: (c.turns.find((t) => t.kind === "answered") as { text?: string | null } | undefined)?.text ?? null,
        by: (c.turns.find((t) => t.kind === "answered") as { by?: string } | undefined)?.by ?? null,
        remedy: (c.turns.filter((t) => t.kind === "remedied").pop() as { remedy?: string } | undefined)?.remedy ?? null,
        blocked: (c.turns.filter((t) => t.kind === "remedied").pop() as { blocked?: string[] } | undefined)?.blocked ?? [],
        grantId: c.grantId,
      })),
    histogram: reasonHistogram(site.key),
    answered: answerRate(site.key),
    grants: allGrants(site.key).slice(-10).reverse(),
    spend: monthlySpend(site.key),
    policy: readSettings(site.key).recovery,
    site: { key: site.key, name: site.name },
    run,
    summary: recoverySummary(run),
    drafts: readDrafts(site.key, 10),
    /**
     * Recent calls, newest first, with their transcripts.
     *
     * This is the only place a merchant can read what their shop actually said
     * on the telephone. On every other channel the message is the draft; on this
     * one a model wrote half the words, so the draft is not the record and the
     * transcript is.
     */
    calls: calls(site.key)
      .slice(0, 8)
      .map((c) => ({ ...c, lines: callTranscript(site.key, c.callSid) })),
    sent: readSends(site.key).filter((s) => s.ok).length,
    channels: CHANNELS.map((c) => ({ id: c.id, label: c.label, available: c.available, unlockedBy: c.unlockedBy, note: c.note })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  // Scoped at the write, not only at the read.
  if (!merchant.sites.includes(shop)) return { ok: false, error: "not your store" };

  const act = String(form.get("act") ?? "");

  if (act === "settings") {
    const res = writeSettings(
      shop,
      {
        outreach: {
          enabled: form.get("enabled") === "on",
          cooldownDays: Number(form.get("cooldownDays")),
          maxPerRun: Number(form.get("maxPerRun")),
          minMarginAtStake: Number(form.get("minMarginAtStake")),
          cartAgeHours: {
            min: Number(form.get("ageMin")),
            max: Number(form.get("ageMax")) * 24,
          },
        },
      },
      merchant.email,
    );
    return { ok: res.ok, error: res.error };
  }

  if (act === "policy") {
    const res = writeSettings(
      shop,
      {
        recovery: {
          enabled: form.get("rec_enabled") === "on",
          maxDepthPct: Number(form.get("maxDepthPct")),
          requiresTier: String(form.get("requiresTier")) as "returning" | "regular",
          monthlyGrantCap: Number(form.get("monthlyGrantCap")),
          monthlyMarginCap: Number(form.get("monthlyMarginCap")),
          grantTtlHours: Number(form.get("grantTtlHours")),
          discountFor: form.getAll("discountFor").map(String) as never,
        },
      },
      merchant.email,
    );
    return { ok: res.ok, error: res.error };
  }

  /**
   * How a phone call behaves.
   *
   * Split from the general outreach settings because it is the only control in
   * this console that changes what KIND of thing goes out rather than how much
   * of it — and because a merchant should have to arrive at this box on purpose
   * before their shop starts holding conversations on the telephone.
   */
  if (act === "call") {
    const res = writeSettings(
      shop,
      {
        outreach: {
          call: {
            mode: form.get("callMode") === "conversation" ? "conversation" : "notice",
            maxTurns: Number(form.get("maxTurns")),
            speaker: String(form.get("speaker") ?? "priya"),
            language: String(form.get("language") ?? "en-IN"),
          },
        },
      },
      merchant.email,
    );
    return { ok: res.ok, error: res.error };
  }

  if (act === "send") {
    const site = sitesForMerchant(merchant.sites).find((s) => s.key === shop)!;

    /**
     * The channel is chosen at send time, and validated against what the code
     * can actually do rather than against what the form posted.
     *
     * A form field is a caller, and a caller that could name any channel could
     * name one with no delivery path — or one the merchant never enabled. So an
     * unrecognised or unavailable channel falls back to `draft`, which writes to
     * a file and reaches nobody. The safe direction.
     */
    const asked = String(form.get("channel") ?? "");
    const ch = CHANNELS.find((c) => c.id === asked);
    const channel = ch && ch.available ? (ch.id as never) : ("draft" as never);

    const run = runRecovery({
      shop,
      shopName: site.name,
      storefrontOrigin: site.origins[0],
      productUrlTemplate: site.productUrlTemplate,
      gatewayOrigin: new URL(request.url).origin,
      siteSecret: site.secret,
      channel,
    });
    if (!run.settings.outreach.enabled) {
      return { ok: false, error: "outreach is switched off — this run drafts and sends nothing" };
    }
    // Re-run rather than trusting ids posted from the page. A target list is a
    // snapshot of a moment; between rendering and clicking, somebody may have
    // bought the thing.
    const results = [];
    for (const t of run.targets) results.push(await send(toDraft(shop, t)));
    return { ok: true, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  return { ok: false, error: "unknown action" };
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const TREATMENT: Record<RecoveryTarget["treatment"], { label: string; colour: string }> = {
  service: { label: "Service", colour: "#8a6d2f" },
  offer: { label: "Approved offer", colour: "#1f4037" },
  reminder: { label: "Reminder", colour: "#6b7a72" },
};

export default function Recovery() {
  const d = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!d.site || !d.run) {
    return (
      <>
        <h1>Basket recovery</h1>
        <p className="lede">No store is connected to this account yet.</p>
      </>
    );
  }

  const { run } = d;
  const o = run.settings.outreach;

  return (
    <>
      <p className="muted" style={{ marginTop: 22, fontSize: 13.5 }}>
        <Link to="/dashboard" style={{ textDecoration: "none" }}>
          ← Features
        </Link>
      </p>
      <h1>Basket recovery</h1>
      <p className="lede">
        Baskets that were never completed, and what — if anything — is worth saying about them. Every
        message below is the exact text that would go out, already through the same checks that guard
        your storefront assistant. Nothing is sent by opening this page.
      </p>

      <div className="stats">
        <div className="stat">
          <b>{run.totals.cartsConsidered}</b>
          <span>baskets considered</span>
        </div>
        <div className="stat">
          <b>{run.targets.length}</b>
          <span>would be written to</span>
        </div>
        <div className="stat">
          <b>{run.suppressed.length}</b>
          <span>left alone</span>
        </div>
        <div className="stat">
          <b>{inr(run.totals.marginAtStake)}</b>
          <span>margin at stake</span>
        </div>
        <div className="stat">
          <b>{inr(run.totals.expectedValue)}</b>
          <span>at an assumed {(run.totals.assumedRecovery * 100).toFixed(0)}%</span>
        </div>
      </div>

      <p className="note">
        {run.emptyReason ??
          `Margin, not basket value — chasing revenue you do not keep is how a recovery campaign
           costs more than it returns. The ${(run.totals.assumedRecovery * 100).toFixed(0)}% is an
           ASSUMPTION, not a measurement: this outreach has never run here, so there is no rate to
           cite. Treat ${inr(run.totals.expectedValue)} as an order of magnitude.`}
      </p>

      {/* ---------------- what people said ---------------- */}
      <h2>Why they didn&rsquo;t buy</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "62ch" }}>
        The only thing in your data that answers <i>why</i> rather than <i>what</i>. Nothing else can:
        the reason never touched your server, so the only way to have it is to ask. One answer is often
        worth more than the basket it came from, because it applies to every basket.
      </p>

      {d.histogram.total === 0 ? (
        <p className="note">
          Nobody has answered yet &mdash; {d.answered.asked} basket{d.answered.asked === 1 ? " has" : "s have"} been
          asked about. This is the number worth waiting for.
        </p>
      ) : (
        <div className="panel">
          {!d.histogram.enough && (
            <p className="note" style={{ marginTop: 0 }}>
              Only {d.histogram.total} answers so far. Shown as counts, not shares, and deliberately not
              as a finding &mdash; four people are not a pattern, and the temptation to act on the first
              three replies is the whole reason this floor exists.
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>Reason</th>
                <th style={{ width: 80 }}>Answers</th>
                {d.histogram.enough && <th style={{ width: 90 }}>Share</th>}
              </tr>
            </thead>
            <tbody>
              {d.histogram.counts.map((c) => (
                <tr key={c.reason}>
                  <td>{REASON_LABEL[c.reason]}</td>
                  <td>{c.count}</td>
                  {d.histogram.enough && <td>{(c.share * 100).toFixed(0)}%</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            {d.answered.answered} of {d.answered.asked} asked replied
            {d.answered.asked ? ` (${Math.round(d.answered.rate * 100)}%)` : ""}.
          </p>
        </div>
      )}

      {d.conversations.length > 0 && (
        <>
          <h3>In their own words</h3>
          <p className="muted" style={{ fontSize: 13.5, margin: "0 0 8px" }}>
            Kept so you can tell whether the classifier is failing or the answers are genuinely vague.
            Only you see this.
          </p>
          <div className="panel">
            <table>
              <tbody>
                {d.conversations.map((c) => (
                  <tr key={c.cartId}>
                    <td style={{ width: 150 }}>
                      <b>{c.reasonLabel ?? "no answer yet"}</b>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.state}
                        {c.by ? ` · by ${c.by}` : ""}
                      </div>
                    </td>
                    <td>
                      {c.text ? <div style={{ fontSize: 13.5 }}>&ldquo;{c.text}&rdquo;</div> : null}
                      {c.remedy ? (
                        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                          &rarr; {c.remedy}
                        </div>
                      ) : null}
                      {/* Merchant-only, always. A shopper told what they nearly
                          got has been handed a strategy for next time. */}
                      {c.blocked.length ? (
                        <div className="muted" style={{ fontSize: 12, marginTop: 4, fontStyle: "italic" }}>
                          no discount: {c.blocked.join("; ")}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- what would be sent ---------------- */}
      <h2>What would go out</h2>
      {run.targets.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Nothing. The table below says why.
        </p>
      ) : (
        run.targets.map((t) => (
          <div
            key={t.cartId}
            className="panel"
            style={{ borderLeft: `3px solid ${TREATMENT[t.treatment].colour}` }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>{t.items.map((i) => i.title).join(", ")}</span>
              <span className="pill" style={{ background: "var(--off-soft)", color: TREATMENT[t.treatment].colour }}>
                {TREATMENT[t.treatment].label}
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {inr(t.marginAtStake)} margin · abandoned {Math.round(t.ageHours / 24)}d ago at the{" "}
                {t.lastStep} step · {t.to.phone ? "phone" : "email"} on file
              </span>
            </div>

            <p style={{ fontSize: 13.5, margin: "10px 0 6px", color: "#3a4a43" }}>{t.because}</p>

            <div
              style={{
                background: "var(--off-soft)",
                borderRadius: 8,
                padding: "12px 14px",
                fontSize: 13.5,
                whiteSpace: "pre-wrap",
                margin: "8px 0 0",
              }}
            >
              {t.text}
            </div>
          </div>
        ))
      )}

      {/* ---------------- what was suppressed ---------------- */}
      <h2>What was left alone, and why</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px" }}>
        The more interesting half. A campaign tool that only shows you its reach has hidden the
        number that can embarrass you.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Reason</th>
              <th style={{ width: 90 }}>Baskets</th>
              <th style={{ width: 130 }}>Margin not chased</th>
            </tr>
          </thead>
          <tbody>
            {run.suppressedBy.map((s) => (
              <tr key={s.reason}>
                <td>
                  {s.label}
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                    {run.suppressed.find((x) => x.reason === s.reason)?.detail}
                  </div>
                </td>
                <td>{s.count}</td>
                <td>{inr(s.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- limits ---------------- */}
      <h2>Your limits</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px" }}>
        Every one of these can only reduce what goes out. There is no setting here that increases
        it, on purpose — a dial that turns up is a dial that gets turned up.
      </p>
      <Form method="post" className="panel">
        <input type="hidden" name="shop" value={d.site.key} />
        <input type="hidden" name="act" value="settings" />
        <table>
          <tbody>
            <tr>
              <td style={{ width: 300 }}>
                <b>Outreach</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Off means this page is a dry run: it drafts everything and sends nothing.
                </div>
              </td>
              <td>
                <label style={{ fontSize: 13.5 }}>
                  <input type="checkbox" name="enabled" defaultChecked={o.enabled} /> On
                </label>
              </td>
            </tr>
            <tr>
              <td>
                <b>Cooldown</b>
                <div className="muted" style={{ fontSize: 12.5 }}>Days before the same person hears from you again.</div>
              </td>
              <td>
                <input type="number" name="cooldownDays" defaultValue={o.cooldownDays} min={1} max={365} style={{ width: 90 }} />
              </td>
            </tr>
            <tr>
              <td>
                <b>Messages per run</b>
                <div className="muted" style={{ fontSize: 12.5 }}>A ceiling, so a data problem cannot become a broadcast.</div>
              </td>
              <td>
                <input type="number" name="maxPerRun" defaultValue={o.maxPerRun} min={1} max={500} style={{ width: 90 }} />
              </td>
            </tr>
            <tr>
              <td>
                <b>Margin floor</b>
                <div className="muted" style={{ fontSize: 12.5 }}>Below this, a basket is not worth a message.</div>
              </td>
              <td>
                ₹<input type="number" name="minMarginAtStake" defaultValue={o.minMarginAtStake} min={0} style={{ width: 90 }} />
              </td>
            </tr>
            <tr>
              <td>
                <b>Age window</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Wait at least this many hours — they may still be checking out — and give up after
                  this many days.
                </div>
              </td>
              <td>
                <input type="number" name="ageMin" defaultValue={o.cartAgeHours.min} min={1} style={{ width: 70 }} /> h to{" "}
                <input type="number" name="ageMax" defaultValue={Math.round(o.cartAgeHours.max / 24)} min={1} style={{ width: 70 }} /> d
              </td>
            </tr>
            <tr>
              <td>
                <b>Quiet hours</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Fixed. Nothing unsolicited between {o.quietHours.fromHour}:00 and {o.quietHours.toHour}:00,{" "}
                  {o.quietHours.tz}.
                </div>
              </td>
              <td className="muted" style={{ fontSize: 13 }}>
                not editable
              </td>
            </tr>
            <tr>
              <td>
                <b>Consent basis</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  <code>{o.consentBasis}</code> — they handed you this number during a checkout they
                  started themselves. That justifies one message about that checkout, and nothing else.
                </div>
              </td>
              <td className="muted" style={{ fontSize: 13 }}>
                needs an opt-in to change
              </td>
            </tr>
          </tbody>
        </table>
        <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: 12 }}>
          Save limits
        </button>
      </Form>

      {/* ---------------- recovery discounts ---------------- */}
      <h2>Recovery discounts</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px", maxWidth: "64ch" }}>
        This is the one thing in CHAPMAN that lets an agent give money away without you approving each
        one, so read it as an approval with a cap rather than as a setting. The agent never chooses a
        depth &mdash; it reads the number below, or offers nothing. A shopper who pushes back gets the
        <b> same</b> grant returned, never a better one.
      </p>
      <div className="stats">
        <div className="stat">
          <b>{d.spend.count}</b>
          <span>of {d.policy.monthlyGrantCap} this month</span>
        </div>
        <div className="stat">
          <b>{inr(d.spend.margin)}</b>
          <span>of {inr(d.policy.monthlyMarginCap)} margin given</span>
        </div>
        <div className="stat">
          <b>{d.grants.filter((g) => g.state === "redeemed").length}</b>
          <span>actually used</span>
        </div>
      </div>

      <Form method="post" className="panel">
        <input type="hidden" name="shop" value={d.site.key} />
        <input type="hidden" name="act" value="policy" />
        <table>
          <tbody>
            <tr>
              <td style={{ width: 300 }}>
                <b>Recovery discounts</b>
                <div className="muted" style={{ fontSize: 12.5 }}>Off means the agent answers with facts and alternatives only.</div>
              </td>
              <td>
                <label style={{ fontSize: 13.5 }}>
                  <input type="checkbox" name="rec_enabled" defaultChecked={d.policy.enabled} /> On
                </label>
              </td>
            </tr>
            <tr>
              <td>
                <b>Most it may take off</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Capped again by your own discount ceiling, and refused outright if the discounted
                  basket would fall through your margin floor.
                </div>
              </td>
              <td>
                <input type="number" name="maxDepthPct" defaultValue={d.policy.maxDepthPct} min={1} max={50} style={{ width: 80 }} /> %
              </td>
            </tr>
            <tr>
              <td>
                <b>Only for</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  First-time shoppers can never qualify &mdash; that is refused when you save, not
                  defaulted. Money for whoever complains teaches everybody to complain.
                </div>
              </td>
              <td>
                <select name="requiresTier" defaultValue={d.policy.requiresTier} style={{ font: "inherit", fontSize: 13.5, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--line)" }}>
                  <option value="returning">shoppers with 2+ orders</option>
                  <option value="regular">shoppers with 4+ orders</option>
                </select>
              </td>
            </tr>
            <tr>
              <td>
                <b>Only in answer to</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Discounting someone who said delivery was too slow does not answer what they told you.
                </div>
              </td>
              <td>
                {REASONS.filter((r) => r !== "unknown").map((r) => (
                  <label key={r} style={{ display: "block", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      name="discountFor"
                      value={r}
                      defaultChecked={d.policy.discountFor.includes(r)}
                    />{" "}
                    {REASON_LABEL[r]}
                  </label>
                ))}
              </td>
            </tr>
            <tr>
              <td>
                <b>Monthly caps</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Counted at issue, not at redemption &mdash; the exposure exists the moment a grant does.
                </div>
              </td>
              <td>
                <input type="number" name="monthlyGrantCap" defaultValue={d.policy.monthlyGrantCap} min={1} max={500} style={{ width: 80 }} /> grants,
                {" "}₹<input type="number" name="monthlyMarginCap" defaultValue={d.policy.monthlyMarginCap} min={1} style={{ width: 100 }} /> of margin
              </td>
            </tr>
            <tr>
              <td>
                <b>Each one lasts</b>
                <div className="muted" style={{ fontSize: 12.5 }}>It answers a conversation. It is not a coupon.</div>
              </td>
              <td>
                <input type="number" name="grantTtlHours" defaultValue={d.policy.grantTtlHours} min={1} max={168} style={{ width: 80 }} /> hours
              </td>
            </tr>
          </tbody>
        </table>
        <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: 12 }}>
          Save discount policy
        </button>
      </Form>

      {d.grants.length > 0 && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th style={{ width: 90 }}>State</th>
                <th>Grant</th>
                <th style={{ width: 110 }}>Costs you</th>
              </tr>
            </thead>
            <tbody>
              {d.grants.map((g) => (
                <tr key={g.id}>
                  <td>{g.state}</td>
                  <td>
                    {Math.round(g.depth * 100)}% off {g.title}, up to {g.qtyCap}
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {g.tier} shopper, said &ldquo;{g.reason}&rdquo;, expires {g.expiresAt.slice(0, 16).replace("T", " ")}
                    </div>
                  </td>
                  <td>{inr(g.marginCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- channels ---------------- */}
      <h2>Channels</h2>
      <div className="panel">
        <table>
          <tbody>
            {d.channels.map((c) => (
              <tr key={c.id}>
                <td style={{ width: 180 }}>
                  <b>{c.label}</b>
                </td>
                <td style={{ width: 90 }}>
                  <span className={`pill ${c.available ? "available" : "planned"}`}>
                    {c.available ? "Live" : "Locked"}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: 13 }}>
                  {c.unlockedBy ?? c.note}
                  {c.unlockedBy && c.note ? <div style={{ marginTop: 4 }}>{c.note}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- the phone ---------------- */}
      <h2>On the telephone</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px" }}>
        A call is the only channel where nothing is left behind for the shopper to re-read, and the
        only one where a mistake cannot be screenshotted. So it starts as a one-way notice, and
        becomes a conversation only if you say so.
      </p>
      <Form method="post" className="panel" style={{ padding: 16 }}>
        <input type="hidden" name="shop" value={d.site.key} />
        <input type="hidden" name="act" value="call" />

        <label style={{ display: "block", marginBottom: 10 }}>
          <input type="radio" name="callMode" value="notice" defaultChecked={o.call.mode !== "conversation"} />{" "}
          <b>Read a notice</b>
          <div className="muted" style={{ fontSize: 13, marginLeft: 22 }}>
            Speaks the message below, then hangs up. No model anywhere near the call — the shopper
            hears the exact sentence you can read on this page.
          </div>
        </label>

        <label style={{ display: "block", marginBottom: 10 }}>
          <input
            type="radio"
            name="callMode"
            value="conversation"
            defaultChecked={o.call.mode === "conversation"}
          />{" "}
          <b>Hold a conversation</b>
          <div className="muted" style={{ fontSize: 13, marginLeft: 22 }}>
            Same opening sentence, then asks what put them off and answers what they say. It cannot
            offer a discount — it is never told one exists. Every reply is checked by the same gate
            as your storefront assistant before it is spoken, and both sides are transcribed below.
          </div>
        </label>

        <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13.5 }}>
            Exchanges at most{" "}
            <input
              type="number"
              name="maxTurns"
              min={1}
              max={8}
              defaultValue={o.call.maxTurns}
              style={{ width: 60 }}
            />
          </label>
          <label style={{ fontSize: 13.5 }}>
            Voice{" "}
            <input name="speaker" defaultValue={o.call.speaker} style={{ width: 90 }} />
          </label>
          <label style={{ fontSize: 13.5 }}>
            Language{" "}
            <input name="language" defaultValue={o.call.language} style={{ width: 80 }} />
          </label>
          <button type="submit" disabled={busy}>
            Save
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
          Callers can press 9 at any point to stop these calls for good. That is recorded against
          them the moment they press it, and every future run reads it.
        </p>
      </Form>

      {/* ---------------- send ---------------- */}
      <h2>Run it</h2>
      <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px" }}>
        The campaign is re-computed when you click, not taken from what is on this screen — between
        rendering and clicking, somebody may have bought the thing.
        {d.sent > 0 ? ` ${d.sent} messages have gone out from this store so far.` : ""}
      </p>
      <Form method="post">
        <input type="hidden" name="shop" value={d.site.key} />
        <input type="hidden" name="act" value="send" />
        <label style={{ fontSize: 13.5, marginRight: 12 }}>
          Send by{" "}
          <select name="channel" defaultValue={o.channels[0] ?? "draft"}>
            {d.channels
              .filter((c) => c.available)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
        <button type="submit" className="btn-primary" disabled={busy || !o.enabled}>
          {o.enabled ? `Send ${run.targets.length} messages` : "Outreach is off"}
        </button>
      </Form>

      {/* ---------------- transcripts ---------------- */}
      {d.calls.length > 0 && (
        <>
          <h3>What was actually said</h3>
          <p className="muted" style={{ fontSize: 13.5, margin: "0 0 10px" }}>
            On every other channel the draft is the record. On a call a model wrote half the words,
            so this is — and it is written down before it is spoken, not after.
          </p>
          {d.calls.map((c) => (
            <div className="panel" key={c.callSid} style={{ padding: 14, marginBottom: 10 }}>
              <div className="muted mono" style={{ fontSize: 12, marginBottom: 8 }}>
                {c.at.slice(0, 16).replace("T", " ")} · {c.cartId}
              </div>
              {c.lines.map((l, i) => (
                <div key={i} style={{ margin: "4px 0", fontSize: 13.5 }}>
                  <b style={{ color: l.who === "shop" ? "#1f4037" : "#6b7a72" }}>
                    {l.who === "shop" ? "Shop" : "Them"}
                  </b>{" "}
                  {l.text}
                  {l.source && l.source !== "template" && l.source !== "model" ? (
                    <span className="pill planned" style={{ marginLeft: 8, fontSize: 11 }}>
                      {l.source === "bounds_refused"
                        ? "blocked, safe line spoken"
                        : l.source === "model_unavailable"
                          ? "model unavailable"
                          : l.source}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {d.drafts.length > 0 && (
        <>
          <h3>Last written</h3>
          <div className="panel">
            <table>
              <tbody>
                {d.drafts.map((x) => (
                  <tr key={x.id}>
                    <td className="mono" style={{ width: 190 }}>
                      {x.at.slice(0, 16).replace("T", " ")}
                    </td>
                    <td style={{ width: 110 }}>{x.treatment}</td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {x.text.slice(0, 90)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- gaps ---------------- */}
      <h2>What would make this better</h2>
      <div className="panel">
        <table>
          <tbody>
            {run.gaps.map((g) => (
              <tr key={g.what}>
                <td style={{ width: 340 }}>
                  <b>{g.what}</b>
                  <div className="muted" style={{ fontSize: 12.5 }}>{g.who === "merchant" ? "you" : "us"}</div>
                </td>
                <td className="muted" style={{ fontSize: 13 }}>{g.unlocks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
