import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// The CLI compiled alongside the tests (build/src/index.js)
export const BIN = resolve(__dirname, "../../src/index.js");

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runCli(
  args: string[],
  opts: { cwd?: string; input?: string; env?: Record<string, string> } = {}
): CliResult {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd,
    input: opts.input ?? "",
    encoding: "utf-8",
    env: { ...process.env, RW_DB_PATH: undefined, NO_COLOR: "1", ...opts.env },
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}
