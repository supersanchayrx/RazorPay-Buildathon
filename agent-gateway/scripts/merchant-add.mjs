/**
 * Create a merchant console account.
 *
 * A CLI rather than a sign-up page, deliberately. A console anyone can register
 * for is a console anyone can probe, and there is no plausible flow where a
 * stranger self-serves access to a merchant's margins.
 *
 *   npm run merchant:add -- --email you@shop.com --name "Nilgiri Post" \
 *                           --sites pk_nilgiripost_dev [--password ...]
 *
 * With no --password one is generated and printed once.
 */
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import * as esbuild from "esbuild";

const out = path.join(process.cwd(), "node_modules", ".cache", "auth.mjs");
fs.mkdirSync(path.dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: ["app/lib/auth.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "silent",
});
const { createMerchant, readMerchants } = await import(pathToFileURL(out).href);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const email = flag("email");
const name = flag("name");
const sites = (flag("sites") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (!email || !name || sites.length === 0) {
  console.error(
    "usage: npm run merchant:add -- --email <email> --name <shop name> --sites <key[,key]> [--password <pw>]",
  );
  console.error(`\nexisting accounts: ${readMerchants().map((m) => m.email).join(", ") || "none"}`);
  process.exit(1);
}

// Generated passwords beat chosen ones for a first account, and printing it
// once is honest about the fact that it is not recoverable afterwards.
const password = flag("password") ?? crypto.randomBytes(9).toString("base64url");

try {
  const m = createMerchant({ email, name, password, sites });
  console.log(`created ${m.email}  (${m.id})`);
  console.log(`  shops:    ${m.sites.join(", ")}`);
  console.log(`  password: ${password}`);
  console.log(`\nStored scrypt-hashed in data/merchants.json. This is the only time the`);
  console.log(`password is printed — it cannot be read back out.`);
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}
