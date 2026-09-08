import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Divider } from "@astryxdesign/core/Divider";
import { FileInput } from "@astryxdesign/core/FileInput";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  CATALOG_CSV_SAMPLE,
  catalogJson,
  parseCatalogCsv,
  type CatalogCsvResult,
} from "../lib/catalog-csv";

interface ColumnGuide extends Record<string, unknown> {
  column: string;
  requirement: string;
  format: string;
  example: string;
}

const COLUMN_GUIDE: ColumnGuide[] = [
  {
    column: "handle",
    requirement: "Required",
    format: "Unique, stable, lowercase slug",
    example: "green-tea",
  },
  {
    column: "title",
    requirement: "Required",
    format: "Product name; repeat for each variant",
    example: "Green Tea",
  },
  {
    column: "price",
    requirement: "Required",
    format: "Major currency units, never paise",
    example: "480",
  },
  {
    column: "variant_title",
    requirement: "Optional",
    format: "Variant name; defaults to Default",
    example: "100 g",
  },
  {
    column: "sku",
    requirement: "Optional",
    format: "Unique merchant identifier",
    example: "GT-100",
  },
  {
    column: "in_stock",
    requirement: "Optional",
    format: "true or false; defaults to true",
    example: "true",
  },
  {
    column: "inventory",
    requirement: "Optional",
    format: "Whole number; blank means unknown",
    example: "42",
  },
  {
    column: "currency",
    requirement: "Optional",
    format: "One ISO code for the whole file; defaults to INR",
    example: "INR",
  },
  {
    column: "description",
    requirement: "Optional",
    format: "Product prose; repeat exactly for each variant",
    example: "Bright whole-leaf tea",
  },
  {
    column: "type",
    requirement: "Optional",
    format: "Product category",
    example: "Green Tea",
  },
  {
    column: "vendor",
    requirement: "Optional",
    format: "Brand or maker",
    example: "Monsoon Market",
  },
  {
    column: "tags",
    requirement: "Optional",
    format: "Separate multiple tags with a pipe",
    example: "tea|green",
  },
  {
    column: "image",
    requirement: "Optional",
    format: "Absolute URL or storefront-relative path",
    example: "/images/green-tea.jpg",
  },
  {
    column: "url",
    requirement: "Optional",
    format: "Absolute URL or storefront-relative path",
    example: "/products/green-tea",
  },
];

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function CatalogCsvImport() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CatalogCsvResult | null>(null);
  const [reading, setReading] = useState(false);

  const chooseFile = async (selection: File | File[] | null) => {
    const next = Array.isArray(selection) ? (selection[0] ?? null) : selection;
    setFile(next);
    setResult(null);
    if (!next) return;

    setReading(true);
    try {
      setResult(parseCatalogCsv(await next.text()));
    } catch (error) {
      setResult({
        ok: false,
        errors: [
          error instanceof Error ? error.message : "The CSV could not be read.",
        ],
      });
    } finally {
      setReading(false);
    }
  };

  const status = result
    ? result.ok
      ? {
          type: "success" as const,
          message: `${result.products} products and ${result.variants} variants are ready.`,
        }
      : { type: "error" as const, message: result.errors.join(" ") }
    : undefined;

  return (
    <VStack gap={6}>
      <VStack gap={3}>
        <Text weight="semibold">CSV shape</Text>
        <Text color="secondary">
          Use one row per variant. Products with multiple variants use multiple
          rows with the same handle and identical product details. Save the file
          as UTF-8 CSV.
        </Text>
        <Table
          data={COLUMN_GUIDE}
          columns={[
            { key: "column", header: "Column", width: pixel(150) },
            { key: "requirement", header: "Required", width: pixel(100) },
            { key: "format", header: "Format", width: proportional(2) },
            { key: "example", header: "Example", width: proportional(1) },
          ]}
          idKey="column"
          density="compact"
          dividers="rows"
        />
        <CodeBlock
          code={CATALOG_CSV_SAMPLE.trimEnd()}
          language="text"
          title="catalog-template.csv"
          hasCopyButton
          isWrapped
          container="card"
        />
        <HStack gap={2} wrap="wrap">
          <Button
            type="button"
            variant="secondary"
            label="Download CSV template"
            onClick={() =>
              downloadText(
                "catalog-template.csv",
                CATALOG_CSV_SAMPLE,
                "text/csv",
              )
            }
          />
        </HStack>
      </VStack>

      <Divider />

      <FileInput
        label="Import product CSV"
        description="CSV only, up to 5 MB. The file is converted in this browser and is not stored by Chapman."
        value={file}
        onChange={chooseFile}
        accept=".csv,text/csv"
        maxSize={5 * 1024 * 1024}
        mode="dropzone"
        placeholder="Choose or drop a CSV file"
        isLoading={reading}
        status={status}
        statusVariant="detached"
      />

      {result && !result.ok ? (
        <Banner
          status="error"
          title="This CSV cannot be converted yet"
          description={result.errors.join(" ")}
        />
      ) : null}

      {result?.ok ? (
        <Card>
          <VStack gap={5}>
            <VStack gap={2}>
              <Text weight="semibold">Catalogue generated</Text>
              <Text color="secondary">
                {result.products} products from {result.rows} CSV rows, with{" "}
                {result.variants} variants in {result.catalog.shop.currency}.
              </Text>
              {result.warnings.map((warning) => (
                <Text key={warning} type="supporting" color="secondary">
                  {warning}
                </Text>
              ))}
            </VStack>
            <CodeBlock
              code={catalogJson(result.catalog)}
              language="json"
              title="catalog.json preview"
              hasCopyButton
              hasLineNumbers
              maxHeight="24rem"
              container="card"
            />
            <Button
              type="button"
              variant="primary"
              label="Download catalog.json"
              onClick={() =>
                downloadText(
                  "catalog.json",
                  catalogJson(result.catalog),
                  "application/json",
                )
              }
            />
          </VStack>
        </Card>
      ) : null}

      <VStack gap={3}>
        <Text weight="semibold">Host the generated file</Text>
        <List listStyle="decimal" density="spacious">
          <ListItem
            label="Publish catalog.json on your storefront"
            description="For example, place it in a Vercel public directory so it is available at https://your-store.com/catalog.json."
          />
          <ListItem
            label="Open the URL in a private browser window"
            description="It must return the JSON directly without a login, redirect loop, or HTML error page."
          />
          <ListItem
            label="Paste that absolute URL into Catalogue feed URL"
            description="Save Store Configuration, then run Chapman Doctor to verify reachability and shape."
          />
        </List>
      </VStack>
    </VStack>
  );
}
