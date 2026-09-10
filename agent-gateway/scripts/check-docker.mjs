/**
 * The container, asserted rather than hoped for.
 *
 * Everything here is a thing that fails silently, at somebody else's first
 * `docker compose up`, with an error that names the wrong cause. None of it is
 * subtle once you have seen it; all of it costs an hour the first time.
 *
 * FOUR CLASSES, and they are all the same shape — an agreement between two
 * files that nothing enforces:
 *
 *   1. WHAT REACHES THE IMAGE. `COPY . .` plus a `.dockerignore` that forgets
 *      `data` bakes the shop's ledger, its placed orders and its hashed console
 *      passwords into a layer. Layers are not deletable after the fact, and an
 *      image gets pushed. This is the one that cannot be fixed later, so it is
 *      asserted first.
 *
 *   2. WHERE THINGS ARE WRITTEN. init, bootstrap, loadRootEnv and
 *      findConfigFile each resolve the config and the .env independently. If
 *      they drift, setup writes a configuration that nothing reads and reports
 *      success.
 *
 *   3. WHAT THE ENTRYPOINT PROMISES. Production refuses `devSecret`, so a
 *      secret must exist before `npm start`. Prisma must not run when there is
 *      no Shopify. Both are one line, and both are invisible until the boot
 *      that needs them.
 *
 *   4. THE DEMO'S BEFORE AND AFTER. The clean storefront must genuinely have no
 *      tag in it, and the cart must degrade rather than 404 in silence — because
 *      the alternative is discovering it on camera.
 *
 * Run:  node scripts/check-docker.mjs
 */
import fs from "node:fs";
import path from "node:path";

let failed = 0;
const check = (label, ok, detail) => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

const ROOT = path.join(process.cwd(), "..");
const read = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

const dockerignore = read("Dockerfile") && read(".dockerignore");
const dockerfile = read("Dockerfile");
const entrypoint = read(path.join("docker", "entrypoint.sh"));
const compose = read(path.join(ROOT, "docker-compose.yml"));
const storeDockerfile = read(path.join(ROOT, "demo-store", "Dockerfile"));

/* ================================================================== *
 * 1. What reaches the image
 * ================================================================== */
console.log("\n-- what reaches the image ----------------------------------\n");

{
  const lines = dockerignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const has = (entry) => lines.includes(entry);

  check(
    "the data directory is excluded",
    has("data") || has("data/") || has("/data"),
    "it holds the ledger, placed orders, shopper memory and hashed console passwords",
  );
  check(
    ".env is excluded",
    has(".env"),
    "a build host's secrets must not become a layer",
  );
  check(".env.* is excluded", has(".env.*"));
  check(
    "but .env.example still ships",
    lines.includes("!.env.example"),
    "the template is documentation and holds no values",
  );
  check(
    "a merchant's own config is excluded",
    has("chapman.config.json"),
    "one host's origins baked into a shared image is how a shop serves somebody else's shop",
  );
  check("Shopify session storage is excluded", has("prisma/dev.sqlite"));
  check("build output is excluded", has("build") && has("node_modules"));
}

/* ================================================================== *
 * 2. The image itself
 * ================================================================== */
console.log("\n-- the image -----------------------------------------------\n");

{
  const pkg = JSON.parse(read("package.json") || "{}");
  const engines = pkg.engines?.node ?? "";

  const from = /^FROM\s+node:(\S+)/m.exec(dockerfile)?.[1] ?? "";
  const major = Number(/^(\d+)/.exec(from)?.[1] ?? 0);
  check(
    "the base image is a Node the package.json allows",
    major >= 22,
    `node:${from} against engines ${engines}`,
  );

  // `npm ci` under NODE_ENV=production omits devDependencies, and vite is one.
  // The failure reads as a broken build script rather than a wrong ENV line.
  const envAt = dockerfile.indexOf("ENV NODE_ENV=production");
  const ciAt = dockerfile.indexOf("npm ci");
  check(
    "NODE_ENV=production is set after npm ci, not before",
    envAt > ciAt && ciAt >= 0,
    "otherwise npm ci silently omits vite and the build fails",
  );
  check(
    "dev dependencies are installed",
    /npm ci(?!.*--omit=dev)/.test(dockerfile),
    "doctor, init and check all bundle .server modules with esbuild inside the image",
  );
  check(
    "the entrypoint's carriage returns are stripped",
    /sed -i 's\/\\r\$\/\/'/.test(dockerfile),
    "a CRLF shebang fails as /bin/sh\\r: not found, which names neither the file nor the cause",
  );
  check(
    "the entrypoint is the ENTRYPOINT",
    /ENTRYPOINT \["\/usr\/local\/bin\/chapman-entrypoint"\]/.test(dockerfile),
  );
  check(
    "prisma is not in the default command",
    /CMD \["npm", "start"\]/.test(dockerfile) &&
      !/CMD.*docker-start/.test(dockerfile),
    "prisma is Shopify session storage only; running it unconditionally can only fail",
  );
}

/* ================================================================== *
 * 3. Where things are written
 * ================================================================== */
console.log("\n-- where things are written --------------------------------\n");

{
  const initSrc = read("scripts/init.mjs");
  const bootSrc = read("scripts/bootstrap.mjs");
  const envSrc = read("app/lib/env.server.ts");
  const dbSrc = read("app/lib/database.server.ts");

  check(
    "all four agree on CHAPMAN_ENV_FILE",
    [initSrc, bootSrc, envSrc].every((s) => s.includes("CHAPMAN_ENV_FILE")),
    "init writes it, bootstrap appends to it, loadRootEnv reads it",
  );
  check(
    "the entrypoint exports the database, env file, and data dir",
    entrypoint.includes("export CHAPMAN_ENV_FILE") &&
      entrypoint.includes("export CHAPMAN_DATA_DIR") &&
      entrypoint.includes("export CHAPMAN_DATABASE_PATH"),
  );
  check(
    "compose points SQLite and generated secrets at the volume",
    /CHAPMAN_DATA_DIR:\s*\/data/.test(compose) &&
      /CHAPMAN_DATABASE_PATH:\s*\/data\/chapman\.sqlite/.test(compose) &&
      /DATABASE_URL:\s*file:\/data\/chapman\.sqlite/.test(compose) &&
      /CHAPMAN_ENV_FILE:\s*\/data\//.test(compose),
    "/app and / are layers; a console account written there is gone on the next up",
  );
  check(
    "the volume is named, so `down` keeps it",
    /volumes:\s*[\s\S]*chapman-data:/.test(compose) &&
      /chapman-data:\/data/.test(compose),
  );
  check(
    "the shared repository enables SQLite safety pragmas",
    ["foreign_keys = ON", "journal_mode = WAL", "busy_timeout = 5000"].every((value) => dbSrc.includes(value)),
  );
}

/* ================================================================== *
 * 4. What the entrypoint promises
 * ================================================================== */
console.log("\n-- the entrypoint ------------------------------------------\n");

{
  check(
    "it is LF, not CRLF",
    entrypoint.length > 0 && !entrypoint.includes("\r\n"),
    "git normalises this via .gitattributes; the Dockerfile strips it again",
  );
  check("it starts with a POSIX shebang", entrypoint.startsWith("#!/bin/sh"));
  check(
    "a missing configured store defaults to dashboard onboarding",
    /CHAPMAN_AUTO_INIT/.test(entrypoint) &&
      /starting merchant onboarding/.test(entrypoint),
    "no storefront is registered until the signed-in merchant submits setup",
  );
  check(
    "unattended setup is explicitly opt-in and still uses npm run init",
    /AUTO_INIT/.test(entrypoint) && /npm run init/.test(entrypoint),
    "operators can still provision known site details without a browser",
  );
  check(
    "synthetic merchant history is explicitly opt-in",
    /SEED_DEMO/.test(entrypoint) && /CHAPMAN_SEED:-0/.test(entrypoint),
    "a fresh merchant must never appear to have orders they did not create",
  );
  check(
    "an existing store still gets its secrets generated",
    /npm run --silent bootstrap/.test(entrypoint),
    "production refuses devSecret, so every route that resolves a site 500s without this",
  );
  check(
    "prisma runs only when Shopify is configured",
    /if \[ -n "\$SHOPIFY_API_KEY" \]/.test(entrypoint) &&
      /prisma migrate deploy/.test(entrypoint),
  );
  check(
    "the bootstrap is skipped for one-off commands",
    /IS_SERVER/.test(entrypoint),
    "so `run --rm -it gateway npm run init` is not racing a bootstrap writing the same file",
  );
  check(
    "it execs the command rather than wrapping it",
    /\nexec "\$@"/.test(entrypoint),
    "so signals reach the server and `docker compose stop` is not a ten-second timeout",
  );
  check(
    "existing environment values win over the generated file",
    /if \[ -z "\$\(eval/.test(entrypoint),
    "an orchestrator injecting a real secret must beat one we generated months ago",
  );
  check(
    "payments need two pasted values and no variable names",
    /CHAPMAN_RAZORPAY_KEY_ID_ENV=RAZORPAY_KEY_ID/.test(entrypoint),
    "the indirection stays, but nobody has to invent a variable name to get started",
  );
  check(
    "database migrations run before bootstrap and traffic",
    entrypoint.indexOf("npm run --silent db:migrate") >= 0 &&
      entrypoint.indexOf("npm run --silent db:migrate") < entrypoint.indexOf("npm run --silent bootstrap"),
  );
  check(
    "Compose probes explicit database readiness",
    compose.includes("http://127.0.0.1:3000/health/ready") &&
      read("app/routes/health.ready.tsx").includes("databaseHealth()"),
  );
}

/* ================================================================== *
 * 5. bootstrap never overwrites
 * ================================================================== */
console.log("\n-- bootstrap is safe to re-run -----------------------------\n");

{
  const bootSrc = read("scripts/bootstrap.mjs");
  check(
    "it appends to the env file, never writes it",
    bootSrc.includes("appendFileSync(") &&
      !bootSrc.includes("writeFileSync(ENV_FILE"),
    "a truncated .env on the second boot is a shop with no signing secret",
  );
  check(
    "it checks both the environment and the file before adding",
    /alreadySet/.test(bootSrc) && /process\.env\[name\]/.test(bootSrc),
    "rotating a secret on boot signs every shopper out on every boot",
  );
  check(
    "it creates a console account only when there is none",
    /existing\.length > 0/.test(bootSrc),
  );
  check(
    "the generated console password is random",
    /randomBytes\(9\)/.test(bootSrc),
    "a password in a Dockerfile is not a password",
  );
  check(
    "npm run bootstrap exists",
    JSON.parse(read("package.json")).scripts.bootstrap ===
      "node scripts/bootstrap.mjs",
  );
}

/* ================================================================== *
 * 6. The demo's before and after
 * ================================================================== */
console.log("\n-- the demo ------------------------------------------------\n");

{
  const mainGo = read(path.join(ROOT, "demo-store", "main.go"));
  const checkoutGo = read(path.join(ROOT, "demo-store", "checkout.go"));
  const cartJs = read(path.join(ROOT, "demo-store", "assets", "cart.js"));
  const cleanSrc = read("scripts/demo-clean-store.mjs");

  check(
    "the store separates the browser's gateway URL from its own",
    /AGENT_BASE_URL/.test(mainGo) && /AGENT_UPSTREAM_URL/.test(mainGo),
    "across a compose network the browser says localhost:3000 and the container says gateway:3000",
  );
  check(
    "the store can be told where its files are",
    /STORE_DIR/.test(mainGo),
    "rootDir() is a compile-time source path and does not exist inside an image",
  );
  check(
    "-chapman=false unregisters the agent surface rather than hiding it",
    /if \*chapmanOn \{/.test(mainGo) &&
      /mux\.HandleFunc\("\/\.well-known\/ucp"/.test(mainGo),
    "so the 404 in the before shot is a real 404 from a real mux",
  );
  check(
    "the store and the gateway derive the same secret variable name",
    /func secretEnvFor/.test(mainGo),
    "a mismatch is an order feed the gateway rejects as unsigned, which reads as a broken assistant",
  );

  check(
    "the cart uses the merchant's checkout without installing chat",
    /fetch\("\/api\/checkout"/.test(cartJs) &&
      /CHAPMAN_BASE/.test(cartJs),
    "Razorpay works first; the optional Chapman URL is only for recovery beacons",
  );
  check(
    "the merchant creates and verifies Razorpay orders server-side",
    /func \(c \*checkout\) start/.test(checkoutGo) &&
      /func \(c \*checkout\) confirm/.test(checkoutGo) &&
      /SetBasicAuth/.test(checkoutGo),
    "neither the price nor the key secret may come from the browser",
  );

  for (const page of ["index.html", "product.html", "account.html"]) {
    const html = read(path.join(ROOT, "demo-store", page));
    check(
      `${page} marks the integration block`,
      html.includes("<!-- CHAPMAN:BEGIN") &&
        html.includes("<!-- CHAPMAN:END -->"),
      "an explicit boundary is what makes stripping it bounded rather than a guess",
    );
  }

  check(
    "the clean store is generated, not checked in",
    !fs.existsSync(path.join(ROOT, "demo-store-clean", ".git")) &&
      read(path.join(ROOT, ".gitignore")).includes("demo-store-clean"),
    "a second checked-in storefront drifts the day someone edits the first",
  );
  check(
    "the generator greps its own output",
    /FORBIDDEN/.test(cleanSrc) && /embed\.js/.test(cleanSrc),
    "a half-stripped page fails on camera and looks like the product failing",
  );
  check(
    "npm run demo:clean-store exists",
    JSON.parse(read("package.json")).scripts["demo:clean-store"] ===
      "node scripts/demo-clean-store.mjs",
  );
}

/* ================================================================== *
 * 7. compose
 * ================================================================== */
console.log("\n-- compose -------------------------------------------------\n");

{
  check(
    "the gateway is not behind a profile",
    /gateway:\s*\n\s+build:/.test(compose),
    "a merchant runs `docker compose up` and gets the product",
  );
  check(
    "the storefront is behind the demo profile",
    /profiles: \["demo"\]/.test(compose),
  );
  check(
    "the tunnel is behind its own profile",
    /profiles: \["tunnel"\]/.test(compose),
  );
  // Comments stripped first. Both of the checks below are about VALUES, and
  // this file explains at length what not to write — a check that reads its own
  // documentation as a violation is a check nobody keeps.
  const live = compose
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  check(
    "no required-variable markers, which are interpolated before profiles filter",
    !/\$\{[A-Za-z_][A-Za-z0-9_]*:\?/.test(live),
    "one of those makes `docker compose up` fail for everyone who never asked for a tunnel",
  );
  check(
    "the store waits for the gateway to be healthy",
    /condition: service_healthy/.test(compose),
    "after onboarding it can read the generated site secret and optional order history",
  );
  check(
    "the store mounts that volume read-only",
    /chapman-data:\/data:ro/.test(compose),
    "the shop being integrated must never be able to write into the gateway's data",
  );
  check(
    "the storefront is bind-mounted, not baked",
    /\.\/demo-store-clean:\/store/.test(compose),
    "pasting the tag on the host has to be live on the next refresh, with no rebuild",
  );
  check(
    "the store receives Razorpay keys directly from .env",
    /store:[\s\S]*?RAZORPAY_KEY_ID: \$\{RAZORPAY_KEY_ID:-\}[\s\S]*?RAZORPAY_KEY_SECRET: \$\{RAZORPAY_KEY_SECRET:-\}/.test(compose),
    "pasting the two test values before docker compose up is the entire storefront setup",
  );
  // Every variable whose NAME says it carries a credential must have a value
  // that is an interpolation, empty, or a path. A literal is a secret in version
  // control, and this file is the most likely place for one to be pasted "just
  // to test it" and then committed.
  const literals = [];
  for (const line of live.split("\n")) {
    const m =
      /^\s*([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*):\s*(.*)$/.exec(
        line,
      );
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    const ok = value === "" || value.startsWith("${") || value.startsWith("/");
    if (!ok) literals.push(`${m[1]}=${value.slice(0, 12)}…`);
  }
  check(
    "no secret has a literal value in this file",
    literals.length === 0,
    literals.length
      ? literals.join(", ")
      : "every one is an interpolation, empty, or a path",
  );
  check(
    "the store image builds Go from source",
    /FROM golang:/.test(storeDockerfile) && /AS build/.test(storeDockerfile),
  );
  check(
    "the store image does not run as root",
    /USER store/.test(storeDockerfile),
  );
}

console.log(failed === 0 ? "\nALL PASS\n" : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
