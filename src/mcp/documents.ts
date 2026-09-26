import { DB } from "../db/connection.js";
import { Project } from "../projects/repository.js";
import { writeJsonExport } from "../transfer/json/export.js";
import { renderDashboard } from "../reports/dashboard.js";
import { MAX_RESULT_BYTES, textResult, ToolResult, TooLarge, tooLarge } from "./results.js";

// Documents (exports, dashboards) are read as resources, which a client
// fetches on its own instead of putting them into the model's context: they
// may be larger. Each is still one JSON-RPC message, and the SDK's stdio
// client drops the connection over 10 MiB (10,485,760 bytes): 32 MB ended
// the session of a client following export_json's link
export const MAX_DOCUMENT_BYTES = 10_000_000;


export const resourceUri = (project: string, path: string) => `rewelo://${encodeURIComponent(project)}/${path}`;

// The export as export_json and the export resource return it, given up
// past maxBytes: the whole export of a big project in memory killed the
// server (heap out of memory), only for the result to be refused as too large
export async function jsonExport(db: DB, projectId: number, withHistory: boolean, maxBytes: number): Promise<string> {
  let text = "";
  await writeJsonExport(db, projectId, { withHistory, indent: false }, async (chunks) => {
    for await (const chunk of chunks) {
      text += chunk;
      // UTF-16 units, at most the bytes: over this is over in bytes too
      if (text.length > maxBytes) throw new TooLarge(tooLarge(`over ${maxBytes / 1_000_000} MB`, maxBytes));
    }
  });
  return text;
}

// Measured as sent: the text JSON-escaped in the message (a quote, a
// backslash or a line break takes two bytes)
export function checkDocumentSize(text: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(JSON.stringify(text), "utf-8");
  if (bytes > maxBytes) throw new TooLarge(tooLarge(`${(bytes / 1_000_000).toFixed(1)} MB`, maxBytes));
  return text;
}

// A document too large for a tool result: a link to the resource with it.
// Too large is what the tool result would be (textResult), not the document
// alone: one a few bytes under 5 MB failed as "too large" instead
export async function documentOrLink(build: () => Promise<string>, uri: string, name: string, mimeType: string) {
  try {
    return new ToolResult(textResult(checkDocumentSize(await build(), MAX_RESULT_BYTES)));
  } catch (err) {
    if (!(err instanceof TooLarge)) throw err;
    return new ToolResult({
      content: [
        {
          type: "text",
          text: `The ${name} is over ${MAX_RESULT_BYTES / 1_000_000} MB, too large to return here. Read it from the resource ${uri} (up to ${MAX_DOCUMENT_BYTES / 1_000_000} MB), or use the rw CLI, which writes it to a file.`,
        },
        { type: "resource_link", uri, name, mimeType },
      ],
    });
  }
}

export const dashboard = (db: DB, proj: Project, limit?: number) =>
  renderDashboard(db, proj.id, proj.name, {
    generatedAt: new Date().toISOString(),
    limit,
    limitHint: "a higher <code>limit</code> for <code>report_dashboard</code>",
  });
