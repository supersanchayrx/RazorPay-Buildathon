import type { GeneratedCatalog } from "./catalog-csv";

export type CatalogCrawlResponse =
  | {
      ok: true;
      catalog: GeneratedCatalog;
      pagesScanned: number;
      productsFound: number;
      variantsFound: number;
      warnings: string[];
    }
  | { ok: false; error: string };
