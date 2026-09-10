import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { runAssistant } from "../lib/assistant.server";
import { featureOn } from "../lib/featureflags.server";
import { shopifyCatalog } from "../lib/catalog.server";
import { publicBodyFailure, readPublicJson } from "../lib/http-security.server";

/**
 * Conversational endpoint for the storefront overlay.
 *   merchant.myshopify.com/apps/agent/chat  ->  /proxy/chat
 *
 * Everything that must be bounded runs on this side of the wire. The browser
 * receives an answer; it never receives — or can alter — the rules that
 * produced it.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop: string;
  let admin;
  try {
    const ctx = await authenticate.public.appProxy(request);
    if (!ctx.session?.shop || !ctx.admin) {
      return json({ error: "app is not installed on this shop" }, 401);
    }
    shop = ctx.session.shop;
    admin = ctx.admin;
  } catch {
    return json({ error: "proxy signature not verified" }, 401);
  }

  let message = "";
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  try {
    const body = await readPublicJson<{
      message?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    }>(request, "chat");
    message = (body.message ?? "").trim().slice(0, 2000);
    history = Array.isArray(body.history) ? body.history : [];
  } catch (error) {
    const failure = publicBodyFailure(error);
    return json({ error: failure.message, error_code: failure.code }, failure.status);
  }
  if (!message) return json({ error: "message is required" }, 400);

  // The Shopify twin of the check in `embed.chat`. Keyed on the myshopify
  // domain, which is how `settings.server.ts` already keys a Shopify shop —
  // one shop, one identity, whichever front door it came through.
  //
  // Memory and the tool set need no check here: both are enforced inside
  // `runAssistant`, so this path inherits them rather than repeating them.
  if (!featureOn(shop, "assistant")) {
    return json({
      reply: "Chat isn't available on this store at the moment.",
      bounded: false,
      gates: [],
      toolCalls: [],
    });
  }

  try {
    const result = await runAssistant({
      catalog: shopifyCatalog(admin),
      shop,
      message,
      history,
    });
    return json({
      reply: result.reply,
      // Surfaced so the demo can show the gate firing rather than just assert it.
      bounded: result.violations.length > 0,
      gates: result.violations.map((v) => v.gate),
      toolCalls: result.toolCalls,
      cards: result.cards,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return json({ error: "assistant failed", detail }, 500);
  }
};

// GET exists only so the endpoint can be smoke-tested with curl.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    return json({ ok: true, endpoint: "chat", method: "POST", shop: session?.shop ?? null });
  } catch {
    return json({ error: "proxy signature not verified" }, 401);
  }
};
