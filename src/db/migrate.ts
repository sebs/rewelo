import { readFileSync } from "fs";
import { resolve } from "path";
import { DB } from "./connection.js";
import { AppError } from "../validation/strings.js";

// Stored in the SQLite header by create.sql ("RWLO"), so we never mistake
// another application's database for ours.
export const APPLICATION_ID = 0x52574c4f;

const SCHEMA_TABLES = [
  "projects",
  "tag_revisions",
  "tags",
  "ticket_relations",
  "ticket_revisions",
  "ticket_tag_changes",
  "ticket_tags",
  "tickets",
  "weight_configs",
];

function schemaPath(): string {
  return resolve(__dirname, "../../db/create.sql");
}

export async function migrate(db: DB): Promise<void> {
  if ((await applicationId(db)) === APPLICATION_ID) return;

  // Decide under the write lock: a concurrent process may be creating the
  // schema right now, and we must see its result rather than race it.
  await db.transaction(async () => {
    const appId = await applicationId(db);
    if (appId === APPLICATION_ID) return;

    const tables = (
      await db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
    ).map((r) => r.name);

    if (appId === 0 && tables.length === 0) {
      await db.exec(readFileSync(schemaPath(), "utf-8"));
      return;
    }

    // Databases created before the application id was introduced
    if (appId === 0 && tables.join() === SCHEMA_TABLES.join()) {
      await db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
      return;
    }

    throw new AppError("The database file is not a rewelo database");
  });
}

async function applicationId(db: DB): Promise<number> {
  const [row] = await db.all<{ application_id: number }>("PRAGMA application_id");
  return row.application_id;
}
