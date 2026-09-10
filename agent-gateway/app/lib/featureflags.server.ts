/**
 * Which parts of CHAPMAN this shop has switched on.
 *
 * WHY THIS EXISTS. CHAPMAN is a tool for any merchant, and no merchant wants
 * all of it. A shop with no phone support does not want voice. A shop whose
 * order data lives somewhere we cannot reach does not want the assistant
 * offering to look orders up. Until now the only answer was "do not use that
 * page", which is not an answer: the page not being used does not stop the
 * tool being advertised to an agent, or a memory being written about a
 * shopper.
 *
 * WHY IT IS NOT IN `settings.server.ts`. That file answers HOW a feature
 * behaves — quiet hours, discount depth, monthly caps. This one answers
 * WHETHER IT IS THERE AT ALL. They are different questions with different
 * blast radii, and `writeSettings` validates policy in a way a boolean has no
 * use for. Keeping them apart also means the switch cannot be corrupted by a
 * settings file that fails validation for an unrelated reason.
 *
 * WHAT "OFF" HAS TO MEAN. Off is not a hidden card. A switch that removes a
 * feature from the dashboard while an agent can still call its tool is worse
 * than no switch, because the merchant now believes something false about
 * their own shop. So every switch below names the surfaces it governs, and
 * those surfaces check it — the UCP tool list, the tool dispatcher, the
 * shopper's tool set, and the routes themselves.
 *
 * THE ONE DISTINCTION THAT MATTERS: ENTRY VERSUS IN-FLIGHT.
 *
 * A feature has places where it STARTS and places where something already
 * started FINISHES. Only the first kind is gated.
 *
 *   - Switching payments off must not refuse a Razorpay webhook. The buyer's
 *     money has already moved; refusing the callback does not un-charge them,
 *     it loses their order.
 *   - It must not break `pay/:site/:orderId` either. That link was issued
 *     before the switch was flipped and somebody is holding it.
 *   - Switching voice off must not 404 the TwiML callbacks. A call already
 *     connected would die mid-sentence.
 *   - Switching recovery off must not 404 `recover/:site/:token`. That link is
 *     already in somebody's inbox.
 *
 * Off means "start nothing new". It never means "drop what is in the air".
 */
import { database, databasePath, ensureStore, transaction } from "./database.server";

export type FeatureKey =
  | "assistant"
  | "agent_front"
  | "payments"
  | "orders"
  | "offers"
  | "memory"
  | "recovery"
  | "voice";

export type FeatureSwitch = {
  key: FeatureKey;
  name: string;
  /**
   * What actually stops, in the merchant's terms. Rendered verbatim on the
   * console next to the switch — a merchant should never have to guess how far
   * "off" reaches, and writing it here rather than in the page keeps the claim
   * next to the code that has to honour it.
   */
  offMeans: string;
  /** Entry surfaces that refuse while this is off. Documentation and a test target. */
  gates: string[];
  /** Surfaces that keep working regardless, because something is already in flight. */
  inflight?: string[];
  /** UCP tool names withdrawn from `tools/list` and refused at `tools/call`. */
  ucpTools: string[];
  /** Shopper-facing tool names withdrawn from the assistant's tool set. */
  shopperTools: string[];
};

/**
 * Everything a merchant may switch off.
 *
 * All default ON. A switch that arrives already off would silently change what
 * an existing installation does the moment it updates, which is precisely the
 * failure this is supposed to prevent.
 */
export const SWITCHES: FeatureSwitch[] = [
  {
    key: "assistant",
    name: "Storefront assistant",
    offMeans:
      "The chat widget stops answering. The script still loads, so your pages do not break, but every message is declined. Agents are unaffected — they come in through the agent surface below.",
    gates: ["embed.chat", "proxy.chat"],
    ucpTools: [],
    shopperTools: [],
  },
  {
    key: "agent_front",
    name: "Agent-readable storefront",
    offMeans:
      "The whole machine surface disappears: discovery, the tool endpoint, the agent view and llms.txt all return 404. A shopper's AI agent reaching your store falls back to reading your HTML, as it would have before you installed CHAPMAN.",
    gates: [
      "ucp.$site.mcp",
      "ucp.$site.profile",
      "ucp.$site.agentview",
      "ucp.$site.llms.txt",
    ],
    ucpTools: [],
    shopperTools: [],
  },
  {
    key: "payments",
    name: "Razorpay agent checkout",
    offMeans:
      "No new Chapman-hosted Razorpay checkout can be created by an agent or the assistant. The storefront's native checkout is unchanged. Baskets still price — quoting is not paying. A payment already under way still completes, and a Razorpay webhook is still accepted, because refusing it would lose an order somebody has already paid for.",
    gates: ["embed.checkout", "create_checkout"],
    inflight: ["pay.$site.$orderId", "webhooks.razorpay.$site"],
    ucpTools: [
      "create_checkout",
      "get_checkout",
      "update_checkout",
      "complete_checkout",
      "cancel_checkout",
    ],
    shopperTools: [],
  },
  {
    key: "orders",
    name: "Order & cart access",
    offMeans:
      "Nothing can look up an order. `get_order` leaves the agent tool list and the assistant loses `get_my_orders`, so “where is my order” is declined rather than answered from stale data.",
    gates: ["get_order", "get_my_orders"],
    ucpTools: ["get_order"],
    shopperTools: ["get_my_orders"],
  },
  {
    key: "offers",
    name: "Offer proposals",
    offMeans:
      "Approved offers stop being advertised. `get_promotions` leaves the agent tool list and the assistant loses `get_live_offers`. Existing approvals are not deleted — they simply stop being reachable, and come back when you switch this on.",
    gates: ["get_promotions", "get_live_offers"],
    ucpTools: ["get_promotions"],
    shopperTools: ["get_live_offers"],
  },
  {
    key: "memory",
    name: "Shopper memory",
    offMeans:
      "Nothing new is remembered about a shopper and nothing already stored is recalled into a conversation. What is on disk stays there, untouched, and is readable again the moment you switch this back on.",
    gates: ["embed.memory", "recall", "remember"],
    ucpTools: [],
    shopperTools: [],
  },
  {
    key: "recovery",
    name: "Basket recovery",
    offMeans:
      "No basket is drafted for outreach and nothing can be sent. Recovery and restore links already in a shopper's inbox keep working, because the person holding one did nothing wrong.",
    gates: ["dashboard.recovery send"],
    inflight: ["recover.$site.$token", "restore.$site.$token"],
    ucpTools: [],
    shopperTools: [],
  },
  {
    key: "voice",
    name: "Voice & messaging outreach",
    offMeans:
      "No call is placed. A call already connected runs to its end rather than being cut off mid-sentence, so the carrier callbacks stay open.",
    gates: ["voice call placement"],
    inflight: ["voice.twiml", "voice.turn", "voice.reply", "voice.audio"],
    ucpTools: [],
    shopperTools: [],
  },
];

/**
 * The three that have no switch, and why not.
 *
 * Rendered on the console beside the others. A merchant who cannot find the
 * off switch for the ledger deserves to be told it is deliberate rather than
 * left looking for it.
 */
export const ALWAYS_ON: { key: string; name: string; why: string }[] = [
  {
    key: "ledger",
    name: "Decision ledger",
    why: "This is the record of what was said on your behalf and which gate stopped what. A switch that turns off your own audit trail is not a feature.",
  },
  {
    key: "cortex",
    name: "Shop cortex",
    why: "Every other feature reads from it. Switching it off would not disable a surface, it would make the rest answer from nothing.",
  },
  {
    key: "testbench",
    name: "Test bench",
    why: "It only ever asks your own shop questions. There is nothing here to switch off.",
  },
];

const KEYS = SWITCHES.map((s) => s.key);
const byKey = new Map(SWITCHES.map((s) => [s.key, s]));

export type FeatureFlags = Record<FeatureKey, boolean>;

export type FlagsFile = {
  flags: FeatureFlags;
  updatedAt: string | null;
  updatedBy: string | null;
  /** The last twenty changes. Small, bounded, and enough to answer "who turned this off". */
  history: { ts: string; by: string; key: FeatureKey; to: boolean }[];
};

const ALL_ON = (): FeatureFlags =>
  Object.fromEntries(KEYS.map((k) => [k, true])) as FeatureFlags;

/**
 * Read, defaulting every unknown key to ON.
 *
 * The default direction is the whole safety argument. A file written before a
 * feature existed is missing that key, and a missing key that read as `false`
 * would switch off a feature the merchant never chose to switch off — every
 * time we shipped a new one.
 */
export function readFlags(site: string): FeatureFlags {
  const out = ALL_ON();
  const rows = database().prepare(`
    SELECT f.feature, f.enabled
    FROM feature_flags f JOIN stores s ON s.id = f.store_id
    WHERE s.site_key = ?
  `).all(site) as Array<{ feature: string; enabled: number }>;
  for (const row of rows) {
    // Only an explicit `false` switches anything off. Anything else — absent,
    // null, a string left by a hand edit — is the safe direction.
    if (KEYS.includes(row.feature as FeatureKey) && row.enabled === 0) {
      out[row.feature as FeatureKey] = false;
    }
  }
  return out;
}

/** The whole file, for the console, which wants to say when and by whom. */
export function readFlagsFile(site: string): FlagsFile {
  const rows = database().prepare(`
    SELECT e.changed_at, e.changed_by, e.feature, e.enabled
    FROM feature_flag_events e JOIN stores s ON s.id = e.store_id
    WHERE s.site_key = ? ORDER BY e.id DESC LIMIT 20
  `).all(site) as Array<{
    changed_at: string; changed_by: string; feature: FeatureKey; enabled: number;
  }>;
  const history = rows.reverse().map((r) => ({
    ts: r.changed_at, by: r.changed_by, key: r.feature, to: r.enabled === 1,
  }));
  const last = history.at(-1);
  return {
    flags: readFlags(site),
    updatedAt: last?.ts ?? null,
    updatedBy: last?.by ?? null,
    history,
  };
}

/** Is this feature on for this shop? Unknown keys are on — see `readFlags`. */
export function featureOn(site: string, key: FeatureKey): boolean {
  return readFlags(site)[key] !== false;
}

/**
 * Flip one or more switches.
 *
 * Returns the new state rather than nothing, so the console renders what was
 * actually written instead of what it hoped it wrote.
 */
export function writeFlags(
  site: string,
  patch: Partial<Record<FeatureKey, boolean>>,
  by: string,
): FlagsFile {
  const current = readFlagsFile(site);
  const next: FeatureFlags = { ...current.flags };
  const changes: FlagsFile["history"] = [];
  const ts = new Date().toISOString();

  for (const k of KEYS) {
    const v = patch[k];
    if (typeof v !== "boolean" || v === next[k]) continue;
    next[k] = v;
    changes.push({ ts, by, key: k, to: v });
  }

  if (changes.length === 0) return current;

  const storeId = ensureStore(site);
  transaction((db) => {
    const upsert = db.prepare(`
      INSERT INTO feature_flags(store_id, feature, enabled, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(store_id, feature) DO UPDATE SET
        enabled = excluded.enabled, updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `);
    const event = db.prepare(`
      INSERT INTO feature_flag_events(store_id, feature, enabled, changed_at, changed_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const change of changes) {
      upsert.run(storeId, change.key, change.to ? 1 : 0, ts, by);
      event.run(storeId, change.key, change.to ? 1 : 0, ts, by);
    }
  });
  return readFlagsFile(site);
}

/* ------------------------------------------------------------------ *
 * Enforcement helpers
 *
 * One function per surface shape, so a route gates a feature in a single
 * line and there is exactly one place to look when asking what "off" does.
 * ------------------------------------------------------------------ */

/**
 * Refuse a route whose feature is off.
 *
 * Throws a 404 rather than a 403, and the difference is deliberate: a surface
 * the merchant switched off should look absent, not forbidden. A 403 tells a
 * caller the thing exists and invites a retry with better credentials.
 */
export function requireFeature(site: string, key: FeatureKey): void {
  if (featureOn(site, key)) return;
  throw new Response("Not found", { status: 404 });
}

/** Which switch governs a UCP tool, if any. */
export function featureForUcpTool(name: string): FeatureKey | null {
  for (const s of SWITCHES) if (s.ucpTools.includes(name)) return s.key;
  return null;
}

/**
 * The UCP tools this shop actually offers.
 *
 * `agent_front` off empties the list rather than trimming it — the surface is
 * gone, not reduced. The route 404s before this is reached, but a caller that
 * gets here another way must not be handed a menu.
 */
export function filterUcpTools<T extends { name: string }>(
  site: string,
  tools: T[],
): T[] {
  const flags = readFlags(site);
  if (!flags.agent_front) return [];
  const off = new Set<string>();
  for (const s of SWITCHES)
    if (!flags[s.key]) for (const t of s.ucpTools) off.add(t);
  return tools.filter((t) => !off.has(t.name));
}

/** The same, for the tools the shopper's assistant is given. */
export function filterShopperTools<T extends { name: string }>(
  site: string,
  tools: T[],
): T[] {
  const flags = readFlags(site);
  const off = new Set<string>();
  for (const s of SWITCHES)
    if (!flags[s.key]) for (const t of s.shopperTools) off.add(t);
  return tools.filter((t) => !off.has(t.name));
}

/** For the console and `npm run doctor`. */
export function switchFor(key: FeatureKey): FeatureSwitch | null {
  return byKey.get(key) ?? null;
}

/** Test seam: the on-disk path, so a check can clean up after itself. */
export function _file(site: string): string {
  void site;
  return databasePath();
}

export { closeDatabase as _closeDatabase } from "./database.server";
