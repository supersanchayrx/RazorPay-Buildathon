/**
 * Give an existing console account access to another storefront.
 *
 * The companion to `merchant:add`. Splitting them keeps the create path
 * incapable of silently widening an account's reach, which is the mistake you
 * want to be impossible in a tool that hands out access to margins.
 *
 *   npm run merchant:grant -- --email you@shop.com --site pk_secondstore
 */
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
const { grantSite, readMerchants } = await import(pathToFileURL(out).href);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const email = flag("email");
const site = flag("site");

if (!email || !site) {
  console.error("usage: npm run merchant:grant -- --email <email> --site <key>");
  const rows = readMerchants();
  console.error(
    `\nexisting accounts:${rows.length ? "" : " none"}` +
      rows.map((m) => `\n  ${m.email}  ->  ${m.sites.join(", ")}`).join(""),
  );
  process.exit(1);
}

try {
  const m = grantSite(email, site);
  console.log(`${m.email} can now reach: ${m.sites.join(", ")}`);
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}
