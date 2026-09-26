/**
 * Input validation for string fields.
 * Applied at the CLI/MCP boundary before data reaches repositories.
 */

import { ValidationError } from "../errors.js";
import { collapseSpaces } from "../text.js";

export const MAX_PROJECT_NAME = 100;
export const MAX_TICKET_TITLE = 500;
const MAX_TICKET_DESCRIPTION = 10_000;
const MAX_TAG_PREFIX = 50;
const MAX_TAG_VALUE = 100;

// Half of a UTF-16 surrogate pair: no character on its own, and SQLite
// stores it as U+FFFD, which the next import of that text then rejects
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export const hasUnpairedSurrogate = (s: string): boolean => UNPAIRED_SURROGATE.test(s);

function hasNullBytes(s: string): boolean {
  return s.includes("\0");
}

function normalize(s: string): string {
  return s.normalize("NFC");
}

export function validateProjectName(name: string): string {
  if (!name || name.trim().length === 0) {
    throw new ValidationError("Project name must not be empty");
  }
  if (hasNullBytes(name)) {
    throw new ValidationError("Project name must not contain null bytes");
  }
  const normalized = normalize(name.trim());
  if (normalized.length > MAX_PROJECT_NAME) {
    throw new ValidationError(
      `Project name must not exceed ${MAX_PROJECT_NAME} characters`
    );
  }
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]*$/.test(normalized)) {
    throw new ValidationError(
      "Project name must contain only alphanumeric characters, hyphens, underscores, and spaces"
    );
  }
  // "a  b" and "a b" are indistinguishable in listings
  if (normalized.includes("  ")) {
    throw new ValidationError("Project name must not contain consecutive spaces");
  }
  return normalized;
}

export function validateTicketTitle(title: string): string {
  if (!title || title.trim().length === 0) {
    throw new ValidationError("Ticket title must not be empty");
  }
  if (hasNullBytes(title)) {
    throw new ValidationError("Ticket title must not contain null bytes");
  }
  // Unicode line and paragraph separators break lines as well (e.g. for
  // Python's splitlines() reading --quiet output)
  if (/[\n\r\u2028\u2029]/.test(title)) {
    throw new ValidationError("Ticket title must not contain newline characters");
  }
  // Escape sequences would be echoed raw into terminals (colours, cursor moves)
  if (/[\u0000-\u001f\u007f-\u009f]/.test(title)) {
    throw new ValidationError("Ticket title must not contain control characters");
  }
  // Bidi controls make a title display differently from what it is, and
  // invisible characters make distinct titles look identical: reject format
  // (Cf) and default-ignorable characters, and the blank braille pattern.
  // Kept: joiners (U+200C/U+200D), variation selectors and tag characters,
  // which emoji sequences and some scripts need; they can't stand alone.
  const EMOJI_PARTS = /[\u200C\u200D\uFE00-\uFE0F\u{E0020}-\u{E007F}]/gu;
  const stripped = title.replace(EMOJI_PARTS, "");
  if (/[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u.test(stripped) || stripped.trim() === "") {
    throw new ValidationError("Ticket title must not contain invisible or text-direction characters");
  }
  // Node decodes invalid UTF-8 (in arguments and files) to U+FFFD, so this is
  // almost always a sign of a wrongly encoded input rather than intended
  if (title.includes("\uFFFD")) {
    throw new ValidationError("Ticket title is not valid UTF-8 (it contains the replacement character \uFFFD)");
  }
  if (hasUnpairedSurrogate(title)) {
    throw new ValidationError("Ticket title is not valid Unicode (it contains an unpaired surrogate)");
  }
  const normalized = collapseSpaces(normalize(title.trim()));
  // URL parsing drops "." and ".." path segments, even percent-encoded: the
  // MCP resource rewelo://{project}/ticket/{title} could never reach them
  if (normalized === "." || normalized === "..") {
    throw new ValidationError('Ticket title must not be "." or ".."');
  }
  if (normalized.length > MAX_TICKET_TITLE) {
    throw new ValidationError(
      `Ticket title must not exceed ${MAX_TICKET_TITLE} characters`
    );
  }
  return normalized;
}

export function validateTicketDescription(
  description: string | undefined
): string | undefined {
  if (description === undefined || description === null) return undefined;
  if (hasNullBytes(description)) {
    throw new ValidationError(
      "Ticket description must not contain null bytes"
    );
  }
  // Line breaks and tabs are fine in free text; other control characters
  // (e.g. ESC) would be echoed raw into terminals.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(description)) {
    throw new ValidationError("Ticket description must not contain control characters");
  }
  // As for titles: invalid UTF-8 (e.g. a Latin-1 CSV) decodes to U+FFFD
  if (description.includes("\uFFFD")) {
    throw new ValidationError("Ticket description is not valid UTF-8 (it contains the replacement character \uFFFD); save the file as UTF-8");
  }
  if (hasUnpairedSurrogate(description)) {
    throw new ValidationError("Ticket description is not valid Unicode (it contains an unpaired surrogate)");
  }
  const normalized = normalize(description);
  if (normalized.length > MAX_TICKET_DESCRIPTION) {
    throw new ValidationError(
      `Ticket description must not exceed ${MAX_TICKET_DESCRIPTION} characters`
    );
  }
  return normalized;
}

/**
 * Split a "prefix:value" tag string into its two parts. A tag value may not
 * contain a colon, so anything other than exactly one colon is an error rather
 * than silently dropping the extra segments (e.g. "state:wip:foo" used to be
 * quietly treated as "state:wip").
 */
export function parseTagPair(raw: string): { prefix: string; value: string } {
  const parts = raw.split(":");
  if (parts.length !== 2) {
    throw new ValidationError(`Tag "${raw}" must be in prefix:value format`);
  }
  return { prefix: parts[0], value: parts[1] };
}

export function validateTagPrefix(prefix: string): string {
  if (!prefix || prefix.trim().length === 0) {
    throw new ValidationError("Tag prefix must not be empty");
  }
  if (hasNullBytes(prefix)) {
    throw new ValidationError("Tag prefix must not contain null bytes");
  }
  // Checked as given: lowercasing and NFC turn some other letters into
  // ASCII (the Kelvin sign K into k), which slipped past the check after them
  if (!/^[A-Za-z0-9-]*$/.test(prefix.trim())) {
    throw new ValidationError(
      "Tag prefix must start with a lowercase letter or digit and contain only lowercase letters, digits and hyphens"
    );
  }
  const normalized = normalize(prefix.trim().toLowerCase());
  if (normalized.length > MAX_TAG_PREFIX) {
    throw new ValidationError(
      `Tag prefix must not exceed ${MAX_TAG_PREFIX} characters`
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new ValidationError(
      "Tag prefix must start with a lowercase letter or digit and contain only lowercase letters, digits and hyphens"
    );
  }
  return normalized;
}

export function validateTagValue(value: string): string {
  if (!value || value.trim().length === 0) {
    throw new ValidationError("Tag value must not be empty");
  }
  if (hasNullBytes(value)) {
    throw new ValidationError("Tag value must not contain null bytes");
  }
  // Checked as given: lowercasing and NFC turn some other letters into
  // ASCII (the Kelvin sign K into k), which slipped past the check after them
  if (!/^[A-Za-z0-9-]*$/.test(value.trim())) {
    throw new ValidationError(
      "Tag value must start with a lowercase letter or digit and contain only lowercase letters, digits and hyphens"
    );
  }
  const normalized = normalize(value.trim().toLowerCase());
  if (normalized.length > MAX_TAG_VALUE) {
    throw new ValidationError(
      `Tag value must not exceed ${MAX_TAG_VALUE} characters`
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new ValidationError(
      "Tag value must start with a lowercase letter or digit and contain only lowercase letters, digits and hyphens"
    );
  }
  return normalized;
}

/**
 * Parse and validate a "prefix:value" tag the way it is stored (trimmed,
 * lowercase), so filters match tags written as e.g. "STATE:Done".
 */
export function parseTag(raw: string): { prefix: string; value: string } {
  const { prefix, value } = parseTagPair(raw);
  return { prefix: validateTagPrefix(prefix), value: validateTagValue(value) };
}
