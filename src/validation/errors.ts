/**
 * Error sanitisation: wraps internal errors before they reach the user.
 * Never exposes SQL, file paths, or stack traces in user-facing output.
 */

import { ValidationError } from "./strings.js";

export function sanitizeError(err: unknown): string {
  if (err instanceof ValidationError) {
    return err.message;
  }

  if (err instanceof Error) {
    // Known application errors — pass through safe messages
    if (err.message.includes("not found")) return err.message;
    if (err.message.includes("already exists")) return err.message;
    if (err.message.includes("must be a Fibonacci")) return err.message;
    if (err.message.includes("must be a non-negative")) return err.message;
    if (err.message.includes("must not exceed")) return err.message;
    if (err.message.includes("denominator is zero")) return err.message;
    if (err.message.includes("Rate limit exceeded")) return err.message;
    if (err.message.includes("payload too large")) return err.message;
    if (err.message.includes("cannot relate to itself")) return err.message;
    if (err.message.includes("Relation already exists")) return err.message;
    if (err.message.includes("Unknown relation type")) return err.message;

    // Constraint violations from the database — provide helpful message
    if (err.message.includes("Constraint Error") || err.message.includes("UNIQUE")) {
      return "A record with the same unique key already exists";
    }

    // Generic database or internal errors - do not leak details
    return "An internal error occurred. Please try again.";
  }

  return "An unexpected error occurred.";
}
