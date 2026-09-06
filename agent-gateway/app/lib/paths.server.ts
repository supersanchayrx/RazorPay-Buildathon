/**
 * Where CHAPMAN keeps the things it writes.
 *
 * Every runtime file — the decision ledger, placed orders, shopper memory,
 * console accounts, the session secret — used to be addressed as
 * `path.join(process.cwd(), "data", …)`, written out longhand at twenty-nine
 * separate call sites. That is fine while the only person running this is the
 * person who wrote it, and wrong the moment a merchant does: `process.cwd()`
 * is the checkout. A shop's orders end up inside a git working tree that the
 * next `git pull` walks over, and a container that gets replaced takes the
 * shop's data with it.
 *
 * One variable moves all of it:
 *
 *   CHAPMAN_DATA_DIR=/var/lib/chapman
 *
 * Unset, it resolves to `./data` exactly as before. That default is not
 * laziness — it is the reason nothing changed for anyone already running this.
 *
 * WHAT BELONGS HERE. State CHAPMAN produced and cannot recreate: orders that
 * were placed, offers that were approved, what a shopper told us, who can log
 * into the console. Seed output (`orders.jsonl`, `carts.jsonl`,
 * `merchant-inputs.json`) lands here too and is the one exception — `npm run
 * seed` rebuilds it deterministically from nothing, so losing it costs a
 * command.
 *
 * WHAT DOES NOT. Configuration is `chapman.config.json`, because a merchant
 * edits it and we must never overwrite it. Secrets are named in the
 * environment and resolved at the moment of use — see `env.server.ts`. If you
 * are about to write a key into this directory, you are in the wrong file:
 * this directory is the one we tell merchants to back up and mount into a
 * container, which makes it the worst possible place to keep one.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Resolved once and held.
 *
 * Read lazily rather than at module load so that a test — and `npm run
 * doctor` — can set the variable, then import, and still be heard. A merchant
 * does not move their data half way through a process, so caching costs
 * nothing and saves a `path.resolve` on every ledger append.
 */
let root: string | null = null;

/** The absolute directory CHAPMAN writes to. Created if it is not there. */
export function dataDir(): string {
  if (root) return root;

  const configured = process.env.CHAPMAN_DATA_DIR?.trim();
  root = configured ? path.resolve(configured) : path.join(process.cwd(), "data");

  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    // Deliberately swallowed. A path helper that throws turns "your data
    // directory is not writable" into a stack trace from whichever feature
    // happened to touch disk first. The write that follows will fail with the
    // real errno, against the real filename, and `npm run doctor` asks the
    // question directly.
  }

  return root;
}

/** `dataPath("orders.jsonl")` — the only way this codebase names a data file. */
export function dataPath(...parts: string[]): string {
  return path.join(dataDir(), ...parts);
}

/**
 * Forget the resolved directory.
 *
 * Exists for the check suite, which points the whole application at a
 * throwaway directory and then puts it back. Nothing in the running server
 * calls this.
 */
export function resetDataDir(): void {
  root = null;
}
