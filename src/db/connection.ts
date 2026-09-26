import { accessSync, constants, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { AppError } from "../errors.js";
import { collapseSpaces, isBlank } from "../text.js";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Row {
  [key: string]: unknown;
}

// Long enough to wait for another process's large import (writes take turns;
// reads don't wait at all in WAL mode)
const BUSY_TIMEOUT_MS = 30_000;

// SQLite's own wait (busy_timeout) blocks the thread; a server that waits
// with waitForLockWith keeps it this short and waits between tries instead
const SHORT_BUSY_TIMEOUT_MS = 50;

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

// readOnly: why the database was opened read-only, if it was
function translate(err: unknown, readOnly?: string): unknown {
  const errcode = (err as { errcode?: unknown })?.errcode;
  if (typeof errcode !== "number") return err;
  const message = (errcode & 0xff) === 8 && readOnly ? readOnly : STORAGE_ERRORS[errcode & 0xff];
  return message ? new AppError(message) : err;
}

function sqlite<T>(fn: () => T, readOnly?: string): T {
  try {
    return fn();
  } catch (err) {
    throw translate(err, readOnly);
  }
}

const writable = (path: string) => {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * A database file rewelo can't change, or one in a directory it can't
 * write: why, or undefined. Reading it in WAL mode needs a -shm file next to
 * it, which SQLite can't create in a read-only directory ("The database file
 * is read-only" even for project list), and a read-only file left -wal and
 * -shm behind. No one can change it either, so it is opened immutable,
 * without them; unless a -wal holds changes, which that would ignore.
 */
function readOnlyReason(dbPath: string): string | undefined {
  try {
    if (!statSync(dbPath).isFile() || statSync(`${dbPath}-wal`, { throwIfNoEntry: false })?.size) return undefined;
  } catch {
    return undefined;
  }
  if (!writable(dirname(resolve(dbPath)))) {
    return `The database's directory ${dirname(resolve(dbPath))} is read-only: rewelo can read the database but not change it`;
  }
  if (!writable(dbPath)) return "The database file is read-only";
  return undefined;
}

/** Told about this connection's write transactions (DB.transaction) */
export interface TransactionObserver {
  /** The transaction holds the write lock: no other connection writes until it ends */
  begun?(): Promise<void> | void;
  /** The transaction's writes are done and it is about to commit */
  committing?(): Promise<void> | void;
}

export class DB {
  private db: DatabaseSync;
  private observers: TransactionObserver[] = [];
  private waitForLock: ((ms: number) => Promise<void>) | undefined;

  private constructor(db: DatabaseSync, private readonly readOnly?: string) {
    this.db = db;
  }

  private sqlite<T>(fn: () => T): T {
    return sqlite(fn, this.readOnly);
  }

  static async open(dbPath: string): Promise<DB> {
    // Wait up to BUSY_TIMEOUT_MS for another process's lock instead of
    // failing at once with "database is locked" (parallel CLI runs).
    const readOnly = dbPath === ":memory:" ? undefined : readOnlyReason(dbPath);
    const location = readOnly ? new URL(`${pathToFileURL(resolve(dbPath))}?immutable=1`) : dbPath;
    return sqlite(() => {
      const db = new DatabaseSync(location, { timeout: BUSY_TIMEOUT_MS, readOnly: readOnly !== undefined });
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
      // Blank as the app sees it (Unicode spaces too), for migrations
      db.function("is_blank", { deterministic: true }, (s) => (typeof s === "string" && isBlank(s) ? 1 : 0));
      return new DB(db, readOnly);
    });
  }

  async exec(sql: string): Promise<void> {
    this.sqlite(() => this.db.exec(sql));
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
    return this.sqlite(() => this.prepare(sql).all(...(params as SQLInputValue[])) as T[]);
  }

  async run(sql: string, ...params: unknown[]): Promise<void> {
    this.sqlite(() => this.prepare(sql).run(...(params as SQLInputValue[])));
  }

  observeTransactions(observer: TransactionObserver): void {
    this.observers.push(observer);
  }

  /**
   * Wait for another connection's write lock with `wait` between tries,
   * instead of in SQLite, which blocks the thread: a server stays
   * responsive (pings, cancellations, other calls) while a write waits.
   */
  async waitForLockWith(wait: (ms: number) => Promise<void>): Promise<void> {
    this.waitForLock = wait;
    await this.exec(`PRAGMA busy_timeout = ${SHORT_BUSY_TIMEOUT_MS}`);
  }

  // IMMEDIATE takes the write lock up front: a deferred transaction that
  // reads first and writes later can deadlock against another writer, and
  // SQLite then fails at once instead of honouring the busy timeout.
  private async beginImmediate(): Promise<void> {
    if (!this.waitForLock) return this.exec("BEGIN IMMEDIATE");
    const deadline = Date.now() + BUSY_TIMEOUT_MS;
    for (let delay = 10; ; delay = Math.min(delay * 2, 250)) {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        return;
      } catch (err) {
        const errcode = (err as { errcode?: unknown })?.errcode;
        if (typeof errcode !== "number" || (errcode & 0xff) !== 5 || Date.now() >= deadline) throw translate(err, this.readOnly);
      }
      await this.waitForLock(delay);
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Nested call: run inside the already open transaction
    if (this.db.isTransaction) return fn();

    await this.beginImmediate();
    try {
      for (const o of this.observers) await o.begun?.();
      const result = await fn();
      for (const o of this.observers) await o.committing?.();
      await this.exec("COMMIT");
      return result;
    } catch (err) {
      await this.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Reads in one snapshot: other processes' writes in between (WAL mode)
   * are not seen, so several queries describe the same state.
   */
  /**
   * Runs fn in a write transaction and rolls it back, whatever it wrote: a
   * dry run that sees its own changes and leaves none behind.
   */
  async rolledBack<T>(fn: () => Promise<T>): Promise<T> {
    // A rollback here would end the caller's transaction too
    if (this.db.isTransaction) throw new Error("rolledBack can't run inside another transaction");
    await this.beginImmediate();
    try {
      return await fn();
    } finally {
      await this.exec("ROLLBACK");
    }
  }

  async readTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn();
    await this.exec("BEGIN DEFERRED");
    try {
      return await fn();
    } finally {
      await this.exec("COMMIT");
    }
  }

  /** Rows this connection has inserted, updated or deleted so far */
  async totalChanges(): Promise<number> {
    return (await this.all<{ n: number }>("SELECT total_changes() AS n"))[0].n;
  }

  /** Changes whenever another connection commits (PRAGMA data_version) */
  async dataVersion(): Promise<number> {
    return (await this.all<{ data_version: number }>("PRAGMA data_version"))[0].data_version;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
