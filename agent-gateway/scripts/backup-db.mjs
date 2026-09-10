/** Create a consistent, integrity-checked SQLite snapshot with VACUUM INTO. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(
  process.env.CHAPMAN_DATABASE_PATH ||
    path.join(process.env.CHAPMAN_DATA_DIR || path.join(project, "data"), "chapman.sqlite"),
);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.resolve(process.argv[2] || path.join(path.dirname(source), "backups", `chapman-${stamp}.sqlite`));

if (!fs.existsSync(source)) throw new Error(`Chapman database does not exist: ${source}`);
if (source === target) throw new Error("Backup target must differ from the live database.");
if (fs.existsSync(target)) throw new Error(`Backup target already exists: ${target}`);
fs.mkdirSync(path.dirname(target), { recursive: true });

const quoted = target.replaceAll("'", "''");
const db = new DatabaseSync(source);
try {
  const integrity = db.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") throw new Error(`Source integrity check failed: ${integrity.integrity_check}`);
  db.exec(`VACUUM INTO '${quoted}'`);
} finally {
  db.close();
}

const backup = new DatabaseSync(target, { readOnly: true });
try {
  const integrity = backup.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") throw new Error(`Backup integrity check failed: ${integrity.integrity_check}`);
  backup.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get();
} finally {
  backup.close();
}
console.log(`chapman: backup verified at ${target}`);
