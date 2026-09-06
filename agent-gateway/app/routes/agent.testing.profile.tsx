import type { LoaderFunctionArgs } from "react-router";
import { UCP_VERSION } from "../lib/ucp.server";
import { selfOrigin } from "../lib/origin.server";

/**
 * A UCP agent profile, for testing this store's agent surface.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A HOLE IN THE IDENTITY GATE.
 *
 * `create_checkout` refuses any caller whose `meta["ucp-agent"].profile` does
 * not resolve to a real document. That gate is doing real work: holding stock
 * and opening a payment cost the merchant something, so the caller has to be
 * attributable to a host somebody can look up and, if necessary, block.
 *
 * But it also means the surface cannot be exercised by hand. A person pointing
 * Claude or ChatGPT at this store has no profile to name, and a model asked for
 * one invents a plausible URL that 404s — so the demo dies at the step it was
 * meant to prove, for a reason that looks like a bug and is not.
 *
 * So this is a REAL profile, honestly labelled. It does not pretend to be a
 * shopping platform. Every checkout that names it lands in the ledger as
 * `agent.testing`, which is exactly what it is: somebody trying the store out.
 * A merchant reading their ledger can tell those apart from real agent traffic
 * at a glance, which is more than they could if the tester had invented a
 * company name.
 *
 * IT IS NOT AN IDENTITY MODEL. It is one shared URL and anyone may name it, so
 * it attributes to "a tester" and no further. Production attribution is the
 * agent publishing its own profile on its own domain, which is what the
 * protocol asks for and what a real shopping platform will already have.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const u = new URL(request.url);

  return new Response(
    JSON.stringify(
      {
        ucp: {
          version: UCP_VERSION,
          status: "success",
          // An agent profile advertises what the AGENT does, which is shop. It
          // carries no services and no payment handlers: it is not a business,
          // it is a caller, and a profile claiming otherwise would be inviting
          // somebody to transact with the test harness.
          capabilities: {
            "dev.ucp.shopping.cart": [{ version: UCP_VERSION }],
            "dev.ucp.shopping.checkout": [{ version: UCP_VERSION }],
          },
        },
        name: "CHAPMAN test harness",
        description:
          "A person exercising this store's agent surface by hand — through the ucp CLI, an MCP client, or scripts/shop-as-agent.mjs. Not a shopping platform, and not a fleet.",
        url: `${selfOrigin(request)}/agent/testing/profile`,
      },
      null,
      2,
    ),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    },
  );
};
