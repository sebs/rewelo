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
    // Known application errors
    if (err.message.startsWith("Ticket not found")) return "Ticket not found";
    if (err.message.startsWith("Tag not found")) return "Tag not found";
    if (err.message.includes("must be a Fibonacci")) return err.message;
    if (err.message.includes("must be a non-negative")) return err.message;
    if (err.message.includes("denominator is zero")) return err.message;
    if (err.message.includes("Rate limit exceeded")) return err.message;
    if (err.message.includes("payload too large")) return err.message;
    if (err.message.startsWith("Project not found")) return "Project not found";
    if (err.message.startsWith("Tag not found")) return "Tag not found";

    // Generic database or internal errors - do not leak details
    return "An internal error occurred. Please try again.";
  }

  return "An unexpected error occurred.";
}
