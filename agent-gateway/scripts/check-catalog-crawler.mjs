/** Deterministic checks for the bounded structured-data storefront crawler. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const cache = path.join(process.cwd(), "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(cache, "catalog-crawler-check-"));
const output = path.join(sandbox, "catalog-crawler.mjs");
const healthOutput = path.join(sandbox, "catalog-health.mjs");
await Promise.all([
  esbuild.build({
    entryPoints: ["app/lib/catalog-crawler.server.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  }),
  esbuild.build({
    entryPoints: ["app/lib/catalog-health.server.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: healthOutput,
    logLevel: "silent",
  }),
]);
const Crawler = await import(pathToFileURL(output).href);
const Health = await import(pathToFileURL(healthOutput).href);

let failed = 0;
const check = (label, ok, detail) => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  - ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

const pages = new Map([
  [
    "https://shop.example/",
    '<!doctype html><html><a href="/products/tea">Tea</a></html>',
  ],
  [
    "https://shop.example/sitemap.xml",
    `<?xml version="1.0"?><urlset>
      <url><loc>https://shop.example/products/tea</loc></url>
      <url><loc>https://shop.example/products/coffee</loc></url>
      <url><loc>https://elsewhere.example/products/ignored</loc></url>
    </urlset>`,
  ],
  [
    "https://shop.example/products/tea",
    `<html><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Nilgiri Tea",
      description: "Bright &amp; clean",
      sku: "TEA-100",
      brand: { "@type": "Brand", name: "Monsoon" },
      image: "/images/tea.jpg",
      url: "/products/tea",
      offers: {
        "@type": "Offer",
        price: "480.00",
        priceCurrency: "INR",
        availability: "https://schema.org/InStock",
      },
    })}</script></html>`,
  ],
  [
    "https://shop.example/products/coffee",
    `<html><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Araku Coffee",
      url: "/products/coffee",
      hasVariant: [
        {
          "@type": "Product",
          name: "250 g",
          sku: "COF-250",
          offers: { price: 640, priceCurrency: "INR", availability: "InStock" },
        },
        {
          "@type": "Product",
          name: "500 g",
          sku: "COF-500",
          offers: {
            price: 1180,
            priceCurrency: "INR",
            availability: "OutOfStock",
          },
        },
      ],
    })}</script></html>`,
  ],
]);

const fakeFetch = async (input) => {
  const url = String(input);
  const body = pages.get(url);
  if (body === undefined) return new Response("not found", { status: 404 });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": url.endsWith(".xml") ? "application/xml" : "text/html",
    },
  });
};
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

try {
  check("loopback IPv4 is private", Crawler.isPrivateAddress("127.0.0.1"));
  check("RFC1918 IPv4 is private", Crawler.isPrivateAddress("10.0.0.8"));
  check("loopback IPv6 is private", Crawler.isPrivateAddress("::1"));
  check(
    "a public IPv4 address is accepted",
    !Crawler.isPrivateAddress("93.184.216.34"),
  );

  let privateRejected = false;
  try {
    await Crawler.crawlStorefront("http://127.0.0.1", {
      fetch: fakeFetch,
      lookup: publicLookup,
    });
  } catch {
    privateRejected = true;
  }
  check(
    "private storefront URLs are rejected before fetching",
    privateRejected,
  );

  const result = await Crawler.crawlStorefront("https://shop.example/", {
    fetch: fakeFetch,
    lookup: publicLookup,
  });
  check(
    "the homepage and sitemap product pages are scanned",
    result.pagesScanned === 3,
  );
  check("two structured products are generated", result.productsFound === 2);
  check("nested Product variants are retained", result.variantsFound === 3);
  check(
    "the catalogue currency comes from offers",
    result.catalog.shop.currency === "INR",
  );
  check(
    "relative image URLs become absolute",
    result.catalog.products.find((product) => product.handle === "tea")
      ?.image === "https://shop.example/images/tea.jpg",
  );
  check(
    "explicit out-of-stock offers remain unavailable",
    result.catalog.products
      .find((product) => product.handle === "coffee")
      ?.variants.some(
        (variant) => variant.sku === "COF-500" && !variant.inStock,
      ),
  );

  const noFactsFetch = async (input) =>
    new Response(
      String(input).endsWith("sitemap.xml")
        ? "<urlset></urlset>"
        : "<html><h1>A product-looking page without JSON-LD</h1></html>",
      { status: 200, headers: { "content-type": "text/html" } },
    );
  let missingFactsRejected = false;
  try {
    await Crawler.crawlStorefront("https://shop.example/", {
      fetch: noFactsFetch,
      lookup: publicLookup,
    });
  } catch (error) {
    missingFactsRejected = String(error).includes(
      "No products with structured prices",
    );
  }
  check(
    "pages without trustworthy commerce facts fail closed",
    missingFactsRejected,
  );

  const missingAvailabilityFetch = async (input) =>
    new Response(
      String(input).endsWith("sitemap.xml")
        ? "<urlset></urlset>"
        : `<script type="application/ld+json">${JSON.stringify({
            "@type": "Product",
            name: "Availability unknown",
            url: "https://shop.example/products/unknown",
            offers: { price: 100, priceCurrency: "INR" },
          })}</script>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  let unknownStockRejected = false;
  try {
    await Crawler.crawlStorefront("https://shop.example/", {
      fetch: missingAvailabilityFetch,
      lookup: publicLookup,
    });
  } catch {
    unknownStockRejected = true;
  }
  check(
    "missing availability is not converted to in-stock",
    unknownStockRejected,
  );

  const healthy = await Health.inspectCatalog(
    "https://shop.example/catalog.json",
    async () =>
      Response.json({
        products: [
          {
            handle: "tea",
            variants: [
              { title: "100 g", price: 480 },
              { title: "250 g", price: 1080 },
            ],
          },
        ],
      }),
  );
  check(
    "dashboard health reports reachable products and variants",
    healthy.ok && healthy.products === 1 && healthy.variants === 2,
  );

  const empty = await Health.inspectCatalog(
    "https://shop.example/catalog.json",
    async () => Response.json({ products: [] }),
  );
  check("an empty hosted catalogue still needs setup", !empty.ok);

  const unreachable = await Health.inspectCatalog(
    "https://shop.example/catalog.json",
    async () => {
      throw new Error("connection refused");
    },
  );
  check("an unreachable hosted catalogue still needs setup", !unreachable.ok);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(
  failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`,
);
process.exit(failed ? 1 : 0);
