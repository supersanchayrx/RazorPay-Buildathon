/**
 * Merchant console authentication.
 *
 * Adversarial, like the identity suite: each check tries to get in, or to get
 * at another merchant's shop, and asserts that it could not.
 *
 * Run:  node scripts/check-auth.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const out = path.join(process.cwd(), "node_modules", ".cache", "auth-check.mjs");
fs.mkdirSync(path.dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: ["app/lib/auth.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "silent",
});
const A = await import(pathToFileURL(out).href);

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

/* ---- password hashing ---------------------------------------------- */
const stored = A.hashPassword("correct horse battery staple");
check("the right password verifies", A.verifyPassword("correct horse battery staple", stored));
check("a wrong password does not", !A.verifyPassword("Correct horse battery staple", stored));
check(
  "the stored form is scrypt with a per-account salt, not a bare digest",
  stored.startsWith("16384:8:1:") && stored.split(":").length === 5,
  "a fast hash over human passwords is a plaintext file with extra steps",
);
check(
  "two accounts with the same password hash differently",
  A.hashPassword("same") !== A.hashPassword("same"),
  "so one cracked hash does not crack every reuse of that password",
);
// "16384:8:1:!!:!!" is the one that mattered. Buffer.from discards invalid
// base64url characters instead of failing, so that row decoded to a zero-length
// hash, scrypt derived a zero-length key, and timingSafeEqual(empty, empty)
// returned true — every password authenticated. A corrupt row must fail closed.
const MALFORMED = [
  "",
  "garbage",
  "1:2:3",
  "16384:8:1:!!:!!",
  "16384:8:1::",
  "16384:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAA",
  "0:8:1:AAAAAAAAAAAAAAAAAAAAAA:" + "A".repeat(43),
  "-1:8:1:AAAAAAAAAAAAAAAAAAAAAA:" + "A".repeat(43),
  "x:8:1:AAAAAAAAAAAAAAAAAAAAAA:" + "A".repeat(43),
];
const slipped = MALFORMED.filter((s) => A.verifyPassword("any password at all", s) !== false);
check(
  "every malformed stored hash fails closed",
  slipped.length === 0,
  slipped.length ? `AUTH BYPASS via ${slipped.map((s) => JSON.stringify(s)).join(", ")}` : `${MALFORMED.length} corrupt rows`,
);

/* ---- sessions ------------------------------------------------------- */
const merchants = A.readMerchants();
if (merchants.length === 0) {
  console.log("SKIP  sessions — run `npm run merchant:add` first");
} else {
  const m = merchants[0];
  const cookieOf = (v) => `chapman_console=${v}`;
  const token = A.createSession(m.id);

  check("a valid session resolves to its merchant", A.readSession(cookieOf(token))?.id === m.id);
  check("no cookie is not a session", A.readSession(null) === null);

  const [body, sig] = token.split(".");
  const otherBody = Buffer.from(
    JSON.stringify({ sub: "mch_someone_else", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  check(
    "swapping the subject while keeping the signature fails",
    A.readSession(cookieOf(`${otherBody}.${sig}`)) === null,
    "the signature covers the payload",
  );
  check(
    "an unsigned session is rejected",
    A.readSession(cookieOf(`${body}.`)) === null && A.readSession(cookieOf(body)) === null,
  );
  check(
    "an expired session is rejected",
    (() => {
      const expired = Buffer.from(
        JSON.stringify({ sub: m.id, exp: Math.floor(Date.now() / 1000) - 1 }),
      ).toString("base64url");
      return A.readSession(cookieOf(`${expired}.${"x".repeat(43)}`)) === null;
    })(),
  );
  check(
    "garbage cookies are rejected without throwing",
    ["=", "chapman_console=", "chapman_console=a.b.c.d", "x=1; chapman_console=..", "…"].every(
      (c) => A.readSession(c) === null,
    ),
    "5 malformed inputs",
  );

  /* ---- cookie flags ------------------------------------------------- */
  const cookie = A.sessionCookie("v", 3600);
  check(
    "the session cookie is HttpOnly and SameSite=Lax",
    /HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie),
    "HttpOnly stops an XSS walking off with it; Lax stops another origin driving the console",
  );
  check("signing out sets Max-Age=0", /Max-Age=0/.test(A.clearCookie()));
}

/* ---- throttling ----------------------------------------------------- */
const key = "check@example.invalid|test";
check("a fresh key is allowed", A.throttle(key).allowed);
for (let i = 0; i < 8; i++) A.recordFailure(key);
const blocked = A.throttle(key);
check(
  "repeated failures lock the pair out",
  !blocked.allowed && blocked.retryInSeconds > 0,
  `retry in ${Math.ceil(blocked.retryInSeconds / 60)}m — a login form with no limit is a password-guessing API`,
);
check(
  "a different client for the same email is unaffected",
  A.throttle("check@example.invalid|other-client").allowed,
  "so an attacker cannot lock a real merchant out of their own console",
);
A.clearFailures(key);
check("a successful login clears the counter", A.throttle(key).allowed);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
