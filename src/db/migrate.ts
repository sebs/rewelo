import { readFileSync } from "fs";
import { resolve } from "path";
import { DB } from "./connection.js";
import { AppError } from "../validation/strings.js";

// Stored in the SQLite header by create.sql ("RWLO"), so we never mistake
// another application's database for ours.
export const APPLICATION_ID = 0x52574c4f;

// Tables of the first SQLite schema (version 1), which predates the
// application id and user_version.
const VERSION_1_TABLES = [
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

// Upgrades for existing databases, applied in order. db/create.sql always
// holds the complete current schema and sets user_version to SCHEMA_VERSION.
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 2,
    sql: `CREATE TABLE ticket_deletions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      ticket_id  INTEGER NOT NULL,
      title      TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
  },
  {
    // Tag changes remember the tag's name at the time, so a later rename
    // doesn't rewrite history. Existing rows get the name the tag had then:
    // the first rename after the change recorded it in tag_revisions.
    version: 3,
    sql: `CREATE TABLE ticket_tag_changes_v3 (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id  INTEGER NOT NULL,
      tag_id     INTEGER NOT NULL,
      prefix     TEXT NOT NULL,
      value      TEXT NOT NULL,
      action     TEXT NOT NULL CHECK (action IN ('added', 'removed')),
      changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO ticket_tag_changes_v3 (id, ticket_id, tag_id, prefix, value, action, changed_at)
    SELECT c.id, c.ticket_id, c.tag_id,
      coalesce(
        (SELECT r.prefix FROM tag_revisions r WHERE r.tag_id = c.tag_id AND r.revised_at > c.changed_at ORDER BY r.revised_at, r.id LIMIT 1),
        (SELECT t.prefix FROM tags t WHERE t.id = c.tag_id), ''),
      coalesce(
        (SELECT r.value FROM tag_revisions r WHERE r.tag_id = c.tag_id AND r.revised_at > c.changed_at ORDER BY r.revised_at, r.id LIMIT 1),
        (SELECT t.value FROM tags t WHERE t.id = c.tag_id), ''),
      c.action, c.changed_at
    FROM ticket_tag_changes c;
    DROP TABLE ticket_tag_changes;
    ALTER TABLE ticket_tag_changes_v3 RENAME TO ticket_tag_changes;`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function schemaPath(): string {
  return resolve(__dirname, "../../db/create.sql");
}

export async function migrate(db: DB): Promise<void> {
  if ((await pragma(db, "application_id")) === APPLICATION_ID) {
    const version = await pragma(db, "user_version");
    // A newer rewelo may have changed the schema in ways this one would
    // misread or damage
    if (version > SCHEMA_VERSION) {
      throw new AppError(
        `The database uses schema version ${version}, but this rewelo supports up to version ${SCHEMA_VERSION}. Upgrade rewelo to open it.`
      );
    }
    if (version === SCHEMA_VERSION) return;
  }

  // Decide under the write lock: a concurrent process may be creating the
  // schema right now, and we must see its result rather than race it.
  await db.transaction(async () => {
    if ((await pragma(db, "application_id")) !== APPLICATION_ID) {
      const appId = await pragma(db, "application_id");
      const tables = (
        await db.all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
      ).map((r) => r.name);

      if (appId === 0 && tables.length === 0) {
        await db.exec(readFileSync(schemaPath(), "utf-8"));
        return;
      }
      if (appId !== 0 || tables.join() !== VERSION_1_TABLES.join()) {
        throw new AppError("The database file is not a rewelo database");
      }
      // A version 1 database created before the application id existed
      await db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
    }

    const version = await pragma(db, "user_version");
    for (const m of MIGRATIONS) {
      if (m.version > version) await db.exec(m.sql);
    }
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

async function pragma(db: DB, name: "application_id" | "user_version"): Promise<number> {
  const [row] = await db.all<Record<string, number>>(`PRAGMA ${name}`);
  return row[name];
}
