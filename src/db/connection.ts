import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Row {
  [key: string]: unknown;
}

const BUSY_TIMEOUT_MS = 5000;

export class DB {
  private db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static async open(dbPath: string): Promise<DB> {
    // Wait up to BUSY_TIMEOUT_MS for another process's lock instead of
    // failing at once with "database is locked" (parallel CLI runs).
    const db = new DatabaseSync(dbPath, { timeout: BUSY_TIMEOUT_MS });
    db.exec("PRAGMA foreign_keys = ON");
    return new DB(db);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async all<T = Row>(
    sql: string,
    ...params: unknown[]
  ): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }

  async run(sql: string, ...params: unknown[]): Promise<void> {
    this.db.prepare(sql).run(...(params as SQLInputValue[]));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
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
