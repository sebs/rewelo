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
    } catch {
      // no config here — walk up
    }
    if (raw !== undefined) {
      // A broken config must not silently fall through to a parent's config
      // (which may name a different project).
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new ValidationError(`Invalid JSON in ${candidate}: ${(e as Error).message}`);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      const config: ReweloConfig = {};
      if (typeof parsed.project === "string" && parsed.project.trim().length > 0) {
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
