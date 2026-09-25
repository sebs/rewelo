import { isInputRequiredResult, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { AppError, truncate } from "../validation/strings.js";
import { sanitizeError } from "../validation/errors.js";

// Results are compact JSON, and refused above this size: 30,000 tickets made
// ticket_list 13.7 MB and export_json 19.6 MB, far more than a client can use
export const MAX_RESULT_BYTES = 5_000_000;

export const tooLarge = (size: string, max = MAX_RESULT_BYTES) =>
  `The result is too large (${size}, max ${max / 1_000_000} MB). Narrow it (limit, offset, filters), or use the rw CLI, which writes exports and dashboards to files.`;

// Data goes out twice: as structuredContent, checked against the tool's
// outputSchema, and as JSON text for clients that read only the text. A
// document (CSV, JSON export, HTML) goes out as text only.
export function textResult(data: unknown): { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown> } {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes > MAX_RESULT_BYTES) throw new AppError(tooLarge(`${(bytes / 1_000_000).toFixed(1)} MB`));
  const content = [{ type: "text" as const, text }];
  // An array is valid here: the SDK wraps it as {result: [...]} for the 2025
  // protocol, whose structuredContent must be an object
  return typeof data === "string" ? { content } : { content, structuredContent: data as Record<string, unknown> };
}

// A tool result in its final form, such as a link to a resource
export class ToolResult {
  constructor(readonly result: CallToolResult) {}
}

const MAX_ERROR_LENGTH = 1000;

export const shorten = (text: string) =>
  text.length > MAX_ERROR_LENGTH ? `${truncate(text, MAX_ERROR_LENGTH)}… (truncated)` : text;

export function errorResult(err: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  // Messages quote input (e.g. a ticket title); never echo a huge one back
  const message = sanitizeError(err);
  return {
    content: [{ type: "text" as const, text: shorten(message) }],
    isError: true,
  };
}

// Errors the SDK makes itself (invalid arguments, unknown tools) quote the
// input too, but don't pass through errorResult: 200,000 invalid array items
// gave a 12 MB answer, a 3 MB tool name a 3 MB one. Shorten them on the way out.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capErrors(message: any): any {
  if (message?.error && typeof message.error.message === "string") {
    return { ...message, error: { ...message.error, message: shorten(message.error.message), data: undefined } };
  }
  const result = message?.result;
  if (result?.isError && Array.isArray(result.content)) {
    return {
      ...message,
      result: {
        ...result,
        content: result.content.map((c: { type: string; text?: unknown }) =>
          c.type === "text" && typeof c.text === "string" ? { ...c, text: shorten(c.text) } : c
        ),
      },
    };
  }
  return message;
}

/** A tool handler whose return value becomes the result, and whose errors an error result */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safe(fn: (args: any, ctx: ServerContext) => any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (args: any, ctx: ServerContext) => {
    try {
      const result = await fn(args, ctx);
      // A question for the user (inputRequired) goes out as it is
      if (isInputRequiredResult(result)) return result;
      return result instanceof ToolResult ? result.result : textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  };
}
