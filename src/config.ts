import { readFileSync } from "fs";
import { resolve, dirname } from "path";

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
    try {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      const config: ReweloConfig = {};
      if (typeof parsed.project === "string" && parsed.project.trim().length > 0) {
        config.project = parsed.project.trim();
      }
      return config;
    } catch {
      // file not found or not valid JSON — walk up
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return {};
}
