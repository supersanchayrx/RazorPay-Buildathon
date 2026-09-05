/**
 * What `tools/list` returns.
 *
 * These descriptions are read by a language model deciding which call to make,
 * which makes them prompt text, not documentation. Two consequences shaped how
 * they are written:
 *
 * 1. THE MONEY WARNING IS REPEATED ON EVERY PRICED METHOD. Shopify's own
 *    endpoint does the same — every one of their tool descriptions restates
 *    that amounts are minor units, with worked examples. It reads as redundant
 *    to a human and is essential for a model, because the model may only ever
 *    see one of these descriptions in its context. A single note in a preamble
 *    is a note the model will not have.
 *
 * 2. THEY STATE WHAT WILL BE IGNORED. `create_checkout` says outright that any
 *    price sent will be discarded and the catalogue re-read. Telling a model
 *    "this field is not read" prevents a whole class of confident, wrong
 *    behaviour — an agent that believes it negotiated a price will tell the
 *    buyer so, and the buyer will arrive at the payment page to find a
 *    different number.
 *
 * The schemas mirror `mcp.openrpc.json` for 2026-08-25. Where a field is marked
 * `ucp_request: "omit"` in the spec it is absent here: describing a field we
 * will not read is an invitation to send it.
 */

const AMOUNTS = `

Prices are integers in the currency's ISO 4217 minor units, paired with a currency code: {"amount": 34000, "currency": "INR"} is ₹340.00. Divide by 100 for INR before quoting a figure to a buyer.`;

const meta = {
  type: "object",
  description: "Request metadata. The agent profile is fetched and logged.",
  properties: {
    "ucp-agent": {
      type: "object",
      properties: {
        profile: {
          type: "string",
          format: "uri",
          description:
            "URL of your UCP agent profile document. It MUST be reachable: checkout and completion are refused when it is not, because a merchant holding stock for you is entitled to know who asked.",
        },
      },
      required: ["profile"],
    },
    "idempotency-key": {
      type: "string",
      description: "Unique key for retry safety. Maps to the Idempotency-Key header.",
    },
  },
  required: ["ucp-agent"],
} as const;

const lineItems = {
  type: "array",
  description:
    "Line items. Full replacement on update — send the complete basket, not a delta. Identify each item by variant id, SKU, or product handle.",
  items: {
    type: "object",
    required: ["item", "quantity"],
    properties: {
      item: {
        type: "object",
        required: ["id"],
        properties: {
          id: {
            type: "string",
            description:
              "Variant id (gid://chapman/Variant/SKU), product id (gid://chapman/Product/handle), a bare SKU, or a bare handle.",
          },
        },
      },
      quantity: { type: "integer", minimum: 1, description: "Whole units. Fractions are refused, not rounded." },
    },
  },
} as const;

const buyer = {
  type: "object",
  description: "Optional buyer details, used for the order record only.",
  properties: {
    first_name: { type: "string" },
    last_name: { type: "string" },
    email: { type: "string" },
    phone_number: { type: "string" },
  },
} as const;

const idParam = (what: string) => ({ type: "string", description: `The id of the ${what}.` });

export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const obj = (props: Record<string, unknown>, required: string[]) => ({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: props,
  required,
});

export const TOOLS: ToolDescriptor[] = [
  {
    name: "search_catalog",
    description:
      "Search this merchant's catalogue. `query` is free text; `filters` are hard exclusions (results failing them are dropped); `context` carries soft locality signals. Returns products with variants and availability." +
      AMOUNTS,
    inputSchema: obj(
      {
        meta,
        catalog: {
          type: "object",
          properties: {
            query: { type: "string", description: "Free-text search query." },
            filters: {
              type: "object",
              properties: {
                price: {
                  type: "object",
                  properties: { min: { type: "integer" }, max: { type: "integer" } },
                  description: "Price bounds in minor units.",
                },
                available: { type: "boolean", description: "True to exclude out-of-stock items." },
              },
            },
            pagination: {
              type: "object",
              properties: {
                limit: { type: "integer", minimum: 1, description: "Page size, default 10, max 50." },
                cursor: { type: "string", description: "Opaque cursor from a previous response." },
              },
            },
          },
        },
      },
      ["meta", "catalog"],
    ),
  },
  {
    name: "lookup_catalog",
    description:
      "Look up several products or variants at once by identifier. Each returned variant carries `inputs`, saying which identifier you sent resolved to it and how. Identifiers that matched nothing come back as messages rather than being silently dropped." +
      AMOUNTS,
    inputSchema: obj(
      {
        meta,
        catalog: {
          type: "object",
          required: ["ids"],
          properties: {
            ids: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
              description: "Product ids, variant ids, SKUs, or handles.",
            },
          },
        },
      },
      ["meta", "catalog"],
    ),
  },
  {
    name: "get_product",
    description:
      "Full detail for one product, including every variant with its own price and availability. Use after a search when the buyer is choosing between sizes or weights." +
      AMOUNTS,
    inputSchema: obj(
      {
        meta,
        catalog: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "Product id, variant id, SKU, or handle." },
          },
        },
      },
      ["meta", "catalog"],
    ),
  },
  {
    name: "create_cart",
    description:
      "Create a priced cart. A cart is exploration: it costs the buyer nothing and HOLDS NO STOCK, so use it freely while comparing. Totals come back priced by the merchant." +
      AMOUNTS,
    inputSchema: obj(
      {
        meta,
        cart: { type: "object", properties: { line_items: lineItems, buyer }, required: ["line_items"] },
      },
      ["meta", "cart"],
    ),
  },
  {
    name: "get_cart",
    description: "Re-price an existing cart. Prices and availability move; a cart is not a promise." + AMOUNTS,
    inputSchema: obj({ meta, id: idParam("cart") }, ["meta", "id"]),
  },
  {
    name: "update_cart",
    description:
      "Replace a cart's contents. `line_items` is a FULL REPLACEMENT, not a patch — send every line you want to keep." +
      AMOUNTS,
    inputSchema: obj(
      { meta, id: idParam("cart"), cart: { type: "object", properties: { line_items: lineItems, buyer } } },
      ["meta", "id", "cart"],
    ),
  },
  {
    name: "cancel_cart",
    description: "Discard a cart. Nothing was held, so this frees nothing — it is tidiness, not a release.",
    inputSchema: obj({ meta, id: idParam("cart") }, ["meta", "id"]),
  },
  {
    name: "create_checkout",
    description:
      "Open a checkout. Unlike a cart this DOES hold stock, for fifteen minutes, and requires a reachable agent profile. " +
      "The basket is re-priced from the catalogue at this moment: any price you send is ignored, so do not tell the buyer a total until this returns one. " +
      "Expect `status: \"requires_escalation\"` with a `continue_url` — this merchant settles through Razorpay on Indian rails, where UPI authenticates the payer in their own banking app and cannot be completed by an agent holding a token. Give the buyer the link. " +
      "Cancel promptly if the buyer changes their mind, so the units go back on sale." +
      AMOUNTS,
    inputSchema: obj(
      {
        meta,
        checkout: {
          type: "object",
          properties: {
            line_items: lineItems,
            cart_id: {
              type: "string",
              description:
                "Convert an existing cart. When given, the cart's contents are used and any line_items here are ignored.",
            },
            buyer,
          },
        },
      },
      ["meta", "checkout"],
    ),
  },
  {
    name: "get_checkout",
    description:
      "Current state of a checkout. Poll this after handing the buyer the payment link: it turns to `completed` with an `order` once the payment settles, whether the buyer paid in a browser or you completed it yourself." +
      AMOUNTS,
    inputSchema: obj({ meta, id: idParam("checkout") }, ["meta", "id"]),
  },
  {
    name: "update_checkout",
    description:
      "Not supported once a payment order exists: the amount is already registered with the gateway and editing the basket underneath it would make a genuine payment fail its own total check. Cancel and create another instead.",
    inputSchema: obj(
      { meta, id: idParam("checkout"), checkout: { type: "object", properties: { line_items: lineItems, buyer } } },
      ["meta", "id", "checkout"],
    ),
  },
  {
    name: "complete_checkout",
    description:
      "Place the order using a payment you already hold. The only instrument accepted is a Razorpay payment id, as `payment.instruments[0].credential.token` with `handler_id: \"razorpay\"`. " +
      "It is verified against Razorpay, checked to belong to THIS checkout, and checked against the total before any order is written. " +
      "Safe to call repeatedly and safe to call after the buyer already paid in a browser: settlement is idempotent and you get the same order back, never a second one. " +
      "Calling with no instrument is not an error — it returns the escalation link." +
      AMOUNTS,
    inputSchema: obj(
      {
        meta: { ...meta, required: ["ucp-agent", "idempotency-key"] },
        id: idParam("checkout"),
        checkout: {
          type: "object",
          properties: {
            payment: {
              type: "object",
              properties: {
                instruments: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["handler_id", "credential"],
                    properties: {
                      id: { type: "string" },
                      handler_id: { type: "string", enum: ["razorpay"] },
                      type: { type: "string" },
                      credential: {
                        type: "object",
                        required: ["token"],
                        properties: {
                          token: { type: "string", description: "Razorpay payment id, e.g. pay_XXXXXXXX." },
                          type: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      ["meta", "id", "checkout"],
    ),
  },
  {
    name: "cancel_checkout",
    description:
      "Cancel an unpaid checkout and release its stock immediately, instead of waiting out the fifteen-minute hold. Call this when the buyer walks away — it costs you nothing and it costs the merchant a great deal not to.",
    inputSchema: obj(
      { meta: { ...meta, required: ["ucp-agent", "idempotency-key"] }, id: idParam("checkout") },
      ["meta", "id"],
    ),
  },
  {
    name: "get_order",
    description:
      "Read back an order placed through this endpoint. Orders the buyer placed on the merchant's own site are NOT reachable here — those need the buyer's own verified sign-in, because an order number is printed on a receipt and is not proof of who is asking." +
      AMOUNTS,
    inputSchema: obj({ meta, id: idParam("order") }, ["meta", "id"]),
  },
];
