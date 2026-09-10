import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const file = path.resolve(
  process.env.CHAPMAN_DATABASE_PATH ||
    path.join(process.env.CHAPMAN_DATA_DIR || "data", "chapman.sqlite"),
);
const db = new DatabaseSync(file, { readOnly: true });
const kind = process.argv[2];
const row = kind
  ? db.prepare("SELECT COUNT(*) AS count FROM store_documents WHERE kind = ?").get(kind)
  : db.prepare("SELECT COUNT(*) AS count FROM stores WHERE configured = 1").get();
db.close();
process.exit(Number(row.count) > 0 ? 0 : 1);
