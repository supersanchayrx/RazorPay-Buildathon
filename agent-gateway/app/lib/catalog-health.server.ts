export type CatalogHealth = {
  ok: boolean;
  products: number;
  variants: number;
  detail: string;
};

export async function inspectCatalog(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<CatalogHealth> {
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        products: 0,
        variants: 0,
        detail: `The configured URL returned HTTP ${response.status}.`,
      };
    }
    const body = (await response.json()) as { products?: unknown };
    if (!Array.isArray(body?.products)) {
      return {
        ok: false,
        products: 0,
        variants: 0,
        detail:
          "The configured URL did not return an object with a products list.",
      };
    }
    const products = body.products.length;
    const variants = body.products.reduce((count, product) => {
      if (!product || typeof product !== "object") return count;
      const productVariants = (product as { variants?: unknown }).variants;
      return (
        count + (Array.isArray(productVariants) ? productVariants.length : 0)
      );
    }, 0);
    if (products === 0 || variants === 0) {
      return {
        ok: false,
        products,
        variants,
        detail: "The catalogue has no sellable products with variants yet.",
      };
    }
    return {
      ok: true,
      products,
      variants,
      detail: `${products} products and ${variants} variants are reachable.`,
    };
  } catch (error) {
    return {
      ok: false,
      products: 0,
      variants: 0,
      detail:
        error instanceof Error
          ? `The configured catalogue is unreachable: ${error.message}`
          : "The configured catalogue is unreachable.",
    };
  }
}
