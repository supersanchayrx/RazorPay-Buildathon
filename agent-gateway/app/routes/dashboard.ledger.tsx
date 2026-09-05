import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { readLedger } from "../lib/ledger.server";
import { requireMerchant } from "../lib/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireMerchant(request);
  return { rows: readLedger(120).reverse() };
};

/**
 * The ledger, plainly.
 *
 * The point of showing a merchant the blocked replies is that a refusal is only
 * trustworthy if it is visible. A guardrail nobody can inspect is a claim about
 * a guardrail.
 */
export default function Ledger() {
  const { rows } = useLoaderData<typeof loader>();
  return (
    <>
      <p className="muted" style={{ marginTop: 22, fontSize: 13.5 }}>
        <Link to="/dashboard" style={{ textDecoration: "none" }}>
          ← Features
        </Link>
      </p>
      <h1>Decision ledger</h1>
      <p className="lede">
        Everything said on your behalf, and everything stopped before it was. Newest first, last 120.
      </p>
      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Empty.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ whiteSpace: "nowrap" }}>When</th>
                <th>Kind</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={i}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>
                    {e.ts.slice(5, 16).replace("T", " ")}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {e.kind === "refusal" ? (
                      <span className="pill needs_setup">{e.gate ?? "blocked"}</span>
                    ) : e.kind === "tool_error" ? (
                      <span className="pill planned">error</span>
                    ) : (
                      <span className="pill available">reply</span>
                    )}
                  </td>
                  <td>
                    {e.message}
                    {e.kind === "refusal" && e.detail ? (
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                        suppressed: “{String((e.detail as { suppressedReply?: string }).suppressedReply ?? "").slice(0, 120)}”
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
