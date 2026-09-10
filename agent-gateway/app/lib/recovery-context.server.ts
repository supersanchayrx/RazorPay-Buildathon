/** Shared, server-authoritative inputs for every recovery surface. */
import { liveCarts } from "./carts.server";
import type { MerchantInputs } from "./detectors.server";
import { readDocuments, readStoreDocument } from "./database.server";

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

  return readDocuments<RecoveryCart>("seed.carts")
    .find((cart) => cart.id === cartId && (cart as RecoveryCart & { shop?: string }).shop === shop) ?? null;
}

/** Unit costs and merchant floors never cross into shopper-facing context. */
export function readRecoveryInputs(shop: string): MerchantInputs | null {
  return readStoreDocument<MerchantInputs | null>(shop, "merchant.inputs", null);
}
