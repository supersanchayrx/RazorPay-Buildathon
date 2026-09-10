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
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    logInfo("shopify.webhook.received", { topic, shop });

    const current = payload.current as string[];
    if (session) {
        await db.session.update({   
            where: {
                id: session.id
            },
            data: {
                scope: current.toString(),
            },
        });
    }
    return new Response();
};
