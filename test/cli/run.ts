import { spawnSync } from "node:child_process";
import { vi } from "vitest";
import { resolve } from "node:path";

const BIN = resolve(__dirname, "../../dist/index.js");

// Each CLI call is a separate node process; under a loaded machine a test
// or setup hook with several calls can exceed the default 10 s, so allow
// CLI tests more.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runCli(args: string[], opts: { cwd?: string; input?: string } = {}): CliResult {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd,
    input: opts.input ?? "",
    encoding: "utf-8",
    env: { ...process.env, RW_DB_PATH: undefined, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}
