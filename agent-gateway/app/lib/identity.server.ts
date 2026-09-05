/**
 * Shopper identity.
 *
 * ONE RULE GOVERNS THIS FILE:
 *
 *   Never look up an order from an identifier the shopper typed.
 *
 * "Where's my order? My email is priya@example.com" must not work. Anyone can
 * type anyone's address, and a chat widget that answers it is a data breach
 * with a friendly tone. Identity has to be asserted by the merchant's own
 * system, which is the only party that actually knows who is logged in.
 *
 * On Shopify that is free: `logged_in_customer_id` arrives on the App Proxy
 * request inside Shopify's own HMAC. On a custom site there is no such thing,
 * so the merchant mints a short-lived token for their logged-in session and the
 * widget presents it. No token, no personal data — the assistant falls back to
 * the catalogue, which is a perfectly good place to be.
 *
 * Token format, deliberately small enough to read:
 *
 *   v1.<base64url(payload)>.<base64url(hmac-sha256)>
 *   payload = { site, sub, exp }
 *
 * `sub` is the merchant's own customer id. Not an email, because an email is a
 * guessable identifier and this is a bearer token: whoever holds it is treated
 * as that customer, so it is short-lived and bound to one site.
 *
 * This is not JWT and does not want to be. JWT's `alg` field is a decade-long
 * source of verifier bugs (`alg: none`, HS/RS confusion), and it exists to
 * negotiate something we do not negotiate. One algorithm, no negotiation, no
 * header to lie in.
 */
import crypto from "node:crypto";

export type ShopperIdentity = {
  /** The merchant's customer id. */
  sub: string;
  site: string;
  /** How we came to believe it — goes in the ledger. */
  via: "session_token" | "shopify_proxy";
  expiresAt: string;
};

export type VerifyFailure =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "wrong_site"
  | "expired";

const b64url = (b: Buffer) => b.toString("base64url");

export function mintSessionToken(opts: {
  site: string;
  sub: string;
  secret: string;
  ttlSeconds?: number;
}): string {
  const payload = JSON.stringify({
    site: opts.site,
    sub: opts.sub,
    // Short by default. A stolen token should stop working before anyone has
    // finished deciding what to do with it.
    exp: Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 900),
  });
  const body = b64url(Buffer.from(payload, "utf8"));
  const sig = b64url(crypto.createHmac("sha256", opts.secret).update(body).digest());
  return `v1.${body}.${sig}`;
}

export function verifySessionToken(
  token: string | null | undefined,
  opts: { site: string; secret: string; now?: number },
): { ok: true; identity: ShopperIdentity } | { ok: false; reason: VerifyFailure } {
  if (!token) return { ok: false, reason: "missing" };

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, reason: "malformed" };
  const [, body, sig] = parts;

  const expected = b64url(crypto.createHmac("sha256", opts.secret).update(body).digest());
  // Constant-time, and length-checked first because timingSafeEqual throws on a
  // length mismatch — which would itself be a timing signal, and a crash.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: { site?: string; sub?: string; exp?: number };
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Signature checked before anything is read out of the payload: an unverified
  // payload is attacker-controlled input and must not reach any logic.
  if (!claims.sub || typeof claims.sub !== "string") return { ok: false, reason: "malformed" };

  // A token minted for one shop must not work at another, or a merchant with a
  // leaked secret could read customers at every other shop we serve.
  if (claims.site !== opts.site) return { ok: false, reason: "wrong_site" };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return { ok: false, reason: "expired" };

  return {
    ok: true,
    identity: {
      sub: claims.sub,
      site: opts.site,
      via: "session_token",
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    },
  };
}

/**
 * Shopify needs none of the above. The proxy request is already HMAC-signed by
 * Shopify and carries the customer id, so verifying the proxy IS verifying the
 * identity — there is nothing further to check and nothing for a merchant to
 * implement.
 */
export function identityFromProxy(
  customerId: string | null,
  shop: string,
): ShopperIdentity | null {
  if (!customerId) return null;
  return {
    sub: customerId,
    site: shop,
    via: "shopify_proxy",
    // Bounded by Shopify's own signature window, not by us.
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  };
}
