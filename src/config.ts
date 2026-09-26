import { lstatSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { ValidationError, describeFsError } from "./errors.js";

export interface ReweloConfig {
  project?: string;
  /** The file project was read from */
  source?: string;
}

const CONFIG_FILENAME = ".rewelo.json";
const MAX_CONFIG_BYTES = 64 * 1024;

/**
 * Walk up from `startDir` looking for `.rewelo.json`.
 * Returns the parsed config or `{}` if none is found.
 */
export function loadConfig(startDir: string = process.cwd()): ReweloConfig {
  let dir = resolve(startDir);

  while (true) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    let raw: string | undefined;
    try {
      // Errors quote the file (to point at a mistake), and the MCP server
      // passes them to its client: a link to another file (a secret) would
      // leak its content, so, as for --db and --output, no symbolic links
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new ValidationError(`${candidate} must be a regular file, not a symbolic link`);
      // Reading a FIFO or a device blocks, which hung the CLI and the MCP
      // server (it loads the config at startup)
      if (!stat.isFile() && !stat.isDirectory()) throw new ValidationError(`${candidate} must be a regular file`);
      if (stat.isFile() && stat.size > MAX_CONFIG_BYTES) throw new ValidationError(`${candidate} is too large for a .rewelo.json`);
      raw = readFileSync(candidate, "utf-8");
    } catch (e) {
      if (e instanceof ValidationError) throw e;
      // No config here: walk up. Anything else (a directory of that name,
      // no permission) must not silently fall through to a parent's config.
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw describeFsError(e, "read", candidate);
      }
    }
    if (raw !== undefined) {
      // A broken config must not silently fall through to a parent's config
      // (which may name a different project).
      let parsed;
      try {
        parsed = JSON.parse(raw.replace(/^\uFEFF/, "")); // editors may add a BOM
      } catch {
        // Not the parser's message: it quotes the file's content
        throw new ValidationError(`Invalid JSON in ${candidate}; it should look like {"project": "Acme"}`);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ValidationError(`${candidate} must contain a JSON object, e.g. {"project": "Acme"}`);
      }
      // A misspelt key ("Project") would otherwise be ignored, and the error
      // then claims there is no .rewelo.json at all
      const unknown = Object.keys(parsed).filter((key) => key !== "project");
      if (unknown.length > 0) {
        throw new ValidationError(
          `Unknown key${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")} in ${candidate}; the only key is "project"`
        );
      }
      const config: ReweloConfig = {};
      if (parsed.project !== undefined) {
        if (typeof parsed.project !== "string" || parsed.project.trim().length === 0) {
          throw new ValidationError(`The "project" field in ${candidate} must be a non-empty string`);
        }
        config.project = parsed.project.trim();
        config.source = candidate;
      }
      return config;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return {};
}
