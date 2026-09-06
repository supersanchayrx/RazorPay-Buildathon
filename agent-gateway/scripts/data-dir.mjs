/**
 * The data directory, for scripts.
 *
 * The application resolves this in `app/lib/paths.server.ts`. Scripts cannot
 * import that — they are plain `.mjs` run by bare Node, and the app's modules
 * use extensionless imports only a bundler resolves — so the same two lines
 * live here rather than being reached for across the boundary.
 *
 * They must agree. If `npm run seed` writes where the server does not read,
 * the failure surfaces as an empty dashboard with no error anywhere, which is
 * the worst kind. `scripts/check-config.mjs` asserts the two resolvers return
 * the same answer.
 */
import path from "node:path";

export const DATA_DIR = process.env.CHAPMAN_DATA_DIR?.trim()
  ? path.resolve(process.env.CHAPMAN_DATA_DIR.trim())
  : path.join(process.cwd(), "data");

export const dataPath = (...parts) => path.join(DATA_DIR, ...parts);
