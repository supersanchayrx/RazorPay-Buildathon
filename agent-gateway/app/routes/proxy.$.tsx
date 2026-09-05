import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Tier-0 agent surface, served through Shopify's App Proxy:
 *   merchant.myshopify.com/apps/agent/*  ->  <app>/proxy/*
 *
 * Right now this is a diagnostic, not the real manifest. It answers two
 * questions in one request:
 *   1. does the proxy path reach us at all?
 *   2. does Shopify forward RFC 9421 crawler-signature headers, or strip them?
 *      (findings-06 open item 1 — decides whether agent verification is
 *       available at tier 0 or is tier-3-only)
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  // The whole point of open item 1.
  const crawlerSignature = {
    forwarded: Boolean(headers["signature"] || headers["signature-agent"]),
    signature: headers["signature"] ?? null,
    "signature-input": headers["signature-input"] ?? null,
    "signature-agent": headers["signature-agent"] ?? null,
  };

  // Shopify signs proxy requests itself; this verifies that signature.
  let proxyAuth: Record<string, unknown>;
  try {
    const { session } = await authenticate.public.appProxy(request);
    proxyAuth = { verified: true, shop: session?.shop ?? null };
  } catch (error) {
    proxyAuth = {
      verified: false,
      threw: error instanceof Response ? `Response ${error.status}` : String(error),
    };
  }

  return new Response(
    JSON.stringify(
      {
        ok: true,
        note: "agent-gateway proxy diagnostic",
        receivedPath: url.pathname,
        proxyAuth,
        crawlerSignature,
        query,
        headers,
      },
      null,
      2,
    ),
    { headers: { "content-type": "application/json; charset=utf-8" } },
  );
};
