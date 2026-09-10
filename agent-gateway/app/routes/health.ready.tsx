import { databaseHealth } from "../lib/database.server";

/** Readiness covers only dependencies Chapman owns locally. */
export const loader = () => {
  try {
    return Response.json(
      { ok: true, database: databaseHealth() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, database: { ok: false }, error: (error as Error).message },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
};
