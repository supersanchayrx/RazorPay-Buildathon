import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logInfo } from "../lib/logging.server";
import { publicBodyFailure, readPublicText } from "../lib/http-security.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    await readPublicText(request.clone(), "webhook");
  } catch (error) {
    const failure = publicBodyFailure(error);
    return Response.json({ error: failure.message, error_code: failure.code }, { status: failure.status });
  }
  const { shop, session, topic } = await authenticate.webhook(request);

  logInfo("shopify.webhook.received", { topic, shop });

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
