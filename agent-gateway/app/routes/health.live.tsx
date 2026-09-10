/** Process liveness deliberately has no dependency checks. */
export const loader = () => Response.json(
  { ok: true },
  { headers: { "cache-control": "no-store" } },
);
