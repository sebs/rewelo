import { readFileSync } from "fs";
import { resolve } from "path";
import { DB } from "./connection.js";

function schemaPath(): string {
  return resolve(__dirname, "../../db/create.sql");
}

export async function migrate(db: DB): Promise<void> {
  const exists = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'"
  );

  if (exists.length === 0) {
    const sql = readFileSync(schemaPath(), "utf-8");
    await db.exec(sql);
  }
}
