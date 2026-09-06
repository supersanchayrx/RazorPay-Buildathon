/**
 * The parts of `npm run init` that are worth testing.
 *
 * Everything here is pure: text in, text out, no filesystem and no prompts.
 * That is the whole reason it is a separate file — `scripts/check-init.mjs`
 * can then assert the one property that matters, which is that the config this
 * script emits is a config `config.server.ts` accepts. An init that writes a
 * file the server refuses to start on is worse than no init at all, because
 * the merchant now has a broken file they did not write and cannot read.
 *
 * `scripts/init.mjs` holds the interview and does all the I/O.
 */

/* ------------------------------------------------------------------ *
 * Validators
 *
 * These duplicate rules that config.server.ts also enforces, and that is
 * intentional: the point is to say the sentence while the merchant is still
 * looking at the question, not after the file is written. The check script
 * asserts the two agree on the cases that matter.
 * ------------------------------------------------------------------ */

export const isExactOrigin = (v) => {
  try {
    return new URL(v).origin === v;
  } catch {
    return false;
  }
};

export const originsValid = (v) => {
  const list = String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) {
    return "at least one origin is required — it is the check that stops other sites embedding your widget.";
  }
  const bad = list.find((o) => !isExactOrigin(o));
  if (bad) {
    return `"${bad}" is not an exact origin. Scheme and host only: https://shop.example, not https://shop.example/ and not https://shop.example/path.`;
  }
  return null;
};

export const urlValid = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? null : "must be http or https.";
  } catch {
    return "must be an absolute URL, e.g. https://shop.example/catalog.json.";
  }
};

export const keyValid = (v) =>
  /^[A-Za-z0-9_-]+$/.test(v)
    ? null
    : "letters, digits, underscore and hyphen only — it appears in URLs and in your page HTML.";

export const templateValid = (v) =>
  !String(v).trim() || String(v).includes("{handle}")
    ? null
    : "must contain the literal {handle}, or be left empty.";

export const accentValid = (v) => (/^#[0-9a-fA-F]{3,8}$/.test(v) ? null : "a hex colour, e.g. #1f4037.");

export const emailValid = (v) =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim()) ? null : "that does not look like an email address.";

export const required = (what) => (v) => (String(v).trim() ? null : `${what} is required.`);

/* ------------------------------------------------------------------ *
 * Naming
 * ------------------------------------------------------------------ */

/** "Nilgiri Post" -> "pk_nilgiripost". A suggestion; the merchant can override. */
export const keyFromName = (name) => {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  return `pk_${slug || "store"}`;
};

/**
 * "pk_nilgiripost" -> "SITE_SECRET_NILGIRIPOST".
 *
 * No convention to remember: whatever this produces is written into the config
 * as `secretEnv`, and the config is what the server reads. The shape exists so
 * the `.env` is legible to a human, not so anything can guess it.
 */
export const secretEnvFor = (key) =>
  `SITE_SECRET_${String(key).replace(/^pk_/, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;

/* ------------------------------------------------------------------ *
 * Emitting the config
 * ------------------------------------------------------------------ */

/**
 * One site, as commented JSONC.
 *
 * Hand-written rather than `JSON.stringify`d because the comments are the
 * point. This file gets edited later by whoever inherits the shop, and a bare
 * object gives them nothing to edit against.
 */
export function siteBlock(s) {
  const q = (v) => JSON.stringify(v);
  const lines = [];
  const L = (...xs) => lines.push(...xs.map((x) => (x === "" ? "" : `    ${x}`)));

  L("{");
  L(`  // Public identifier. It sits in your page HTML; it is a name, not a password.`);
  L(`  "key": ${q(s.key)},`);
  L(`  "name": ${q(s.name)},`);
  L("");
  L(`  // The exact origins allowed to embed the widget. The browser sets this`);
  L(`  // header itself and page JavaScript cannot forge it, so this is the real`);
  L(`  // access check. Add every domain your storefront answers on.`);
  L(`  "origins": [${s.origins.map(q).join(", ")}],`);
  L("");
  L(`  // Your product feed, as JSON. See docs/catalog-format.md.`);
  L(`  "catalogFeedUrl": ${q(s.catalogFeedUrl)},`);
  if (s.productUrlTemplate) {
    L(`  // How to build a product link. Omit to fall back to your front page.`);
    L(`  "productUrlTemplate": ${q(s.productUrlTemplate)},`);
  }
  if (s.recoverPath || s.restorePath) {
    L("");
    L(`  // Paths on YOUR origin that forward our recovery pages, so a shopper who`);
    L(`  // was on your domain is asked the question on your domain rather than on`);
    L(`  // a gateway domain they have never heard of. Both optional; see INSTALL.md.`);
    if (s.recoverPath) L(`  "recoverPath": ${q(s.recoverPath)},`);
    if (s.restorePath) L(`  "restorePath": ${q(s.restorePath)},`);
  }
  L("");
  L(`  "greeting": ${q(s.greeting)},`);
  L(`  "accent": ${q(s.accent)},`);
  L("");
  L(`  // The NAME of the environment variable holding this shop's signing`);
  L(`  // secret — never the secret. Generated into your .env by npm run init.`);
  L(`  "secretEnv": ${q(s.secretEnv)}${s.orders || s.razorpay ? "," : ""}`);

  if (s.orders) {
    L("");
    L(`  // A read-only endpoint you publish. We sign our requests to it with the`);
    L(`  // secret above, so you can prove the request came from us. Turning this`);
    L(`  // on is what lets the assistant answer "where is my order?".`);
    L(`  "orders": { "feedUrl": ${q(s.orders.feedUrl)} }${s.razorpay ? "," : ""}`);
  }

  if (s.razorpay) {
    L("");
    L(`  // Environment variable NAMES again. Values go in .env.`);
    L(`  //`);
    L(`  // Register the webhook in your Razorpay dashboard against`);
    L(`  //   <your gateway>/webhooks/razorpay/${s.key}`);
    L(`  // Without it settlement rides the browser return path, and a buyer who`);
    L(`  // closes the tab after paying gets no order.`);
    L(`  //`);
    L(`  // "methods" is ADVERTISED TO AGENTS, so it has to be true. Left out here:`);
    L(`  // the default is card, netbanking and wallet, which is what a Razorpay`);
    L(`  // account presents with nothing extra switched on. Add "upi" only once`);
    L(`  // KYC has cleared on your account.`);
    L(`  "razorpay": {`);
    L(`    "keyIdEnv": ${q(s.razorpay.keyIdEnv)},`);
    L(`    "keySecretEnv": ${q(s.razorpay.keySecretEnv)},`);
    L(`    "webhookSecretEnv": ${q(s.razorpay.webhookSecretEnv)}`);
    L(`  }`);
  }

  L("}");
  return lines.join("\n");
}

/**
 * A site carried over from an existing config, emitted verbatim.
 *
 * The merchant's comments do not survive a rewrite — init backs the old file up
 * and says so — but no FIELD may be lost, including ones init never asks about
 * (`recoverPath`, `razorpay.methods`, a hand-written `devSecret`). Re-emitting
 * the raw parsed object rather than a reconstructed one is what guarantees that.
 */
export function rawBlock(raw) {
  return JSON.stringify(raw, null, 2)
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

export function configText(blocks) {
  return [
    "// CHAPMAN — site registry.",
    "//",
    "// Written by `npm run init`. Gitignored, so your settings survive `git pull`.",
    "// Comments are allowed (`//` and /* */). Trailing commas are not.",
    "//",
    "// Nothing in this file is a secret. Secrets are named here and their values",
    "// live in your .env. If you are about to paste a key in, you are in the",
    "// wrong file.",
    "//",
    "// Re-run `npm run init` to add another storefront, or edit by hand and run",
    "// `npm run doctor` to check it.",
    "{",
    '  "sites": [',
    blocks.join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Adding to .env
 * ------------------------------------------------------------------ */

/**
 * Work out what to append to an existing `.env`, and append nothing else.
 *
 * Deliberately incapable of changing a line that already exists. A merchant
 * re-running init after six months has a live `SITE_SECRET_` in that file, and
 * rotating it silently would invalidate every session token in the wild — a
 * failure that surfaces as the assistant forgetting who everyone is, with
 * nothing in any log to connect it to a setup command.
 *
 * Returns the text to APPEND, not the whole file, so a bug here cannot truncate
 * a merchant's environment.
 */
export function envAdditions(existingText, entries, today = new Date().toISOString().slice(0, 10)) {
  const text = existingText ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";

  const present = new Set();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) present.add(t.slice(0, eq).trim());
  }

  const add = entries.filter((e) => !present.has(e.key));
  const kept = entries.filter((e) => present.has(e.key)).map((e) => e.key);
  if (add.length === 0) return { append: "", added: [], kept };

  let append = "";
  if (text.length > 0 && !/\r?\n$/.test(text)) append += eol;
  append += `${eol}# CHAPMAN — written by npm run init, ${today}${eol}`;
  for (const e of add) {
    if (e.comment) for (const line of e.comment.split("\n")) append += `# ${line}${eol}`;
    append += `${e.key}=${e.value}${eol}`;
  }
  return { append, added: add.map((e) => e.key), kept };
}

/**
 * The variables a given setup needs, in the order they should appear.
 *
 * Split out from init so the check script can assert that a Razorpay setup
 * names all three variables and that none of them is written with a value —
 * the "we never ask you to type a secret" rule, as an assertion rather than a
 * comment.
 */
export function envEntriesFor({ site, siteSecret, consoleSecret, gatewayOrigin }) {
  const entries = [
    {
      key: site.secretEnv,
      value: siteSecret,
      comment: `Signs session tokens for ${site.key} and our requests to its order feed.\nRotating this signs everyone out. Keep it off version control.`,
    },
    {
      key: "CONSOLE_SESSION_SECRET",
      value: consoleSecret,
      comment: "Signs merchant console sessions.",
    },
    {
      key: "GATEWAY_ORIGIN",
      value: gatewayOrigin,
      comment: "Where this gateway answers. Used to build the recovery links we send shoppers.",
    },
  ];
  if (site.razorpay) {
    entries.push(
      {
        key: site.razorpay.keyIdEnv,
        value: "",
        comment: "Paste your Razorpay key id here. Payments decline until you do.",
      },
      { key: site.razorpay.keySecretEnv, value: "" },
      {
        key: site.razorpay.webhookSecretEnv,
        value: "",
        comment: `From the webhook you register at ${gatewayOrigin}/webhooks/razorpay/${site.key}`,
      },
    );
  }
  return entries;
}

/** The tag a merchant pastes into their template. One place, so docs and CLI agree. */
export const embedTag = (gatewayOrigin, key) =>
  `<script src="${gatewayOrigin}/embed.js"\n        data-site="${key}" defer></script>`;
