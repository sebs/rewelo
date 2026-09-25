import { DB } from "../db/connection.js";
import { Project } from "../projects/repository.js";
import { writeJsonExport } from "../export/json.js";
import { renderDashboard } from "../reports/dashboard.js";
import { AppError } from "../errors.js";
import { MAX_RESULT_BYTES, ToolResult, tooLarge } from "./results.js";

// Documents (exports, dashboards) are read as resources, which a client
// fetches on its own instead of putting them into the model's context: they
// may be larger. The whole document is still one message in memory.
export const MAX_DOCUMENT_BYTES = 32_000_000;

// Thrown while a document is built, once it is over its limit
class DocumentTooLarge extends AppError {}

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
      if (text.length > maxBytes) throw new DocumentTooLarge(tooLarge(`over ${maxBytes / 1_000_000} MB`, maxBytes));
    }
  });
  return text;
}

export function checkDocumentSize(text: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes > maxBytes) throw new DocumentTooLarge(tooLarge(`${(bytes / 1_000_000).toFixed(1)} MB`, maxBytes));
  return text;
}

// A document too large for a tool result: a link to the resource with it
export async function documentOrLink(build: () => Promise<string>, uri: string, name: string, mimeType: string) {
  try {
    return checkDocumentSize(await build(), MAX_RESULT_BYTES);
  } catch (err) {
    if (!(err instanceof DocumentTooLarge)) throw err;
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
