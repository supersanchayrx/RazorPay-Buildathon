/**
 * Merchant authentication for the CHAPMAN console.
 *
 * THREE CREDENTIAL CLASSES LIVE IN THIS CODEBASE AND THEY MUST NOT BE CONFUSED:
 *
 *   site key       public, sits in the merchant's HTML, identifies a storefront.
 *                  Not a secret and never treated as one.
 *   site secret    server-side, shared with the merchant's own backend. Signs
 *                  shopper session tokens and our requests to their order feed.
 *   merchant login THIS FILE. Proves a human may administer a shop.
 *
 * A single "auth" module that served all three would eventually let one stand in
 * for another, and the failure would be silent. They are separate files with
 * separate lifetimes on purpose.
 *
 * Passwords are hashed with scrypt — deliberately slow and memory-hard, so a
 * stolen file is expensive to attack offline. Never a bare SHA: a fast hash
 * over human-chosen passwords is a plaintext file with extra steps.
 *
 * File-backed for now, and it should be a Prisma table before real merchants
 * exist. The shape below is the schema.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths.server";

export type Merchant = {
  id: string;
  email: string;
  name: string;
  /** scrypt: N:r:p:salt:hash, all base64url. */
  password: string;
  /** Which storefronts this person may administer. The console scopes to these. */
  sites: string[];
  createdAt: string;
};

const FILE = dataPath("merchants.json");

/**
 * The secret that signs console sessions.
 *
 * Generated and persisted on first run rather than hardcoded, so a checked-out
 * copy of this repo cannot mint a session for someone else's deployment. In
 * production this comes from the environment.
 */
function sessionSecret(): string {
  if (process.env.CONSOLE_SESSION_SECRET) return process.env.CONSOLE_SESSION_SECRET;
  const p = dataPath(".session-secret");
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    const s = crypto.randomBytes(32).toString("base64url");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, s, "utf8");
    return s;
  }
}

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

const N = 16384, R = 8, P = 1, KEYLEN = 32;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return [N, R, P, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const parts = stored.split(":");
    if (parts.length !== 5) return false;
    const [n, r, p, saltB64, hashB64] = parts;

    const salt = Buffer.from(saltB64, "base64url");
    const expected = Buffer.from(hashB64, "base64url");

    // Every field is validated before it is used, because Buffer.from silently
    // DISCARDS invalid base64url characters rather than failing. A stored hash
    // of "!!" decodes to zero bytes; deriving a zero-length key from it and
    // comparing gives timingSafeEqual(empty, empty) === true, and every
    // password on earth authenticates. A corrupt row must fail closed, not open.
    if (expected.length !== KEYLEN || salt.length < 16) return false;

    const [N_, r_, p_] = [Number(n), Number(r), Number(p)];
    if (![N_, r_, p_].every((v) => Number.isInteger(v) && v > 0)) return false;
    // Bound the work factor too: a crafted row with an enormous N is a denial
    // of service on the login path.
    if (N_ > 1 << 20 || r_ > 32 || p_ > 16) return false;

    const actual = crypto.scryptSync(plain, salt, KEYLEN, {
      N: N_,
      r: r_,
      p: p_,
      maxmem: 128 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * The merchant store
 * ------------------------------------------------------------------ */

export function readMerchants(): Merchant[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Merchant[];
  } catch {
    return [];
  }
}

function writeMerchants(rows: Merchant[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(rows, null, 2) + "\n", "utf8");
}

export function createMerchant(opts: {
  email: string;
  name: string;
  password: string;
  sites: string[];
}): Merchant {
  const rows = readMerchants();
  const email = opts.email.trim().toLowerCase();
  if (rows.some((m) => m.email === email)) throw new Error(`${email} already exists`);
  const m: Merchant = {
    id: "mch_" + crypto.randomBytes(8).toString("hex"),
    email,
    name: opts.name,
    password: hashPassword(opts.password),
    sites: opts.sites,
    createdAt: new Date().toISOString(),
  };
  writeMerchants([...rows, m]);
  return m;
}

/**
 * Give an existing account access to another storefront.
 *
 * Exists because `npm run init` adds a second shop to a config that already
 * has one, and the account that will manage it is usually the account that is
 * already there. Without this the merchant finishes setup, signs in, and
 * cannot see the shop they just configured -- which reads as setup having
 * failed rather than as a permission they were never given.
 *
 * Idempotent, and returns the merchant either way. Granting a site that is not
 * in the config is legal: the console shows nothing for it, and the grant
 * starts working the moment the site is added.
 */
export function grantSite(email: string, siteKey: string): Merchant {
  const rows = readMerchants();
  const e = email.trim().toLowerCase();
  const m = rows.find((x) => x.email === e);
  if (!m) throw new Error(`${e} does not exist`);
  if (!m.sites.includes(siteKey)) {
    m.sites = [...m.sites, siteKey];
    writeMerchants(rows);
  }
  return m;
}

export function findMerchantByEmail(email: string): Merchant | null {
  const e = email.trim().toLowerCase();
  return readMerchants().find((m) => m.email === e) ?? null;
}

export function findMerchantById(id: string): Merchant | null {
  return readMerchants().find((m) => m.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * Throttling
 * ------------------------------------------------------------------ */

const attempts = new Map<string, { n: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 10 * 60_000;

/**
 * A login form with no limit is a password-guessing API with a nice layout.
 * Keyed on email AND client, so one attacker cannot lock a real merchant out
 * of their own console by failing their login on purpose.
 *
 * In memory, so it resets on restart and does not survive more than one
 * process. Adequate for a single-node deployment and explicitly not for more.
 */
export function throttle(key: string): { allowed: boolean; retryInSeconds: number } {
  const row = attempts.get(key);
  if (row && row.until > Date.now() && row.n >= MAX_ATTEMPTS) {
    return { allowed: false, retryInSeconds: Math.ceil((row.until - Date.now()) / 1000) };
  }
  return { allowed: true, retryInSeconds: 0 };
}

export function recordFailure(key: string) {
  const row = attempts.get(key);
  if (!row || row.until <= Date.now()) attempts.set(key, { n: 1, until: Date.now() + LOCKOUT_MS });
  else attempts.set(key, { n: row.n + 1, until: Date.now() + LOCKOUT_MS });
}

export function clearFailures(key: string) {
  attempts.delete(key);
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

const COOKIE = "chapman_console";
const SESSION_HOURS = 12;

function sign(body: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
}

export function createSession(merchantId: string): string {
  const body = Buffer.from(
    JSON.stringify({ sub: merchantId, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSession(cookieHeader: string | null): Merchant | null {
  if (!cookieHeader) return null;
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;

  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;

  const expected = sign(body);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a mismatch, and a throw here
  // would be both a crash and a timing signal.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return findMerchantById(claims.sub);
  } catch {
    return null;
  }
}

/**
 * For child loaders.
 *
 * The layout guard already redirects an unauthenticated visitor, but React
 * Router runs child loaders in parallel with the layout's — so a child that
 * assumed the guard had run would read `undefined` and throw a less useful
 * error. Each loader that touches merchant data asks for itself.
 */
export function requireMerchant(request: Request): Merchant {
  const merchant = readSession(request.headers.get("Cookie"));
  if (!merchant) throw new Response(null, { status: 302, headers: { Location: "/login" } });
  return merchant;
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  const parts = [
    `${COOKIE}=${value}`,
    "Path=/",
    // HttpOnly: page scripts cannot read it, so an XSS on the console cannot
    // walk away with a live session.
    "HttpOnly",
    // Lax: the cookie is not sent on cross-site POSTs, which is what stops
    // another origin from driving a logged-in merchant's console.
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  // Secure would break plain-http local development, so it is conditional
  // rather than absent — the production path must not silently lose it.
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export const clearCookie = () => sessionCookie("", 0);
