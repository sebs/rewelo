import { readFileSync } from "fs";
import { resolve } from "path";
import { DB } from "./connection.js";

function schemaPath(): string {
  return resolve(__dirname, "../../db/create.sql");
}

export async function migrate(db: DB): Promise<void> {
  const exists = await db.all(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'rw'"
  );

  if (exists.length === 0) {
    const sql = readFileSync(schemaPath(), "utf-8");
    await db.exec(sql);
    return;
  }

  // Incremental migrations for tables added after initial release
  await migrateTicketRelations(db);
}

async function migrateTicketRelations(db: DB): Promise<void> {
  const tables = await db.all(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'rw' AND table_name = 'ticket_relations'"
  );
  if (tables.length > 0) return;

  await db.exec(`
    CREATE SEQUENCE IF NOT EXISTS rw.ticket_relations_id_seq;

    CREATE TABLE rw.ticket_relations (
        id            INTEGER PRIMARY KEY DEFAULT nextval('rw.ticket_relations_id_seq'),
        project_id    INTEGER NOT NULL REFERENCES rw.projects(id),
        source_id     INTEGER NOT NULL,
        target_id     INTEGER NOT NULL,
        relation_type TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

        UNIQUE (project_id, source_id, target_id, relation_type)
    );
  `);
}
