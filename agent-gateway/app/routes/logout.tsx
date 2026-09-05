import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { clearCookie } from "../lib/auth.server";

/**
 * Sign-out is a POST, and only a POST.
 *
 * A GET would let any page on the internet sign a merchant out with an
 * `<img src="/logout">`. Harmless as pranks go, but it is the same reasoning
 * that keeps every state change off GET, and the exception is where the habit
 * erodes.
 *
 * So the loader sends a stray GET back to the dashboard and changes nothing.
 * Only the action clears the cookie.
 */
export const action = async (_: ActionFunctionArgs) =>
  redirect("/login", { headers: { "Set-Cookie": clearCookie() } });

export const loader = async (_: LoaderFunctionArgs) => redirect("/dashboard");
