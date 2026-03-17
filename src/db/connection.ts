import duckdb from "duckdb";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Row {
  [key: string]: unknown;
}

export class DB {
  private db: duckdb.Database;
  private conn: duckdb.Connection;

  private constructor(db: duckdb.Database, conn: duckdb.Connection) {
    this.db = db;
    this.conn = conn;
  }

  static async open(dbPath: string): Promise<DB> {
    return new Promise((res, rej) => {
      const db = new duckdb.Database(dbPath, (err) => {
        if (err) return rej(err);
        const conn = new duckdb.Connection(db, (err2) => {
          if (err2) return rej(err2);
          res(new DB(db, conn));
        });
      });
    });
  }

  async exec(sql: string): Promise<void> {
    return new Promise((res, rej) => {
      this.conn.exec(sql, (err) => {
        if (err) return rej(err);
        res();
      });
    });
  }

  async all<T = Row>(
    sql: string,
    ...params: unknown[]
  ): Promise<T[]> {
    return new Promise((res, rej) => {
      this.conn.all(sql, ...params, (err: duckdb.DuckDbError | null, rows: duckdb.TableData) => {
        if (err) return rej(err);
        res(rows as T[]);
      });
    });
  }

  async run(sql: string, ...params: unknown[]): Promise<void> {
    return new Promise((res, rej) => {
      this.conn.run(sql, ...params, (err: duckdb.DuckDbError | null) => {
        if (err) return rej(err);
        res();
      });
    });
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
    return new Promise((res, rej) => {
      this.conn.close((err) => {
        if (err) return rej(err);
        this.db.close((err2) => {
          if (err2) return rej(err2);
          res();
        });
      });
    });
  }
}
