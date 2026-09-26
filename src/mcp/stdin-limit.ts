import { Transform } from "node:stream";

// The longest message the server reads. Tool calls' text arguments are
// limited to 1 MB (checkPayloadSize); the SDK's stdio transport reads at most
// 10 MiB, and over that it closes, which stopped the server silently.
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/**
 * What a dropped message was: a request with this id, a notification (no
 * answer is due), or neither that could be told (answered with id null)
 */
export type Dropped = { id: string | number } | { notification: true } | { id: null };

// The top-level keys of one JSON-RPC message, read as it streams by: the
// id may come after params, megabytes into the line
class MessageScanner {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private token = ""; // the string or value being read at the top level
  private key: string | undefined; // the key whose value comes next
  private expectingKey = true;
  private array = false;
  id: string | number | undefined;
  method = false;

  feed(text: string): void {
    for (const c of text) {
      if (this.inString) {
        if (this.depth === 1 && this.token.length < 200) this.token += c;
        if (this.escaped) this.escaped = false;
        else if (c === "\\") this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') {
        this.inString = true;
        if (this.depth === 1) this.token = c;
      } else if (c === "{" || c === "[") {
        if (this.depth === 0 && c === "[") this.array = true;
        this.depth++;
      } else if (c === "}" || c === "]") {
        if (this.depth === 1) this.value();
        this.depth--;
      } else if (this.depth === 1) {
        if (c === ":") {
          if (this.expectingKey) this.key = this.parse(this.token) as string | undefined;
          this.expectingKey = false;
          this.token = "";
        } else if (c === ",") {
          this.value();
        } else if (!/\s/.test(c) && this.token.length < 200) this.token += c;
      }
    }
  }

  // A top-level value ends: note the id and whether there is a method
  private value(): void {
    if (!this.expectingKey) {
      if (this.key === "id") {
        const id = this.parse(this.token);
        if (typeof id === "string" || typeof id === "number") this.id = id;
      } else if (this.key === "method") this.method = true;
    }
    this.expectingKey = true;
    this.key = undefined;
    this.token = "";
  }

  private parse(token: string): unknown {
    try {
      return JSON.parse(token);
    } catch {
      return undefined;
    }
  }

  result(): Dropped {
    if (this.array) return { id: null };
    if (this.id !== undefined) return { id: this.id };
    return this.method ? { notification: true } : { id: null };
  }
}

/**
 * Passes stdin's messages (one per line) on, but drops a line longer than
 * `max` bytes and, at its end, tells `onDropped` what it was: the server
 * answers a request with an error and keeps serving.
 */
export function limitLines(max: number, onDropped: (dropped: Dropped) => void): Transform {
  let length = 0; // bytes of the current line so far
  let scanner = new MessageScanner();
  let dropping = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const out: Buffer[] = [];
      for (let start = 0; start < chunk.length; ) {
        const newline = chunk.indexOf(0x0a, start);
        const end = newline === -1 ? chunk.length : newline + 1;
        const piece = chunk.subarray(start, end);
        scanner.feed(piece.toString("utf8"));
        if (!dropping && length + piece.length > max + (newline === -1 ? 0 : 1)) {
          dropping = true;
          // End the part already passed on, so the next message doesn't
          // join it: a line that isn't JSON is skipped
          out.push(Buffer.from("\n"));
        }
        if (!dropping) out.push(piece);
        length += piece.length;
        if (newline !== -1) {
          if (dropping) onDropped(scanner.result());
          length = 0;
          scanner = new MessageScanner();
          dropping = false;
        }
        start = end;
      }
      done(null, out.length > 0 ? Buffer.concat(out) : undefined);
    },
  });
}
