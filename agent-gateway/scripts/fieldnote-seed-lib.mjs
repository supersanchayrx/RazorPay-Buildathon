import crypto from "node:crypto";

export const FIELDNOTE_SHOP = "pk_fieldnote_home";
export const FIELDNOTE_SEED = 20260910;

export function normalizePhone(value) {
  let raw = String(value || "").trim().replace(/[\s()-]/g, "");
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  if (/^\d{10}$/.test(raw)) raw = `+91${raw}`;
  return /^\+[1-9]\d{7,14}$/.test(raw) ? raw : "";
}

export function fieldnoteCustomerId(secret, phone) {
  const normalized = normalizePhone(phone);
  if (!secret || !normalized) throw new Error("A site secret and valid E.164 phone are required.");
  const suffix = crypto.createHmac("sha256", secret)
    .update(`fieldnote-customer.${normalized}`)
    .digest("hex")
    .slice(0, 16);
  return `cus_fieldnote_${suffix}`;
}

const PRODUCTS = [
  { handle: "sola-cane-table-lamp", title: "Sola Cane Table Lamp", sku: "FNH-SOLA-NAT", unitPrice: 3290, unitCost: 1900 },
  { handle: "dune-block-print-throw", title: "Dune Block-Print Throw", sku: "FNH-DUNE-1420", unitPrice: 2450, unitCost: 1400 },
  { handle: "tide-ceramic-carafe", title: "Tide Ceramic Carafe", sku: "FNH-TIDE-1L", unitPrice: 1650, unitCost: 900 },
  { handle: "kora-jute-market-tote", title: "Kora Jute Market Tote", sku: "FNH-KORA-NAT", unitPrice: 1180, unitCost: 650 },
  { handle: "moss-linen-cushion-cover", title: "Moss Linen Cushion Cover", sku: "FNH-MOSS-5555", unitPrice: 940, unitCost: 440 },
  { handle: "mira-brass-incense-holder", title: "Mira Brass Incense Holder", sku: "FNH-MIRA-BRS", unitPrice: 890, unitCost: 450 },
  { handle: "kora-jute-market-tote", title: "Kora Jute Market Tote", sku: "FNH-KORA-FOR", unitPrice: 1280, unitCost: 700 },
  { handle: "moss-linen-cushion-cover", title: "Moss Linen Cushion Cover", sku: "FNH-MOSS-4545", unitPrice: 760, unitCost: 350 },
];

const SUPPORTING_NAMES = [
  "Meera Kapoor", "Arjun Nair", "Kavya Rao", "Rohan Sen", "Tara Mehta", "Imran Shah",
  "Isha Menon", "Dev Malhotra", "Ananya Bose", "Kabir Khanna", "Sneha Iyer", "Vikram Das",
  "Rhea Bhat", "Farhan Ali", "Nandini Jain", "Aditya Pillai", "Maya Sethi", "Sameer Roy",
  "Lakshmi Kini", "Veer Arora", "Aisha Mirza", "Manav Joshi", "Shreya Dutta", "Omar Khan",
  "Priya Anand", "Gautam Suri", "Neha Bedi", "Raghav Kohli", "Trisha Paul", "Zain Merchant",
  "Charu Desai", "Nikhil Grover", "Pooja Reddy", "Yash Verma", "Juhi Saran", "Aryan Bakshi",
  "Riya Thomas", "Siddharth Gill", "Divya Sood", "Aarav Kulkarni", "Mira Wadia", "Karan Ahuja",
  "Leela Prasad", "Naveen Chopra", "Sana Qureshi", "Rahul Chadha", "Tanya Mathur", "Varun Goel",
];

const SUPPORTING_CUSTOMERS = SUPPORTING_NAMES.map((name, index) => ({
  id: `cus_fieldnote_demo_${String(index + 1).padStart(2, "0")}`,
  name,
  // +1 202-555-0100 through 0199 is reserved for fictional use by NANPA.
  phone: `+120255501${String(index + 1).padStart(2, "0")}`,
}));

const PREFERENCES = [
  [
    ["preference", "They prefer natural fibres, cane and warm earthy colours.", "I prefer natural fibres, cane and warm earthy colours."],
    ["context", "They are furnishing a calm reading corner in their home.", "I'm furnishing a calm reading corner in my home."],
    ["habit", "They usually choose handcrafted home accents over mass-produced pieces.", "I usually choose handcrafted home accents over mass-produced pieces."],
    ["preference", "They like soft ambient lighting rather than bright white light.", "I like soft ambient lighting rather than bright white light."],
  ],
  [
    ["preference", "They prefer washed linen and muted greens.", "I prefer washed linen and muted greens."],
    ["context", "They often buy housewarming gifts for close friends.", "I often buy housewarming gifts for close friends."],
  ],
  [
    ["preference", "They like blue-grey ceramics with handmade variation.", "I like blue-grey ceramics with handmade variation."],
    ["habit", "They usually shop for tableware in matching pairs.", "I usually shop for tableware in matching pairs."],
  ],
  [
    ["preference", "They prefer compact decor made from solid brass.", "I prefer compact decor made from solid brass."],
    ["context", "They are decorating a small meditation space.", "I'm decorating a small meditation space."],
  ],
  [
    ["preference", "They like hand-printed textiles in sand and indigo tones.", "I like hand-printed textiles in sand and indigo tones."],
    ["habit", "They usually choose easy-care textiles for everyday use.", "I usually choose easy-care textiles for everyday use."],
  ],
  [
    ["preference", "They prefer structured bags made from natural materials.", "I prefer structured bags made from natural materials."],
    ["context", "They shop for practical pieces for weekend markets.", "I shop for practical pieces for weekend markets."],
  ],
  [
    ["preference", "They like warm bedside lighting with visible craft details.", "I like warm bedside lighting with visible craft details."],
    ["boundary", "They do not want recommendations for smoked finishes.", "Please don't recommend smoked finishes to me."],
  ],
  [
    ["preference", "They prefer larger cushion covers with concealed zips.", "I prefer larger cushion covers with concealed zips."],
    ["habit", "They usually refresh one room at a time.", "I usually refresh one room at a time."],
  ],
  [
    ["preference", "They like simple pieces that mix wood and woven cane.", "I like simple pieces that mix wood and woven cane."],
    ["context", "They are setting up a guest bedroom.", "I'm setting up a guest bedroom."],
  ],
];

function preferencesFor(customerIndex) {
  if (customerIndex < PREFERENCES.length) return PREFERENCES[customerIndex];
  return PREFERENCES[1 + ((customerIndex - 1) % (PREFERENCES.length - 1))];
}

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function isoHoursBefore(asOf, hours, minute = 0) {
  const d = new Date(asOf.getTime() - hours * 3_600_000);
  d.setUTCMinutes(minute, 0, 0);
  return d.toISOString();
}

function line(product, qty = 1) {
  return {
    handle: product.handle,
    title: product.title,
    sku: product.sku,
    qty,
    unitPrice: product.unitPrice,
    unitCost: product.unitCost,
    lineTotal: product.unitPrice * qty,
  };
}

function safeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

export function buildFieldnoteSeed({ name, phone, secret, asOf = new Date() }) {
  const prominentName = safeName(name);
  const prominentPhone = normalizePhone(phone);
  if (!prominentName) throw new Error("USERNAME is empty.");
  if (!prominentPhone) throw new Error("TWILIO_TEST_TO must be a valid E.164 phone number.");
  if (!secret) throw new Error("The Fieldnote site secret could not be resolved.");
  if (Number.isNaN(asOf.getTime())) throw new Error("The seed date is invalid.");

  const prominent = {
    id: fieldnoteCustomerId(secret, prominentPhone),
    name: prominentName,
    phone: prominentPhone,
  };
  const profiles = [prominent, ...SUPPORTING_CUSTOMERS].map((customer, index) => ({
    ...customer,
    email: `${index === 0 ? "presenter" : customer.name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@example.invalid`,
    synthetic: true,
    seed: FIELDNOTE_SEED,
  }));

  const rand = rng(FIELDNOTE_SEED);
  const orders = [];
  let orderSequence = 0;
  const makeOrder = (customer, product, ageHours, extra, fail = false) => {
      const basketLines = [line(product, rand() < 0.14 ? 2 : 1)];
      // Dune + Moss is an intentionally planted co-purchase pattern.
      if (extra) basketLines.push(line(extra));
      const subtotal = basketLines.reduce((sum, item) => sum + item.lineTotal, 0);
      const shipping = subtotal >= 1200 ? 0 : 90;
      const total = subtotal + shipping;
      orders.push({
        id: `ord_fieldnote_${String(++orderSequence).padStart(3, "0")}`,
        synthetic: true,
        seed: FIELDNOTE_SEED,
        shop: FIELDNOTE_SHOP,
        ts: isoHoursBefore(asOf, ageHours, Math.floor(rand() * 59)),
        customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email },
        lines: basketLines,
        subtotal,
        shipping,
        total,
        currency: "INR",
        channel: rand() < 0.11 ? "agent" : "web",
        payment: {
          method: rand() < 0.57 ? "upi" : rand() < 0.74 ? "card" : "netbanking",
          bank: fail ? "HDFC" : null,
          status: fail ? "failed" : "captured",
          amount: total,
          currency: "INR",
          attempts: [fail
            ? { status: "failed", bank: "HDFC", code: "GATEWAY_ERROR", description: "Bank gateway unavailable", source: "bank" }
            : { status: "captured", bank: null }],
          settled: !fail,
        },
        status: fail ? "payment_failed" : "placed",
      });
  };

  // Six months of deterministic background trade. The prominent shopper is
  // overlaid below rather than sampled, so their story stays exact on reruns.
  for (let daysAgo = 180; daysAgo >= 0; daysAgo -= 1) {
    const day = new Date(asOf.getTime() - daysAgo * 86_400_000).getUTCDay();
    const weekend = day === 0 || day === 6;
    const volume = weekend ? 1 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 3);
    for (let i = 0; i < volume; i += 1) {
      const customer = profiles[1 + Math.floor(rand() * (profiles.length - 1))];
      const product = rand() < 0.24 ? PRODUCTS[0] : PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
      const extra = product.sku === "FNH-DUNE-1420" && rand() < 0.58
        ? PRODUCTS[rand() < 0.5 ? 4 : 7]
        : rand() < 0.12 ? PRODUCTS[Math.floor(rand() * PRODUCTS.length)] : null;
      const recentHdfcFailure = daysAgo <= 60 && rand() < 0.11;
      makeOrder(customer, product, daysAgo * 24 + 8 + Math.floor(rand() * 14), extra, recentHdfcFailure);
    }
  }

  // Fourteen clean purchases make the controlled identity visibly prominent.
  const prominentOrderAges = [174, 159, 143, 126, 108, 91, 75, 61, 48, 36, 27, 20, 14, 10];
  prominentOrderAges.forEach((daysAgo, index) => {
    const product = PRODUCTS[(index + 1) % PRODUCTS.length];
    const extra = index % 4 === 0 ? PRODUCTS[4] : null;
    makeOrder(prominent, product, daysAgo * 24 + 11, extra, false);
  });

  const carts = [];
  // Historical background abandonment. Sola is overrepresented on purpose so
  // the commercial-analysis surface has a real, planted recovery signal.
  for (let daysAgo = 180; daysAgo >= 1; daysAgo -= 1) {
    const count = rand() < 0.58 ? 1 : 0;
    const bonus = rand() < 0.13 ? 1 : 0;
    for (let i = 0; i < count + bonus; i += 1) {
      const customer = profiles[1 + Math.floor(rand() * (profiles.length - 1))];
      const product = rand() < 0.46 ? PRODUCTS[0] : PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
      const basketLines = [line(product)];
      carts.push({
        id: `crt_fieldnote_history_${String(carts.length + 1).padStart(3, "0")}`,
        synthetic: true,
        seed: FIELDNOTE_SEED,
        shop: FIELDNOTE_SHOP,
        ts: isoHoursBefore(asOf, daysAgo * 24 + 7 + Math.floor(rand() * 15), Math.floor(rand() * 59)),
        customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email },
        lines: basketLines,
        subtotal: basketLines[0].lineTotal,
        currency: "INR",
        lastStep: rand() < 0.43 ? "payment" : rand() < 0.5 ? "address" : "cart",
        recovered: false,
      });
    }
  }

  // Six baskets make the prominent shopper obvious while the recovery policy
  // still selects only one and safely suppresses the other five as duplicates.
  for (let i = 0; i < 6; i += 1) {
    const product = PRODUCTS[i];
    const basketLines = [line(product)];
    carts.push({
      id: `crt_fieldnote_presenter_${i + 1}`,
      synthetic: true,
      seed: FIELDNOTE_SEED,
      shop: FIELDNOTE_SHOP,
      ts: isoHoursBefore(asOf, 26 + i * 17, 20 + i),
      customer: { id: prominent.id, name: prominent.name, phone: prominent.phone, email: profiles[0].email },
      lines: basketLines,
      subtotal: basketLines[0].lineTotal,
      currency: "INR",
      lastStep: i % 2 === 0 ? "payment" : "address",
      recovered: false,
    });
  }

  const memories = profiles.flatMap((customer, customerIndex) =>
    preferencesFor(customerIndex).map(([kind, text, evidence], memoryIndex) => {
      const createdAt = isoHoursBefore(asOf, (8 + customerIndex + memoryIndex) * 24, memoryIndex);
      return {
        id: `mem_seed_fieldnote_${customerIndex}_${memoryIndex}`,
        shop: FIELDNOTE_SHOP,
        sub: customer.id,
        kind,
        text,
        source: memoryIndex % 3 === 0 ? "chat" : memoryIndex % 3 === 1 ? "voice" : "recovery",
        evidence,
        createdAt,
        lastUsedAt: createdAt,
        expiresAt: new Date(asOf.getTime() + 180 * 86_400_000).toISOString(),
      };
    }),
  );

  const unitCost = Object.fromEntries(PRODUCTS.map((product) => [product.sku, product.unitCost]));
  return {
    shop: FIELDNOTE_SHOP,
    seed: FIELDNOTE_SEED,
    prominent,
    profiles,
    orders: orders.sort((a, b) => a.ts.localeCompare(b.ts)),
    carts: carts.sort((a, b) => a.ts.localeCompare(b.ts)),
    memories,
    merchantInputs: {
      synthetic: true,
      seed: FIELDNOTE_SEED,
      shop: FIELDNOTE_SHOP,
      note: "Synthetic Fieldnote demo costs. Never expose this merchant-only document to shoppers.",
      currency: "INR",
      unitCost,
      floors: {
        minMarginPct: 25,
        maxDiscountPct: 12,
        neverDiscount: [],
        minSampleSize: 3,
      },
    },
  };
}
