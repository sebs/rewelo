import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// CLI tests (test/cli) run the compiled binary, so compile once per run.
export default function setup(): void {
  const root = resolve(__dirname, "..");
  execFileSync(resolve(root, "node_modules/.bin/tsc"), { cwd: root, stdio: "inherit" });
}
