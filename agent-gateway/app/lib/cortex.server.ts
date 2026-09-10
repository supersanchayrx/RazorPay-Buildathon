/**
 * The shop cortex — one place that holds what is true about a merchant.
 *
 * Today this knowledge is scattered: the site registry knows the name and
 * origins, the catalogue feed knows policies and prices, merchant-inputs knows
 * costs and floors, the ledger knows what was refused, the calendar knows the
 * regions. Every tool re-derives its own half-view, and they drift. This is the
 * missing centre, not a new feature.
 *
 * TWO RULES MAKE A SHARED MEMORY SAFE.
 *
 * 1. THE CORTEX HOLDS NO SHOPPER DATA. Not one field. Shop knowledge is
 *    merchant-owned and shared by every tool; shopper knowledge is personal
 *    data that must stay partitioned per (merchant, shopper). Merge them into
 *    one pool "all tools can borrow from" and the first leak is a shopper's
 *    preference surfacing in a merchant report — or in a stranger's chat.
 *    Enforced structurally: there is no type below that can carry a person.
 *
 * 2. THE CORTEX HAS TWO PROJECTIONS. `shopperView` and `merchantView`. Unit
 *    cost, margin floors and rejected proposals are the merchant's negotiating
 *    position; the assistant that talks to shoppers must not be able to read
 *    them. A shared memory without an outward projection is a leak with good
 *    intentions.
 *
 * Everything carries provenance and an age, because a tool borrowing a fact
 * needs to know whether it is reading stock from a minute ago or an answer the
 * merchant typed six months ago. A stale cortex fact rendered into a reply is
 * the same fabrication risk as a stale memory.
 *
 * Most of it is DERIVED, not typed. The merchant supplies what we genuinely
 * cannot compute — their voice, their floors — and nothing else.
 */
import { fixtureInputs, fixtureOrders } from "./fixture.server";
import type { CatalogSource, ShopPolicies } from "./catalog.server";
import { readLedger } from "./ledger.server";
import { conversations } from "./conversations.server";
import type { Region } from "./calendar.server";
import type { Site } from "./sites.server";
import { readSettings } from "./settings.server";
import {
  findingsAgeDays,
  readFindings,
  type ServiceNotice,
} from "./findings.server";

export type Provenance =
  "merchant" | "catalogue" | "orders" | "ledger" | "derived";

export type Fact<T> = {
  value: T;
  from: Provenance;
  /** When this was established. */
  at: string;
  /** null means it does not go stale — a policy the merchant wrote stays true until they change it. */
  staleAfterDays: number | null;
};

const fact = <T>(
  value: T,
  from: Provenance,
  staleAfterDays: number | null,
  at = new Date().toISOString(),
): Fact<T> => ({
  value,
  from,
  at,
  staleAfterDays,
});

export function isStale(f: Fact<unknown>, asOf = new Date()): boolean {
  if (f.staleAfterDays === null) return false;
  return (asOf.getTime() - Date.parse(f.at)) / 86400000 > f.staleAfterDays;
}

export type ShopCortex = {
  key: string;
  name: string;
  currency: string;
  regions: Region[];

  /** The one thing only the merchant can tell us. */
  voice: Fact<string> | null;
  policies: Fact<ShopPolicies>;

  /** Shape of what they sell — derived, never typed. */
  catalogue: Fact<{
    products: number;
    variants: number;
    priceMin: number;
    priceMax: number;
    categories: string[];
    outOfStock: string[];
  }>;

  /** MERCHANT-ONLY. Never reaches a shopper surface. */
  constraints: Fact<{
    minMarginPct: number;
    maxDiscountPct: number;
    neverDiscount: string[];
    minSampleSize: number;
  }> | null;

  /** MERCHANT-ONLY. Derived from order history when it exists. */
  commerce: Fact<{
    ordersPerMonth: number;
    avgOrderValue: number;
    bestsellers: string[];
    windowDays: number;
  }> | null;

  /** MERCHANT-ONLY. What was said, and what was stopped. */
  decisions: Fact<{
    replies: number;
    refusals: number;
    byGate: Record<string, number>;
  }>;

  /**
   * MERCHANT-ONLY. Aggregate recovery evidence derived from conversation
   * states. It intentionally carries no cart or customer identifiers.
   */
  recoveryOutcomes: Fact<{
    grantsIssued: number;
    paidOrders: number;
    conversionRate: number;
  }>;

  /**
   * MERCHANT-ONLY. What the last analysis run concluded.
   *
   * The return path that was missing. The cortex has always fed the proposer;
   * this is the proposer feeding back, as an aged fact like everything else, so
   * a merchant can see both what was found and how long ago it was found.
   */
  findings: Fact<{
    incidents: Array<{
      id: string;
      title: string;
      onsetAt: string;
      detectedAt: string;
    }>;
    topActions: Array<{ id: string; title: string; monthlyValue: number }>;
    stopped: number;
    recovery: {
      wouldContact: number;
      suppressed: number;
      marginAtStake: number;
      expectedValue: number;
      enabled: boolean;
    } | null;
    /** Why shoppers said they didn't buy. Merchant-only, like everything above. */
    reasons: {
      total: number;
      enough: boolean;
      counts: Array<{ reason: string; count: number; share: number }>;
    } | null;
    /** Aggregate evidence that issued recovery grants led to paid orders. */
    recoveryOutcomes?: {
      grantsIssued: number;
      paidOrders: number;
      conversionRate: number;
    } | null;
  }> | null;

  /**
   * The ONLY thing derived from analysis that a shopper may hear.
   *
   * Whole sentences, written server-side and bounds-checked before they were
   * stored. The assistant may repeat one; it may not paraphrase it, and it
   * cannot reach the finding underneath. One approved sentence, or nothing.
   */
  serviceNotices: Fact<ServiceNotice[]>;

  /** What we still need, and who has to supply it. A to-do list the agent keeps about itself. */
  gaps: Array<{ what: string; who: "merchant" | "us"; unlocks: string }>;
};

/* ------------------------------------------------------------------ */

function readMerchantInputs(): {
  minMarginPct: number;
  maxDiscountPct: number;
  neverDiscount: string[];
  minSampleSize: number;
} | null {
  const raw = fixtureInputs<{ floors?: {
    minMarginPct: number; maxDiscountPct: number;
    neverDiscount: string[]; minSampleSize: number;
  } }>();
  return raw?.floors ?? null;
}

function readOrderSummary(): {
  ordersPerMonth: number;
  avgOrderValue: number;
  bestsellers: string[];
  windowDays: number;
} | null {
  try {
    const rows = fixtureOrders<any>()
      .filter((o: { status: string }) => o.status === "placed");
    if (!rows.length) return null;
    const first = Date.parse(rows[0].ts);
    const last = Date.parse(rows[rows.length - 1].ts);
    const days = Math.max(1, (last - first) / 86400000);
    const units: Record<string, number> = {};
    let total = 0;
    for (const o of rows) {
      total += o.total;
      for (const l of o.lines) units[l.handle] = (units[l.handle] ?? 0) + l.qty;
    }
    return {
      ordersPerMonth: Math.round((rows.length / days) * 30),
      avgOrderValue: Math.round(total / rows.length),
      bestsellers: Object.entries(units)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([h]) => h),
      windowDays: Math.round(days),
    };
  } catch {
    return null;
  }
}

/**
 * Assemble the cortex for one shop.
 *
 * Deliberately cheap and stateless — it reads what already exists rather than
 * maintaining a parallel store that can fall out of step with the truth. When
 * this moves behind Prisma the derived parts should stay derived; only the
 * merchant-typed parts are worth persisting, because only they cannot be
 * recomputed.
 */
const cache = new Map<string, { at: number; cortex: ShopCortex }>();
const CACHE_MS = 60_000;

/**
 * Cached assembly. One shopper conversation asks the cortex several times, and
 * re-reading five thousand ledger rows per message is how a shared memory
 * becomes the reason everything got slow.
 *
 * Keyed on the site, which is also the isolation boundary: two shops run by the
 * same person are two entries with no path between them.
 */
export async function getCortex(
  opts: Parameters<typeof buildCortex>[0],
): Promise<ShopCortex> {
  const hit = cache.get(opts.site.key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.cortex;
  const cortex = await buildCortex(opts);
  cache.set(opts.site.key, { at: Date.now(), cortex });
  return cortex;
}

export async function buildCortex(opts: {
  site: Pick<Site, "key" | "name">;
  catalog: CatalogSource;
  regions?: Region[];
  voice?: string | null;
}): Promise<ShopCortex> {
  const products = await opts.catalog.search({ limit: 500 }).catch(() => []);
  const policies = await opts.catalog
    .policies()
    .catch(() => ({}) as ShopPolicies);
  const ledger = readLedger(5000);
  const floors = readMerchantInputs();
  const orders = readOrderSummary();
  const settings = readSettings(opts.site.key);
  const found = readFindings(opts.site.key);
  const foundAge = findingsAgeDays(found);
  const recovery = conversations(opts.site.key);
  const grantsIssued = recovery.filter((c) => Boolean(c.grantId)).length;
  const paidOrders = recovery.filter((c) => c.state === "recovered").length;

  /**
   * An explicit argument still wins over the stored setting.
   *
   * The caller that passes a voice is a test or a preview, and a preview that
   * silently rendered the saved value instead of the one being previewed would
   * be useless in exactly the moment someone needed it.
   */
  const voice = opts.voice ?? settings.voice;

  const prices = products
    .flatMap((p) => [Number(p.minPrice), Number(p.maxPrice)])
    .filter(Number.isFinite);
  const byGate: Record<string, number> = {};
  for (const e of ledger)
    if (e.kind === "refusal" && e.gate)
      byGate[e.gate] = (byGate[e.gate] ?? 0) + 1;

  const gaps: ShopCortex["gaps"] = [];
  if (!voice)
    gaps.push({
      what: "How the shop should sound — a sentence or two in the merchant's own words",
      who: "merchant",
      unlocks:
        "A reasoner that sounds like this shop rather than like a chatbot",
    });
  if (!floors)
    gaps.push({
      what: "Unit costs and discount floors",
      who: "merchant",
      unlocks: "Offer proposals that cannot suggest selling at a loss",
    });
  if (!orders)
    gaps.push({
      what: "Order history — connected source or Shopify Admin",
      who: "merchant",
      unlocks:
        "Cross-sell from real co-purchase, replenishment reminders, offer proposals",
    });
  if (!found)
    gaps.push({
      what: "An analysis run — nothing has been proposed yet",
      who: "us",
      unlocks:
        "Incidents and recovery figures in this memory, and the service notices the assistant is " +
        "allowed to pass on when payments are failing",
    });
  else if (foundAge !== null && foundAge > 7)
    gaps.push({
      what: `A fresh analysis — the last one ran ${Math.round(foundAge)} days ago`,
      who: "us",
      unlocks:
        "Findings that describe this week rather than the one before last",
    });
  gaps.push({
    what: "Signed shopper identity",
    who: "us",
    unlocks: "Order status answers, and any memory of a returning shopper",
  });

  return {
    key: opts.site.key,
    name: opts.site.name,
    currency: products[0]?.currency ?? "INR",
    regions: opts.regions ?? ["IN"],
    voice: voice
      ? fact(voice, "merchant", null, settings.updatedAt ?? undefined)
      : null,
    policies: fact(policies, "catalogue", 7),
    catalogue: fact(
      {
        products: products.length,
        variants: products.reduce((s, p) => s + p.variants.length, 0),
        priceMin: prices.length ? Math.min(...prices) : 0,
        priceMax: prices.length ? Math.max(...prices) : 0,
        categories: [
          ...new Set(products.map((p) => p.productType).filter(Boolean)),
        ] as string[],
        outOfStock: products
          .filter((p) => (p.totalInventory ?? 0) === 0)
          .map((p) => p.handle),
      },
      "catalogue",
      // Stock moves. A catalogue snapshot older than a day is a liability, not
      // a memory — which is why nothing downstream may quote from it.
      1,
    ),
    constraints: floors ? fact(floors, "merchant", null) : null,
    commerce: orders ? fact(orders, "orders", 7) : null,
    decisions: fact(
      {
        replies: ledger.filter((e) => e.kind === "reply").length,
        refusals: ledger.filter((e) => e.kind === "refusal").length,
        byGate,
      },
      "ledger",
      null,
    ),
    recoveryOutcomes: fact(
      {
        grantsIssued,
        paidOrders,
        conversionRate: grantsIssued ? paidOrders / grantsIssued : 0,
      },
      "derived",
      null,
    ),
    findings: found
      ? fact(
          {
            incidents: found.incidents,
            topActions: found.topActions,
            stopped: found.stopped,
            recovery: found.recovery,
            reasons: found.reasons ?? null,
            recoveryOutcomes: found.recoveryOutcomes ?? null,
          },
          "derived",
          // A week. Long enough that a weekly run keeps it fresh, short enough
          // that a run which quietly stopped shows up as stale rather than as
          // a confident answer about a month ago.
          7,
          found.ranAt,
        )
      : null,
    serviceNotices: fact(
      found?.serviceNotices ?? [],
      "derived",
      7,
      found?.ranAt,
    ),
    gaps,
  };
}

/* ------------------------------------------------------------------ *
 * Projections
 * ------------------------------------------------------------------ */

export type ShopperView = {
  name: string;
  currency: string;
  voice: string | null;
  policies: ShopPolicies;
  /** Shape only. Never a price or a stock number — those come from a live tool. */
  sells: { categories: string[]; products: number };
  /**
   * Sentences about service, already written and already checked.
   *
   * The single channel from the analysis side to a shopper. Text, not data: the
   * assistant repeats one or it says nothing, and it has no route to the
   * finding that produced it.
   */
  serviceNotices: Array<{ text: string; about: string[] }>;
};

/**
 * What the shopper-facing assistant may know about the shop.
 *
 * Note what is absent: margins, costs, floors, rejected proposals, order
 * volumes. The assistant cannot leak what it was never handed, and that is a
 * stronger guarantee than instructing it not to.
 *
 * Note also that no price or stock number crosses this boundary. The cortex
 * describes the shop; the catalogue tool answers about products. Same rule as
 * shopper memory: the cortex supplies context, tools supply facts.
 */
export function shopperView(c: ShopCortex): ShopperView {
  return {
    name: c.name,
    currency: c.currency,
    voice: c.voice?.value ?? null,
    policies: c.policies.value,
    sells: {
      categories: c.catalogue.value.categories,
      products: c.catalogue.value.products,
    },
    serviceNotices: isStale(c.serviceNotices)
      ? []
      : c.serviceNotices.value.map((n) => ({
          text: n.text,
          about: n.about ?? [],
        })),
  };
}

/** Everything, for merchant-facing tools: the proposer, the console, diagnostics. */
export function merchantView(c: ShopCortex): ShopCortex {
  return c;
}
