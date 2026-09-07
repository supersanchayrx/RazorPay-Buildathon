/**
 * Synthetic commercial history for the offer proposer.
 *
 * The proposer's whole job is to find a defensible reason to change a price.
 * It cannot be built, and more importantly cannot be *tested*, against a store
 * with no past. This writes that past.
 *
 * Three rules govern everything below.
 *
 * 1. DETERMINISTIC. A fixed seed drives one PRNG. Re-running with the same
 *    optional TWILIO_TEST_TO produces the same bytes. Without this you cannot
 *    tell whether the proposer's output changed because you improved the
 *    proposer or because the dice rolled differently, and every regression
 *    becomes unfalsifiable.
 *
 * 2. LABELLED. Every record carries `synthetic: true` and the seed that made
 *    it. A synthetic number must never be able to reach a merchant-facing claim
 *    without being detectable as synthetic on inspection. This is the same
 *    discipline as the bounds layer, applied to data rather than to speech.
 *
 * 3. PLANTED, NOT RANDOM. Uniform noise teaches nothing: a proposer that finds
 *    nothing in it is indistinguishable from a broken one. So real signals are
 *    planted here on purpose, and so are two traps that a naive proposer will
 *    fall into. The traps matter more than the signals — see PLANTED below.
 *
 * Run:  node scripts/seed-history.mjs
 * Out:  data/orders.jsonl, data/carts.jsonl, data/merchant-inputs.json
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const SEED = 20260905;
const SHOP = "pk_monsoon_market";
const TODAY = new Date("2026-09-05T00:00:00Z");
const DAYS = 180;
const TEST_PHONE = process.env.TWILIO_TEST_TO?.trim() ?? "";

if (TEST_PHONE && !/^\+[1-9]\d{7,14}$/.test(TEST_PHONE)) {
  throw new Error(
    "TWILIO_TEST_TO must be an E.164 phone number, including the leading +",
  );
}

const OUT = DATA_DIR;
const LOYAL_DEMOS = [
  { customerId: "cus_demo_regular_delivery", cartId: "crt_demo_regular_delivery" },
  { customerId: "cus_demo_loyal_chai", cartId: "crt_demo_loyal_chai" },
  { customerId: "cus_demo_loyal_green", cartId: "crt_demo_loyal_green" },
  { customerId: "cus_demo_loyal_coffee", cartId: "crt_demo_loyal_coffee" },
];

/**
 * Re-seeding is the demo reset button for the planted recovery story.
 *
 * Orders and carts are deterministic, but outreach state intentionally lives
 * in separate append-only files. Without clearing only these planted identities,
 * the first rehearsal puts it inside the normal 30-day cooldown and every
 * subsequent rehearsal has no callback target. Never match the shared test
 * phone here: every synthetic shopper uses it, so doing that would erase the
 * audit trail for the entire fixture.
 */
function resetLoyalDemoRuntime() {
  const files = [
    "outreach-drafts.jsonl",
    "outreach-log.jsonl",
    "recovery-conversations.jsonl",
    "recovery-grants.jsonl",
    "recovery-message-log.jsonl",
    "voice-transcripts.jsonl",
  ];
  let removed = 0;

  for (const name of files) {
    const file = path.join(OUT, name);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const kept = lines.filter((line) => {
      const belongsToDemo = LOYAL_DEMOS.some(
        ({ customerId, cartId }) =>
          line.includes(`\"customerId\":\"${customerId}\"`) ||
          line.includes(`\"cartId\":\"${cartId}\"`),
      );
      if (belongsToDemo) removed += 1;
      return !belongsToDemo;
    });
    if (kept.length !== lines.length) {
      fs.writeFileSync(file, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
    }
  }

  return removed;
}

/* ------------------------------------------------------------------ *
 * PLANTED
 *
 * Signals — things a competent proposer should find:
 *
 *   S1  ceramic-cupping-set moves slowly against a 57% margin. Slow, real room,
 *       and — this took a second pass to get right — enough units to clear the
 *       sample floor. A "signal" below the floor is not a signal, it is a
 *       fourth trap, and the first version of this fixture shipped one by
 *       accident at four units in six months.
 *   S2  masala-chai-blend and single-estate-assam-ctc are bought together far
 *       more often than their tags would predict. Co-purchase beats tag
 *       similarity, which is what `catalog.complements` currently guesses from.
 *   S3  a cohort of ~12 customers reorders MCB-100 on roughly a 30-day cycle.
 *       That is a replenishment offer, not a discount.
 *   S4  netbanking failures cluster on one bank in the last 60 days — ~40%
 *       against a ~6% baseline. That is a routing and recovery problem, and it
 *       is what the voice agent exists for.
 *   S5  abandoned carts skew high-value; the kettle appears in them constantly
 *       and converts almost never.
 *   S6  gifting demand rises in the two weeks before Raksha Bandhan (14–29 Aug
 *       2026). Real seasonality, so the detectors have something to be right
 *       about — and something that must not be mistaken for a trend change.
 *   S7  four named demo shoppers have recent completed orders and abandoned
 *       baskets below free delivery. Every one safely clears the 8% margin
 *       floor, making several recovery-call rehearsals repeatable rather than
 *       lucky.
 *
 * Traps — things a naive proposer will find that are NOT there:
 *
 *   T1  copper-chai-kettle has 3 orders, 2 of them COD. "Kettle buyers prefer
 *       COD" is a 67% rate on n=3. A proposer without a sample-size floor will
 *       propose a COD-exclusive kettle offer off three data points.
 *   T2  cold-brew-concentrate sells fast and is nearly out of stock — every
 *       velocity signal says promote it. Its margin is 14%. A proposer that
 *       reads velocity without reading cost proposes 15% off and books a loss
 *       on every unit.
 *   T3  the Rakhi window itself. Demand climbs into a festival, and a
 *       calendar-driven proposer answers with a festive discount. Every unit it
 *       marks down was already coming — the festival caused the demand, not the
 *       offer. Discounting into a rising window is the "sure things" mistake
 *       with dates in place of people.
 *
 * If the proposer clears T1, T2 and T3 it is worth trusting on the signals. If
 * it does not, the fact that it also found them is luck.
 * ------------------------------------------------------------------ */

/** mulberry32 — small, fast, and stable across Node versions. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p) => rand() < p;

/* ------------------------------------------------------------------ *
 * Merchant-supplied inputs.
 *
 * Cost lives here and NOT in catalog.json, because catalog.json is the public
 * feed the widget reads over the open internet. Unit cost is the one number a
 * merchant cannot afford to leak — it is their negotiating position with every
 * supplier and every buyer. The separation is the point: the proposer needs
 * margin, the shopper-facing surface must never be able to reach it.
 * ------------------------------------------------------------------ */
const UNIT_COST = {
  "NFG-100": 245,
  "NFG-250": 540,
  "AVF-250": 330,
  "AVF-500": 600,
  "MCB-100": 150,
  "MCB-250": 315,
  "SEA-250": 205,
  "SEA-500": 370,
  "CGT-100": 260,
  "CBC-500": 505, // T2: 14% margin on a fast mover
  "CCK-12": 2050, // 16% margin
  "CCS-06": 820, // S1: 57% margin on a slow mover
};

const PRICE = {
  "NFG-100": 480,
  "NFG-250": 1080,
  "AVF-250": 640,
  "AVF-500": 1180,
  "MCB-100": 340,
  "MCB-250": 720,
  "SEA-250": 420,
  "SEA-500": 760,
  "CGT-100": 520,
  "CBC-500": 590,
  "CCK-12": 2450,
  "CCS-06": 1890,
};

const HANDLE = {
  "NFG-100": "nilgiri-frost-green-tea",
  "NFG-250": "nilgiri-frost-green-tea",
  "AVF-250": "araku-valley-filter-coffee",
  "AVF-500": "araku-valley-filter-coffee",
  "MCB-100": "masala-chai-blend",
  "MCB-250": "masala-chai-blend",
  "SEA-250": "single-estate-assam-ctc",
  "SEA-500": "single-estate-assam-ctc",
  "CGT-100": "cardamom-green-tea",
  "CBC-500": "cold-brew-concentrate",
  "CCK-12": "copper-chai-kettle",
  "CCS-06": "ceramic-cupping-set",
};

const TITLE = {
  "nilgiri-frost-green-tea": "Nilgiri Frost Green Tea",
  "araku-valley-filter-coffee": "Araku Valley Filter Coffee",
  "masala-chai-blend": "Masala Chai Blend",
  "single-estate-assam-ctc": "Single Estate Assam CTC",
  "cardamom-green-tea": "Cardamom Green Tea",
  "cold-brew-concentrate": "Cold Brew Concentrate",
  "copper-chai-kettle": "Copper Chai Kettle",
  "ceramic-cupping-set": "Ceramic Cupping Set",
};

/**
 * How often each SKU is the *first* thing in a basket. Not a probability of
 * appearing — attachments below add to this.
 */
const LEAD_WEIGHT = {
  "MCB-100": 30,
  "MCB-250": 14,
  "SEA-250": 12,
  "SEA-500": 6,
  "AVF-250": 13,
  "AVF-500": 6,
  "NFG-100": 8,
  "NFG-250": 4,
  "CGT-100": 5,
  "CBC-500": 9,
  "CCS-06": 5,
  // CCK-12 is absent on purpose. The kettle's only orders are the three planted
  // for T1; letting it also appear in the organic draw grew it to twelve and
  // quietly destroyed both the sample-size trap and the abandonment signal.
};

/** S2 — co-purchase, deliberately not aligned with the tag graph. */
const ATTACH = {
  "MCB-100": [["SEA-250", 0.42]],
  "MCB-250": [["SEA-500", 0.38]],
  "AVF-250": [["CBC-500", 0.3]],
  "AVF-500": [["CBC-500", 0.26]],
  "SEA-250": [["MCB-100", 0.18]],
  "CCS-06": [["NFG-100", 0.45]],
};

const leadTable = (() => {
  const t = [];
  for (const [sku, w] of Object.entries(LEAD_WEIGHT)) {
    for (let i = 0; i < Math.round(w * 10); i++) t.push(sku);
  }
  return t;
})();

/* ------------------------------------------------------------------ *
 * Customers. Email stays fake by construction: `.invalid` is reserved by RFC
 * 2606 and can never resolve. For a controlled voice demo, TWILIO_TEST_TO may
 * replace every synthetic phone number with the presenter's own handset. The
 * value comes from the environment and is never committed.
 * ------------------------------------------------------------------ */
const NAMES = [
  "arjun",
  "meera",
  "kabir",
  "divya",
  "rohan",
  "ananya",
  "vikram",
  "sneha",
  "farhan",
  "ishita",
  "nikhil",
  "priya",
  "aditya",
  "tara",
  "imran",
  "lakshmi",
  "gautam",
  "rhea",
  "sameer",
  "nandini",
  "veer",
  "aisha",
  "manav",
  "kavya",
  "dev",
  "shreya",
  "arnav",
  "pooja",
  "yash",
  "riya",
  "omar",
  "juhi",
  "siddharth",
  "neha",
  "raghav",
  "trisha",
  "aryan",
  "maya",
  "zain",
  "charu",
];

function makeCustomers(n) {
  const cs = [];
  for (let i = 0; i < n; i++) {
    const name = NAMES[i % NAMES.length];
    cs.push({
      id: `cus_syn_${String(i).padStart(3, "0")}`,
      name,
      phone:
        TEST_PHONE || `+9199${String(10000000 + i * 7919).slice(0, 8)}`,
      email: `${name}${i}@example.invalid`,
    });
  }
  return cs;
}
const CUSTOMERS = makeCustomers(140);

/** S3 — the replenishment cohort, a fixed slice so it is easy to look up. */
const REPLENISHERS = CUSTOMERS.slice(0, 12);

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */
const METHOD_MIX = [
  ...Array(46).fill("upi"),
  ...Array(24).fill("card"),
  ...Array(20).fill("netbanking"),
  ...Array(10).fill("cod"),
];

// Weighted, not uniform. Equal weights put only four orders behind the failure
// cluster, which is not a signal, it is a coincidence with a colour.
const BANKS = [
  ...Array(34).fill("HDFC"),
  ...Array(22).fill("ICIC"),
  ...Array(20).fill("SBIN"),
  ...Array(14).fill("AXIS"),
  ...Array(10).fill("KKBK"),
];

/** Razorpay-shaped failure reasons. Real codes, so downstream logic is honest. */
const FAILURES = [
  {
    code: "BAD_REQUEST_ERROR",
    description: "Payment failed at the bank",
    source: "bank",
  },
  {
    code: "GATEWAY_ERROR",
    description: "Gateway timed out",
    source: "gateway",
  },
  {
    code: "BAD_REQUEST_ERROR",
    description: "Insufficient funds",
    source: "customer",
  },
];

function payment(method, dayIndex, total) {
  const daysAgo = DAYS - dayIndex;
  const bank = method === "netbanking" ? pick(BANKS) : null;

  // S4 — one bank, last 60 days, ~40% failure against a ~6% baseline.
  const clustered = method === "netbanking" && bank === "HDFC" && daysAgo <= 60;
  const failRate = method === "cod" ? 0 : clustered ? 0.4 : 0.09;

  const attempts = [];
  let status = "captured";
  if (chance(failRate)) {
    const f = clustered
      ? {
          code: "GATEWAY_ERROR",
          description: "Bank gateway unavailable",
          source: "bank",
        }
      : pick(FAILURES);
    attempts.push({ status: "failed", ...f, bank });
    // Some shoppers retry, most do not. The ones who do not are the voice
    // agent's entire addressable market.
    if (chance(0.35)) attempts.push({ status: "captured", bank });
    else status = "failed";
  } else {
    attempts.push({ status: "captured", bank });
  }

  return {
    method,
    bank,
    status,
    amount: total,
    currency: "INR",
    attempts,
    // COD is captured on delivery, not at checkout. Treating it as an instant
    // capture would overstate the success rate of every other method.
    settled: status === "captured" && method !== "cod",
  };
}

/**
 * An order's status follows its payment, always.
 *
 * Recording a failed payment as a placed order is the quietest possible way to
 * corrupt a dataset: nothing errors, and every metric computed by counting
 * orders instead of captures runs a few percent high forever.
 */
const statusFor = (p) =>
  p.status === "captured" ? "placed" : "payment_failed";

/* ------------------------------------------------------------------ *
 * Baskets and orders
 * ------------------------------------------------------------------ */
function basket() {
  const lead = pick(leadTable);
  const skus = new Set([lead]);
  for (const [sku, p] of ATTACH[lead] ?? []) if (chance(p)) skus.add(sku);
  if (chance(0.12)) skus.add(pick(leadTable));
  return [...skus];
}

function lines(skus) {
  return skus.map((sku) => {
    const qty = chance(0.18) ? 2 : 1;
    return {
      handle: HANDLE[sku],
      title: TITLE[HANDLE[sku]],
      sku,
      qty,
      unitPrice: PRICE[sku],
      unitCost: UNIT_COST[sku],
      lineTotal: PRICE[sku] * qty,
    };
  });
}

function tsOn(dayIndex, hour) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - (DAYS - dayIndex));
  d.setUTCHours(hour, between(0, 59), between(0, 59), 0);
  return d.toISOString();
}

/**
 * Orders per day. A gentle upward trend plus a weekend dip — enough seasonality
 * that "sales are down" is answerable, not so much that it dominates.
 */
function volumeFor(dayIndex) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - (DAYS - dayIndex));
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const trend = 3 + (dayIndex / DAYS) * 2.5;
  return Math.max(
    1,
    Math.round(trend * (weekend ? 0.65 : 1) + (rand() * 2 - 1)),
  );
}

const orders = [];
const carts = [];
let seq = 0;

for (let day = 0; day <= DAYS; day++) {
  const n = volumeFor(day);

  for (let i = 0; i < n; i++) {
    const customer = pick(CUSTOMERS);
    const skus = basket();
    const ls = lines(skus);
    const subtotal = ls.reduce((s, l) => s + l.lineTotal, 0);
    const shipping = subtotal >= 1200 ? 0 : 60;
    const total = subtotal + shipping;
    const method = pick(METHOD_MIX);
    const pay = payment(method, day, total);

    orders.push({
      id: `ord_syn_${String(++seq).padStart(5, "0")}`,
      synthetic: true,
      seed: SEED,
      shop: SHOP,
      ts: tsOn(day, between(8, 22)),
      customer: {
        id: customer.id,
        phone: customer.phone,
        email: customer.email,
      },
      lines: ls,
      subtotal,
      shipping,
      total,
      currency: "INR",
      // The channel split is what makes "agent traffic is growing" a claim we
      // can check rather than assert.
      channel: chance(0.08) ? "agent" : "web",
      payment: pay,
      status: statusFor(pay),
    });
  }

  // S5 — abandoned carts, skewed high-value. The kettle is in a lot of them and
  // converts almost never: interest without conversion is a pricing signal,
  // and it is invisible if you only ever look at orders.
  const abandons = between(0, 2) + (chance(0.3) ? 1 : 0);
  for (let i = 0; i < abandons; i++) {
    const customer = pick(CUSTOMERS);
    const skus = chance(0.4) ? ["CCK-12"] : basket();
    const ls = lines(skus);
    const subtotal = ls.reduce((s, l) => s + l.lineTotal, 0);
    carts.push({
      id: `crt_syn_${String(carts.length + 1).padStart(5, "0")}`,
      synthetic: true,
      seed: SEED,
      shop: SHOP,
      ts: tsOn(day, between(9, 23)),
      customer: {
        id: customer.id,
        phone: customer.phone,
        email: customer.email,
      },
      lines: ls,
      subtotal,
      currency: "INR",
      // Where they stopped. "Reached payment and stopped" is a very different
      // conversation from "browsed and left", and the voice agent needs to know
      // which one it is opening with.
      lastStep: chance(0.45) ? "payment" : chance(0.5) ? "address" : "cart",
      recovered: false,
    });
  }
}

/* S3 — overlay the replenishment cohort on top, so their cadence is clean
   rather than buried in the random draw. */
for (const customer of REPLENISHERS) {
  const offset = between(0, 29);
  for (let day = offset; day <= DAYS; day += between(27, 33)) {
    const ls = lines(chance(0.3) ? ["MCB-100", "SEA-250"] : ["MCB-100"]);
    const subtotal = ls.reduce((s, l) => s + l.lineTotal, 0);
    const shipping = subtotal >= 1200 ? 0 : 60;
    const pay = payment("upi", day, subtotal + shipping);
    orders.push({
      id: `ord_syn_${String(++seq).padStart(5, "0")}`,
      synthetic: true,
      seed: SEED,
      shop: SHOP,
      ts: tsOn(day, between(8, 20)),
      customer: {
        id: customer.id,
        phone: customer.phone,
        email: customer.email,
      },
      lines: ls,
      subtotal,
      shipping,
      total: subtotal + shipping,
      currency: "INR",
      channel: "web",
      payment: pay,
      status: statusFor(pay),
      cohort: "replenish",
    });
  }
}

/* S6 / T3 — Raksha Bandhan gifting lift, 14 Aug to 29 Aug 2026.
   Rakhi is a gifting occasion, so the gift-shaped items move: the cupping set
   and the larger tea tins. Nothing else changes.

   This is planted as a SIGNAL and a TRAP at once, and the trap is the reason it
   exists. A calendar-driven proposer sees demand climbing into a festival and
   reaches for a festive discount. Every unit it discounts was already going to
   sell — the demand is the festival, not the offer. Discounting into a rising
   window is the "sure things" mistake with dates instead of people, and retail
   practice is blunt about it: the deepest cuts belong at the END of a season.

   The window is chosen to sit inside the fixture so the waste is countable
   rather than argued. */
// Day index counts forward to TODAY, so index = DAYS - (days before today).
// 2026-08-14 is 22 days before 2026-09-05, and 2026-08-29 is 7.
const RAKHI = { from: DAYS - 22, to: DAYS - 7 };
const GIFT_SKUS = ["CCS-06", "NFG-250", "MCB-250"];
for (let day = RAKHI.from; day <= RAKHI.to; day++) {
  // A realistic gifting lift is a couple of times baseline, not an order of
  // magnitude. An implausibly loud signal makes detection look easy and teaches
  // the detector nothing about the case that actually matters.
  const extra = between(0, 2) === 2 ? 2 : 1;
  for (let i = 0; i < extra; i++) {
    const customer = pick(CUSTOMERS);
    const skus = [pick(GIFT_SKUS)];
    if (chance(0.25)) skus.push(pick(GIFT_SKUS));
    const ls = lines([...new Set(skus)]);
    const subtotal = ls.reduce((s, l) => s + l.lineTotal, 0);
    const shipping = subtotal >= 1200 ? 0 : 60;
    const pay = payment(pick(METHOD_MIX), day, subtotal + shipping);
    orders.push({
      id: `ord_syn_${String(++seq).padStart(5, "0")}`,
      synthetic: true,
      seed: SEED,
      shop: SHOP,
      ts: tsOn(day, between(9, 21)),
      customer: {
        id: customer.id,
        phone: customer.phone,
        email: customer.email,
      },
      lines: ls,
      subtotal,
      shipping,
      total: subtotal + shipping,
      currency: "INR",
      channel: chance(0.08) ? "agent" : "web",
      payment: pay,
      status: statusFor(pay),
      occasion: "raksha-bandhan-2026",
    });
  }
}

/* T1 — the kettle. Exactly three orders, two on COD. Small on purpose. */
const kettleDays = [22, 74, 141];
for (let k = 0; k < kettleDays.length; k++) {
  const customer = CUSTOMERS[100 + k];
  const ls = lines(["CCK-12"]);
  const subtotal = ls[0].lineTotal;
  const pay = payment(k < 2 ? "cod" : "card", kettleDays[k], subtotal);
  orders.push({
    id: `ord_syn_${String(++seq).padStart(5, "0")}`,
    synthetic: true,
    seed: SEED,
    shop: SHOP,
    ts: tsOn(kettleDays[k], 15),
    customer: { id: customer.id, phone: customer.phone, email: customer.email },
    lines: ls,
    subtotal,
    shipping: 0,
    total: subtotal,
    currency: "INR",
    channel: "web",
    payment: pay,
    status: statusFor(pay),
  });
}

/* S7 — the golden-path recovery call used in the presentation. */
const demoCustomer = {
  id: LOYAL_DEMOS[0].customerId,
  phone: TEST_PHONE || "+919900000777",
  email: "demo.regular@example.invalid",
};
const demoLine = (sku, qty = 1) => ({
  handle: HANDLE[sku],
  title: TITLE[HANDLE[sku]],
  sku,
  qty,
  unitPrice: PRICE[sku],
  unitCost: UNIT_COST[sku],
  lineTotal: PRICE[sku] * qty,
});
const demoAt = (daysAgo, hour) => {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

for (const [i, daysAgo] of [170, 154, 138, 122, 106, 90, 74, 58, 42, 28, 18, 8].entries()) {
  const basketLines = [demoLine(i % 2 === 0 ? "MCB-100" : "SEA-250")];
  const subtotal = basketLines[0].lineTotal;
  const shipping = 60;
  orders.push({
    id: `ord_demo_regular_${String(i + 1).padStart(2, "0")}`,
    synthetic: true,
    seed: SEED,
    shop: SHOP,
    ts: demoAt(daysAgo, 14),
    customer: demoCustomer,
    lines: basketLines,
    subtotal,
    shipping,
    total: subtotal + shipping,
    currency: "INR",
    channel: "web",
    payment: {
      method: "upi",
      bank: null,
      status: "captured",
      amount: subtotal + shipping,
      currency: "INR",
      attempts: [{ status: "captured", bank: null }],
      settled: true,
    },
    status: "placed",
  });
}

const demoCartLines = [demoLine("MCB-250"), demoLine("SEA-250")];
carts.push({
  id: LOYAL_DEMOS[0].cartId,
  synthetic: true,
  seed: SEED,
  shop: SHOP,
  ts: demoAt(0, 18),
  customer: demoCustomer,
  lines: demoCartLines,
  subtotal: demoCartLines.reduce((sum, line) => sum + line.lineTotal, 0),
  currency: "INR",
  lastStep: "address",
  recovered: false,
});

const extraLoyalDemos = [
  {
    customerId: "cus_demo_loyal_chai",
    cartId: "crt_demo_loyal_chai",
    email: "demo.loyal.chai@example.invalid",
    skus: ["MCB-250", "SEA-250"],
  },
  {
    customerId: "cus_demo_loyal_green",
    cartId: "crt_demo_loyal_green",
    email: "demo.loyal.green@example.invalid",
    skus: ["NFG-250"],
  },
  {
    customerId: "cus_demo_loyal_coffee",
    cartId: "crt_demo_loyal_coffee",
    email: "demo.loyal.coffee@example.invalid",
    skus: ["AVF-250", "MCB-100"],
  },
];

for (const [demoIndex, fixture] of extraLoyalDemos.entries()) {
  const customer = {
    id: fixture.customerId,
    phone: TEST_PHONE || `+91990000078${demoIndex}`,
    email: fixture.email,
  };
  for (let i = 0; i < 6; i++) {
    const basketLines = [demoLine(i % 2 === 0 ? "MCB-100" : "SEA-250")];
    const subtotal = basketLines[0].lineTotal;
    orders.push({
      id: `ord_demo_loyal_${demoIndex + 1}_${String(i + 1).padStart(2, "0")}`,
      synthetic: true,
      seed: SEED,
      shop: SHOP,
      ts: demoAt(100 - i * 14 - demoIndex, 13),
      customer,
      lines: basketLines,
      subtotal,
      shipping: 60,
      total: subtotal + 60,
      currency: "INR",
      channel: "web",
      payment: {
        method: "upi",
        bank: null,
        status: "captured",
        amount: subtotal + 60,
        currency: "INR",
        attempts: [{ status: "captured", bank: null }],
        settled: true,
      },
      status: "placed",
    });
  }

  const basketLines = fixture.skus.map((sku) => demoLine(sku));
  carts.push({
    id: fixture.cartId,
    synthetic: true,
    seed: SEED,
    shop: SHOP,
    ts: demoAt(0, 15 - demoIndex),
    customer,
    lines: basketLines,
    subtotal: basketLines.reduce((sum, line) => sum + line.lineTotal, 0),
    currency: "INR",
    lastStep: demoIndex === 1 ? "cart" : "address",
    recovered: false,
  });
}

orders.sort((a, b) => a.ts.localeCompare(b.ts));
carts.sort((a, b) => a.ts.localeCompare(b.ts));

/* ------------------------------------------------------------------ */

fs.mkdirSync(OUT, { recursive: true });
const resetRows = resetLoyalDemoRuntime();

const write = (name, rows) =>
  fs.writeFileSync(
    path.join(OUT, name),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );

write("orders.jsonl", orders);
write("carts.jsonl", carts);

fs.writeFileSync(
  path.join(OUT, "merchant-inputs.json"),
  JSON.stringify(
    {
      synthetic: true,
      seed: SEED,
      shop: SHOP,
      note: "Merchant-supplied. Never served to a shopper surface — unit cost is the merchant's negotiating position.",
      currency: "INR",
      unitCost: UNIT_COST,
      // Floors the merchant sets once. The proposer may not propose past these,
      // and a floor the proposer cannot see is a floor it will cross.
      floors: {
        minMarginPct: 25,
        maxDiscountPct: 20,
        neverDiscount: ["cold-brew-concentrate"],
        minSampleSize: 30,
      },
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

const captured = orders.filter((o) => o.status === "placed");
console.log(
  `seed        ${SEED}  (deterministic — re-running overwrites with identical bytes)`,
);
console.log(
  `orders      ${orders.length}  (${captured.length} placed, ${orders.length - captured.length} payment_failed)`,
);
console.log(`carts       ${carts.length} abandoned`);
console.log(
  `revenue     INR ${captured.reduce((s, o) => s + o.total, 0).toLocaleString("en-IN")}`,
);
console.log(
  `window      ${orders[0].ts.slice(0, 10)} .. ${orders[orders.length - 1].ts.slice(0, 10)}`,
);
console.log(
  `written     data/orders.jsonl, data/carts.jsonl, data/merchant-inputs.json`,
);
console.log(`demo reset  ${resetRows} prior loyal-shopper runtime rows removed`);
