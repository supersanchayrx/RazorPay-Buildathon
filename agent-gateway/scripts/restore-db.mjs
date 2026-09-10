/** Restore a verified SQLite snapshot, preserving a pre-restore recovery copy. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const sourceArg = args.find((arg) => arg !== "--yes");
if (!sourceArg || !args.includes("--yes")) {
  throw new Error("Usage: npm run db:restore -- /path/to/backup.sqlite --yes (stop the gateway first)");
}
const source = path.resolve(sourceArg);
const target = path.resolve(
  process.env.CHAPMAN_DATABASE_PATH ||
    path.join(process.env.CHAPMAN_DATA_DIR || path.join(project, "data"), "chapman.sqlite"),
);
if (!fs.existsSync(source)) throw new Error(`Backup does not exist: ${source}`);
if (source === target) throw new Error("Restore source must differ from the live database.");

const verify = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") throw new Error(`${file}: integrity check failed: ${integrity.integrity_check}`);
    db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get();
  } finally {
    db.close();
  }
};
verify(source);
fs.mkdirSync(path.dirname(target), { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
let recovery = null;
if (fs.existsSync(target)) {
  const live = new DatabaseSync(target);
  try { live.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { live.close(); }
  recovery = path.join(path.dirname(target), "backups", `chapman-before-restore-${stamp}.sqlite`);
  fs.mkdirSync(path.dirname(recovery), { recursive: true });
  const quoted = recovery.replaceAll("'", "''");
  const current = new DatabaseSync(target);
  try { current.exec(`VACUUM INTO '${quoted}'`); } finally { current.close(); }
  verify(recovery);
}

const temporary = `${target}.restore-${process.pid}`;
fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
verify(temporary);
for (const companion of [`${target}-wal`, `${target}-shm`]) {
  if (fs.existsSync(companion)) fs.unlinkSync(companion);
}
if (fs.existsSync(target)) fs.unlinkSync(target);
fs.renameSync(temporary, target);
verify(target);
console.log(`chapman: restored ${target}${recovery ? `; previous database preserved at ${recovery}` : ""}`);
