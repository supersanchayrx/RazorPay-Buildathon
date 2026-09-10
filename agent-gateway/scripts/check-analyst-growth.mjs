/** Focused checks for the analyst's deterministic time-series layer. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const outfile = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "check-analyst-growth-bundle.mjs",
);
await esbuild.build({
  entryPoints: ["app/lib/merchanttools.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "silent",
});
const analyst = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const line = {
  handle: "test-product",
  title: "Test Product",
  sku: "TEST-1",
  qty: 1,
  unitPrice: 100,
  unitCost: 50,
  lineTotal: 100,
};
const order = (id, ts, customer, total = 100, cohort = {}) => ({
  id,
  ts,
  status: "placed",
  total,
  currency: "INR",
  customer: { id: customer, ...cohort },
  lines: [{ ...line, unitPrice: total, lineTotal: total }],
  payment: { method: "upi", bank: null, status: "captured", attempts: [] },
});

const rows = [
  order("jun-1", "2026-06-03T10:00:00Z", "returning", 200),
  order("jul-1", "2026-07-03T10:00:00Z", "july", 300),
  order("aug-1", "2026-08-20T10:00:00Z", "august-late", 400),
  order("aug-2", "2026-08-08T10:00:00Z", "august", 400),
  order("sep-1", "2026-09-03T10:00:00Z", "returning", 100),
  order("sep-2", "2026-09-11T10:00:00Z", "september", 100),
  { ...order("failed", "2026-09-10T10:00:00Z", "failed", 9_999), status: "payment_failed" },
];

const out = analyst.growthSnapshot(rows, 4);
check("snapshot anchors itself to the latest completed order", out.includes("DATA THROUGH 2026-09-11"));
check("failed payments do not inflate revenue", !out.includes("9,999"));
check("trailing customer count is computed by code", out.includes("TRAILING 30 DAYS: 3 unique customers"));
check("month-to-date uses equal elapsed days", out.includes("same first 11 days of the prior 3 months"));
check("partial months are labelled rather than projected", out.includes("Sep 2026 MTD (11 days)"));
check("returning customers are separated from first-seen customers", out.includes("first seen, 1 returning"));
check("commercial decomposition carries a causality caveat", out.includes("not proof that one caused another"));
check(
  "the merchant registry exposes the growth tool",
  analyst.MERCHANT_TOOLS.some((tool) => tool.name === "growth_snapshot"),
);

const campaignRows = Array.from({ length: 60 }, (_, index) =>
  order(
    `campaign-${index}`,
    `2026-09-${String((index % 11) + 1).padStart(2, "0")}T10:00:00Z`,
    `campaign-customer-${index}`,
    500,
    {
      ageBand: index < 40 ? "25-34" : "35-44",
      acquisitionSource: index < 36 ? "instagram" : "organic_search",
    },
  ),
);
const campaign = analyst.marketingCampaignBrief(
  campaignRows,
  {
    unitCost: { "TEST-1": 250 },
    floors: {
      minMarginPct: 25,
      maxDiscountPct: 20,
      neverDiscount: [],
      minSampleSize: 30,
    },
  },
  "Test Shop",
  180,
);
check("campaign brief uses declared audience evidence", campaign.includes("25-34 is the largest DECLARED age band: 40 of 60"));
check("campaign brief proposes a bounded channel test", campaign.includes("14-day instagram prospecting test"));
check("campaign brief sets a contribution-margin guard", campaign.includes("CAC must remain below"));
check("campaign brief refuses unsupported ROAS claims", campaign.includes("cannot claim ROAS"));
check("campaign brief includes an earned-PR experiment", campaign.includes("EARNED PR TEST"));
const unprofiled = analyst.marketingCampaignBrief(rows, null, "Test Shop", 180);
check("missing demographics are not inferred", unprofiled.includes("Do not infer age"));
check(
  "the merchant registry exposes the marketing brief",
  analyst.MERCHANT_TOOLS.some((tool) => tool.name === "marketing_campaign_brief"),
);

const retentionRows = [
  order("retained-first", "2026-05-01T10:00:00Z", "retained"),
  order("retained-again", "2026-05-20T10:00:00Z", "retained"),
  order("not-retained", "2026-05-02T10:00:00Z", "one-time"),
  order("recent-first", "2026-09-01T10:00:00Z", "recent"),
  order("anchor", "2026-09-11T10:00:00Z", "anchor"),
];
const retention = analyst.customerRetentionCohorts(retentionRows, 6);
check("retention uses eligible cohort denominators", retention.includes("30d 1/2"));
check("retention does not mark immature cohorts as failed", retention.includes("90d not mature"));
check("retention rates carry confidence intervals", retention.includes("95% interval"));
const concentration = analyst.revenueConcentration(campaignRows, 180);
check("customer concentration is calculated", concentration.includes("Customer HHI"));
check("product concentration is calculated", concentration.includes("Product HHI"));
check("concentration does not invent churn", concentration.includes("not proof of churn risk"));
check(
  "the merchant registry exposes retention and concentration tools",
  ["customer_retention_cohorts", "revenue_concentration"].every((name) =>
    analyst.MERCHANT_TOOLS.some((tool) => tool.name === name),
  ),
);
check(
  "the merchant registry remains read-only",
  analyst.MERCHANT_TOOLS.every(
    (tool) => !/^(create|update|delete|approve|send|call|set|write|publish)_/.test(tool.name),
  ),
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
