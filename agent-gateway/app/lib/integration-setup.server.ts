/**
 * Safe, serialisable setup instructions for feature pages.
 *
 * This module is the only place the dashboard asks whether provider variables
 * exist. It returns variable NAMES and booleans, never values. Keeping the
 * provider list beside the runtime names also gives the tests one place to
 * catch an instruction that drifted away from the code that consumes it.
 */
import type {
  EnvironmentRequirement,
  IntegrationSetupGuide,
} from "../components/integration-setup";
import { secret } from "./env.server";
import type { Site } from "./sites.server";

const ROOT_ENV_STEP =
  "Open the .env beside docker-compose.yml in the repository root and add the variables shown above.";
const RESTART_STEP =
  "Apply the new environment and any durable config change with docker compose up -d --force-recreate gateway, then reload this page.";

const variable = (
  name: string,
  purpose: string,
  requirement: EnvironmentRequirement["requirement"],
  placeholder: string,
): EnvironmentRequirement => ({
  name,
  purpose,
  requirement,
  configured: Boolean(secret(name)),
  placeholder,
});

const envExample = (variables: EnvironmentRequirement[]) =>
  // Blank values are deliberate. If a merchant copies the block before they
  // have a key, a visible placeholder must not become a non-empty value that
  // the readiness check mistakes for a configured credential.
  variables.map((entry) => `${entry.name}=`).join("\n");

export function openRouterSetup(
  job: "assistant" | "analyst" | "summariser" | "grader",
): IntegrationSetupGuide {
  const modelVariable = `OPENROUTER_MODEL_${job.toUpperCase()}`;
  const apiKeyRequired = job === "analyst";
  const variables = [
    variable(
      "OPENROUTER_API_KEY",
      apiKeyRequired
        ? "Required to run the merchant analyst. The key stays on the Chapman server."
        : "Adds model-written output. Without it, this feature keeps its deterministic, bounded fallback.",
      apiKeyRequired ? "required" : "recommended",
      "<paste-your-openrouter-key>",
    ),
    variable(
      modelVariable,
      "Optional model override. For a predictable demo, use one funded model your OpenRouter account can access; free model quotas and slugs change independently.",
      "optional",
      "<optional-openrouter-model-id>",
    ),
  ];
  const hasKey = variables[0].configured;
  const title =
    job === "assistant"
      ? "OpenRouter for assistant replies"
      : job === "analyst"
        ? "OpenRouter for the analyst"
        : job === "summariser"
          ? "OpenRouter for memory consolidation"
          : "OpenRouter for model grading";

  return {
    title,
    summary: apiKeyRequired
      ? "The analyst needs a reasoning model to choose and call its read-only tools."
      : "The feature works without a model key; adding one makes the language less templated while the same code-level limits still apply.",
    status: hasKey ? "ready" : apiKeyRequired ? "attention" : "fallback",
    statusLabel: hasKey
      ? "Model configured"
      : apiKeyRequired
        ? "Key required"
        : "Using safe fallback",
    variables,
    envExample: envExample(variables),
    steps: [
      "Create an OpenRouter API key and keep it server-side.",
      ROOT_ENV_STEP,
      "For a predictable live demo, fund the OpenRouter account and set the model override above. Leaving it empty tries free models, which can exhaust their daily quota; removing the API key uses Chapman's deterministic fallback instead.",
      RESTART_STEP,
    ],
    verify:
      "The variable status above changes to Configured. For the assistant, send a message from the storefront; for other jobs, run the action on this page.",
    docs: [
      {
        label: "OpenRouter API key documentation",
        href: "https://openrouter.ai/docs/api/api-reference/api-keys/create-keys",
      },
    ],
  };
}

export function agentDiscoverySetup(serving: boolean): IntegrationSetupGuide {
  return {
    title: "Agent discovery",
    summary:
      "Publishing /.well-known/ucp is a storefront routing change. Chapman does not need a provider API key to serve it.",
    status: serving ? "ready" : "attention",
    statusLabel: serving ? "Discovery live" : "Route not found",
    variables: [],
    envExample: null,
    steps: [
      "Add the generated redirect or proxy rule below to your storefront host.",
      "Deploy the storefront change.",
      "Use Verify install below; Chapman checks the same public path an agent will use.",
    ],
    verify:
      "Verify install must report Working and the storefront's /.well-known/ucp URL must return a UCP discovery document.",
    docs: [],
  };
}

export function razorpaySetup(site: Site): IntegrationSetupGuide {
  const ref = site.razorpay ?? {
    keyIdEnv: "RAZORPAY_KEY_ID",
    keySecretEnv: "RAZORPAY_KEY_SECRET",
    webhookSecretEnv: "RAZORPAY_WEBHOOK_SECRET",
  };
  const variables = [
    variable(
      ref.keyIdEnv,
      "Razorpay Key ID. This public half is passed to Razorpay Checkout.",
      "required",
      "rzp_test_...",
    ),
    variable(
      ref.keySecretEnv,
      "Razorpay Key Secret. It remains server-side and authenticates order creation.",
      "required",
      "<paste-your-razorpay-key-secret>",
    ),
    variable(
      ref.webhookSecretEnv ?? "RAZORPAY_WEBHOOK_SECRET",
      "Secret you choose when registering the Razorpay webhook. Recommended so payment settlement survives a buyer closing the tab.",
      "recommended",
      "<choose-a-webhook-secret>",
    ),
    variable(
      "PUBLIC_ORIGIN",
      "Public HTTPS origin Razorpay can reach. Required for webhooks; localhost cannot receive them.",
      "recommended",
      "https://<your-subdomain>.ngrok-free.app",
    ),
  ];
  const requiredReady = variables
    .filter((entry) => entry.requirement === "required")
    .every((entry) => entry.configured);
  const linked = Boolean(site.razorpay);

  return {
    title: "Razorpay checkout for agents and the storefront",
    summary: linked
      ? "This storefront is linked to the variable names below. Add their values to Docker; never paste a key secret into storefront code."
      : "This storefront was registered without Razorpay. The variables below are the canonical names, but the storefront must also be linked to them in its Chapman configuration.",
    status: linked && requiredReady ? "ready" : "attention",
    statusLabel: !linked
      ? "Storefront not linked"
      : requiredReady
        ? "Checkout configured"
        : "Keys missing",
    variables,
    envExample: envExample(variables),
    steps: [
      "Generate a test Key ID and Key Secret in the Razorpay dashboard.",
      ROOT_ENV_STEP,
      ...(linked
        ? []
        : [
            `From the repository root, run docker compose run --rm gateway npm run site:enable-razorpay -- --site ${site.key}. It stores only the variable names and is safe to run again.`,
          ]),
      "For webhooks, start a public tunnel and set PUBLIC_ORIGIN to its HTTPS URL.",
      `Register <PUBLIC_ORIGIN>/webhooks/razorpay/${site.key} in Razorpay with the same webhook secret.`,
      RESTART_STEP,
    ],
    verify:
      "This page must say Checkout configured and advertise the payment methods your Razorpay account can actually accept. Then use Test bench to check payment readiness.",
    docs: [
      {
        label: "Razorpay API key authentication",
        href: "https://razorpay.com/docs/api/authentication/",
      },
      {
        label: "Razorpay webhook setup",
        href: "https://razorpay.com/docs/payments/dashboard/account-settings/webhooks/",
      },
    ],
  };
}

export function voiceSetup(): IntegrationSetupGuide {
  const variables = [
    variable(
      "SARVAM_API_KEY",
      "Renders the approved recovery message as speech.",
      "required",
      "<paste-your-sarvam-key>",
    ),
    variable(
      "TWILIO_ACCOUNT_SID",
      "Identifies the Twilio account that places the call.",
      "required",
      "AC...",
    ),
    variable(
      "TWILIO_AUTH_TOKEN",
      "Authenticates Twilio API calls and verifies signed Twilio webhooks.",
      "required",
      "<paste-your-twilio-auth-token>",
    ),
    variable(
      "TWILIO_FROM",
      "The Twilio phone number calls are placed from, including country code.",
      "required",
      "+1...",
    ),
    variable(
      "PUBLIC_ORIGIN",
      "Public HTTPS origin Twilio can reach for TwiML and audio. Localhost cannot receive a call webhook.",
      "required",
      "https://<your-subdomain>.ngrok-free.app",
    ),
    variable(
      "VOICE_QUIET_HOURS_TEST_NUMBER",
      "Optional test handset allowed during quiet hours. It must exactly match the number entered in the test form.",
      "optional",
      "+919876543210",
    ),
    variable(
      "OPENROUTER_API_KEY",
      "Optional for conversational calls. Notice-only calls do not need a model.",
      "optional",
      "<optional-openrouter-key>",
    ),
    variable(
      "OPENROUTER_MODEL_ASSISTANT",
      "Optional model override for conversational call turns.",
      "optional",
      "<optional-openrouter-model-id>",
    ),
    variable(
      "OPENROUTER_MODEL_GRADER",
      "Optional model override for classifying free-form recovery answers.",
      "optional",
      "<optional-openrouter-model-id>",
    ),
  ];
  const ready = variables
    .filter((entry) => entry.requirement === "required")
    .every((entry) => entry.configured);

  return {
    title: "Sarvam and Twilio for recovery calls",
    summary:
      "Sarvam creates the audio and Twilio places the call. All five required values must be present before Voice becomes available.",
    status: ready ? "ready" : "attention",
    statusLabel: ready ? "Voice configured" : "Voice keys missing",
    variables,
    envExample: envExample(variables),
    steps: [
      "Create a Sarvam API key and a Twilio account with a voice-capable phone number.",
      "For local Docker, put NGROK_AUTHTOKEN in .env and run docker compose --profile tunnel up -d.",
      "Read the HTTPS tunnel URL from http://localhost:4040/api/tunnels and use it as PUBLIC_ORIGIN.",
      ROOT_ENV_STEP,
      "If you are testing during configured quiet hours, set VOICE_QUIET_HOURS_TEST_NUMBER to the same E.164 number you will enter below.",
      RESTART_STEP,
    ],
    verify:
      "Voice changes to Live in the Channels table below. Keep recovery in dry-run mode until a test call reaches a phone you control.",
    docs: [
      {
        label: "Sarvam API quickstart",
        href: "https://docs.sarvam.ai/api/getting-started/quickstart",
      },
      {
        label: "Twilio credentials",
        href: "https://www.twilio.com/docs/usage/secure-credentials",
      },
    ],
  };
}

export function messagingSetup(): IntegrationSetupGuide {
  const variables = [
    variable(
      "TWILIO_ACCOUNT_SID",
      "Identifies the Twilio account that sends the message.",
      "required",
      "AC...",
    ),
    variable(
      "TWILIO_AUTH_TOKEN",
      "Authenticates the server-side Twilio Messages API request.",
      "required",
      "<paste-your-twilio-auth-token>",
    ),
    variable(
      "TWILIO_FROM",
      "Default Twilio sender. The same number used for calls can be used when it is SMS-capable.",
      "required",
      "+1...",
    ),
    variable(
      "TWILIO_MESSAGING_FROM",
      "Optional SMS-specific sender. It overrides TWILIO_FROM.",
      "optional",
      "+1...",
    ),
    variable(
      "TWILIO_MESSAGING_SERVICE_SID",
      "Optional Messaging Service sender. When set, it is used instead of either From number.",
      "optional",
      "MG...",
    ),
    variable(
      "PUBLIC_ORIGIN",
      "Public HTTPS gateway origin placed in the payment link sent to a phone.",
      "required",
      "https://<your-subdomain>.ngrok-free.app",
    ),
  ];
  const ready =
    variables[0].configured &&
    variables[1].configured &&
    variables[5].configured &&
    (variables[2].configured ||
      variables[3].configured ||
      variables[4].configured);

  return {
    title: "Twilio SMS for discounted payment links",
    summary:
      "The test button adapts to Full and Trial Twilio accounts. Automated discounted-payment SMS needs a Full account because the unique checkout URL cannot fit into Twilio's predefined trial templates.",
    status: ready ? "ready" : "attention",
    statusLabel: ready ? "SMS configured" : "SMS setup incomplete",
    variables,
    envExample: envExample(variables),
    steps: [
      "Use an SMS-capable Twilio sender. Trial accounts can send only Twilio's predefined templates to verified destination numbers.",
      ROOT_ENV_STEP,
      "For local Docker, expose Chapman through the tunnel profile and set PUBLIC_ORIGIN to that HTTPS gateway URL.",
      RESTART_STEP,
      "Use Send test message below first. Chapman detects Trial accounts and uses Twilio's predefined sms_customer_support template automatically.",
      "Upgrade Twilio before enabling automatic discounted-payment links. Trial templates cannot include a per-order Razorpay URL, and Chapman stops before creating an undeliverable order.",
      "For production messaging in India, complete the applicable DLT entity, sender and content-template registration before sending customer traffic.",
    ],
    verify:
      "The status above says SMS configured and the fixed test message reaches a phone you control.",
    docs: [
      {
        label: "Twilio trial SMS",
        href: "https://www.twilio.com/docs/usage/trials/try-out-sms",
      },
      {
        label: "Twilio Messages API",
        href: "https://www.twilio.com/docs/messaging/api/message-resource",
      },
    ],
  };
}
