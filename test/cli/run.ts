import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// The CLI compiled alongside the tests (build/src/index.js)
export const BIN = resolve(__dirname, "../../src/index.js");

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

// The environment for CLI processes the tests start: no database from the
// developer's shell, and no colour settings. With FORCE_COLOR set in the
// shell, NO_COLOR makes Node print a warning on stderr, which broke tests
// that read stderr.
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, RW_DB_PATH: undefined, FORCE_COLOR: undefined, NO_COLOR: "1", ...extra };
}

export function runCli(
  args: string[],
  opts: { cwd?: string; input?: string; env?: Record<string, string> } = {}
): CliResult {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd,
    input: opts.input ?? "",
    encoding: "utf-8",
    env: childEnv(opts.env),
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}
