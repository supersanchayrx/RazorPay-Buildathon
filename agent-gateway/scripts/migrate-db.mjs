/** Apply Chapman's versioned SQLite migrations before accepting traffic. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(project, "app", "lib", "database.server.ts"), "utf8");
const migrations = [...source.matchAll(
  /version:\s*(\d+),\s+name:\s*"([^"]+)",\s+sql:\s*`([\s\S]*?)`,\s+\},/g,
)].map((match) => ({ version: Number(match[1]), name: match[2], sql: match[3] }));
if (!migrations.length) throw new Error("Could not locate the authoritative database migrations.");
const file = path.resolve(
  process.env.CHAPMAN_DATABASE_PATH ||
    path.join(process.env.CHAPMAN_DATA_DIR || path.join(project, "data"), "chapman.sqlite"),
);
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
) STRICT`);
for (const migration of migrations) {
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
    .get(migration.version);
  if (applied) continue;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(migration.sql);
    db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
      .run(migration.version, migration.name, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* original error wins */ }
    throw error;
  }
}
db.prepare("SELECT 1").get();
db.close();
console.log(`chapman: database ready at ${file}`);
