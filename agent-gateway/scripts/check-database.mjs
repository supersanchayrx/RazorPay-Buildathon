/** Clean migration plus backup/mutate/restore drill on a disposable database. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const sandbox = path.join(process.cwd(), "node_modules", ".cache", "database-check");
fs.rmSync(sandbox, { recursive: true, force: true });
fs.mkdirSync(sandbox, { recursive: true });
const live = path.join(sandbox, "chapman.sqlite");
const backup = path.join(sandbox, "backup.sqlite");
const env = { ...process.env, CHAPMAN_DATA_DIR: sandbox, CHAPMAN_DATABASE_PATH: live };
const run = (script, args = []) => execFileSync(process.execPath, [path.join("scripts", script), ...args], {
  cwd: process.cwd(), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

run("migrate-db.mjs");
let db = new DatabaseSync(live);
const migration = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version;
db.prepare(`INSERT INTO stores(id, site_key, configured, created_at, updated_at)
  VALUES ('store_backup_test', 'pk_backup_test', 0, '2026-01-01', '2026-01-01')`).run();
db.exec("DROP TABLE cart_lines; DROP TABLE pending_checkout_lines; DROP TABLE placed_order_lines; DELETE FROM schema_migrations WHERE version = 2");
db.close();
check("a clean database receives every migration", migration >= 2, `schema version ${migration}`);

run("migrate-db.mjs");
db = new DatabaseSync(live, { readOnly: true });
const upgradedStore = Boolean(db.prepare("SELECT 1 FROM stores WHERE site_key = 'pk_backup_test'").get());
const upgradedVersion = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version;
db.close();
check("a populated older schema upgrades without losing rows", upgradedStore && upgradedVersion === migration);

run("backup-db.mjs", [backup]);
check("backup creates a separate snapshot", fs.existsSync(backup) && fs.statSync(backup).size > 0);

db = new DatabaseSync(live);
db.prepare("DELETE FROM stores WHERE site_key = 'pk_backup_test'").run();
db.close();
run("restore-db.mjs", [backup, "--yes"]);

db = new DatabaseSync(live, { readOnly: true });
const restored = Boolean(db.prepare("SELECT 1 FROM stores WHERE site_key = 'pk_backup_test'").get());
const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
db.close();
check("restore recovers data removed after the snapshot", restored);
check("the restored database passes integrity_check", integrity === "ok", String(integrity));
check(
  "restore preserves a verified pre-restore recovery copy",
  fs.readdirSync(path.join(sandbox, "backups")).some((name) => name.startsWith("chapman-before-restore-")),
);

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failed ? `\n${failed} database check(s) failed` : "\nall database checks passed");
process.exit(failed ? 1 : 0);
