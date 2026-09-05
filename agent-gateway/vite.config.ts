import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

/**
 * The dev tunnel's hostname, allowed only when one is configured.
 *
 * Vite refuses requests whose Host header it does not recognise — DNS-rebinding
 * protection, and it is right to. But Twilio cannot fetch TwiML from localhost,
 * so during voice development the gateway is reached through a tunnel and every
 * request arrives with the tunnel's hostname. Without this, Vite answers 403 to
 * Twilio and the failure looks exactly like a broken route.
 *
 * Derived from PUBLIC_ORIGIN rather than a wildcard like `.ngrok-free.app`. A
 * wildcard would allow anybody's tunnel, which is the whole class of host the
 * check exists to refuse; this allows precisely the one origin we ourselves
 * handed to Twilio, and nothing when no tunnel is configured.
 */
const tunnelHost = process.env.PUBLIC_ORIGIN
  ? [new URL(process.env.PUBLIC_ORIGIN).hostname]
  : [];

export default defineConfig({
  server: {
    allowedHosts: [host, ...tunnelHost],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    reactRouter(),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
}) satisfies UserConfig;
