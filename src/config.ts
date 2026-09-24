import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { ValidationError } from "./validation/strings.js";

export interface ReweloConfig {
  project?: string;
}

const CONFIG_FILENAME = ".rewelo.json";

/**
 * Walk up from `startDir` looking for `.rewelo.json`.
 * Returns the parsed config or `{}` if none is found.
 */
export function loadConfig(startDir: string = process.cwd()): ReweloConfig {
  let dir = resolve(startDir);
  const root = dirname(dir) === dir ? dir : undefined; // will hit root naturally

  while (true) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    let raw: string | undefined;
    try {
      raw = readFileSync(candidate, "utf-8");
    } catch (e) {
      // No config here: walk up. Anything else (a directory of that name,
      // no permission) must not silently fall through to a parent's config.
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw new ValidationError(`Cannot read ${candidate}: ${(e as Error).message}`);
      }
    }
    if (raw !== undefined) {
      // A broken config must not silently fall through to a parent's config
      // (which may name a different project).
      let parsed;
      try {
        parsed = JSON.parse(raw.replace(/^\uFEFF/, "")); // editors may add a BOM
      } catch (e) {
        throw new ValidationError(`Invalid JSON in ${candidate}: ${(e as Error).message}`);
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
      }
      return config;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return {};
}
