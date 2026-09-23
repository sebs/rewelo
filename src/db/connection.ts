import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Row {
  [key: string]: unknown;
}

export class DB {
  private db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static async open(dbPath: string): Promise<DB> {
    const db = new DatabaseSync(dbPath);
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
    await this.exec("BEGIN TRANSACTION");
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
