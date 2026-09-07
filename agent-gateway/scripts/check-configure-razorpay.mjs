import fs from "node:fs";
import {
  DEFAULT_RAZORPAY_REF,
  linkRazorpay,
} from "./configure-razorpay-lib.mjs";

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};
const base = () => ({
  sites: [
    {
      key: "pk_monsoon_market",
      name: "Monsoon Market",
      origins: ["http://localhost:4000"],
      catalogFeedUrl: "http://store:4000/catalog.json",
      secretEnv: "SITE_SECRET_MONSOON_MARKET",
      accent: "#1f4037",
    },
  ],
  futureTopLevelField: { keep: true },
});

console.log("\n-- Razorpay config linker --\n");

{
  const input = base();
  const result = linkRazorpay(input, "pk_monsoon_market");
  check("a missing payment link is added", result.changed);
  check(
    "the canonical variable names are stored",
    JSON.stringify(result.config.sites[0].razorpay) ===
      JSON.stringify(DEFAULT_RAZORPAY_REF),
  );
  check("the input object is not mutated", input.sites[0].razorpay === undefined);
  check(
    "unrelated site and top-level fields survive",
    result.config.sites[0].accent === "#1f4037" &&
      result.config.futureTopLevelField.keep === true,
  );
}

{
  const input = base();
  input.sites[0].razorpay = {
    ...DEFAULT_RAZORPAY_REF,
    methods: ["card", "wallet"],
  };
  const result = linkRazorpay(input, "pk_monsoon_market");
  check("a second run is idempotent", !result.changed);
  check(
    "explicit payment methods survive",
    result.config.sites[0].razorpay.methods.join(",") === "card,wallet",
  );
}

{
  const input = base();
  input.sites[0].razorpay = {
    keyIdEnv: "CUSTOM_ID",
    keySecretEnv: "CUSTOM_SECRET",
  };
  let message = "";
  try {
    linkRazorpay(input, "pk_monsoon_market");
  } catch (error) {
    message = error.message;
  }
  check(
    "a different existing mapping is not overwritten",
    message.includes("different Razorpay variable mapping"),
    message,
  );
}

{
  let message = "";
  try {
    linkRazorpay(base(), "pk_missing");
  } catch (error) {
    message = error.message;
  }
  check("an unknown site fails clearly", message.includes("not registered"), message);
}

{
  const secretSentinel = "rzp-secret-must-not-enter-config";
  const result = linkRazorpay(base(), "pk_monsoon_market");
  check(
    "the output contains names, never a credential value",
    !JSON.stringify(result.config).includes(secretSentinel) &&
      JSON.stringify(result.config).includes("RAZORPAY_KEY_SECRET"),
  );
}

{
  const source = fs.readFileSync("scripts/configure-razorpay.mjs", "utf8");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  check(
    "the terminal command is exposed through npm",
    pkg.scripts["site:enable-razorpay"] ===
      "node scripts/configure-razorpay.mjs",
  );
  check(
    "the command requires both credential values before writing",
    source.includes('present(DEFAULT_RAZORPAY_REF.keyIdEnv)') &&
      source.includes('present(DEFAULT_RAZORPAY_REF.keySecretEnv)'),
  );
  check(
    "the command validates and backs up before atomic replacement",
    source.indexOf("parseSitesConfig(nextText") < source.indexOf("copyFileSync") &&
      source.indexOf("copyFileSync") < source.indexOf("renameSync"),
  );
}

console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
