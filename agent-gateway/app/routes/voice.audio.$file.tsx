import type { LoaderFunctionArgs } from "react-router";
import fs from "node:fs";
import path from "node:path";
import { _cacheDir, config } from "../lib/voice.server";

/**
 * Rendered speech, addressed by the hash of what it says.
 *
 * A SECOND audio route, and the two are different on purpose.
 *
 *   /voice/audio/:site/:token   the draft's own notice. Named by a signed token
 *                               that says WHICH DRAFT, resolved against the site
 *                               secret, dead in fifteen minutes.
 *
 *   /voice/audio/:file          everything spoken during a conversation — the
 *                               question, the model's replies, the safe line.
 *                               There is no draft to name: these sentences are
 *                               composed mid-call and exist only as audio.
 *
 * So this one is addressed by CONTENT: the filename is a SHA-256 of (text,
 * voice, language), truncated to 32 hex characters. That makes the URL a
 * capability — unguessable, and revealing nothing about whose call it came
 * from, because the same sentence spoken to two shoppers is the same file. It
 * names no cart, no customer and no draft.
 *
 * The regex is the security boundary, not a formality: it admits exactly 32 hex
 * characters and `.mp3`, so nothing here can be walked out of the cache
 * directory. `path.join` with attacker-shaped input is how a media route
 * becomes a file server.
 *
 * It serves only what is already on disk. Nothing about a request can cause
 * synthesis, so this route cannot be used to spend the shop's speech credit.
 */

const NAME = /^[0-9a-f]{32}\.mp3$/;

export async function loader({ params }: LoaderFunctionArgs) {
  if (!config()) return new Response("not found", { status: 404 });

  const name = params.file ?? "";
  if (!NAME.test(name)) return new Response("not found", { status: 404 });

  let body: Buffer;
  try {
    body = fs.readFileSync(path.join(_cacheDir(), name));
  } catch {
    // 404 rather than 500: a cache that was cleared between the TwiML being
    // written and Twilio fetching it is an ordinary race, not a fault.
    return new Response("not found", { status: 404 });
  }

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(body.length),
      /**
       * Never cached by anything in between.
       *
       * The content hash would make this trivially cacheable, and that is
       * exactly the temptation to refuse: an intermediary holding a shopper's
       * recovery message after the call has ended quietly outlives every
       * expiry we set elsewhere.
       */
      "Cache-Control": "no-store, private",
    },
  });
}
