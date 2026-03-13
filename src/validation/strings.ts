/**
 * Input validation for string fields.
 * Applied at the CLI/MCP boundary before data reaches repositories.
 */

const MAX_PROJECT_NAME = 100;
const MAX_TICKET_TITLE = 500;
const MAX_TICKET_DESCRIPTION = 10_000;
const MAX_TAG_PREFIX = 50;
const MAX_TAG_VALUE = 100;

function hasNullBytes(s: string): boolean {
  return s.includes("\0");
}

function normalize(s: string): string {
  return s.normalize("NFC");
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
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
  return normalized;
}

export function validateTicketTitle(title: string): string {
  if (!title || title.trim().length === 0) {
    throw new ValidationError("Ticket title must not be empty");
  }
  if (hasNullBytes(title)) {
    throw new ValidationError("Ticket title must not contain null bytes");
  }
  const normalized = normalize(title.trim());
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
  const normalized = normalize(description);
  if (normalized.length > MAX_TICKET_DESCRIPTION) {
    throw new ValidationError(
      `Ticket description must not exceed ${MAX_TICKET_DESCRIPTION} characters`
    );
  }
  return normalized;
}

export function validateTagPrefix(prefix: string): string {
  if (!prefix || prefix.trim().length === 0) {
    throw new ValidationError("Tag prefix must not be empty");
  }
  if (hasNullBytes(prefix)) {
    throw new ValidationError("Tag prefix must not contain null bytes");
  }
  const normalized = normalize(prefix.trim().toLowerCase());
  if (normalized.length > MAX_TAG_PREFIX) {
    throw new ValidationError(
      `Tag prefix must not exceed ${MAX_TAG_PREFIX} characters`
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new ValidationError(
      "Tag prefix must contain only lowercase alphanumeric characters and hyphens"
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
  const normalized = normalize(value.trim().toLowerCase());
  if (normalized.length > MAX_TAG_VALUE) {
    throw new ValidationError(
      `Tag value must not exceed ${MAX_TAG_VALUE} characters`
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new ValidationError(
      "Tag value must contain only lowercase alphanumeric characters and hyphens"
    );
  }
  return normalized;
}
