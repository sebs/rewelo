/**
 * The errors rewelo throws, and what any error says to the user: AppError
 * messages are safe to show; everything else is summed up, never exposing
 * SQL, file paths, or stack traces.
 */

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const FS_ERRORS: Record<string, string> = {
  EACCES: "Permission denied",
  EPERM: "Operation not permitted",
  ENOENT: "No such file or directory",
  EISDIR: "Is a directory",
  ENOTDIR: "Not a directory",
  EROFS: "Read-only file system",
  ENOSPC: "No space left on device",
};

/** A file system error as a message naming the path, for paths the user gave */
export function describeFsError(err: unknown, action: "read" | "write", path: string): Error {
  const problem = FS_ERRORS[(err as NodeJS.ErrnoException)?.code ?? ""];
  return problem ? new AppError(`Cannot ${action} ${path}: ${problem.toLowerCase()}`) : (err as Error);
}

/**
 * fn's result; any error it throws becomes a ValidationError with where in
 * front of its message ("Row 3: benefit must be ..."): for checking input.
 */
export function prefixErrors<T>(where: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new ValidationError(`${where}: ${(e as Error).message}`);
  }
}

/**
 * fn's result; a ValidationError it throws gets where in front of its
 * message, anything else passes on as it is: for writes, where a failing
 * database must not pass for bad input.
 */
export async function prefixValidationErrors<T>(where: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ValidationError) throw new ValidationError(`${where}: ${e.message}`);
    throw e;
  }
}

export function sanitizeError(err: unknown): string {
  // AppError (and its subclass ValidationError) carry user-safe messages
  if (err instanceof AppError) {
    return err.message;
  }

  if (err instanceof Error) {
    // File system errors: say what went wrong (without the path), since
    // "please try again" never helps with e.g. a permission problem
    const fsProblem = FS_ERRORS[(err as NodeJS.ErrnoException).code ?? ""];
    if (fsProblem) return fsProblem;

    // Constraint violations from the database — provide helpful message
    if (err.message.includes("UNIQUE constraint failed")) {
      return "A record with the same unique key already exists";
    }
    // e.g. a write racing the deletion of what it refers to
    if (err.message.includes("FOREIGN KEY constraint failed")) {
      return "A record this refers to no longer exists (it may just have been deleted)";
    }

    // Generic database or internal errors - do not leak details
    return "An internal error occurred. Please try again.";
  }

  return "An unexpected error occurred.";
}
