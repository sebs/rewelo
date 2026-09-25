import { Transform } from "node:stream";

// The longest message the server reads. Tool calls' text arguments are
// limited to 1 MB (checkPayloadSize); the SDK's stdio transport reads at most
// 10 MiB, and over that it closes, which stopped the server silently.
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

// A request's id, if the start of its line shows it before the parameters
// (an "id" inside them is some argument's)
const ID = /"id"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+)/;

function requestId(head: string): string | number | undefined {
  const match = ID.exec(head);
  const params = head.indexOf('"params"');
  if (!match || (params !== -1 && params < match.index)) return undefined;
  return JSON.parse(match[1]);
}

/**
 * Passes stdin's messages (one per line) on, but drops a line longer than
 * `max` bytes and tells `onDropped` its id, if its start showed one: the
 * server answers that request with an error and keeps serving.
 */
export function limitLines(max: number, onDropped: (id: string | number | undefined) => void): Transform {
  let length = 0; // bytes of the current line so far
  let head = ""; // its start, to find the id in
  let dropping = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const out: Buffer[] = [];
      for (let start = 0; start < chunk.length; ) {
        const newline = chunk.indexOf(0x0a, start);
        const end = newline === -1 ? chunk.length : newline + 1;
        const piece = chunk.subarray(start, end);
        if (head.length < 256) head += piece.subarray(0, 256).toString("utf8");
        if (!dropping && length + piece.length > max + (newline === -1 ? 0 : 1)) {
          dropping = true;
          // End the part already passed on, so the next message doesn't
          // join it: a line that isn't JSON is skipped
          out.push(Buffer.from("\n"));
          onDropped(requestId(head));
        }
        if (!dropping) out.push(piece);
        length += piece.length;
        if (newline !== -1) {
          length = 0;
          head = "";
          dropping = false;
        }
        start = end;
      }
      done(null, out.length > 0 ? Buffer.concat(out) : undefined);
    },
  });
}
