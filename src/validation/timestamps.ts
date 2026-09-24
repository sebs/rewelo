import { ValidationError } from "./strings.js";

// An ISO date or date-time: 2026-03-10, 2026-03-10T09:00, 2026-03-10T09:00:00.000Z,
// 2026-03-10T09:00:00+02:00. Date.parse alone is far more lenient: it reads
// "Ticket 12" as a date in 2001 and rolls "2026-02-30" over into March.
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

function isValidIso(since: string): boolean {
  const m = ISO_TIMESTAMP.exec(since);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59)) return false;
  return m[6] === undefined || Number(m[6]) <= 59;
}

// Date.parse reads a plain date as UTC but a date-time without an offset as
// local time, so "2026-03-10" and "2026-03-10T00:00" differed by the machine's
// UTC offset. Stored timestamps are UTC: read both as UTC.
function asUtc(since: string): string {
  const m = ISO_TIMESTAMP.exec(since)!;
  const iso = since.replace(" ", "T");
  return m[4] !== undefined && m[7] === undefined ? `${iso}Z` : iso;
}

/**
 * Timestamps are stored as ISO-8601 UTC text (2026-01-31T12:00:00.000Z) and
 * compared as strings in SQL, so user-supplied bounds must use the same form:
 * "2026-01-31T14:00:00+02:00" is the same instant but compares differently.
 */
export function normalizeSince(since: string): string {
  const ms = isValidIso(since.trim()) ? Date.parse(asUtc(since.trim())) : NaN;
  if (Number.isNaN(ms)) {
    throw new ValidationError(
      `Invalid timestamp "${since}". Use an ISO date or date-time, e.g. 2026-03-10 or 2026-03-10T09:00:00Z`
    );
  }
  return new Date(ms).toISOString();
}
