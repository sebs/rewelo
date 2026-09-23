/**
 * Timestamps are stored as ISO-8601 UTC text (2026-01-31T12:00:00.000Z) and
 * compared as strings in SQL, so user-supplied bounds must use the same form:
 * "2026-01-31T14:00:00+02:00" is the same instant but compares differently.
 */
export function normalizeSince(since: string): string {
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? since : new Date(ms).toISOString();
}
