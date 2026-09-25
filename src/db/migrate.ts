import { readFileSync } from "fs";
import { resolve } from "path";
import { DB } from "./connection.js";
import { AppError } from "../errors.js";
import { collapseSpaces, truncate } from "../text.js";
import { MAX_PROJECT_NAME, MAX_TICKET_TITLE, validateProjectName, validateTicketTitle } from "../validation/strings.js";

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
const MIGRATIONS: { version: number; sql?: string; run?: (db: DB) => Promise<void> }[] = [
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
  {
    // A shared write order for the event log (timestamps tie within a
    // millisecond). Existing rows are ordered as well as their timestamps allow.
    version: 4,
    sql: `CREATE TABLE IF NOT EXISTS event_order (
        seq    INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL CHECK (source IN ('ticket', 'revision', 'tag_change', 'deletion')),
        row_id INTEGER NOT NULL,
        UNIQUE (source, row_id)
    );
    CREATE TRIGGER IF NOT EXISTS tickets_event_order_insert AFTER INSERT ON tickets
    BEGIN INSERT INTO event_order (source, row_id) VALUES ('ticket', NEW.id); END;
    CREATE TRIGGER IF NOT EXISTS tickets_event_order_delete AFTER DELETE ON tickets
    BEGIN DELETE FROM event_order WHERE source = 'ticket' AND row_id = OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS ticket_revisions_event_order_insert AFTER INSERT ON ticket_revisions
    BEGIN INSERT INTO event_order (source, row_id) VALUES ('revision', NEW.id); END;
    CREATE TRIGGER IF NOT EXISTS ticket_revisions_event_order_delete AFTER DELETE ON ticket_revisions
    BEGIN DELETE FROM event_order WHERE source = 'revision' AND row_id = OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS ticket_tag_changes_event_order_insert AFTER INSERT ON ticket_tag_changes
    BEGIN INSERT INTO event_order (source, row_id) VALUES ('tag_change', NEW.id); END;
    CREATE TRIGGER IF NOT EXISTS ticket_tag_changes_event_order_delete AFTER DELETE ON ticket_tag_changes
    BEGIN DELETE FROM event_order WHERE source = 'tag_change' AND row_id = OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS ticket_deletions_event_order_insert AFTER INSERT ON ticket_deletions
    BEGIN INSERT INTO event_order (source, row_id) VALUES ('deletion', NEW.id); END;
    CREATE TRIGGER IF NOT EXISTS ticket_deletions_event_order_delete AFTER DELETE ON ticket_deletions
    BEGIN DELETE FROM event_order WHERE source = 'deletion' AND row_id = OLD.id; END;
    INSERT OR IGNORE INTO event_order (source, row_id)
    SELECT source, row_id FROM (
      SELECT 'ticket' AS source, id AS row_id, created_at AS ts, 0 AS rank FROM tickets
      UNION ALL SELECT 'revision', id, revised_at, 1 FROM ticket_revisions
      UNION ALL SELECT 'tag_change', id, changed_at, 1 FROM ticket_tag_changes
      UNION ALL SELECT 'deletion', id, deleted_at, 2 FROM ticket_deletions
    ) ORDER BY ts, rank, row_id;`,
  },
  {
    // Project diff must not report a ticket created and deleted after since
    // as deleted: remember when a deleted ticket was created
    version: 5,
    sql: `ALTER TABLE ticket_deletions ADD COLUMN created_at TEXT`,
  },
  {
    // Titles are stored with runs of spaces collapsed since 0.5.1; older ones
    // may still hold "a  b", which export/import can't take back when "a b"
    // exists as well. Collapse them, numbering the clashes: "a b (2)".
    version: 6,
    run: collapseStoredTitles,
  },
  {
    // History is read per ticket: without indexes report times, the event log
    // and history export/import scanned whole tables once per ticket (22 s
    // for 20,000 tickets)
    version: 7,
    sql: `CREATE INDEX IF NOT EXISTS ticket_revisions_ticket ON ticket_revisions (ticket_id);
    CREATE INDEX IF NOT EXISTS ticket_tag_changes_ticket ON ticket_tag_changes (ticket_id);
    CREATE INDEX IF NOT EXISTS ticket_tags_ticket ON ticket_tags (ticket_id);
    CREATE INDEX IF NOT EXISTS tickets_project ON tickets (project_id, created_at);
    CREATE INDEX IF NOT EXISTS tickets_title ON tickets (project_id, title);
    CREATE INDEX IF NOT EXISTS ticket_deletions_project ON ticket_deletions (project_id, deleted_at);`,
  },
  {
    // Version 6 appended " (2)" without shortening, which could take a title
    // past 500 characters, and such a project's export could not be imported
    version: 8,
    run: (db) => retitleTickets(db, (title) => title),
  },
  {
    // "No description" was stored as NULL or "" depending on how it was set
    version: 9,
    sql: `UPDATE tickets SET description = NULL WHERE description = ''`,
  },
  {
    // Version 8 could cut a title just after a space, and a title ending in
    // one can't be found by name (names are looked up trimmed). A blank
    // description is no description, stored as null like "" since version 9,
    // in the history as well (else a diff shows "   " → null as a change).
    version: 10,
    run: async (db) => {
      await retitleTickets(db, (title) => title.trim());
      await db.run(`UPDATE tickets SET description = NULL WHERE is_blank(description)`);
      await db.run(`UPDATE ticket_revisions SET description = NULL WHERE is_blank(description)`);
    },
  },
  {
    // Older versions accepted titles and project names that today's rules
    // reject (".", newlines, invisible characters, invalid UTF-8, "a  b"
    // project names): every command worked on them, but their export could
    // not be imported again. Give them the nearest name the rules accept.
    version: 11,
    run: async (db) => {
      await retitleTickets(db, acceptedTitle);
      await renameProjects(db);
    },
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
    if (version === SCHEMA_VERSION) return enableWal(db);
  }

  // Decide under the write lock: a concurrent process may be creating the
  // schema right now, and we must see its result rather than race it.
  try {
    await upgrade(db);
  } catch (err) {
    // An older schema can only be read after upgrading it, which needs write
    // access: say that rather than just "read-only"
    if (err instanceof AppError && err.message.includes("is read-only")) {
      const version = await pragma(db, "user_version");
      throw new AppError(
        `The database uses schema version ${version} and is read-only; open it once with write access so rewelo can upgrade it to version ${SCHEMA_VERSION}`
      );
    }
    throw err;
  }
  await enableWal(db);
}

async function upgrade(db: DB): Promise<void> {
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
      if (m.version > version) {
        if (m.sql) await db.exec(m.sql);
        if (m.run) await m.run(db);
      }
    }
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

// Write-ahead logging lets commands read while another process writes (a
// large import used to lock even project list out). The mode is stored in the
// file, so this is only done for our own databases, once they are known to be
// ours; a read-only or busy file simply keeps its mode.
async function enableWal(db: DB): Promise<void> {
  try {
    const [row] = await db.all<{ journal_mode: string }>("PRAGMA journal_mode");
    if (row.journal_mode === "delete") await db.exec("PRAGMA journal_mode = WAL");
  } catch {
    // keep the current mode
  }
}

// Give tickets the title `rewrite` makes of theirs, numbering clashes
// ("a b (2)") and keeping every title within the length limit.
async function retitleTickets(db: DB, rewrite: (title: string) => string): Promise<void> {
  const tickets = await db.all<{ id: number; project_id: number; title: string }>(
    "SELECT id, project_id, title FROM tickets ORDER BY project_id, id"
  );
  const taken = new Set(tickets.map((t) => `${t.project_id}/${t.title}`));
  // Titles are stored trimmed, so a cut just after a space drops it; a cut
  // inside an emoji drops its first half
  const fit = (base: string, suffix: string) => truncate(base, MAX_TICKET_TITLE - suffix.length).trimEnd() + suffix;
  for (const t of tickets) {
    // A title of only spaces would become "", which no command accepts
    const base = rewrite(t.title) || "Untitled";
    if (base === t.title && t.title.length <= MAX_TICKET_TITLE) continue;
    let title = fit(base, "");
    for (let n = 2; taken.has(`${t.project_id}/${title}`); n++) title = fit(base, ` (${n})`);
    taken.delete(`${t.project_id}/${t.title}`);
    taken.add(`${t.project_id}/${title}`);
    // Like any rename, keep the old title in the ticket's history, so the
    // change shows in ticket history and the event log
    await db.run(
      `INSERT INTO ticket_revisions (ticket_id, title, description, benefit, penalty, estimate, risk, tags)
       SELECT id, title, description, benefit, penalty, estimate, risk,
         (SELECT json_group_array(json_object('prefix', tg.prefix, 'value', tg.value))
          FROM ticket_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.ticket_id = tickets.id)
       FROM tickets WHERE id = ?`,
      t.id
    );
    await db.run(
      "UPDATE tickets SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      title,
      t.id
    );
  }
}

const EMOJI_PARTS = /[\u200C\u200D\uFE00-\uFE0F\u{E0020}-\u{E007F}]/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// The title as validateTicketTitle would accept it: line breaks and control
// characters as spaces, invisible and text-direction characters dropped,
// broken characters as "?"; "" when nothing acceptable is left
function acceptedTitle(title: string): string {
  const cleaned = collapseSpaces(
    title
      .replace(LONE_SURROGATE, "?")
      .replace(/\uFFFD/g, "?")
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
      .replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu, (c) => (EMOJI_PARTS.test(c) ? c : ""))
      .normalize("NFC")
  ).trim();
  try {
    validateTicketTitle(truncate(cleaned, MAX_TICKET_TITLE).trimEnd());
    return cleaned;
  } catch {
    return "";
  }
}

// Project names as validateProjectName accepts them, numbering clashes
// ("a-b-2"): accents dropped, other characters as "-", runs of spaces as one
async function renameProjects(db: DB): Promise<void> {
  const projects = await db.all<{ id: number; name: string }>("SELECT id, name FROM projects ORDER BY id");
  const taken = new Set(projects.map((p) => p.name));
  const fit = (base: string, suffix: string) => truncate(base, MAX_PROJECT_NAME - suffix.length).trimEnd() + suffix;
  for (const p of projects) {
    try {
      if (validateProjectName(p.name) === p.name) continue;
    } catch {
      // renamed below
    }
    const cleaned = p.name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-zA-Z0-9 _-]+/g, "-")
      .replace(/ +/g, " ")
      .trim();
    // "-" alone would read as an option on the command line
    const base = /[a-zA-Z0-9]/.test(cleaned) ? cleaned : "Project";
    let name = fit(base, "");
    for (let n = 2; taken.has(name); n++) name = fit(base, `-${n}`);
    taken.delete(p.name);
    taken.add(name);
    await db.run("UPDATE projects SET name = ? WHERE id = ?", name, p.id);
  }
}

async function collapseStoredTitles(db: DB): Promise<void> {
  await retitleTickets(db, collapseSpaces);
}

async function pragma(db: DB, name: "application_id" | "user_version"): Promise<number> {
  const [row] = await db.all<Record<string, number>>(`PRAGMA ${name}`);
  return row[name];
}
