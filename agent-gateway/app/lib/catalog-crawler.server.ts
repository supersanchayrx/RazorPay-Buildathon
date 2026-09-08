/**
 * Small, deliberately constrained storefront crawler.
 *
 * This is an onboarding importer, not a search-engine spider. It stays on one
 * public hostname, reads a bounded sitemap/page set, and trusts only structured
 * Product/Offer JSON-LD for commerce facts. Missing data becomes a warning;
 * nothing is inferred with a model.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import type { GeneratedCatalog } from "./catalog-csv";

const MAX_PAGES = 30;
const MAX_SITEMAPS = 5;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const USER_AGENT =
  "ChapmanCatalogImporter/0.1 (+merchant-authorized onboarding crawl)";

type LookupResult = { address: string; family: number };
type CrawlDependencies = {
  fetch?: typeof fetch;
  lookup?: (hostname: string) => Promise<LookupResult[]>;
};

export type CatalogCrawlResult = {
  catalog: GeneratedCatalog;
  pagesScanned: number;
  productsFound: number;
  variantsFound: number;
  warnings: string[];
};

function ipv4Private(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0)
  );
}

export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return ipv4Private(address);
  if (family !== 6) return true;
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return ipv4Private(lower.slice(7));
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith("2001:db8:")
  );
}

async function assertPublicUrl(
  url: URL,
  lookup: NonNullable<CrawlDependencies["lookup"]>,
) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("The storefront URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Storefront URLs containing credentials are not accepted.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (net.isIP(hostname) !== 0 && isPrivateAddress(hostname))
  ) {
    throw new Error(
      "Private, local, and internal storefront addresses cannot be crawled.",
    );
  }
  const addresses = await lookup(hostname);
  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error(
      "The storefront hostname does not resolve exclusively to public addresses.",
    );
  }
}

async function defaultLookup(hostname: string): Promise<LookupResult[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function responseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES)
    throw new Error("A storefront response exceeded 2 MB.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("A storefront response exceeded 2 MB.");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchStoreText(
  input: URL,
  hostname: string,
  dependencies: Required<CrawlDependencies>,
): Promise<{ text: string; url: URL; contentType: string }> {
  let current = new URL(input);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (current.hostname.toLowerCase() !== hostname) {
      throw new Error(
        "The storefront redirected to another hostname, so the crawl was stopped.",
      );
    }
    await assertPublicUrl(current, dependencies.lookup);
    const response = await dependencies.fetch(current, {
      headers: {
        accept: "text/html,application/xml,text/xml;q=0.9",
        "user-agent": USER_AGENT,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location)
        throw new Error(
          "The storefront returned a redirect without a destination.",
        );
      current = new URL(location, current);
      continue;
    }
    if (!response.ok)
      throw new Error(`${current} returned HTTP ${response.status}.`);
    return {
      text: await responseText(response),
      url: current,
      contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
    };
  }
  throw new Error("The storefront redirected too many times.");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value: unknown, limit = 600): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, limit) : undefined;
}

const list = <T>(value: T | T[] | undefined | null): T[] =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];

function typeIs(value: unknown, wanted: string): boolean {
  return list(value as string | string[]).some(
    (type) =>
      typeof type === "string" && type.toLowerCase() === wanted.toLowerCase(),
  );
}

function productNodes(value: unknown, output: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => productNodes(entry, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const object = value as Record<string, unknown>;
  if (typeIs(object["@type"], "Product")) {
    output.push(object);
    return output;
  }
  Object.values(object).forEach((entry) => productNodes(entry, output));
  return output;
}

function jsonLdProducts(html: string): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    const source = match[1].replace(/^\s*<!--|-->\s*$/g, "").trim();
    if (!source) continue;
    try {
      productNodes(JSON.parse(source), output);
    } catch {
      // One malformed structured-data block must not discard valid blocks later in the page.
    }
  }
  return output;
}

function absoluteUrl(value: unknown, pageUrl: URL): string | undefined {
  const raw =
    typeof value === "string"
      ? value
      : value &&
          typeof value === "object" &&
          typeof (value as Record<string, unknown>).url === "string"
        ? String((value as Record<string, unknown>).url)
        : undefined;
  if (!raw) return undefined;
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function priceNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(
    String(value)
      .replace(/,/g, "")
      .replace(/[^0-9.-]/g, ""),
  );
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function named(value: unknown): string | undefined {
  if (typeof value === "string") return cleanText(value, 120);
  if (value && typeof value === "object") {
    return cleanText((value as Record<string, unknown>).name, 120);
  }
  return undefined;
}

function availability(value: unknown): boolean | null {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (
    text.includes("outofstock") ||
    text.includes("discontinued") ||
    text.includes("soldout")
  ) {
    return false;
  }
  if (text.includes("instock") || text.includes("limitedavailability")) {
    return true;
  }
  return null;
}

function normalizeProduct(
  node: Record<string, unknown>,
  pageUrl: URL,
): {
  product: GeneratedCatalog["products"][number];
  currencies: string[];
} | null {
  const title = cleanText(node.name, 200);
  const productUrl = absoluteUrl(node.url, pageUrl) ?? pageUrl.toString();
  const urlHandle = slug(
    new URL(productUrl).pathname.split("/").filter(Boolean).pop() ?? "",
  );
  const handle = urlHandle || slug(title ?? "");
  if (!title || !handle) return null;

  const variantProducts = list(
    node.hasVariant as Record<string, unknown> | Record<string, unknown>[],
  );
  const sources = variantProducts.length ? variantProducts : [node];
  const currencies: string[] = [];
  const variants: GeneratedCatalog["products"][number]["variants"] = [];
  for (const source of sources) {
    const offers = list(
      source.offers as Record<string, unknown> | Record<string, unknown>[],
    );
    for (const offer of offers) {
      if (!offer || typeof offer !== "object") continue;
      const price = priceNumber(offer.price ?? offer.lowPrice);
      const currency = cleanText(offer.priceCurrency, 3)?.toUpperCase();
      const inStock = availability(offer.availability);
      if (
        price === null ||
        !currency ||
        !/^[A-Z]{3}$/.test(currency) ||
        inStock === null
      ) {
        continue;
      }
      currencies.push(currency);
      variants.push({
        title:
          cleanText(source.name, 120) ??
          cleanText(offer.name, 120) ??
          (variantProducts.length ? title : "Default"),
        price,
        ...(cleanText(source.sku ?? offer.sku ?? node.sku, 120)
          ? { sku: cleanText(source.sku ?? offer.sku ?? node.sku, 120) }
          : {}),
        inStock,
      });
    }
  }
  if (!variants.length) return null;

  const rawKeywords = cleanText(node.keywords, 300);
  const tags = rawKeywords
    ? rawKeywords
        .split(/[,|]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    : undefined;
  const rawImage = list(node.image as unknown | unknown[])[0];
  return {
    product: {
      handle,
      title,
      ...(cleanText(node.description)
        ? { description: cleanText(node.description) }
        : {}),
      ...(cleanText(node.category, 120)
        ? { type: cleanText(node.category, 120) }
        : {}),
      ...(named(node.brand ?? node.manufacturer)
        ? { vendor: named(node.brand ?? node.manufacturer) }
        : {}),
      ...(tags?.length ? { tags } : {}),
      ...(absoluteUrl(rawImage, pageUrl)
        ? { image: absoluteUrl(rawImage, pageUrl) }
        : {}),
      url: productUrl,
      variants,
    },
    currencies,
  };
}

function xmlLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => decodeEntities(match[1]).trim())
    .filter(Boolean);
}

function htmlLinks(html: string, base: URL): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      links.push(new URL(decodeEntities(match[1]), base).toString());
    } catch {
      // Ignore malformed links; they are navigation noise, not catalogue data.
    }
  }
  return links;
}

const productish = (url: string) =>
  /\/(products?|shop|p)\//i.test(new URL(url).pathname);

export async function crawlStorefront(
  input: string,
  overrides: CrawlDependencies = {},
): Promise<CatalogCrawlResult> {
  let start: URL;
  try {
    start = new URL(input.trim());
  } catch {
    throw new Error(
      "Enter an absolute storefront URL such as https://store.example.",
    );
  }
  const dependencies: Required<CrawlDependencies> = {
    fetch: overrides.fetch ?? fetch,
    lookup: overrides.lookup ?? defaultLookup,
  };
  await assertPublicUrl(start, dependencies.lookup);
  const hostname = start.hostname.toLowerCase();
  const warnings: string[] = [];
  const pageUrls = new Set<string>();

  const home = await fetchStoreText(start, hostname, dependencies);
  if (
    !home.contentType.includes("html") &&
    !home.text.match(/<html|<script/i)
  ) {
    throw new Error("The storefront URL did not return an HTML page.");
  }
  pageUrls.add(home.url.toString());

  try {
    const sitemap = await fetchStoreText(
      new URL("/sitemap.xml", home.url),
      hostname,
      dependencies,
    );
    let locations = xmlLocations(sitemap.text);
    const childSitemaps = locations
      .filter((url) => /\.xml(?:$|\?)/i.test(url))
      .slice(0, MAX_SITEMAPS);
    if (childSitemaps.length) {
      const children = await Promise.allSettled(
        childSitemaps.map((url) =>
          fetchStoreText(new URL(url), hostname, dependencies),
        ),
      );
      locations = children.flatMap((result) =>
        result.status === "fulfilled" ? xmlLocations(result.value.text) : [],
      );
    }
    const sameHost = locations.filter((url) => {
      try {
        return new URL(url).hostname.toLowerCase() === hostname;
      } catch {
        return false;
      }
    });
    const ordered = [
      ...sameHost.filter(productish),
      ...sameHost.filter((url) => !productish(url)),
    ];
    ordered.slice(0, MAX_PAGES).forEach((url) => pageUrls.add(url));
  } catch (error) {
    warnings.push(
      `Sitemap discovery was unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    htmlLinks(home.text, home.url)
      .filter(
        (url) =>
          new URL(url).hostname.toLowerCase() === hostname && productish(url),
      )
      .slice(0, MAX_PAGES)
      .forEach((url) => pageUrls.add(url));
  }

  const pages = [...pageUrls].slice(0, MAX_PAGES);
  const fetched: PromiseSettledResult<
    Awaited<ReturnType<typeof fetchStoreText>>
  >[] = [];
  for (let index = 0; index < pages.length; index += 5) {
    fetched.push(
      ...(await Promise.allSettled(
        pages
          .slice(index, index + 5)
          .map((url) =>
            url === home.url.toString()
              ? Promise.resolve(home)
              : fetchStoreText(new URL(url), hostname, dependencies),
          ),
      )),
    );
  }
  const normalized: NonNullable<ReturnType<typeof normalizeProduct>>[] = [];
  let pagesScanned = 0;
  let structuredProducts = 0;
  for (const result of fetched) {
    if (result.status === "rejected") {
      warnings.push(`One product page was skipped: ${String(result.reason)}`);
      continue;
    }
    pagesScanned++;
    const nodes = jsonLdProducts(result.value.text);
    structuredProducts += nodes.length;
    for (const node of nodes) {
      const product = normalizeProduct(node, result.value.url);
      if (product) normalized.push(product);
    }
  }
  if (!normalized.length) {
    throw new Error(
      "No products with structured prices, currencies, and availability were found. Use the CSV importer, or add complete Schema.org Product and Offer JSON-LD to the storefront.",
    );
  }

  const currencyCounts = new Map<string, number>();
  normalized
    .flatMap((entry) => entry.currencies)
    .forEach((currency) =>
      currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1),
    );
  const currency = [...currencyCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  if (!currency)
    throw new Error("Product prices were found without a usable currency.");

  const products = new Map<string, GeneratedCatalog["products"][number]>();
  for (const entry of normalized) {
    const variants = entry.product.variants.filter(
      (_, index) => entry.currencies[index] === currency,
    );
    if (!variants.length) continue;
    const product = { ...entry.product, variants };
    const existing = products.get(product.handle);
    if (!existing || product.variants.length > existing.variants.length)
      products.set(product.handle, product);
  }
  if (currencyCounts.size > 1) {
    warnings.push(
      `Multiple currencies were found; only ${currency} products were included.`,
    );
  }
  if (structuredProducts > normalized.length) {
    warnings.push(
      `${structuredProducts - normalized.length} structured product entries were omitted because a title, price, currency, or availability was missing.`,
    );
  }
  if (pageUrls.size >= MAX_PAGES) {
    warnings.push(`The quick crawler inspected at most ${MAX_PAGES} pages.`);
  }

  const catalog: GeneratedCatalog = {
    shop: { currency },
    products: [...products.values()],
  };
  return {
    catalog,
    pagesScanned,
    productsFound: catalog.products.length,
    variantsFound: catalog.products.reduce(
      (sum, product) => sum + product.variants.length,
      0,
    ),
    warnings,
  };
}
