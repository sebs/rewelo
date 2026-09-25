import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { DB } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { getProjectByName, Project } from "../projects/repository.js";
import { AppError } from "../errors.js";
import { RateLimiter } from "./limits.js";

/** The tool call being run: its signal says when the client cancelled it */
export const currentCall = new AsyncLocalStorage<AbortSignal>();

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
  // Calls take turns: the last one's turn, and how to end the current one
  private tail: Promise<void> = Promise.resolve();
  private endTurn: (() => void) | undefined;

  constructor(
    private readonly dbPath: string,
    private readonly rateLimiter: RateLimiter,
    /** Given the connection once it is open (the channel watches its writes) */
    private readonly opened: (db: DB) => void = () => {}
  ) {}

  private open(): Promise<DB> {
    this.shared ??= DB.open(this.dbPath)
      .then(async (db) => {
        await migrate(db);
        await db.waitForLockWith((ms) => this.waitForLock(ms));
        this.opened(db);
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
    await this.takeTurn();
    try {
      return await fn(db);
    } finally {
      this.giveTurn();
    }
  };

  private async takeTurn(): Promise<void> {
    const previous = this.tail;
    let end!: () => void;
    this.tail = new Promise<void>((resolve) => (end = resolve));
    await previous;
    this.endTurn = end;
  }

  private giveTurn(): void {
    const end = this.endTurn;
    this.endTurn = undefined;
    end?.();
  }

  // A write waiting for another process's lock (a large import): the calls
  // behind it run meanwhile (reads aren't blocked in WAL mode), and a call
  // the client cancelled stops waiting
  private async waitForLock(ms: number): Promise<void> {
    this.giveTurn();
    await sleep(ms);
    await this.takeTurn();
    if (currentCall.getStore()?.aborted) throw new AppError("The call was cancelled while it waited for the database lock");
  }

  withProject = async <T>(name: string, fn: (db: DB, project: Project) => Promise<T>): Promise<T> =>
    this.withDb(async (db) => {
      const proj = await getProjectByName(db, name);
      if (!proj) throw new AppError("Project not found");
      return fn(db, proj);
    });
}
