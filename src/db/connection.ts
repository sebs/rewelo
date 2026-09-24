import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { AppError, collapseSpaces } from "../validation/strings.js";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Row {
  [key: string]: unknown;
}

// Long enough to wait for another process's large import (writes take turns;
// reads don't wait at all in WAL mode)
const BUSY_TIMEOUT_MS = 30_000;

// SQLite primary result codes that mean "the file is the problem", mapped
// to messages the user can act on (instead of a generic internal error).
const STORAGE_ERRORS: Record<number, string> = {
  5: "The database is locked by another process. Try again later",
  6: "The database is locked by another process. Try again later",
  8: "The database file is read-only",
  10: "Disk I/O error: the database or one of SQLite's temporary files could not be written (is the file system read-only or full?)",
  11: "The database file is corrupted or is not a SQLite database",
  13: "The disk is full",
  14: "Cannot open the database file (the path must be a file in an existing, accessible directory)",
  26: "The database file is corrupted or is not a SQLite database",
};

function translate(err: unknown): unknown {
  const errcode = (err as { errcode?: unknown })?.errcode;
  if (typeof errcode !== "number") return err;
  const message = STORAGE_ERRORS[errcode & 0xff];
  return message ? new AppError(message) : err;
}

function sqlite<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw translate(err);
  }
}

export class DB {
  private db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static async open(dbPath: string): Promise<DB> {
    // Wait up to BUSY_TIMEOUT_MS for another process's lock instead of
    // failing at once with "database is locked" (parallel CLI runs).
    return sqlite(() => {
      const db = new DatabaseSync(dbPath, { timeout: BUSY_TIMEOUT_MS });
      db.exec("PRAGMA foreign_keys = ON");
      // SQLite's lower() only folds ASCII ("Ä" stays "Ä"); searches need
      // the same Unicode lowercasing that JavaScript applies to the term.
      db.function("unicode_lower", { deterministic: true }, (s) =>
        typeof s === "string" ? s.toLowerCase() : s
      );
      // Titles stored before spaces were collapsed may still hold "a  b"
      db.function("collapse_spaces", { deterministic: true }, (s) =>
        typeof s === "string" ? collapseSpaces(s) : s
      );
      return new DB(db);
    });
  }

  async exec(sql: string): Promise<void> {
    sqlite(() => this.db.exec(sql));
  }

  // Prepared statements, reused: preparing the same SQL for every row of a
  // loop dominated per-ticket work. Bounded, as some SQL is built per call.
  private statements = new Map<string, StatementSync>();

  private prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      if (this.statements.size >= 200) this.statements.delete(this.statements.keys().next().value!);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  async all<T = Row>(
    sql: string,
    ...params: unknown[]
  ): Promise<T[]> {
    return sqlite(() => this.prepare(sql).all(...(params as SQLInputValue[])) as T[]);
  }

  async run(sql: string, ...params: unknown[]): Promise<void> {
    sqlite(() => this.prepare(sql).run(...(params as SQLInputValue[])));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Nested call: run inside the already open transaction
    if (this.db.isTransaction) return fn();

    // IMMEDIATE takes the write lock up front: a deferred transaction that
    // reads first and writes later can deadlock against another writer, and
    // SQLite then fails at once instead of honouring the busy timeout.
    await this.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      await this.exec("COMMIT");
      return result;
    } catch (err) {
      await this.exec("ROLLBACK");
      throw err;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
