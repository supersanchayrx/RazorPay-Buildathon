import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  clearFailures,
  createSession,
  findMerchantByEmail,
  readSession,
  recordFailure,
  sessionCookie,
  throttle,
  verifyPassword,
} from "../lib/auth.server";

/**
 * Deliberately a top-level route rather than a child of `dashboard`.
 *
 * The dashboard layout redirects anyone without a session to here. If the login
 * page lived inside that layout it would redirect to itself forever — a loop
 * that only appears once the guard is switched on, which is exactly when
 * nobody is watching.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (readSession(request.headers.get("Cookie"))) throw redirect("/dashboard");
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");

  // Keyed on the pair, so an attacker hammering one address cannot lock the
  // real owner out of their own console.
  const client = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const key = `${email.toLowerCase()}|${client}`;

  const gate = throttle(key);
  if (!gate.allowed) {
    return {
      error: `Too many attempts. Try again in ${Math.ceil(gate.retryInSeconds / 60)} minutes.`,
    };
  }

  const merchant = findMerchantByEmail(email);
  const ok = merchant ? verifyPassword(password, merchant.password) : false;

  if (!merchant || !ok) {
    recordFailure(key);
    // One message for both cases. Saying "no such account" turns the login form
    // into a tool for discovering which merchants exist.
    return { error: "Email or password is not right." };
  }

  clearFailures(key);
  return redirect("/dashboard", {
    headers: { "Set-Cookie": sessionCookie(createSession(merchant.id), 12 * 3600) },
  });
};

const CSS = `
:root { --bg:#f7f6f3; --panel:#fff; --ink:#16211c; --muted:#6b7a72; --line:#e3e6e2; --accent:#1f4037; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.shell { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
.box { width:100%; max-width:380px; }
.brand { font-size:20px; font-weight:620; letter-spacing:-0.01em; margin:0 0 4px; }
.brand span { color:var(--accent); }
.sub { color:var(--muted); font-size:13.5px; margin:0 0 20px; }
form { background:var(--panel); border:1px solid var(--line); border-radius:11px; padding:20px; }
label { display:block; font-size:13px; color:var(--muted); margin:0 0 5px; }
input { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #d8ded9;
  border-radius:8px; font-size:15px; margin-bottom:14px; }
input:focus { outline:2px solid #cfe0d8; border-color:var(--accent); }
button { width:100%; padding:11px; border:0; border-radius:8px; background:var(--accent);
  color:#fff; font-size:15px; font-weight:550; cursor:pointer; }
button[disabled] { opacity:.6; cursor:default; }
.err { background:#fbeceb; color:#8a2f2f; border-radius:8px; padding:9px 11px;
  font-size:13.5px; margin-bottom:14px; }
.note { color:var(--muted); font-size:12.5px; margin:14px 2px 0; line-height:1.5; }
code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;
  background:#eef1ef; border-radius:4px; padding:1px 5px; }
`;

export default function Login() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="shell">
        <div className="box">
          <p className="brand">
            CHAP<span>MAN</span>
          </p>
          <p className="sub">Merchant console</p>
          <Form method="post">
            {data?.error ? <div className="err">{data.error}</div> : null}
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </Form>
          <p className="note">
            No accounts yet? Create one with <code>npm run merchant:add</code>. There is no public
            sign-up: a console that anyone can register for is a console anyone can probe.
          </p>
        </div>
      </div>
    </>
  );
}
