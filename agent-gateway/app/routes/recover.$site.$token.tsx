import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { findSite } from "../lib/sites.server";
import { liveCarts } from "../lib/carts.server";
import { verifyRecoveryToken } from "../lib/identity.server";
import { jsonFeedCatalog } from "../lib/catalog.server";
import { addTurn, conversation } from "../lib/conversations.server";
import { classify, OFFERED_CHOICES, REASON_LABEL, type Reason } from "../lib/reasons";
import { standing } from "../lib/loyalty.server";
import { chooseRemedy, type Remedy } from "../lib/remedies.server";
import { readSettings } from "../lib/settings.server";
import { readFindings } from "../lib/findings.server";
import { findGrant, redeem } from "../lib/grants.server";
import { learn } from "../lib/memory.server";
import { buildQuote } from "../lib/quote.server";
import { createOrder, isConfigured, toMinorUnits } from "../lib/razorpay.server";
import { claim } from "../lib/reservations.server";
import { savePending } from "../lib/orderstore.server";
import { record } from "../lib/ledger.server";
import { complete, isConfigured as modelConfigured, MODELS } from "../lib/openrouter.server";
import fs from "node:fs";
import path from "node:path";

/**
 * The page a recovery message points at — the inbound half of the loop.
 *
 * Everything before this was the shop talking. This is the only place the
 * shopper gets to answer, and the answer is the point of the whole feature: no
 * amount of analytics recovers WHY somebody didn't buy, because the why never
 * touched the server.
 *
 * FOUR THINGS THIS PAGE IS CAREFUL ABOUT.
 *
 * 1. THE LINK IS NOT A LOGIN. The token proves "this link came from a message
 *    we sent about this basket", and that is all the authority it carries. It
 *    shows the basket it names and nothing else — no order history, no account.
 *    A link forwarded to a friend must not hand over a person's account, and
 *    this page never mints a session from one.
 *
 * 2. THE QUESTION IS ASKED ONCE. `conversations.server.ts` refuses a second
 *    `asked` turn on the same basket. Asking twice tells the shopper nobody
 *    read the first answer, which destroys the thing being collected.
 *
 * 3. THE REMEDY IS COMPUTED, NOT NEGOTIATED. What happens next is a pure
 *    function of (reason, standing, basket, policy). Coming back and pushing
 *    returns the same answer — including the same grant, never a better one.
 *
 * 4. NOTHING HERE TELLS THE SHOPPER WHAT THEY NEARLY GOT. Every reason a
 *    discount was withheld is recorded for the merchant and none of it is
 *    rendered. "You'd have qualified with one more order" is a sentence that
 *    turns a recovery page into a lesson in how to game one.
 */

type CartRow = {
  id: string;
  ts: string;
  customer?: { id: string };
  lines: Array<{ handle: string; title: string; sku: string; qty: number; unitPrice: number; lineTotal: number }>;
  subtotal?: number;
};

/**
 * The basket this link names — seeded or real.
 *
 * Live baskets are folded in from their own store rather than read out of
 * `carts.jsonl`, because `npm run seed` rewrites that file wholesale. A shopper
 * following a link to a real basket the morning after somebody re-seeded the
 * fixture would otherwise be told their basket no longer exists, which is true
 * of our records and false of their shopping.
 */
function readCart(shop: string, cartId: string): CartRow | null {
  const live = liveCarts(shop).find((c) => c.id === cartId);
  if (live) return live as CartRow;
  try {
    return (
      fs
        .readFileSync(path.join(process.cwd(), "data", "carts.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as CartRow)
        .find((c) => c.id === cartId) ?? null
    );
  } catch {
    return null;
  }
}

function readInputs() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "merchant-inputs.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Resolve the token, or say why not. Shared by the loader and the action. */
function open(params: { site?: string; token?: string }) {
  const site = findSite(params.site ?? null);
  if (!site) return { error: "This link is for a shop we don't recognise." as const };

  const v = verifyRecoveryToken(params.token, { site: site.key, secret: site.secret });
  if (!v.ok) {
    return {
      error:
        v.reason === "expired"
          ? ("This link has expired. Your basket is still on the shop, though." as const)
          : ("This link isn't valid." as const),
    };
  }
  const cart = readCart(site.key, v.claim.cart);
  if (!cart) return { error: "We can't find that basket any more." as const };
  // The token names a customer; the cart names one too. They must agree, or a
  // token minted for one basket has been pointed at another.
  if (cart.customer?.id && cart.customer.id !== v.claim.sub) {
    return { error: "This link isn't valid." as const };
  }
  return { site, claim: v.claim, cart };
}

/**
 * Open the conversation if this is the first we have seen of this link.
 *
 * Shared by the loader and the action, and it has to be. It lived in the loader
 * alone for one afternoon, and the consequence was the worst bug this feature
 * could have: a shopper who answered "the shipping charge was too much" got a
 * correct, helpful reply on screen — and the answer was silently discarded,
 * because a POST that arrives before any GET finds no conversation to attach to
 * and `addTurn` refuses to record an answer to a question nobody asked.
 *
 * The page looked like it worked. The one thing this whole feature exists to
 * collect was thrown away. Two entry points into one state machine, and only
 * one of them creating the state, is exactly the shape of the harness bug that
 * left the widget running without tools.
 */
function ensureAsked(shop: string, cartId: string, sub: string): void {
  if (conversation(shop, cartId)) return;
  addTurn({
    shop,
    cartId,
    customerId: sub,
    turn: { kind: "asked", ts: new Date().toISOString(), channel: "link", draftId: `rcv_${cartId}` },
  });
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const o = open(params);
  if ("error" in o) return { error: o.error, shopName: null, basket: [], state: null, say: null, grant: null, choices: [] };

  const { site, cart, claim } = o;

  // The token is unforgeable and names one basket, so arriving here IS the shop
  // having asked — whether the message went out through a channel or a merchant
  // reviewed the draft and sent it by hand.
  ensureAsked(site.key, cart.id, claim.sub);

  const conv = conversation(site.key, cart.id);
  const grant = conv?.grantId ? findGrant(site.key, conv.grantId) : null;
  const lastRemedy = conv?.turns.filter((t) => t.kind === "remedied").pop();

  return {
    error: null as string | null,
    shopName: site.name,
    accent: site.accent,
    basket: cart.lines.map((l) => ({ title: l.title, qty: l.qty, lineTotal: l.lineTotal })),
    subtotal: cart.subtotal ?? cart.lines.reduce((s, l) => s + l.lineTotal, 0),
    state: conv?.state ?? "asked",
    reason: conv?.reason ?? null,
    say: lastRemedy ? (lastRemedy as { remedy: string }).remedy : null,
    grant: grant && grant.state === "live" ? { id: grant.id, percent: Math.round(grant.depth * 100), title: grant.title } : null,
    // A redeemed grant is not a dead end: send them back to the payment page
    // they already have, rather than telling them their discount is gone.
    payUrl:
      grant && grant.state === "redeemed" && grant.redeemedOrderId
        ? `/pay/${site.key}/${grant.redeemedOrderId}`
        : null,
    choices: OFFERED_CHOICES.map((r) => ({ value: r, label: REASON_LABEL[r] })),
    /**
     * Back to the shop with the basket already in it.
     *
     * Only when the merchant has wired the restore route, because a link to a
     * path their server does not serve is worse than no link. The token in the
     * URL is the one they already followed to get here — it carries no more
     * authority on the storefront than it does on this page.
     */
    restoreUrl:
      site.restorePath && site.origins[0]
        ? `${site.origins[0]}/?restore=${encodeURIComponent(params.token ?? "")}`
        : null,
  };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const o = open(params);
  if ("error" in o) return { error: o.error };
  const { site, cart, claim } = o;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "answer");

  /* ---------------- pay with the grant ---------------- */
  if (intent === "pay") {
    const conv = conversation(site.key, cart.id);
    const grant = conv?.grantId ? findGrant(site.key, conv.grantId) : null;
    if (!grant) return { error: "There's no discount on this basket." };
    if (grant.state === "redeemed" && grant.redeemedOrderId) {
      return { redirect: `/pay/${site.key}/${grant.redeemedOrderId}` };
    }
    if (grant.state !== "live") return { error: "That discount has expired." };
    if (!site.razorpay || !isConfigured(site.razorpay)) return { error: "This shop can't take payments right now." };

    const catalog = jsonFeedCatalog(site.catalogFeedUrl);
    // Re-priced from the catalogue, with the grant read by ID from disk. The
    // page sends which grant, never what it is worth.
    const quoted = await buildQuote({
      catalog,
      items: cart.lines.map((l) => ({ handle: l.handle, sku: l.sku, qty: l.qty })),
      shop: site.key,
      grantId: grant.id,
    });
    if (!quoted.ok) return { error: quoted.problems[0]?.message ?? "That basket can't be priced right now." };
    const quote = quoted.quote;

    const order = await createOrder(site.razorpay, {
      amount: toMinorUnits(quote.total),
      currency: quote.currency,
      receipt: `rc_${quote.fingerprint}_${Date.now().toString(36)}`,
      notes: { site: site.key, fingerprint: quote.fingerprint, customer: claim.sub, grant: grant.id },
    });
    if (!order.ok) return { error: order.message };

    const onHand = new Map<string, number>();
    for (const l of quote.lines) {
      const p = await catalog.get(l.handle).catch(() => null);
      onHand.set(l.sku, p?.variants.find((x) => x.sku === l.sku)?.inventoryQuantity ?? 0);
    }
    const held = claim_(site.key, order.order.id, quote.lines, onHand);
    if (!held) return { error: "Someone else is checking out with the last of that. Try again in a few minutes." };

    // Spent at order creation, not at settlement: the exposure exists the
    // moment a discounted order does. `redeemedOrderId` is what stops that from
    // punishing a closed tab — a shopper who comes back is sent to the same
    // payment page rather than told the discount is gone.
    const spent = redeem(site.key, grant.id, order.order.id);
    if (!spent.ok) return { error: "That discount has already been used." };

    savePending({
      gatewayOrderId: order.order.id,
      shop: site.key,
      createdAt: new Date().toISOString(),
      amount: quote.total,
      currency: quote.currency,
      fingerprint: quote.fingerprint,
      customer: claim.sub,
      lines: quote.lines.map((l) => ({
        handle: l.handle,
        title: l.title,
        sku: l.sku,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    });

    record({
      shop: site.key,
      kind: "payment_started",
      message: `recovery checkout ${order.order.id} for ${quote.total} ${quote.currency}`,
      detail: { grant: grant.id, discount: quote.discount, cartId: cart.id },
    });

    return { redirect: `/pay/${site.key}/${order.order.id}` };
  }

  /* ---------------- answer the question ---------------- */
  ensureAsked(site.key, cart.id, claim.sub);
  const conv = conversation(site.key, cart.id);
  if (conv?.finished) return { error: null, done: true };
  if (conv?.answeredAt) return { error: null, done: true };

  const chosen = (String(form.get("choice") ?? "") || null) as Reason | null;
  const text = String(form.get("text") ?? "").slice(0, 600) || null;
  if (!chosen && !text?.trim()) return { error: "Tell us in a word or two, or pick one above." };

  /**
   * The classifier gets the sentence and nothing else.
   *
   * No standing, no basket value, no mention that one of these labels can lead
   * to money. A classifier that knows which answer pays out is a classifier
   * with an incentive.
   */
  const cls = await classify({
    chosen,
    text,
    ask: modelConfigured()
      ? async (prompt) =>
          (await complete({
            model: MODELS.grader(),
            messages: [{ role: "user", content: prompt }],
            maxTokens: 16,
            temperature: 0,
          })) ?? ""
      : undefined,
  });

  const who = standing({ customerId: claim.sub });

  /**
   * The answer is the product. If it cannot be recorded, we do not proceed to a
   * remedy — a remedy issued against a conversation that was never written is a
   * discount with no audit trail behind it, and an answer that vanished while
   * the page said thank you.
   */
  const recorded = addTurn({
    shop: site.key,
    cartId: cart.id,
    customerId: claim.sub,
    turn: {
      kind: "answered",
      ts: new Date().toISOString(),
      reason: cls.reason,
      by: cls.by,
      evidence: cls.evidence,
      text,
      tier: who.tier,
    },
  });

  /**
   * The reason is about this BASKET. What they said may also be about THEM.
   *
   * "I only ever drink it black and the delivery charge was too much" carries
   * one fact for the recovery loop and one that will still be true in March,
   * and the two belong in different stores — the reason is per-basket and
   * finishes with it, a preference is per-person and outlives it.
   *
   * Third surface into the same memory, after the widget and the phone call.
   * All the gates live in `learn`: no verified identity means nothing is
   * written, and anything carrying a price, a stock level, an offer or an order
   * state is refused. The one thing worth noting is the identity — `claim.sub`
   * came out of a signed token, so this is not "whoever typed an email".
   */
  if (text) {
    try {
      learn({ shop: site.key, sub: claim.sub, said: text, route: "open", source: "recovery" });
    } catch {
      /* enrichment, never a dependency — the ANSWER is what must not be lost */
    }
  }
  if (!recorded.ok) {
    record({ shop: site.key, kind: "tool_error", message: `recovery answer not recorded: ${recorded.error}` });
    return { error: "Something went wrong saving that. Try once more?" };
  }

  const settings = readSettings(site.key);
  const notices = readFindings(site.key)?.serviceNotices ?? [];
  const catalog = jsonFeedCatalog(site.catalogFeedUrl);

  const decision = await chooseRemedy({
    shop: site.key,
    cartId: cart.id,
    reason: cls.reason,
    standing: who,
    basket: cart.lines.map((l) => ({ handle: l.handle, title: l.title, sku: l.sku, qty: l.qty, unitPrice: l.unitPrice })),
    policy: settings.recovery,
    inputs: readInputs(),
    catalog,
    policies: await catalog.policies().catch(() => ({})),
    serviceNotice: notices.find((n) => n.about.includes("netbanking") || n.about.includes("card"))?.text ?? null,
  });

  addTurn({
    shop: site.key,
    cartId: cart.id,
    customerId: claim.sub,
    turn: {
      kind: "remedied",
      ts: new Date().toISOString(),
      remedy: decision.remedy.say,
      grantId: decision.remedy.kind === "discount" ? decision.remedy.grant.id : undefined,
      blocked: decision.blocked,
    },
  });

  // They told us to stop. Recorded as a closed conversation, which suppresses
  // this basket AND this person from any further recovery message.
  if (decision.remedy.kind === "closed") {
    addTurn({
      shop: site.key,
      cartId: cart.id,
      customerId: claim.sub,
      turn: { kind: "closed", ts: new Date().toISOString(), why: `they said no (${cls.reason})` },
    });
  }

  return {
    error: null,
    say: decision.remedy.say,
    kind: decision.remedy.kind,
    products: decision.remedy.kind === "cross_sell" ? decision.remedy.products : [],
    grant:
      decision.remedy.kind === "discount"
        ? { id: decision.remedy.grant.id, percent: Math.round(decision.remedy.grant.depth * 100) }
        : null,
  };
};

/** Small wrapper so the import name `claim` is not shadowed by the form field. */
function claim_(
  shop: string,
  orderId: string,
  lines: Array<{ sku: string; qty: number }>,
  availableFromCatalogue: Map<string, number>,
): boolean {
  return claim({ shop, orderId, lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })), availableFromCatalogue }).ok;
}

/* ------------------------------------------------------------------ */

const CSS = `
:root { --bg:#f7f6f3; --panel:#fff; --ink:#16211c; --muted:#6b7a72; --line:#e3e6e2; --accent:#1f4037; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.wrap { max-width:560px; margin:0 auto; padding:36px 20px 64px; }
h1 { font-size:22px; letter-spacing:-0.02em; margin:0 0 6px; }
p.lede { color:var(--muted); margin:0 0 22px; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 18px; margin:14px 0; }
.row { display:flex; justify-content:space-between; gap:12px; font-size:14px; padding:4px 0; }
.choices { display:flex; flex-direction:column; gap:8px; margin:10px 0; }
.choice { display:flex; align-items:center; gap:9px; border:1px solid var(--line); border-radius:9px;
  padding:11px 13px; background:var(--panel); cursor:pointer; font-size:14px; }
.choice:hover { border-color:#c9d8d0; }
textarea { width:100%; font:inherit; font-size:14px; padding:10px 12px; border:1px solid var(--line);
  border-radius:9px; background:var(--panel); color:var(--ink); resize:vertical; }
button { background:var(--accent); color:#fff; border:0; border-radius:9px; padding:11px 18px;
  font:inherit; font-size:14px; font-weight:550; cursor:pointer; margin-top:12px; }
button:disabled { opacity:.5; cursor:default; }
.said { background:#eef3f0; border-radius:9px; padding:14px 16px; font-size:14.5px; margin:14px 0; }
.muted { color:var(--muted); font-size:13px; }
.err { color:#8a2f2f; font-size:13.5px; }
`;

export default function Recover() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>() as
    | { error?: string | null; say?: string; kind?: string; products?: Array<{ handle: string; title: string; price: number }>; grant?: { id: string; percent: number } | null; redirect?: string; done?: boolean }
    | undefined;
  const busy = useNavigation().state !== "idle";

  // The action returns a redirect target rather than throwing one, so the
  // browser navigation happens after React has the result — same pattern the
  // checkout widget uses.
  if (a?.redirect && typeof window !== "undefined") window.location.href = a.redirect;

  if (d.error) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="wrap">
          <h1>Sorry</h1>
          <p className="lede">{d.error}</p>
        </div>
      </>
    );
  }

  const answered = Boolean(a?.say) || d.state !== "asked";
  const say = a?.say ?? d.say;
  const grant = a?.grant ?? d.grant;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <h1>{d.shopName}</h1>
        <p className="lede">
          You left this behind. We&rsquo;re not going to badger you about it — but if you have ten
          seconds, knowing what stopped you genuinely helps.
        </p>

        <div className="panel">
          {d.basket.map((l, i) => (
            <div className="row" key={i}>
              <span>
                {l.title} {l.qty > 1 ? `× ${l.qty}` : ""}
              </span>
              <span>₹{l.lineTotal.toLocaleString("en-IN")}</span>
            </div>
          ))}
          <div className="row" style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 8, fontWeight: 600 }}>
            <span>Subtotal</span>
            <span>₹{(d.subtotal ?? 0).toLocaleString("en-IN")}</span>
          </div>
          {/*
            One tap back to the shop with this basket already in it.
            Under the answer form, not above it: the question is what this page
            is for, and a "buy now" button at the top turns an apology into a
            sales page. It is offered, never insisted on.
          */}
          {d.restoreUrl ? (
            <p style={{ margin: "12px 0 0", fontSize: 13.5 }}>
              <a href={d.restoreUrl}>Put this basket back on the shop →</a>
            </p>
          ) : null}
        </div>

        {!answered && (
          <Form method="post">
            <input type="hidden" name="intent" value="answer" />
            <div className="choices">
              {d.choices.map((c) => (
                <label className="choice" key={c.value}>
                  <input type="radio" name="choice" value={c.value} />
                  {c.label}
                </label>
              ))}
            </div>
            <textarea name="text" rows={2} placeholder="Or say it in your own words — one line is plenty." />
            {a?.error ? <p className="err">{a.error}</p> : null}
            <button type="submit" disabled={busy}>
              {busy ? "…" : "Send"}
            </button>
            <p className="muted" style={{ marginTop: 10 }}>
              This goes to {d.shopName}, not to an advertiser. We don&rsquo;t sell it and we don&rsquo;t
              share it.
            </p>
          </Form>
        )}

        {answered && say ? (
          <>
            <div className="said">{say}</div>

            {a?.products?.length ? (
              <div className="panel">
                {a.products.map((p) => (
                  <div className="row" key={p.handle}>
                    <span>{p.title}</span>
                    <span>from ₹{p.price.toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {grant ? (
              <Form method="post">
                <input type="hidden" name="intent" value="pay" />
                <button type="submit" disabled={busy}>
                  {busy ? "…" : `Pay with ${grant.percent}% off`}
                </button>
                <p className="muted" style={{ marginTop: 8 }}>
                  The discount is applied by the shop when the payment page opens. There&rsquo;s no code
                  to enter, and it only works on this basket.
                </p>
              </Form>
            ) : null}

            {d.payUrl ? (
              <p className="muted" style={{ marginTop: 12 }}>
                You already have a payment open for this basket — <a href={d.payUrl}>pick it up here</a>.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
