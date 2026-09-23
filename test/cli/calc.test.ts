import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw calc (CLI)", () => {
  let dir: string;
  let rw: (...args: string[]) => ReturnType<typeof runCli>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    const db = join(dir, "x.db");
    rw = (...args) => runCli(["--db", db, ...args]);
    rw("project", "create", "P");
    rw("ticket", "create", "--project", "P", "--title", "A");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("calc priority validates inline weights like config weights --set", () => {
    const negative = rw("calc", "priority", "--project", "P", "--w1", "-5");
    expect(negative.code).toBe(1);
    expect(negative.stderr).toContain("Weight w1 must be a non-negative number");

    const huge = rw("calc", "priority", "--project", "P", "--w1", "1e308", "--w2", "1e308");
    expect(huge.code).toBe(1);
    expect(huge.stderr).toContain("must not exceed 100");

    expect(rw("calc", "priority", "--project", "P", "--w1", "3").code).toBe(0);
  });

  it("rejects a --limit beyond the safe integer range", () => {
    const r = rw("report", "event-log", "--project", "P", "--limit", "99999999999999999999");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is not a valid integer");
  });

  it("health shows no ratio consistently in text and JSON when there are no low-priority tickets", () => {
    const text = rw("report", "health", "--project", "P", "--threshold", "-1").stdout;
    expect(text).toContain("High:Low ratio: n/a (no low-priority tickets)");
    const json = JSON.parse(rw("--json", "report", "health", "--project", "P", "--threshold", "-1").stdout);
    expect(json).toMatchObject({ highToLowRatio: null, lowPriorityCount: 0 });
  });

  it("rejects integer options with fractions or trailing garbage", () => {
    for (const [option, value] of [["--top", "1.5"], ["--top", "3abc"]]) {
      const r = rw("report", "summary", "--project", "P", option, value);
      expect(r.code, `${option} ${value}`).toBe(1);
      expect(r.stderr).toContain(`"${value}" is not a valid integer`);
    }
    expect(rw("ticket", "list", "--project", "P", "--limit", "2abc").stderr).toContain("is not a valid integer");
    expect(rw("report", "summary", "--project", "P", "--top", "2").code).toBe(0);
  });

  it("config weights rejects flag combinations it would otherwise ignore", () => {
    const weights = (...args: string[]) => rw("config", "weights", "--project", "P", ...args);
    const cases: [string[], string][] = [
      [["--w1", "5"], "Pass --set to change weights"],
      [["--set", "--reset", "--w1", "3"], "Use either --set or --reset"],
      [["--set"], "--set needs at least one of --w1, --w2, --w3, --w4"],
      [["--set", "--w1", "2abc"], '"2abc" is not a valid number'],
    ];
    for (const [args, message] of cases) {
      const r = weights(...args);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.stderr, args.join(" ")).toContain(message);
    }
    expect(weights("--json").stdout).toContain('"w1":1.5');
    expect(weights("--set", "--w1", "2.5").stdout).toContain("w1=2.5");
  });
});
