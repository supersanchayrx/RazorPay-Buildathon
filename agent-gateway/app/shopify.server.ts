/**
 * Shopify — for the merchants who have Shopify.
 *
 * WHY THIS FILE IS LAZY. `shopifyApp()` validates its own configuration and
 * throws on an empty `appUrl`. It used to be called at module scope, and
 * `entry.server.tsx` imports this file to add response headers, so that throw
 * happened while the server was still assembling itself — before any router,
 * any route, any error boundary. The result was not a Shopify feature failing.
 * It was the process refusing to start:
 *
 *   ShopifyError: Detected an empty appUrl configuration
 *
 * A merchant on WooCommerce, on a static site, on their own Rails app, hits
 * that on their first `npm start` — for a platform they do not use and never
 * asked about. CHAPMAN is a tool for any merchant; Shopify is one integration
 * it happens to offer, and an integration must not be able to veto the boot.
 *
 * The local workaround is worth naming because this deletes it: `.env.embed`
 * carried four invented Shopify credentials whose only purpose was to get
 * past this line. `npm run dev:gateway` worked because Vite injected them.
 * `npm start` did not, because `react-router-serve` does not read that file —
 * the production entrypoint had been broken for as long as the placeholders
 * had been papering over it.
 *
 * WHAT CHANGES WHEN SHOPIFY IS CONFIGURED. Nothing. The same `shopifyApp()`
 * call with the same arguments, made on first use instead of at import, and
 * memoised so it still happens exactly once.
 *
 * WHAT CHANGES WHEN IT IS NOT. `addDocumentResponseHeaders` becomes a no-op,
 * which is what it already was for every non-Shopify request: it emits headers
 * only for a request carrying a `shop` parameter, so `/dashboard` and
 * `/embed.js` got an empty Headers object before this change and get one now.
 * Everything else — `authenticate`, `login`, the session storage — throws a
 * sentence naming the three variables, and only if a Shopify route is actually
 * reached. A 500 on `/auth` for a shop that has no Shopify is the correct
 * outcome. A dead server is not.
 */
import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { loadRootEnv } from "./lib/env.server";

function buildShopify() {
  return shopifyApp({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
    apiVersion: ApiVersion.July26,
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(prisma),
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    ...(process.env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });
}

type ShopifyApp = ReturnType<typeof buildShopify>;

const NOT_CONFIGURED =
  "Shopify is not configured. This route belongs to the Shopify app and needs " +
  "SHOPIFY_API_KEY, SHOPIFY_API_SECRET and SHOPIFY_APP_URL set in the " +
  "environment or your .env. Nothing else in CHAPMAN requires them — the " +
  "widget, the UCP tool surface, quotes and payments all run on a custom site " +
  "with Shopify absent.";

/**
 * Whether the three variables `shopifyApp()` insists on are present.
 *
 * Exported because the answer is worth reporting rather than discovering: the
 * dashboard can say which integration is live, and `npm run doctor` can say
 * "Shopify: not configured (fine — you are not using it)" instead of leaving a
 * merchant to work that out from a stack trace.
 */
export function shopifyConfigured(): boolean {
  loadRootEnv();
  return Boolean(
    process.env.SHOPIFY_API_KEY &&
      process.env.SHOPIFY_API_SECRET &&
      process.env.SHOPIFY_APP_URL,
  );
}

let app: ShopifyApp | null = null;

/** Built on first use, then held. Throws only if a Shopify route is reached. */
function get(): ShopifyApp {
  if (app) return app;
  if (!shopifyConfigured()) throw new Error(NOT_CONFIGURED);
  app = buildShopify();
  return app;
}

/**
 * The lazy accessors.
 *
 * A Proxy rather than a hand-written wrapper per member, because
 * `authenticate` is a nested object — `authenticate.admin`,
 * `authenticate.webhook`, `authenticate.public.appProxy` — and re-declaring
 * that shape by hand is how a signature quietly drifts from the library's.
 * Forwarding the property access preserves every overload exactly, and the
 * types below are the library's own.
 */
const lazy = <T extends object>(pick: (a: ShopifyApp) => T): T =>
  new Proxy({} as T, {
    get: (_t, prop, receiver) => Reflect.get(pick(get()) as object, prop, receiver),
    has: (_t, prop) => prop in (pick(get()) as object),
  });

export default lazy((a) => a);
export const apiVersion = ApiVersion.July26;
export const authenticate = lazy((a) => a.authenticate);
export const unauthenticated = lazy((a) => a.unauthenticated);
export const sessionStorage = lazy((a) => a.sessionStorage as object) as ShopifyApp["sessionStorage"];

export const login: ShopifyApp["login"] = (request) => get().login(request);
export const registerWebhooks: ShopifyApp["registerWebhooks"] = (options) =>
  get().registerWebhooks(options);

/**
 * The one export that must survive Shopify being absent, because
 * `entry.server.tsx` calls it on every document response in the application.
 */
export const addDocumentResponseHeaders: ShopifyApp["addDocumentResponseHeaders"] = (
  request,
  headers,
) => {
  if (!shopifyConfigured()) return;
  get().addDocumentResponseHeaders(request, headers);
};
