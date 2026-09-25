import { DB } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { getProjectByName, Project } from "../projects/repository.js";
import { AppError } from "../errors.js";
import { RateLimiter } from "./limits.js";

type Around = <T>(db: DB, fn: (db: DB) => Promise<T>) => Promise<T>;

/**
 * The server's one database connection, shared for its lifetime (which
 * matters for :memory: databases). Calls run their DB work one at a time:
 * otherwise a call's statements could land inside another call's open
 * transaction (and be rolled back with it).
 */
export class DbSession {
  // Memoise the promise, not the result: concurrent first calls must share
  // one open + migrate instead of each opening their own connection.
  private shared: Promise<DB> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dbPath: string,
    private readonly rateLimiter: RateLimiter,
    /** Runs around every call's DB work (the channel notes the events it wrote) */
    private readonly around: Around = (db, fn) => fn(db)
  ) {}

  private open(): Promise<DB> {
    this.shared ??= DB.open(this.dbPath)
      .then(async (db) => {
        await migrate(db);
        return db;
      })
      .catch((err) => {
        this.shared = null;
        throw err;
      });
    return this.shared;
  }

  /** A tool call's DB work: rate-limited, then in turn */
  withDb = async <T>(fn: (db: DB) => Promise<T>): Promise<T> => {
    await this.rateLimiter.acquire();
    return this.queued(fn);
  };

  // The server's own work (looking for changes) doesn't count against the
  // rate limit, but waits its turn like a tool call
  queued = async <T>(fn: (db: DB) => Promise<T>): Promise<T> => {
    const db = await this.open();
    const run = this.queue.then(() => this.around(db, fn));
    this.queue = run.catch(() => {});
    return run;
  };

  withProject = async <T>(name: string, fn: (db: DB, project: Project) => Promise<T>): Promise<T> =>
    this.withDb(async (db) => {
      const proj = await getProjectByName(db, name);
      if (!proj) throw new AppError("Project not found");
      return fn(db, proj);
    });
}
