import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useNavigation } from "react-router";
import { requireMerchant } from "../lib/auth.server";
import { sitesForMerchant } from "../lib/sites.server";
import {
  CONSOLIDATE_ABOVE,
  MEMORY_TTL_DAYS,
  consolidate,
  forget,
  memoryBySubject,
  memoryStats,
  RECALL_LIMIT,
} from "../lib/memory.server";
import { complete, isConfigured as modelConfigured, MODELS } from "../lib/openrouter.server";

/**
 * What the shop remembers about people, shown to the merchant in full.
 *
 * This page exists because of the position the feature takes: memory is STATED,
 * not silent. An assistant that quietly knows things about a shopper is
 * unsettling when it is right and invisible when it is wrong — and a merchant
 * who cannot read what their assistant believes has no answer when a customer
 * says "your bot said something odd about me".
 *
 * TWO BOUNDARIES ARE VISIBLE ON THIS PAGE, AND THEY ARE THE POINT.
 *
 * 1. THIS IS NOT THE CORTEX. The shop cortex holds what is true about the
 *    MERCHANT and has no type that can carry a person. This holds people, keyed
 *    per (merchant, shopper), and nothing here is ever pooled into shop
 *    knowledge. Only counts cross — and even those go to the findings document,
 *    not to a shopper.
 *
 * 2. NOTHING HERE CAN EXPIRE INTO A LIE. A memory may not contain a price, a
 *    stock level, an offer, an order state or a delivery date; candidates that
 *    do are refused at write time by `checkMemory`. That is what makes it safe
 *    to render a six-week-old sentence into today's reply.
 *
 * The subject column is the merchant's OWN customer id. This store has never
 * held an email or a phone number, and there is no code path that could put one
 * in it.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = requireMerchant(request);
  const site = sitesForMerchant(merchant.sites)[0] ?? null;
  if (!site) return { site: null, subjects: [], stats: null, limits: null, summariser: false };

  return {
    site: { key: site.key, name: site.name },
    subjects: memoryBySubject(site.key).map((g) => ({
      sub: g.sub,
      memories: g.memories.map((m) => ({
        id: m.id,
        kind: m.kind,
        text: m.text,
        source: m.source,
        createdAt: m.createdAt,
        lastUsedAt: m.lastUsedAt,
        expiresAt: m.expiresAt,
        // What they actually said. Merchant-only, and the thing that lets a
        // wrong memory be traced back to the sentence that produced it.
        evidence: m.evidence ?? null,
      })),
    })),
    stats: memoryStats(site.key),
    /**
     * Constants travel as DATA, not as an import the component makes.
     *
     * A component that imports from a `.server` module keeps that whole module
     * graph alive in the client bundle, and React Router only strips server
     * code from `loader`/`action`/`middleware`/`headers`. `npm run build` fails
     * outright; dev mode is perfectly happy, which is how this ships. Third
     * time this class has been caught here, so: the loader reads the constant,
     * the component reads the loader.
     */
    limits: { ttlDays: MEMORY_TTL_DAYS, recallLimit: RECALL_LIMIT, condenseAbove: CONSOLIDATE_ABOVE },
    summariser: modelConfigured(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const merchant = requireMerchant(request);
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  // Scoped at the write, not only at the read.
  if (!merchant.sites.includes(shop)) return { ok: false, error: "not your store" };

  const sub = String(form.get("sub") ?? "");
  if (!sub) return { ok: false, error: "which shopper?" };

  /**
   * Condensing is merchant-triggered, not automatic on the shopper's path.
   *
   * `recall` runs while somebody is waiting for a reply. This reads a person's
   * whole history and calls a model, so it belongs on a button — and having a
   * human press it means the result is looked at, which for a summariser is
   * worth more than the convenience of it happening quietly.
   */
  if (String(form.get("act") ?? "") === "condense") {
    const res = await consolidate({
      shop,
      sub,
      ask: modelConfigured()
        ? async (prompt) =>
            (await complete({
              model: MODELS.summariser(),
              messages: [{ role: "user", content: prompt }],
              maxTokens: 300,
              temperature: 0,
              timeoutMs: 20_000,
            })) ?? ""
        : undefined,
    });
    return {
      ok: true,
      message:
        res.before === res.after
          ? `Nothing changed — ${res.because ?? "there was nothing to merge"}.`
          : `${res.before} down to ${res.after}, ${res.by === "model" ? "by the summariser" : "by rule"}.` +
            (res.because ? ` ${res.because}.` : ""),
    };
  }

  // An id deletes one memory; its absence deletes everything about that person.
  const id = String(form.get("id") ?? "") || undefined;
  const ok = forget(shop, sub, id);
  return ok
    ? { ok: true, message: id ? "Forgotten." : "Everything about that shopper is forgotten." }
    : { ok: false, error: "could not write the deletion" };
};

const KIND_BLURB: Record<string, string> = {
  preference: "a durable taste",
  context: "who or what they buy for",
  habit: "how they shop",
  boundary: "something they asked us not to do",
};

export default function MemoryPage() {
  const d = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  if (!d.site || !d.stats || !d.limits) {
    return (
      <>
        <h1>Shopper memory</h1>
        <p className="lede">No store is connected to this account yet.</p>
      </>
    );
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 22, fontSize: 13.5 }}>
        <Link to="/dashboard" style={{ textDecoration: "none" }}>
          ← Features
        </Link>
      </p>
      <h1>Shopper memory</h1>
      <p className="lede">
        What your assistant remembers about individual people, and every word of it. Kept separate
        from the shop&rsquo;s own memory on purpose: that one holds facts about your business and
        cannot hold a person, this one holds people and never becomes a report.
      </p>

      <div className="stats">
        <div className="stat">
          <b>{d.stats.people}</b>
          <span>people remembered</span>
        </div>
        <div className="stat">
          <b>{d.stats.total}</b>
          <span>things remembered</span>
        </div>
        <div className="stat">
          <b>{d.stats.bySource.voice ?? 0}</b>
          <span>learned on a call</span>
        </div>
        <div className="stat">
          <b>{d.limits.ttlDays}d</b>
          <span>before one expires</span>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>The rules, which are code and not a policy document</h3>
        <table>
          <tbody>
            <tr>
              <td style={{ width: 260 }}>Nobody signed in</td>
              <td>
                Nothing is written at all. With no identity there is no way to honour a deletion
                request later, so collecting would be taking something we could never give back.
              </td>
            </tr>
            <tr>
              <td>A memory may contain</td>
              <td>
                Durable things about a person — prefers low caffeine, buys gifts for a colleague,
                brews in a French press.
              </td>
            </tr>
            <tr>
              <td>A memory may never contain</td>
              <td>
                Anything that expires: a price, a stock level, an offer, an order state, a payment
                detail or a delivery date. Candidates carrying one are <b>refused when written</b>,
                which is what makes it safe to put a six-week-old sentence into today&rsquo;s reply.
              </td>
            </tr>
            <tr>
              <td>How it is used</td>
              <td>
                Memory supplies the <i>question</i>; your catalogue supplies the <i>answer</i>. The
                assistant may say &ldquo;last time you were after something low-caffeine — still?&rdquo;
                and then look up what is actually low-caffeine, in stock, at today&rsquo;s price. At
                most {d.limits.recallLimit} are used in any one reply.
              </td>
            </tr>
            <tr>
              <td>When the list gets long</td>
              <td>
                Above {d.limits.condenseAbove} lines about one person you can <b>condense</b> them.
                Near-duplicates merge by rule with no model at all;{" "}
                {d.summariser
                  ? "a summariser then rewrites the rest as fewer, clearer lines"
                  : "a summariser would then rewrite the rest, but no model key is configured, so only the rule pass runs"}
                . Every line it writes is checked against the lines it was given — anything it
                invented, or anything carrying a price or a date, and the whole merge is thrown
                away rather than half-applied. A boundary (&ldquo;don&rsquo;t contact me&rdquo;) is
                never merged into anything and is not even shown to the summariser.
              </td>
            </tr>
            <tr>
              <td>Who else sees it</td>
              <td>
                Nobody. It is keyed to this shop, so the same person shopping at another store we
                serve has a separate memory that never meets this one.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {d.subjects.length === 0 ? (
        <p className="note">
          Nothing remembered yet. Memories are written when a <b>signed-in</b> shopper says
          something durable about themselves — in the widget or on a recovery call. A question about
          your returns policy is about you, not about them, and is discarded before any model sees it.
        </p>
      ) : (
        d.subjects.map((g) => (
          <div className="panel" key={g.sub}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span className="mono" style={{ fontWeight: 600 }}>
                {g.sub}
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {g.memories.length} remembered
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                {g.memories.length > d.limits!.condenseAbove ? (
                  <Form method="post">
                    <input type="hidden" name="shop" value={d.site!.key} />
                    <input type="hidden" name="sub" value={g.sub} />
                    <input type="hidden" name="act" value="condense" />
                    <button className="btn-primary" type="submit" disabled={busy}>
                      Condense these
                    </button>
                  </Form>
                ) : null}
                <Form method="post">
                  <input type="hidden" name="shop" value={d.site!.key} />
                  <input type="hidden" name="sub" value={g.sub} />
                  <button className="btn-secondary" type="submit" disabled={busy}>
                    Forget this shopper
                  </button>
                </Form>
              </div>
            </div>

            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Remembered</th>
                  <th style={{ width: 120 }}>Kind</th>
                  <th style={{ width: 90 }}>From</th>
                  <th style={{ width: 90 }}>Expires</th>
                  <th style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {g.memories.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.text}
                      {m.evidence ? (
                        <details style={{ marginTop: 4 }}>
                          <summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>
                            what they said
                          </summary>
                          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                            &ldquo;{m.evidence}&rdquo;
                          </div>
                        </details>
                      ) : null}
                    </td>
                    <td>
                      {m.kind}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {KIND_BLURB[m.kind]}
                      </div>
                    </td>
                    <td>{m.source}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {m.expiresAt.slice(0, 10)}
                    </td>
                    <td>
                      <Form method="post">
                        <input type="hidden" name="shop" value={d.site!.key} />
                        <input type="hidden" name="sub" value={g.sub} />
                        <input type="hidden" name="id" value={m.id} />
                        <button className="btn-secondary" type="submit" disabled={busy}>
                          Forget
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      <p className="note">
        Expiry is applied when a memory is <i>read</i>, not by a job that has to keep running. So a
        memory that has aged out is invisible from the moment it should be, whether or not anything
        swept it — the failure this refuses is a forgotten cron leaving a profile alive for years.
        Using a memory refreshes it, so what survives is what the shop actually finds useful.
      </p>
    </>
  );
}
