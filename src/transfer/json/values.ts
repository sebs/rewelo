import { prefixErrors, ValidationError } from "../../errors.js";
import { truncate } from "../../text.js";
import type { TagPair } from "../types.js";
import { validateTagPrefix, validateTagValue } from "../../validation/strings.js";

// Reading untrusted JSON: size and nesting limits, and tag pairs

export const MAX_JSON_SIZE_BYTES = 50 * 1024 * 1024;

export const MAX_NESTING_DEPTH = 10;

export function checkDepth(obj: unknown, depth: number = 0): void {
  if (depth > MAX_NESTING_DEPTH) {
    throw new ValidationError(`JSON nesting depth exceeds maximum of ${MAX_NESTING_DEPTH}`);
  }
  if (Array.isArray(obj)) {
    for (const item of obj) checkDepth(item, depth + 1);
  } else if (obj !== null && typeof obj === "object") {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      checkDepth(val, depth + 1);
    }
  }
}

export function checkJsonSize(json: string, label: string = "JSON"): void {
  if (Buffer.byteLength(json, "utf-8") > MAX_JSON_SIZE_BYTES) {
    throw new ValidationError(`${label} exceeds maximum file size of 50 MB`);
  }
}

export function safeParseJson(json: string, label: string = "JSON"): unknown {
  try {
    // Editors on Windows often save UTF-8 with a byte order mark
    return JSON.parse(json.replace(/^\uFEFF/, ""));
  } catch {
    throw new ValidationError(`Invalid ${label}`);
  }
}

/**
 * Only known keys: an unknown one is a mistake the import would otherwise
 * drop silently (a misspelt score, "Estimate" for "estimate", "relation")
 */
export function checkKeys(obj: Record<string, unknown>, known: readonly string[], where: string): void {
  const unknown = Object.keys(obj).filter((k) => !known.includes(k));
  if (unknown.length === 0) return;
  const names = unknown.slice(0, 5).map((k) => JSON.stringify(truncate(k, 50))).join(", ");
  throw new ValidationError(`${where}: unknown key${unknown.length > 1 ? "s" : ""} ${names} (known: ${known.join(", ")})`);
}

export function parseTags(raw: unknown, errorPrefix: string = "Tag"): TagPair[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ValidationError(`${errorPrefix}s must be an array of {"prefix", "value"} objects`);
  }
  return raw.map((tag, i) => {
    const t = tag as Record<string, unknown>;
    // A misspelt key explains a missing one: name it first
    if (t && typeof t === "object" && !Array.isArray(t)) checkKeys(t, ["prefix", "value"], `${errorPrefix} ${i + 1}`);
    if (!t || typeof t !== "object" || typeof t.prefix !== "string" || typeof t.value !== "string") {
      throw new ValidationError(
        `${errorPrefix} ${i + 1}: must be an object with string "prefix" and "value"`
      );
    }
    const { prefix, value } = t;
    return prefixErrors(`${errorPrefix} ${i + 1}`, () => ({ prefix: validateTagPrefix(prefix), value: validateTagValue(value) }));
  });
}
