/**
 * `npm run demo:clean-store` — the demo store, minus CHAPMAN.
 *
 * The demo needs a storefront with no integration in it, so that installing
 * CHAPMAN can happen on camera rather than being asserted. `demo-store/` is the
 * opposite of that and should stay so: it is the reference, integrated five
 * layers deep, and every one of those layers is documented against it.
 *
 * WHY GENERATE RATHER THAN KEEP A SECOND COPY. A checked-in clean storefront
 * rots the day somebody edits the real one, and it rots silently — the copy
 * still serves, still looks right, and is quietly a different shop. Generating
 * it means the clean store is a FUNCTION of the reference: it cannot drift, and
 * `demo-store-clean/` is gitignored so nobody is tempted to edit it back.
 *
 * WHY NOT A FLAG THAT HIDES THE TAG. Because then "installing CHAPMAN" on camera
 * is flipping a flag, and an audience can tell. The file that gets pasted into
 * has to genuinely not contain the tag.
 *
 * WHAT IS REMOVED, and it is only ever this:
 *
 *   - everything between <!-- CHAPMAN:BEGIN --> and <!-- CHAPMAN:END --> in any
 *     .html file. That is the embed tag and the session-token placeholder.
 *   - the Go sources and the README, which belong to the reference, not to a
 *     storefront being served. The compiled server is in the store image.
 *
 * WHAT IS DELIBERATELY KEPT:
 *
 *   - assets/cart.js, which degrades on its own when no tag is on the page:
 *     the buy buttons disable themselves and say why. That dead button becoming
 *     a live one is the whole before-and-after, and it is real.
 *   - catalog.json, the shop's own product data. It is the merchant's, not ours.
 *
 * It ends by GREPPING ITS OWN OUTPUT. A strip that half-worked would leave a
 * broken tag pointing at nothing, on camera, and the failure would look like
 * the product failing. So the assertion is part of the command, not part of the
 * checklist.
 *
 *   npm run demo:clean-store
 *   npm run demo:clean-store -- --out ../somewhere-else
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const SRC = path.resolve(arg("src", path.join(process.cwd(), "..", "demo-store")));
const OUT = path.resolve(arg("out", path.join(process.cwd(), "..", "demo-store-clean")));

/** Markers, and the one place they are spelled. */
const BEGIN = "<!-- CHAPMAN:BEGIN";
const END = "<!-- CHAPMAN:END -->";

/** The reference's own scaffolding: a storefront being served has no use for it. */
const SKIP = [
  (n) => n.endsWith(".go"),
  (n) => n === "go.mod" || n === "go.sum",
  (n) => n === "README.md",
  (n) => n === "Dockerfile",
  (n) => n.endsWith(".exe"),
  (n) => n.startsWith("."),
];

if (!fs.existsSync(path.join(SRC, "index.html"))) {
  console.error(`\nstopped: ${SRC} does not look like the demo store — no index.html.\n`);
  process.exit(1);
}

/**
 * Remove every marked block.
 *
 * Loops rather than replacing once: a page may carry more than one, and a
 * single-shot replace on a page with two would leave the second in place and
 * report success.
 */
function strip(html) {
  let out = html;
  let removed = 0;
  for (;;) {
    const a = out.indexOf(BEGIN);
    if (a < 0) break;
    const b = out.indexOf(END, a);
    if (b < 0) {
      throw new Error(`found ${BEGIN} with no matching ${END}`);
    }
    out = out.slice(0, a) + out.slice(b + END.length);
    removed++;
  }
  // Two blank lines where the block used to be, collapsed. Cosmetic, and the
  // page is about to be looked at closely by a camera.
  out = out.replace(/\n{3,}/g, "\n\n");
  return { out, removed };
}

/* ------------------------------------------------------------------ *
 * Copy
 * ------------------------------------------------------------------ */

// Rebuilt from scratch every time. An incremental copy would leave the tag
// behind from the previous take, which is the one failure that only shows up
// once the camera is rolling.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let files = 0;
let stripped = 0;
const pages = [];

function walk(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.some((f) => f(e.name))) continue;
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      walk(src, dst);
      continue;
    }
    if (e.name.endsWith(".html")) {
      const { out, removed } = strip(fs.readFileSync(src, "utf8"));
      fs.writeFileSync(dst, out, "utf8");
      stripped += removed;
      pages.push(path.relative(OUT, dst).replace(/\\/g, "/"));
      files++;
      continue;
    }
    fs.copyFileSync(src, dst);
    files++;
  }
}

walk(SRC, OUT);

/* ------------------------------------------------------------------ *
 * Then check the output, rather than trusting the loop above
 * ------------------------------------------------------------------ */

const FORBIDDEN = [
  ["embed.js", "the embed tag survived the strip"],
  ["AGENT_BASE", "a gateway placeholder survived the strip"],
  ["CHAPMAN:BEGIN", "a marker survived the strip"],
  ["<!--CHAPMAN_SESSION-->", "the session placeholder survived the strip"],
];

const problems = [];
for (const page of pages) {
  const text = fs.readFileSync(path.join(OUT, page), "utf8");
  for (const [needle, why] of FORBIDDEN) {
    if (text.includes(needle)) problems.push(`${page}: ${why} (${needle})`);
  }
}

const rel = (p) => path.relative(path.join(process.cwd(), ".."), p).replace(/\\/g, "/");

if (problems.length > 0) {
  console.error(`\nstopped: ${rel(OUT)} still contains CHAPMAN:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nThe markers in demo-store/*.html are probably malformed.\n");
  process.exit(1);
}

console.log(`\nclean storefront -> ${rel(OUT)}`);
console.log(`  ${files} files, ${pages.length} pages, ${stripped} integration block${stripped === 1 ? "" : "s"} removed`);
console.log(`  checked: no embed tag, no AGENT_BASE, no session placeholder\n`);
console.log(`  This copy is generated and gitignored. Edit ${rel(SRC)} instead —`);
console.log(`  then run this again. Anything pasted here is meant to be thrown away.\n`);
