/**
 * The feature registry behind the dashboard.
 *
 * Every locked feature states WHAT UNLOCKS IT, not "coming soon". Two reasons:
 * a merchant reading the grid learns what CHAPMAN will eventually do and what
 * it needs from them to do it, and we cannot quietly let a feature drift into
 * looking available when nothing behind it is built.
 *
 * `status` is deliberately not a boolean. "Built but needs the merchant to
 * connect something" is a different conversation from "not built yet", and
 * collapsing them into `locked` would hide the only ones the merchant can act
 * on today.
 *
 * Named `features.ts` rather than `features.server.ts`, and that is not
 * cosmetic. It holds no secret, reads no file and touches no request — it is
 * a list of what exists — and the dashboard renders it in the COMPONENT, not
 * only in the loader. React Router strips server modules out of the client
 * bundle by removing `loader`/`action`, so a `.server` module reached from a
 * component fails the production build outright while dev mode carries on
 * happily. The suffix is a claim about where code may run, and this file was
 * making a claim that was not true.
 */

export type FeatureStatus =
  | "available" // built, working, usable now
  | "needs_setup" // built, but waits on something the merchant must provide
  | "building" // partially built, not usable
  | "planned"; // designed, not built

export type Feature = {
  key: string;
  name: string;
  blurb: string;
  status: FeatureStatus;
  /** For anything not `available`: the precise thing standing in the way. */
  unlockedBy?: string;
  /** Where the design lives, so a claim can be checked against a document. */
  doc?: string;
  href?: string;
};

export const FEATURES: Feature[] = [
  {
    key: "assistant",
    name: "Storefront assistant",
    blurb:
      "A conversational assistant on your store that answers from your real catalogue and policies, and cannot invent a discount or a deadline.",
    status: "available",
    href: "/dashboard/chatbot",
  },
  {
    key: "cortex",
    name: "Shop cortex",
    blurb:
      "One shared memory of your shop that every tool reads from — catalogue shape, policies, your limits, what was said and what was stopped. Worked out from your own data; you type only what we cannot compute.",
    status: "available",
    href: "/dashboard/cortex",
  },
  {
    key: "ledger",
    name: "Decision ledger",
    blurb:
      "Every reply, every refusal, and the reason each gate fired. The record of what was said on your behalf.",
    status: "available",
    href: "/dashboard/ledger",
  },
  {
    key: "orders",
    name: "Order & cart access",
    blurb:
      "Let the assistant answer “where is my order” and pick up an abandoned cart, from your own data.",
    status: "needs_setup",
    unlockedBy:
      "Connect a source. On Shopify this is already granted. On a custom site you publish a read-only JSON endpoint, the same shape as your catalogue feed.",
    doc: "architecture-data-access.md",
  },
  {
    key: "memory",
    name: "Shopper memory",
    blurb:
      "Remember a returning shopper’s preferences — caffeine, brew style, budget — so they do not repeat themselves.",
    status: "planned",
    unlockedBy:
      "Needs the order source above, an opt-in from you, and a vector store. Off by default, and kept apart from the shop cortex — shop knowledge is yours and shared by every tool; a shopper's is theirs and stays in its own store.",
    doc: "architecture-data-access.md",
  },
  {
    key: "offers",
    name: "Offer proposals",
    blurb:
      "Weekly, evidence-backed suggestions for what to promote — with the arithmetic shown, and nothing published until you approve it.",
    status: "available",
    unlockedBy:
      "Live. Seven detectors over your own orders, three floors and a false-discovery guard before anything is shown, and an approval that is the only thing in CHAPMAN that can make a price claim sayable.",
    doc: "architecture-offer-proposer.md",
    href: "/dashboard/offers",
  },
  {
    key: "recovery",
    name: "Basket recovery",
    blurb:
      "Baskets that were never completed, and what — if anything — is worth saying about them. Shows you every message before it goes out, and every basket it decided to leave alone.",
    status: "available",
    unlockedBy:
      "Live as a dry run: it drafts through the same bounds check as your assistant and delivers to a file. " +
      "WhatsApp, SMS and voice each need their own registration before a message can actually leave.",
    doc: "architecture-recovery.md",
    href: "/dashboard/recovery",
  },
  {
    key: "seasonality",
    name: "Festival & event windows",
    blurb:
      "Indian festival dates as data — stock lead times before Dhanteras, and a merchant-approved event window that makes a deadline honest.",
    status: "building",
    unlockedBy: "The calendar and its guardrails are built. The merchant-facing event editor is not.",
    doc: "architecture-offer-proposer.md",
  },
  {
    key: "agent_front",
    name: "Agent-readable storefront",
    blurb:
      "When a shopper’s AI agent reaches your store, it gets a machine surface it can transact against instead of guessing at your HTML.",
    status: "needs_setup",
    unlockedBy:
      "Built and live: 13 operations over UCP 2026-08-25, the same protocol every Shopify store already serves. On a custom site you add one route — /.well-known/ucp on your own domain, proxied from us. On Shopify you need nothing from us at all; you already have it.",
    doc: "architecture-tool-surface.md",
    href: "/dashboard/agentfront",
  },
  {
    key: "payments",
    name: "Payments & binding quotes",
    blurb:
      "An authoritative total and a payment path that works on Indian rails, handed to a shopper or their agent.",
    status: "available",
    unlockedBy:
      "Live for both the browser and agents. Razorpay orders, signature-verified confirmation, a signed webhook, stock held for fifteen minutes, and settlement that is idempotent across all three report paths.",
    doc: "findings-01-api-surface.md",
  },
  {
    key: "voice",
    name: "Voice & messaging outreach",
    blurb: "Deliver recovery messages over WhatsApp, SMS or a call, within the limits you set.",
    status: "building",
    unlockedBy:
      "The agent that decides who to contact and what to say is built and runs today — see Basket recovery. " +
      "What is missing is delivery: WhatsApp needs Business templates approved by Meta, SMS needs a DLT-registered " +
      "sender and template, voice needs a telephony provider and a recorded-consent trail. Each is a registration, " +
      "not a code change.",
    doc: "architecture-recovery.md",
    href: "/dashboard/recovery",
  },
  {
    key: "testbench",
    name: "Test bench",
    blurb:
      "Fire the hard questions at your own assistant and watch what happens. Also checks, by actually fetching them, which of your endpoints each feature needs and what is missing.",
    status: "available",
    href: "/dashboard/testbench",
  },
  {
    key: "diagnostics",
    name: "Diagnostics",
    blurb: "What agents and shoppers asked that we could not answer.",
    status: "planned",
    unlockedBy: "Needs the tool registry, so unanswered calls are recorded as they happen.",
    doc: "architecture-tool-surface.md",
  },
];

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  available: "Available",
  needs_setup: "Needs setup",
  building: "In progress",
  planned: "Planned",
};
