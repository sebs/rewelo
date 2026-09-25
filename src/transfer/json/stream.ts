import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";

const isAsyncIterable = (v: unknown): v is AsyncIterable<unknown> =>
  typeof v === "object" && v !== null && Symbol.asyncIterator in v;

/**
 * The text of JSON.stringify(value, null, 2), in pieces: a top-level list
 * (an array, or an async iterable produced while writing) is written one
 * element at a time. The whole text of a 100,000-ticket export (70 MB) next
 * to the data ran the 192 MB heap out of memory.
 */
export async function* jsonChunks(value: object, { indent = true }: { indent?: boolean } = {}): AsyncGenerator<string> {
  // Compact (indent false) is JSON.stringify(value)
  const stringify = (v: unknown, depth: number) =>
    indent ? JSON.stringify(v, null, 2).split("\n").join("\n" + "  ".repeat(depth)) : JSON.stringify(v);
  const [open, keyGap, first, next, close, afterKey, end] = indent
    ? ["{\n", "  ", "[\n    ", ",\n    ", "\n  ]", ": ", "\n"]
    : ["{", "", "[", ",", "]", ":", ""];
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  yield entries.length === 0 ? "{}" : open;
  for (let i = 0; i < entries.length; i++) {
    const [key, v] = entries[i];
    yield `${keyGap}${JSON.stringify(key)}${afterKey}`;
    if (Array.isArray(v) || isAsyncIterable(v)) {
      let count = 0;
      for await (const element of v as AsyncIterable<unknown>) {
        // As JSON.stringify: undefined in an array is null
        yield (count++ === 0 ? first : next) + stringify(element ?? null, 2);
      }
      yield count === 0 ? "[]" : close;
    } else {
      yield stringify(v, 1);
    }
    yield i < entries.length - 1 ? (indent ? ",\n" : ",") : end;
  }
  if (entries.length > 0) yield "}";
}

async function writeTo(stream: Writable, chunks: AsyncIterable<string>): Promise<void> {
  for await (const chunk of chunks) {
    if (!stream.write(chunk)) await new Promise((resolve) => stream.once("drain", resolve));
  }
}

/** A writer for writeJsonExport: indented JSON into a file */
export function toFile(path: string): (chunks: AsyncIterable<string>) => Promise<void> {
  return async (chunks) => {
    const file = createWriteStream(path, { encoding: "utf-8" });
    const closed = new Promise<void>((resolve, reject) => {
      file.once("finish", resolve);
      file.once("error", reject);
    });
    // An error opening the file surfaces on the stream, not from write()
    await Promise.race([writeTo(file, chunks), closed]);
    file.end();
    await closed;
  };
}

/** A writer for writeJsonExport: indented JSON on stdout, then a newline (as console.log) */
export async function toStdout(chunks: AsyncIterable<string>): Promise<void> {
  await writeTo(process.stdout, chunks);
  process.stdout.write("\n");
}
