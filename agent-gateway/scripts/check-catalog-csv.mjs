/** Regression checks for the merchant CSV -> catalog.json converter. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const cache = path.join(process.cwd(), "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(cache, "catalog-csv-check-"));

const output = path.join(sandbox, "catalog-csv.mjs");
const readerOutput = path.join(sandbox, "catalog-reader.mjs");
await Promise.all([
  esbuild.build({
    entryPoints: ["app/lib/catalog-csv.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  }),
  esbuild.build({
    entryPoints: ["app/lib/catalog.server.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: readerOutput,
    logLevel: "silent",
  }),
]);
const CatalogCsv = await import(pathToFileURL(output).href);
const CatalogReader = await import(pathToFileURL(readerOutput).href);

let failed = 0;
const check = (label, ok, detail) => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  - ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

try {
  const valid = CatalogCsv.parseCatalogCsv(CatalogCsv.CATALOG_CSV_SAMPLE);
  check("the template converts", valid.ok);
  check(
    "rows sharing a handle become one product",
    valid.ok && valid.products === 1,
  );
  check("each input row remains a variant", valid.ok && valid.variants === 2);
  check(
    "currency is lifted to the shop",
    valid.ok && valid.catalog.shop.currency === "INR",
  );
  check(
    "major-unit prices remain unchanged",
    valid.ok && valid.catalog.products[0].variants[0].price === 480,
  );

  const quoted = CatalogCsv.parseCatalogCsv(
    'handle,title,description,price\r\nchai,Chai,"Spiced, strong and called ""house"" chai",340\r\n',
  );
  check(
    "quoted commas and escaped quotes are preserved",
    quoted.ok &&
      quoted.catalog.products[0].description ===
        'Spiced, strong and called "house" chai',
  );

  const missing = CatalogCsv.parseCatalogCsv("handle,title\nchai,Chai\n");
  check("missing required columns are rejected", !missing.ok);

  const mixedCurrency = CatalogCsv.parseCatalogCsv(
    "handle,title,price,currency\nchai,Chai,340,INR\ncoffee,Coffee,500,USD\n",
  );
  check("mixed currencies are rejected", !mixedCurrency.ok);

  const duplicateSku = CatalogCsv.parseCatalogCsv(
    "handle,title,price,sku\nchai,Chai,340,SAME\ncoffee,Coffee,500,SAME\n",
  );
  check("duplicate SKUs are rejected", !duplicateSku.ok);

  const changedProduct = CatalogCsv.parseCatalogCsv(
    "handle,title,price,variant_title\nchai,Chai,340,100 g\nchai,Other title,600,250 g\n",
  );
  check("conflicting product fields are rejected", !changedProduct.ok);

  check(
    "generated JSON ends with a newline",
    valid.ok && CatalogCsv.catalogJson(valid.catalog).endsWith("\n"),
  );

  const noInventory = {
    shop: { currency: "INR" },
    products: [
      {
        handle: "available-tea",
        title: "Available tea",
        url: "https://shop.example/products/available-tea",
        variants: [{ title: "Default", price: 200, inStock: true }],
      },
    ],
  };
  const feedUrl = `data:application/json,${encodeURIComponent(JSON.stringify(noInventory))}`;
  const available = await CatalogReader.jsonFeedCatalog(feedUrl).search({
    inStockOnly: true,
  });
  check(
    "blank inventory remains unknown instead of hiding an available product",
    available.length === 1,
  );
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(
  failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`,
);
process.exit(failed ? 1 : 0);
