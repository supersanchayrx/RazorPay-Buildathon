/**
 * The site registry, read from a file the merchant owns.
 *
 * This used to be a TypeScript array in `sites.server.ts`, which was honest
 * while there was one storefront and we were the ones running it. It stops
 * being honest the moment a merchant clones this repo: their shop's origins
 * and catalogue URL are not our source code, and asking them to edit a `.ts`
 * file means a rebuild, a merge conflict on every `git pull`, and a class of
 * error where a missing comma takes the server down with a stack trace about a
 * module they have never heard of.
 *
 * So: JSON on disk, validated on read, with errors that name the field and the
 * fix.
 *
 * WHY THE SECRET RULE SURVIVES THE MOVE. `env.server.ts` states that secrets
 * are referenced by name and never by value. A config file makes that easier
 * to break, not harder — a merchant holding a Razorpay key will paste it into
 * the nearest field. So the config carries `secretEnv`, a variable NAME, and
 * this loader resolves it. The one exception is `devSecret`, which exists
 * because the committed demo config has to work with no environment at all,
 * and which this loader refuses to honour in production.
 */
import fs from "node:fs";
import path from "node:path";
import { secret } from "./env.server";
import type { PaymentMethod } from "./razorpay.server";
import type { Site } from "./sites.server";

/** Merchant-owned registries the runtime discovers automatically. */
export const CONFIG_FILENAMES = ["chapman.config.json"] as const;

const PAYMENT_METHODS: PaymentMethod[] = [
  "upi",
  "card",
  "netbanking",
  "wallet",
  "emi",
  "paylater",
];

/** A neutral default, so a merchant who never picks a colour still gets a widget. */
const DEFAULT_ACCENT = "#1f2937";
const DEFAULT_GREETING = "Ask me anything about our products.";

export type ConfigReport = {
  /** Absolute path of the file we read, or null when there is no config at all. */
  source: string | null;
  sites: Site[];
  /** Refusals. Any error means we do not serve: a half-configured shop is worse than a stopped one. */
  errors: string[];
  /** Legal now, biting later: payments named but not set up, no sites at all. */
  warnings: string[];
};

/**
 * Strip `//` and block comments from JSON.
 *
 * A config a human edits by hand needs comments — the fields people get wrong
 * (`origins`, `productUrlTemplate`) are exactly the ones that need a sentence
 * of explanation next to them. This is the same JSONC that VS Code uses for
 * its own settings.
 *
 * String-aware, and that is the whole difficulty: every `origins` entry
 * contains `//`, so a naive strip deletes the merchant's own domain and leaves
 * a parse error pointing at the wrong line.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false;
        i++;
      } else if (c === "\n") {
        // Keep newlines, so JSON.parse reports the line the merchant is looking at.
        out += c;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && n === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

type Options = {
  /** Injected so the validator is testable without touching the real environment. */
  resolveSecret?: (name: string) => string | null;
  /** Injected so a test can assert the production guard without setting NODE_ENV. */
  production?: boolean;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * An origin is a scheme and a host and nothing else.
 *
 * `allowedOrigin` compares the `Origin` header by exact string equality, so a
 * trailing slash or a path here does not loosen the check — it silently blocks
 * the merchant's own site, and the widget fails with a CORS error that names
 * the browser rather than the typo.
 */
const isExactOrigin = (v: unknown): boolean => {
  if (typeof v !== "string" || v.length === 0) return false;
  try {
    return new URL(v).origin === v;
  } catch {
    return false;
  }
};

const isAbsoluteUrl = (v: unknown): boolean => {
  if (typeof v !== "string" || v.length === 0) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Validate one entry and return the `Site` the rest of the app already expects.
 *
 * Shape is checked here; reachability is not. A merchant must be able to start
 * the server before their catalogue is live and before Razorpay is set up —
 * `npm run doctor` is what tells them those are outstanding. Refusing to boot
 * over an endpoint that happens to be down would make a network blip look like
 * a configuration error.
 */
function readSite(
  raw: unknown,
  where: string,
  errors: string[],
  warnings: string[],
  opts: Required<Options>,
): Site | null {
  if (!isObject(raw)) {
    errors.push(`${where}: must be an object.`);
    return null;
  }

  const fail = (field: string, message: string) =>
    errors.push(`${where}.${field}: ${message}`);
  const warn = (field: string, message: string) =>
    warnings.push(`${where}.${field}: ${message}`);
  let ok = true;

  const key = raw.key;
  if (!isNonEmptyString(key)) {
    fail(
      "key",
      'required. A short public identifier for this storefront, e.g. "pk_mystore".',
    );
    ok = false;
  } else if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    fail(
      "key",
      `"${key}" contains characters that are not letters, digits, underscore or hyphen. It appears in URLs and in your page HTML.`,
    );
    ok = false;
  }

  if (!isNonEmptyString(raw.name)) {
    fail(
      "name",
      'required. The shop name a shopper sees, e.g. "Nilgiri Post".',
    );
    ok = false;
  }

  const origins = raw.origins;
  if (!Array.isArray(origins) || origins.length === 0) {
    fail(
      "origins",
      'required. A non-empty list of the exact origins allowed to embed the widget, e.g. ["https://shop.example"].',
    );
    ok = false;
  } else {
    origins.forEach((o, i) => {
      if (!isExactOrigin(o)) {
        fail(
          `origins[${i}]`,
          `"${String(o)}" is not an exact origin. Scheme and host only — no path, no trailing slash. Write "https://shop.example", not "https://shop.example/".`,
        );
        ok = false;
      }
    });
  }

  if (!isAbsoluteUrl(raw.catalogFeedUrl)) {
    fail(
      "catalogFeedUrl",
      'required. An absolute http(s) URL to your product feed, e.g. "https://shop.example/catalog.json".',
    );
    ok = false;
  }

  const productUrlTemplate = raw.productUrlTemplate;
  if (productUrlTemplate !== undefined) {
    if (
      typeof productUrlTemplate !== "string" ||
      !productUrlTemplate.includes("{handle}")
    ) {
      fail(
        "productUrlTemplate",
        'must contain the literal {handle}, e.g. "/products/{handle}". Omit the field entirely if your product URLs cannot be built from a handle.',
      );
      ok = false;
    }
  }

  for (const field of ["recoverPath", "restorePath"] as const) {
    const v = raw[field];
    if (v !== undefined && (typeof v !== "string" || !v.startsWith("/"))) {
      fail(
        field,
        'must be a path on your own site beginning with "/", e.g. "/recover".',
      );
      ok = false;
    }
  }

  const accent = raw.accent;
  if (
    accent !== undefined &&
    (typeof accent !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(accent))
  ) {
    fail("accent", 'must be a hex colour, e.g. "#1f4037".');
    ok = false;
  }

  /* ---- the secret ------------------------------------------------------ */
  // Order matches what the hardcoded registry did: environment first, dev
  // fallback second. The production guard is new, and is the reason this move
  // improves things rather than merely relocating them — the old fallback
  // would have shipped silently.
  const secretEnv = raw.secretEnv;
  const devSecret = raw.devSecret;
  let resolved: string | null = null;

  if (secretEnv !== undefined && !isNonEmptyString(secretEnv)) {
    fail(
      "secretEnv",
      'must be the NAME of an environment variable, e.g. "SITE_SECRET_MYSTORE" — never the secret itself.',
    );
    ok = false;
  } else if (isNonEmptyString(secretEnv)) {
    resolved = opts.resolveSecret(secretEnv);
  }

  if (!resolved && isNonEmptyString(devSecret)) {
    if (opts.production) {
      fail(
        "devSecret",
        `refused in production. Set ${isNonEmptyString(secretEnv) ? secretEnv : "secretEnv"} in your environment, or run "npm run init" to generate one.`,
      );
      ok = false;
    } else {
      resolved = devSecret;
      warn(
        "devSecret",
        "using the development fallback. Set the environment variable before going live.",
      );
    }
  }

  if (!resolved && ok) {
    fail(
      "secretEnv",
      isNonEmptyString(secretEnv)
        ? `environment variable ${secretEnv} is not set. Add it to your .env, or run "npm run init" to generate one.`
        : "required. Name an environment variable holding this site's signing secret.",
    );
    ok = false;
  }

  /* ---- orders and payments --------------------------------------------- */
  const orders = raw.orders;
  if (orders !== undefined) {
    if (!isObject(orders)) {
      fail(
        "orders",
        "must be an object, or omitted entirely to keep order access off.",
      );
      ok = false;
    } else if (orders.feedUrl !== undefined && !isAbsoluteUrl(orders.feedUrl)) {
      fail(
        "orders.feedUrl",
        "must be an absolute http(s) URL to your read-only order endpoint.",
      );
      ok = false;
    }
  }

  const razorpay = raw.razorpay;
  if (razorpay !== undefined) {
    if (!isObject(razorpay)) {
      fail(
        "razorpay",
        "must be an object, or omitted entirely if this shop does not take payment through CHAPMAN.",
      );
      ok = false;
    } else {
      for (const field of ["keyIdEnv", "keySecretEnv"] as const) {
        if (!isNonEmptyString(razorpay[field])) {
          fail(
            `razorpay.${field}`,
            "required. The NAME of the environment variable holding the value — never the value.",
          );
          ok = false;
        }
      }
      if (
        razorpay.webhookSecretEnv !== undefined &&
        !isNonEmptyString(razorpay.webhookSecretEnv)
      ) {
        fail(
          "razorpay.webhookSecretEnv",
          "must be an environment variable name when present.",
        );
        ok = false;
      }
      if (razorpay.methods !== undefined) {
        if (!Array.isArray(razorpay.methods)) {
          fail(
            "razorpay.methods",
            'must be a list, e.g. ["card", "netbanking"].',
          );
          ok = false;
        } else {
          for (const m of razorpay.methods) {
            if (!PAYMENT_METHODS.includes(m as PaymentMethod)) {
              fail(
                "razorpay.methods",
                `"${String(m)}" is not a payment method. Choose from: ${PAYMENT_METHODS.join(", ")}.`,
              );
              ok = false;
            }
          }
        }
      }
      // A named-but-unset key is legal: the shop still boots and doctor says
      // what is incomplete. The two API credentials block checkout; the
      // optional webhook secret only removes the asynchronous settlement path.
      for (const field of [
        "keyIdEnv",
        "keySecretEnv",
        "webhookSecretEnv",
      ] as const) {
        const name = razorpay[field];
        if (isNonEmptyString(name) && !opts.resolveSecret(name)) {
          warn(
            `razorpay.${field}`,
            field === "webhookSecretEnv"
              ? `${name} is named here but not set in the environment. Browser-confirmed checkout still works, but reliable settlement after the buyer closes the page needs this webhook secret.`
              : `${name} is named here but not set in the environment. Payments will decline until it is.`,
          );
        }
      }
    }
  }

  if (!ok) return null;

  return {
    key: key as string,
    name: raw.name as string,
    origins: origins as string[],
    catalogFeedUrl: raw.catalogFeedUrl as string,
    productUrlTemplate: productUrlTemplate as string | undefined,
    recoverPath: raw.recoverPath as string | undefined,
    restorePath: raw.restorePath as string | undefined,
    greeting: isNonEmptyString(raw.greeting) ? raw.greeting : DEFAULT_GREETING,
    accent: isNonEmptyString(accent) ? accent : DEFAULT_ACCENT,
    secret: resolved as string,
    orders: orders as Site["orders"],
    razorpay: razorpay as Site["razorpay"],
  };
}

/**
 * Parse and validate config text. Pure: no filesystem, and no environment
 * unless the caller's `resolveSecret` reaches for one.
 */
export function parseSitesConfig(
  text: string,
  where: string,
  options: Options = {},
): { sites: Site[]; errors: string[]; warnings: string[] } {
  const opts: Required<Options> = {
    resolveSecret: options.resolveSecret ?? secret,
    production: options.production ?? process.env.NODE_ENV === "production",
  };
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(text));
  } catch (e) {
    return {
      sites: [],
      errors: [
        `${where}: not valid JSON — ${(e as Error).message}. A trailing comma after the last item in a list or object is the usual cause.`,
      ],
      warnings,
    };
  }

  if (!isObject(parsed)) {
    return {
      sites: [],
      errors: [
        `${where}: the top level must be an object with a "sites" list.`,
      ],
      warnings,
    };
  }
  const list = parsed.sites;
  if (!Array.isArray(list)) {
    return {
      sites: [],
      errors: [
        `${where}: "sites" must be a list, e.g. { "sites": [ { ... } ] }.`,
      ],
      warnings,
    };
  }

  const sites: Site[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const site = readSite(raw, `sites[${i}]`, errors, warnings, opts);
    if (!site) return;
    if (seen.has(site.key)) {
      errors.push(
        `sites[${i}].key: "${site.key}" is used more than once. Every storefront needs its own key.`,
      );
      return;
    }
    seen.add(site.key);
    sites.push(site);
  });

  if (list.length === 0) {
    warnings.push(
      `${where}: no sites configured. The custom-storefront surfaces will have nothing to serve.`,
    );
  }

  return { sites, errors, warnings };
}

/**
 * Find the config file.
 *
 * `CHAPMAN_CONFIG` wins, so a container can mount one anywhere. Then the
 * merchant's own file, which is gitignored and therefore survives `git pull`.
 * The committed demo config is never selected implicitly: a new merchant must
 * not inherit a fictional storefront. It remains available as an explicit
 * fixture by setting CHAPMAN_CONFIG=chapman.config.demo.json.
 */
export function findConfigFile(): string | null {
  const explicit = process.env.CHAPMAN_CONFIG;
  if (explicit) {
    const p = path.resolve(explicit);
    return fs.existsSync(p) ? p : null;
  }
  // cwd is the gateway directory in every supported way of starting this — the
  // npm scripts, the Docker WORKDIR. The second candidate catches someone
  // running from the repo root, a mistake worth absorbing rather than punishing.
  const roots = [process.cwd(), path.join(process.cwd(), "agent-gateway")];
  for (const root of roots) {
    for (const name of CONFIG_FILENAMES) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** Read, parse and validate, without throwing. This is what diagnostics call. */
export function readConfig(): ConfigReport {
  const source = findConfigFile();
  if (!source) {
    return {
      source: null,
      sites: [],
      errors: [],
      warnings: [
        `No ${CONFIG_FILENAMES[0]} found in ${process.cwd()}. Configure a storefront in the merchant dashboard or run "npm run init". Shopify-only installs do not need one.`,
      ],
    };
  }
  let text: string;
  try {
    text = fs.readFileSync(source, "utf8");
  } catch (e) {
    return {
      source,
      sites: [],
      errors: [`${source}: could not be read — ${(e as Error).message}`],
      warnings: [],
    };
  }
  const { sites, errors, warnings } = parseSitesConfig(text, source);
  return { source, sites, errors, warnings };
}

let cached: Site[] | null = null;

/**
 * The registry, read once and held.
 *
 * Lazy rather than at module load: an import that throws takes down every
 * route that transitively touches it, including the ones that could have told
 * the merchant what was wrong. Failing on first use gets the same protection
 * with a legible failure, and `npm run check` and `npm run doctor` both reach
 * it long before a shopper does.
 */
export function loadSites(): Site[] {
  if (cached) return cached;
  const report = readConfig();
  for (const w of report.warnings) console.warn(`[chapman config] ${w}`);
  if (report.errors.length > 0) {
    throw new Error(
      [
        "",
        "CHAPMAN could not start: the site configuration is not valid.",
        ...report.errors.map((e) => `  - ${e}`),
        "",
        `Edit ${report.source ?? CONFIG_FILENAMES[0]} and start again, or run "npm run doctor" for a full check.`,
        "",
      ].join("\n"),
    );
  }
  cached = report.sites;
  return cached;
}

/** Testing and the init script only. */
export function resetConfigCache(): void {
  cached = null;
}
