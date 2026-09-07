/** Configure the bounded conversational recovery path used by the demo seed. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const out = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "configure-demo-recovery.mjs",
);
fs.mkdirSync(path.dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: ["app/lib/settings.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "silent",
});
const settings = await import(pathToFileURL(out).href + `?t=${Date.now()}`);

const args = process.argv.slice(2);
const shopAt = args.indexOf("--shop");
const shop =
  (shopAt >= 0 ? String(args[shopAt + 1] ?? "").trim() : "") ||
  process.env.VOICE_TEST_SHOP ||
  "pk_nilgiripost_dev";
const disable = process.argv.includes("--disable");
const result = settings.writeSettings(
  shop,
  disable
    ? {
        outreach: {
          enabled: false,
          channels: ["draft"],
          call: {
            mode: "notice",
            discountHandoff: "off",
            maxTurns: 6,
            speaker: "priya",
            language: "en-IN",
          },
        },
        recovery: { enabled: false },
      }
    : {
        outreach: {
          enabled: true,
          channels: ["voice"],
          call: {
            mode: "conversation",
            discountHandoff: "off",
            maxTurns: 6,
            speaker: "priya",
            language: "en-IN",
          },
        },
        recovery: {
          enabled: true,
          discountFor: ["shipping_cost", "price_too_high"],
          maxDepthPct: 8,
          requiresTier: "returning",
          monthlyGrantCap: 20,
          monthlyMarginCap: 4000,
          grantTtlHours: 48,
        },
      },
  "demo-setup",
);

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

console.log(`shop=${shop}`);
console.log(`outreach=${result.settings.outreach.enabled ? "enabled" : "disabled"}`);
console.log(`channels=${result.settings.outreach.channels.join(",")}`);
console.log(`call_mode=${result.settings.outreach.call.mode}`);
console.log(`recovery_discount=${result.settings.recovery.enabled ? "enabled" : "disabled"}`);
console.log(`discount_for=${result.settings.recovery.discountFor.join(",")}`);
console.log(`depth_cap=${result.settings.recovery.maxDepthPct}%`);
console.log(`required_tier=${result.settings.recovery.requiresTier}`);
