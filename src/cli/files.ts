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
  // "missing" its columns or "invalid JSON": say what it is instead. UTF-16
  // starts with a byte order mark, or has NUL bytes around ASCII characters
  const bom = bytes.subarray(0, 2);
  if ((bom[0] === 0xff && bom[1] === 0xfe) || (bom[0] === 0xfe && bom[1] === 0xff) || bytes.subarray(0, 1000).includes(0)) {
    throw new ValidationError(`${path} is UTF-16; save it as UTF-8`);
  }
  return bytes.toString("utf-8");
}
