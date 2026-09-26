import { csvRow } from "../transfer/csv/codec.js";
import { displayWidth } from "../display-width.js";

/** The output flags: --json, --csv, --quiet (text otherwise) */
export interface OutputOptions {
  json?: boolean;
  csv?: boolean;
  quiet?: boolean;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/**
 * Text from before titles were checked (revisions from rw < 0.3.10, or an
 * imported history) may hold line breaks and other control characters:
 * shown escaped ("a\\nb"), they can't make up lines of output
 */
export function escapeControls(text: string): string {
  return text.replace(CONTROL, (c) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** A table with aligned columns, or CSV under --csv */
export function formatTable(opts: OutputOptions, headers: string[], rows: unknown[][]): string {
  // Coerce every cell to a string up front: some rows carry non-string values
  // (numbers, nulls), and calling String methods like padEnd on them would throw.
  const cells = rows.map((r) =>
    r.map((c) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)))
  );
  // --csv applies to every table
  if (opts.csv) return [headers, ...cells].map(csvRow).join("\n");
  for (const row of cells) row.forEach((cell, i) => (row[i] = escapeControls(cell)));
  const widths = headers.map((h, i) =>
    cells.reduce((max, r) => Math.max(max, displayWidth(r[i] || "")), displayWidth(h))
  );
  // Right-align columns whose cells are all numbers (output-formatting.feature)
  const numeric = headers.map((_, i) => cells.length > 0 && cells.every((r) => /^-?\d+(\.\d+)?$/.test(r[i] ?? "")));
  const pad = (text: string, i: number) => {
    const fill = " ".repeat(Math.max(0, widths[i] - displayWidth(text)));
    // No trailing spaces after a left-aligned last column
    return numeric[i] ? fill + text : i === widths.length - 1 ? text : text + fill;
  };
  const sep = widths.map((w) => "-".repeat(w)).join(" | ");
  const head = headers.map(pad).join(" | ");
  const body = cells.map((r) => r.map(pad).join(" | ")).join("\n");
  return `${head}\n${sep}\n${body}`;
}

/**
 * A command's one result: the data under --json, the quiet line (if any)
 * under --quiet, the text lines otherwise.
 */
export function printResult(opts: OutputOptions, data: unknown, text: string | string[], quiet?: string): void {
  if (opts.json) console.log(JSON.stringify(data));
  else if (opts.quiet) {
    if (quiet !== undefined) console.log(quiet);
  } else {
    for (const line of [text].flat()) console.log(line);
  }
}

export interface RowsView<T> {
  /** What --json prints (default: the items) */
  json?: unknown;
  /** One line per item under --quiet */
  quiet: (item: T) => string;
  /** Printed instead of an empty table (not in CSV) */
  empty: string;
  /** Whether there is nothing to show (default: no items) */
  isEmpty?: boolean;
  headers: string[];
  row: (item: T, index: number) => unknown[];
  /** Lines before and after the table (not in CSV) */
  above?: string[];
  below?: string[];
}

/**
 * A list: the items under --json, a line per item under --quiet, a note when
 * there are none, and a table (CSV under --csv) otherwise.
 */
export function printRows<T>(opts: OutputOptions, items: T[], view: RowsView<T>): void {
  if (opts.json) console.log(JSON.stringify(view.json ?? items));
  else if (opts.quiet) items.forEach((item) => console.log(view.quiet(item)));
  else if ((view.isEmpty ?? items.length === 0) && !opts.csv) console.log(view.empty);
  else {
    if (!opts.csv) view.above?.forEach((line) => console.log(line));
    console.log(formatTable(opts, view.headers, items.map(view.row)));
    if (!opts.csv) view.below?.forEach((line) => console.log(line));
  }
}

/**
 * What an empty page of a paged list says: --limit 0 and an offset past the
 * end show nothing, which is not the same as there being nothing (`none`:
 * there is nothing at all, on any page)
 */
export function emptyPage(what: string, page: { limit?: number; offset?: number }, none: boolean): string {
  if (none) return `No ${what} found.`;
  if (page.limit === 0) return `No ${what} shown (--limit 0).`;
  if (page.offset) return `No ${what} after the first ${page.offset}.`;
  return `No ${what} found.`;
}

// Confirmation for a command that wrote a file: JSON with the path under
// --json, nothing under --quiet
export function reportWritten(opts: OutputOptions, path: string, message: string): void {
  printResult(opts, { output: path }, message);
}
