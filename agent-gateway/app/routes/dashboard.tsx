import { Form, Link, Outlet, redirect, useLoaderData, useLocation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { readSession } from "../lib/auth.server";

/**
 * One guard, on the layout, covering every child route.
 *
 * Putting the check here rather than in each page means a new page cannot ship
 * unprotected by omission — the commonest way an authenticated app grows a hole.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const merchant = readSession(request.headers.get("Cookie"));
  if (!merchant) throw redirect("/login");
  return { merchant: { name: merchant.name, email: merchant.email, sites: merchant.sites } };
};

/**
 * The merchant console.
 *
 * Deliberately outside `app.tsx`, which is the Shopify-embedded layout and
 * requires a Shopify session. CHAPMAN has custom-site merchants too, and they
 * have no Shopify admin to be embedded in — a console reachable only through
 * Shopify would lock out half the product.
 *
 * Authenticated by the loader above, which runs before any child route and
 * redirects rather than rendering. Every page below it can therefore assume a
 * merchant, and `sitesForMerchant` scopes what that merchant can see.
 */

const CSS = `
:root {
  --bg: #f7f6f3; --panel: #fff; --ink: #16211c; --muted: #6b7a72;
  --line: #e3e6e2; --accent: #1f4037; --accent-soft: #eef3f0;
  --warn: #8a6d2f; --warn-soft: #fbf4e4; --off: #9aa5a0; --off-soft: #f1f3f1;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: inherit; }
.wrap { max-width: 1020px; margin: 0 auto; padding: 0 20px 64px; }
header.top { border-bottom: 1px solid var(--line); background: var(--panel); }
header.top .wrap { display: flex; align-items: center; gap: 16px; padding: 14px 20px; }
.brand { font-weight: 620; letter-spacing: -0.01em; font-size: 17px; text-decoration: none; }
.brand span { color: var(--accent); }
.tag { font-size: 12px; color: var(--muted); border: 1px solid var(--line);
  border-radius: 999px; padding: 2px 9px; }
nav.crumbs { margin-left: auto; display: flex; gap: 14px; font-size: 13.5px; color: var(--muted); }
nav.crumbs a { text-decoration: none; }
nav.crumbs a:hover { color: var(--ink); }
nav.crumbs form { margin: 0; }
.signout { background: none; border: 0; padding: 0; font: inherit; font-size: 13.5px;
  color: var(--muted); cursor: pointer; }
.signout:hover { color: var(--ink); }
h1 { font-size: 25px; letter-spacing: -0.02em; margin: 30px 0 6px; }
h2 { font-size: 16.5px; letter-spacing: -0.01em; margin: 30px 0 10px; }
h3 { font-size: 14px; margin: 20px 0 6px; }
p.lede { color: var(--muted); margin: 0 0 22px; max-width: 62ch; }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 15px 16px; display: flex; flex-direction: column; gap: 7px; }
.card.live { border-color: #c9d8d0; box-shadow: 0 1px 0 rgba(31,64,55,.05); }
.card .name { font-weight: 600; font-size: 14.5px; display: flex; align-items: center;
  justify-content: space-between; gap: 10px; }
.card .blurb { color: var(--muted); font-size: 13.5px; margin: 0; }
.card .unlock { font-size: 12.5px; color: var(--warn); background: var(--warn-soft);
  border-radius: 7px; padding: 8px 10px; margin-top: 4px; }
.card a.open { margin-top: auto; padding-top: 8px; font-size: 13.5px; font-weight: 550;
  color: var(--accent); text-decoration: none; }
.card a.open:hover { text-decoration: underline; }
.pill { font-size: 11px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase;
  border-radius: 999px; padding: 3px 8px; white-space: nowrap; }
.pill.available { background: var(--accent-soft); color: var(--accent); }
.pill.needs_setup { background: var(--warn-soft); color: var(--warn); }
.pill.building { background: #eef1f7; color: #4a5a7a; }
.pill.planned { background: var(--off-soft); color: var(--off); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 18px 20px; margin: 14px 0; }
pre { background: #10201a; color: #dceae4; border-radius: 8px; padding: 14px 16px;
  overflow-x: auto; font-size: 12.5px; line-height: 1.5; margin: 10px 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
p code, li code, td code { background: var(--off-soft); border-radius: 4px; padding: 1px 5px; font-size: 12.5px; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th { text-align: left; font-weight: 600; color: var(--muted); font-size: 12px;
  text-transform: uppercase; letter-spacing: .03em; padding: 6px 10px 6px 0;
  border-bottom: 1px solid var(--line); }
td { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0 4px; }
.stat { border: 1px solid var(--line); border-radius: 9px; padding: 10px 14px;
  background: var(--panel); min-width: 116px; }
.stat b { display: block; font-size: 21px; font-weight: 620; letter-spacing: -0.02em; }
.stat span { font-size: 12px; color: var(--muted); }
.note { font-size: 13px; color: var(--muted); border-left: 2px solid var(--line);
  padding-left: 12px; margin: 12px 0; }
ol.steps { padding-left: 20px; margin: 8px 0; }
ol.steps li { margin: 9px 0; }
.tabs { display: flex; gap: 6px; margin: 16px 0 0; }
.tabs a { text-decoration: none; font-size: 13.5px; font-weight: 550; padding: 7px 13px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--muted); }
.tabs a[aria-current] { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-primary { background: var(--accent); color: #fff; border: 0; border-radius: 8px;
  padding: 8px 14px; font: inherit; font-size: 13.5px; font-weight: 550; cursor: pointer; }
.btn-primary:disabled, .btn-secondary:disabled { opacity: .5; cursor: default; }
.btn-secondary { background: var(--panel); color: var(--muted); border: 1px solid var(--line);
  border-radius: 8px; padding: 8px 14px; font: inherit; font-size: 13.5px; cursor: pointer; }
.btn-secondary:hover:enabled { color: var(--ink); }
input[type="date"], input[type="number"] { font: inherit; font-size: 13.5px; padding: 6px 8px;
  border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--ink); }
.muted { color: var(--muted); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
`;

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const { merchant } = useLoaderData<typeof loader>();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="top">
        <div className="wrap">
          <Link to="/dashboard" className="brand">
            CHAP<span>MAN</span>
          </Link>
          <span className="tag" title={merchant.email}>
            {merchant.name}
          </span>
          <nav className="crumbs">
            <Link to="/dashboard">Features</Link>
            <Link to="/dashboard/chatbot">Assistant</Link>
            <Link to="/dashboard/offers">Offers</Link>
            <Link to="/dashboard/recovery">Recovery</Link>
            <Link to="/dashboard/analyst">Analyst</Link>
            <Link to="/dashboard/agentfront">Agent front</Link>
            <Link to="/dashboard/cortex">Cortex</Link>
            <Link to="/dashboard/ledger">Ledger</Link>
            <Link to="/dashboard/testbench">Test bench</Link>
            {/* A form, not a link: sign-out changes state, so it is a POST. */}
            <Form method="post" action="/logout">
              <button type="submit" className="signout">
                Sign out
              </button>
            </Form>
          </nav>
        </div>
      </header>
      <main className="wrap" key={pathname}>
        <Outlet />
      </main>
    </>
  );
}
