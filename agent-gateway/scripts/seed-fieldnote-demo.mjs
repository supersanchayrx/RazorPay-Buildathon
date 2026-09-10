/** Seed the Vercel Fieldnote storefront with controlled, synthetic demo data. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { buildFieldnoteSeed, FIELDNOTE_SHOP } from "./fieldnote-seed-lib.mjs";

const cache = path.join(process.cwd(), "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });

async function bundle(entry, filename) {
  const outfile = path.join(cache, filename);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

const DBS = await bundle("app/lib/database.server.ts", "seed-fieldnote-db.mjs");
const SITES = await bundle("app/lib/sites.server.ts", "seed-fieldnote-sites.mjs");
const MEMORY = await bundle("app/lib/memory.server.ts", "seed-fieldnote-memory.mjs");

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? String(args[at + 1] ?? "").trim() : "";
};
const shop = valueAfter("--shop") || FIELDNOTE_SHOP;
if (shop !== FIELDNOTE_SHOP) throw new Error(`This seed is scoped to ${FIELDNOTE_SHOP}.`);

const site = SITES.findSite(shop);
if (!site) throw new Error(`${shop} is not configured. Complete storefront onboarding first.`);
if (!site.secret) throw new Error(`${shop} has no resolvable signing secret.`);

const asOfText = valueAfter("--as-of");
const asOf = asOfText ? new Date(`${asOfText}T12:00:00.000Z`) : new Date();
const seed = buildFieldnoteSeed({
  name: process.env.USERNAME,
  phone: process.env.TWILIO_TEST_TO,
  secret: site.secret,
  asOf,
});

for (const memory of seed.memories) {
  const violations = MEMORY.checkMemory(memory.text);
  if (violations.length) {
    throw new Error(`Seed memory ${memory.id} failed: ${violations.map((v) => v.gate).join(", ")}`);
  }
}

function resetRuntime() {
  let removed = 0;
  const customerIds = seed.profiles.map((profile) => profile.id);
  const cartIds = seed.carts.map((cart) => cart.id);
  DBS.transaction((db) => {
    const storeId = DBS.ensureStore(shop);
    for (const table of ["voice_transcript_turns", "outreach_attempts", "outreach_drafts"]) {
      for (const identifier of [...customerIds, ...cartIds]) {
        removed += Number(db.prepare(`DELETE FROM ${table} WHERE store_id = ? AND payload LIKE ?`)
          .run(storeId, `%${identifier}%`).changes);
      }
    }
    for (const cartId of cartIds) {
      const conversations = db.prepare(
        "SELECT id FROM recovery_conversations WHERE store_id = ? AND cart_id = ?",
      ).all(storeId, cartId);
      for (const conversation of conversations) {
        removed += Number(db.prepare("DELETE FROM recovery_turns WHERE conversation_id = ?")
          .run(conversation.id).changes);
        removed += Number(db.prepare("DELETE FROM recovery_conversations WHERE id = ?")
          .run(conversation.id).changes);
      }
      const grants = db.prepare(
        "SELECT id FROM recovery_grants WHERE store_id = ? AND cart_id = ?",
      ).all(storeId, cartId);
      for (const grant of grants) {
        removed += Number(db.prepare("DELETE FROM grant_events WHERE grant_id = ?").run(grant.id).changes);
        removed += Number(db.prepare("DELETE FROM recovery_grants WHERE id = ?").run(grant.id).changes);
      }
    }
    removed += Number(db.prepare(
      "DELETE FROM shopper_memories WHERE store_id = ? AND id LIKE 'mem_seed_fieldnote_%'",
    ).run(storeId).changes);
  });
  return removed;
}

const resetRows = resetRuntime();
DBS.writeStoreDocument(shop, "seed.orders", seed.orders, "fieldnote-demo-seed");
DBS.writeStoreDocument(shop, "seed.carts", seed.carts, "fieldnote-demo-seed");
DBS.writeStoreDocument(shop, "seed.customer_profiles", seed.profiles.map((profile) => ({
  id: profile.id,
  name: profile.name,
  synthetic: true,
  seed: seed.seed,
})), "fieldnote-demo-seed");
DBS.writeStoreDocument(shop, "merchant.inputs", seed.merchantInputs, "fieldnote-demo-seed");

DBS.transaction((db) => {
  const storeId = DBS.ensureStore(shop);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO shopper_memories(
      id, store_id, subject, kind, text, source, evidence, content_hash,
      created_at, last_used_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const memory of seed.memories) {
    const contentHash = crypto.createHash("sha256").update(memory.text.trim().toLowerCase()).digest("hex");
    insert.run(
      memory.id, storeId, memory.sub, memory.kind, memory.text, memory.source,
      memory.evidence, contentHash, memory.createdAt, memory.lastUsedAt, memory.expiresAt,
    );
  }
});

console.log(`shop        ${shop}`);
console.log(`seed        ${seed.seed} (synthetic; safe to rerun)`);
console.log(`customers   ${seed.profiles.length} (${seed.prominent.name} is the controlled prominent shopper)`);
console.log(`orders      ${seed.orders.length} (${seed.orders.filter((o) => o.customer.id === seed.prominent.id).length} for the prominent shopper)`);
console.log(`carts       ${seed.carts.length} (${seed.carts.filter((c) => c.customer.id === seed.prominent.id).length} for the prominent shopper; recovery selects one)`);
console.log(`memories    ${seed.memories.length} (${seed.memories.filter((m) => m.sub === seed.prominent.id).length} for the prominent shopper)`);
console.log("contact     TWILIO_TEST_TO used only for the controlled shopper; destination not printed");
console.log(`demo reset  ${resetRows} prior Fieldnote demo runtime row(s) removed`);
