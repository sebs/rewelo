/**
 * Error sanitisation: wraps internal errors before they reach the user.
 * Never exposes SQL, file paths, or stack traces in user-facing output.
 */

import { AppError } from "./strings.js";

export function sanitizeError(err: unknown): string {
  // AppError (and its subclass ValidationError) carry user-safe messages
  if (err instanceof AppError) {
    return err.message;
  }

  if (err instanceof Error) {
    // Constraint violations from the database — provide helpful message
    if (err.message.includes("Constraint Error") || err.message.includes("UNIQUE")) {
      return "A record with the same unique key already exists";
    }

    // Generic database or internal errors - do not leak details
    return "An internal error occurred. Please try again.";
  }

  return "An unexpected error occurred.";
}
