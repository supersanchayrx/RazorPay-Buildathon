/** Shared, server-authoritative inputs for every recovery surface. */
import fs from "node:fs";
import { liveCarts } from "./carts.server";
import type { MerchantInputs } from "./detectors.server";
import { dataPath } from "./paths.server";

export type RecoveryCart = {
  id: string;
  ts: string;
  customer?: { id: string };
  lines: Array<{
    handle: string;
    title: string;
    sku: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal?: number;
};

/** Read the same basket whether the answer arrived on the web or by phone. */
export function readRecoveryCart(
  shop: string,
  cartId: string,
): RecoveryCart | null {
  const live = liveCarts(shop).find((cart) => cart.id === cartId);
  if (live) return live as RecoveryCart;

  try {
    return (
      fs
        .readFileSync(dataPath("carts.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RecoveryCart)
        .find((cart) => cart.id === cartId) ?? null
    );
  } catch {
    return null;
  }
}

/** Unit costs and merchant floors never cross into shopper-facing context. */
export function readRecoveryInputs(): MerchantInputs | null {
  try {
    return JSON.parse(
      fs.readFileSync(dataPath("merchant-inputs.json"), "utf8"),
    ) as MerchantInputs;
  } catch {
    return null;
  }
}
