import { statSync, writeFileSync as fsWriteFileSync, readFileSync as fsReadFileSync } from "fs";
import { describeFsError, ValidationError } from "../errors.js";

// File access on paths the user gave: errors name the path and the problem

export function writeFile(path: string, data: string): void {
  try {
    fsWriteFileSync(path, data, "utf-8");
  } catch (err) {
    throw describeFsError(err, "write", path);
  }
}

// Check an import file's size before reading it: reading first took about
// 7 GB of memory for a 3 GB file before the 50 MB limit was even checked
export function readImportFile(path: string, maxBytes: number): string {
  let size: number;
  try {
    size = statSync(path).size;
  } catch (err) {
    throw describeFsError(err, "read", path);
  }
  if (size > maxBytes) {
    throw new ValidationError(`${path} is ${(size / 1024 / 1024).toFixed(1)} MB; imports take at most ${maxBytes / 1024 / 1024} MB`);
  }
  let bytes: Buffer;
  try {
    bytes = fsReadFileSync(path);
  } catch (err) {
    throw describeFsError(err, "read", path);
  }
  // Read as UTF-8, a UTF-16 file (Excel's "Unicode text", Windows tools) is
  // "missing" its columns or "invalid JSON": say what it is instead
  if (isUtf16(bytes)) throw new ValidationError(`${path} is UTF-16; save it as UTF-8`);
  return bytes.toString("utf-8");
}

// UTF-16 starts with a byte order mark, or has a NUL byte next to each ASCII
// character: in most of the text, or in its first four characters. A NUL
// here and there is a UTF-8 file with a NUL in it, which the import rejects
// as such ("must not contain null bytes")
function isUtf16(bytes: Buffer): boolean {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return false; // UTF-8's
  const pairs = Math.floor(Math.min(bytes.length, 1000) / 2);
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < pairs; i++) {
    if (bytes[2 * i] === 0) evenNul++;
    if (bytes[2 * i + 1] === 0) oddNul++;
  }
  if (pairs > 0 && Math.max(evenNul, oddNul) >= pairs / 2) return true;
  // Text in e.g. Japanese has no NUL bytes, but the file starts in ASCII (a
  // CSV header, JSON's "{"): its first characters show the pattern
  const start = bytes.subarray(0, 8);
  const nulAt = (odd: boolean) => start.length === 8 && start.every((b, i) => (i % 2 === 1) === odd ? b === 0 : b !== 0);
  return nulAt(true) || nulAt(false);
}
