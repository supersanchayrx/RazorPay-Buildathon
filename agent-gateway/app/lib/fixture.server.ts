/** Database-backed synthetic history used only by the opt-in demo seed. */
import { readDocuments, readStoreDocument } from "./database.server";

export const fixtureOrders = <T>(): T[] => readDocuments<T>("seed.orders");
export const fixtureCarts = <T>(): T[] => readDocuments<T>("seed.carts");

export function fixtureInputs<T>(shop?: string): T | null {
  if (shop) return readStoreDocument<T | null>(shop, "merchant.inputs", null);
  return readDocuments<T>("merchant.inputs")[0] ?? null;
}

