import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { allowedOrigin, findSite } from "../lib/sites.server";
import { verifySessionToken } from "../lib/identity.server";
import { forget, memories } from "../lib/memory.server";

/**
 * The shopper's own end of memory: see it, and delete it.
 *
 * A memory store with no exit is a collection, and this one takes the opposite
 * position — memory is stated, correctable and deletable, and the deletion has
 * to be reachable by the person it is about rather than only by the merchant.
 *
 * THE ONLY WAY IN IS A SIGNED SESSION TOKEN. Not an email, not a customer id in
 * the body: those are things anyone can type, and a "show me what you remember"
 * endpoint that accepted one would be a lookup service for other people's
 * preferences. Whoever holds the token is treated as that shopper, which is
 * exactly the authority the merchant's own login already granted them.
 *
 * Scoping is at the LOOKUP and not by convention: `memories` and `forget` both
 * take (shop, sub), and the sub can only have come from `verifySessionToken`.
 * There is no parameter on this route that widens either.
 */

function cors(origin: string | null): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    ...(origin
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-max-age": "86400",
          vary: "Origin",
        }
      : {}),
    // One person's preferences. Nothing in between may keep a copy.
    "cache-control": "no-store, private",
  };
}

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: cors(origin) });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  return json({ ok: true, endpoint: "memory", ops: ["list", "forget"], method: "POST" }, 200, origin);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get("Origin");

  let body: { site?: string; session?: string; op?: "list" | "forget"; id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "expected a JSON body" }, 400, origin);
  }

  const site = findSite(body.site ?? null);
  if (!site) return json({ ok: false, error: "unknown site key" }, 404, origin);

  const ok = allowedOrigin(site, origin);
  if (!ok) return json({ ok: false, error: "origin not allowed for this site" }, 403, origin);

  const verified = verifySessionToken(body.session, { site: site.key, secret: site.secret });
  if (!verified.ok) {
    /**
     * Not signed in is not an error, and the wording matters.
     *
     * An anonymous shopper has nothing stored, so "nothing remembered" is the
     * literal truth rather than a refusal. Saying "sign in to see your data"
     * would imply there is data behind the door.
     */
    return json({ ok: true, memories: [], signedIn: false }, 200, ok);
  }
  const sub = verified.identity.sub;

  if (body.op === "forget") {
    // An id deletes one; its absence deletes everything about this person.
    const done = forget(site.key, sub, typeof body.id === "string" && body.id ? body.id : undefined);
    return json({ ok: done, signedIn: true, memories: done ? [] : undefined }, done ? 200 : 500, ok);
  }

  return json(
    {
      ok: true,
      signedIn: true,
      // The sentence, and when it ages out. Not the evidence: the shopper does
      // not need their own words quoted back at them, and the merchant-facing
      // console is where a wrong memory gets traced to what produced it.
      memories: memories(site.key, sub).map((m) => ({
        id: m.id,
        text: m.text,
        kind: m.kind,
        expiresAt: m.expiresAt,
      })),
    },
    200,
    ok,
  );
};
