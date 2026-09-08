/**
 * Browser-safe CSV -> Chapman catalogue conversion.
 *
 * One CSV row represents one variant. Rows sharing a handle are folded into a
 * single product, which is the least surprising shape for spreadsheet users
 * and maps directly onto the public catalogue contract.
 */

export const CATALOG_CSV_HEADERS = [
  "handle",
  "title",
  "description",
  "type",
  "vendor",
  "tags",
  "image",
  "url",
  "variant_title",
  "price",
  "sku",
  "in_stock",
  "inventory",
  "currency",
] as const;

export const CATALOG_CSV_SAMPLE =
  `${CATALOG_CSV_HEADERS.join(",")}\n` +
  'nilgiri-green-tea,Nilgiri Green Tea,"Bright, clean whole-leaf tea",Green Tea,Monsoon Market,tea|green,/images/green-tea.jpg,/products/nilgiri-green-tea,100 g,480,NFG-100,true,42,INR\n' +
  'nilgiri-green-tea,Nilgiri Green Tea,"Bright, clean whole-leaf tea",Green Tea,Monsoon Market,tea|green,/images/green-tea.jpg,/products/nilgiri-green-tea,250 g,1080,NFG-250,true,18,INR\n';

export type GeneratedCatalog = {
  shop: { currency: string };
  products: Array<{
    handle: string;
    title: string;
    description?: string;
    type?: string;
    vendor?: string;
    tags?: string[];
    image?: string;
    url?: string;
    variants: Array<{
      title: string;
      price: number;
      sku?: string;
      inStock: boolean;
      inventory?: number;
    }>;
  }>;
};

export type CatalogCsvResult =
  | {
      ok: true;
      catalog: GeneratedCatalog;
      rows: number;
      products: number;
      variants: number;
      warnings: string[];
    }
  | { ok: false; errors: string[] };

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) throw new Error("The CSV ends inside a quoted value.");
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

const textOrUndefined = (value: string | undefined) => {
  const clean = value?.trim();
  return clean ? clean : undefined;
};

const booleanValue = (value: string, row: number): boolean => {
  const clean = value.trim().toLowerCase();
  if (!clean || ["true", "yes", "1"].includes(clean)) return true;
  if (["false", "no", "0"].includes(clean)) return false;
  throw new Error(`Row ${row}: in_stock must be true or false.`);
};

export function parseCatalogCsv(input: string): CatalogCsvResult {
  let rows: string[][];
  try {
    rows = csvRows(input.replace(/^\uFEFF/, ""));
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  if (rows.length < 2) {
    return {
      ok: false,
      errors: ["Add a header row and at least one product row."],
    };
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const errors: string[] = [];
  const duplicateHeaders = headers.filter(
    (header, index) => header && headers.indexOf(header) !== index,
  );
  if (duplicateHeaders.length) {
    errors.push(
      `Duplicate column: ${[...new Set(duplicateHeaders)].join(", ")}.`,
    );
  }
  for (const required of ["handle", "title", "price"]) {
    if (!headers.includes(required))
      errors.push(`Missing required column: ${required}.`);
  }
  if (errors.length) return { ok: false, errors };

  const value = (cells: string[], name: string) => {
    const index = headers.indexOf(name);
    return index < 0 ? "" : (cells[index] ?? "");
  };
  const products = new Map<string, GeneratedCatalog["products"][number]>();
  const productValues = new Map<string, Record<string, string>>();
  const skus = new Set<string>();
  const currencies = new Set<string>();
  const warnings: string[] = [];
  const productFields = [
    "title",
    "description",
    "type",
    "vendor",
    "tags",
    "image",
    "url",
  ] as const;

  rows.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    const handle = value(cells, "handle").trim();
    const title = value(cells, "title").trim();
    const rawPrice = value(cells, "price").trim();
    if (!handle) errors.push(`Row ${rowNumber}: handle is required.`);
    if (!title) errors.push(`Row ${rowNumber}: title is required.`);
    if (!rawPrice) errors.push(`Row ${rowNumber}: price is required.`);
    if (!handle || !title || !rawPrice) return;

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) {
      errors.push(
        `Row ${rowNumber}: handle must be lowercase and URL-safe, using hyphens.`,
      );
    }
    const price = Number(rawPrice);
    if (!Number.isFinite(price) || price < 0) {
      errors.push(
        `Row ${rowNumber}: price must be a non-negative number in major units.`,
      );
    }

    const currency = (value(cells, "currency").trim() || "INR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push(
        `Row ${rowNumber}: currency must be a three-letter ISO code such as INR.`,
      );
    }
    currencies.add(currency);

    const inventoryText = value(cells, "inventory").trim();
    const inventory = inventoryText === "" ? undefined : Number(inventoryText);
    if (
      inventory !== undefined &&
      (!Number.isInteger(inventory) || inventory < 0)
    ) {
      errors.push(
        `Row ${rowNumber}: inventory must be a non-negative whole number or blank.`,
      );
    }

    let inStock = true;
    try {
      inStock = booleanValue(value(cells, "in_stock"), rowNumber);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const sku = textOrUndefined(value(cells, "sku"));
    if (sku && skus.has(sku))
      errors.push(`Row ${rowNumber}: duplicate SKU ${sku}.`);
    if (sku) skus.add(sku);

    let product = products.get(handle);
    const rowProductValues = Object.fromEntries(
      productFields.map((field) => [field, value(cells, field).trim()]),
    );
    if (!product) {
      product = {
        handle,
        title,
        ...(textOrUndefined(rowProductValues.description)
          ? { description: rowProductValues.description }
          : {}),
        ...(textOrUndefined(rowProductValues.type)
          ? { type: rowProductValues.type }
          : {}),
        ...(textOrUndefined(rowProductValues.vendor)
          ? { vendor: rowProductValues.vendor }
          : {}),
        ...(textOrUndefined(rowProductValues.tags)
          ? {
              tags: rowProductValues.tags
                .split("|")
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
          : {}),
        ...(textOrUndefined(rowProductValues.image)
          ? { image: rowProductValues.image }
          : {}),
        ...(textOrUndefined(rowProductValues.url)
          ? { url: rowProductValues.url }
          : {}),
        variants: [],
      };
      products.set(handle, product);
      productValues.set(handle, rowProductValues);
    } else {
      const first = productValues.get(handle)!;
      for (const field of productFields) {
        if (rowProductValues[field] !== first[field]) {
          errors.push(
            `Row ${rowNumber}: ${field} differs from another row for ${handle}. Repeat identical product fields for every variant.`,
          );
        }
      }
    }

    product.variants.push({
      title: textOrUndefined(value(cells, "variant_title")) ?? "Default",
      price,
      ...(sku ? { sku } : {}),
      inStock,
      ...(inventory !== undefined &&
      Number.isInteger(inventory) &&
      inventory >= 0
        ? { inventory }
        : {}),
    });
  });

  if (currencies.size > 1) {
    errors.push(
      `All rows must use one currency; found ${[...currencies].join(", ")}.`,
    );
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };

  if (!headers.includes("currency"))
    warnings.push("Currency column omitted; defaulted to INR.");
  if (!headers.includes("inventory")) {
    warnings.push(
      "Inventory column omitted; Chapman will not quote exact stock counts.",
    );
  }

  const catalog: GeneratedCatalog = {
    shop: { currency: [...currencies][0] ?? "INR" },
    products: [...products.values()],
  };
  return {
    ok: true,
    catalog,
    rows: rows.length - 1,
    products: catalog.products.length,
    variants: catalog.products.reduce(
      (sum, product) => sum + product.variants.length,
      0,
    ),
    warnings,
  };
}

export function catalogJson(catalog: GeneratedCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
