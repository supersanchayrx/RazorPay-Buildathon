const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DEFAULT_RAZORPAY_REF = Object.freeze({
  keyIdEnv: "RAZORPAY_KEY_ID",
  keySecretEnv: "RAZORPAY_KEY_SECRET",
  webhookSecretEnv: "RAZORPAY_WEBHOOK_SECRET",
});

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Link one registered storefront to environment-variable names.
 *
 * This function never receives a credential value. Keeping the mutation pure
 * makes it possible to prove that a key cannot accidentally be serialised into
 * chapman.config.json.
 */
export function linkRazorpay(config, siteKey, ref = DEFAULT_RAZORPAY_REF) {
  if (!object(config) || !Array.isArray(config.sites)) {
    throw new Error('the config must contain a top-level "sites" list');
  }
  if (!siteKey || typeof siteKey !== "string") {
    throw new Error("a storefront key is required");
  }
  for (const [field, value] of Object.entries(ref)) {
    if (value !== undefined && !ENV_NAME.test(value)) {
      throw new Error(`${field} is not a valid environment-variable name`);
    }
  }

  const matches = config.sites.filter(
    (site) => object(site) && site.key === siteKey,
  );
  if (matches.length === 0) {
    throw new Error(`storefront ${siteKey} is not registered`);
  }
  if (matches.length > 1) {
    throw new Error(`storefront ${siteKey} appears more than once`);
  }

  // Work on a clone. A failed validation or write must leave the caller's
  // in-memory representation exactly as it was.
  const next = structuredClone(config);
  const site = next.sites.find((entry) => entry.key === siteKey);
  const current = object(site.razorpay) ? site.razorpay : null;

  if (
    current &&
    (current.keyIdEnv !== ref.keyIdEnv ||
      current.keySecretEnv !== ref.keySecretEnv)
  ) {
    throw new Error(
      `${siteKey} is already linked to a different Razorpay variable mapping; ` +
        "change it deliberately in the dashboard or config instead of overwriting it here",
    );
  }

  site.razorpay = {
    ...(current ?? {}),
    keyIdEnv: ref.keyIdEnv,
    keySecretEnv: ref.keySecretEnv,
    // A custom existing webhook name remains custom. The canonical name is
    // supplied only when this is a new link or the optional field was absent.
    webhookSecretEnv:
      current?.webhookSecretEnv ?? ref.webhookSecretEnv,
  };

  return {
    config: next,
    changed: JSON.stringify(site.razorpay) !== JSON.stringify(current),
  };
}
