import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(negative.code, 1);
    assert.ok(negative.stderr.includes("Weight w1 must be a non-negative number"));

    const huge = rw("calc", "priority", "--project", "P", "--w1", "1e308", "--w2", "1e308");
    assert.equal(huge.code, 1);
    assert.ok(huge.stderr.includes("must not exceed 100"));

    assert.equal(rw("calc", "priority", "--project", "P", "--w1", "3").code, 0);
  });

  it("rejects a --limit beyond the safe integer range", () => {
    const r = rw("report", "event-log", "--project", "P", "--limit", "99999999999999999999");
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("is not a valid integer"));
  });

  it("health shows no ratio consistently in text and JSON when there are no low-priority tickets", () => {
    const text = rw("report", "health", "--project", "P", "--threshold", "-1").stdout;
    assert.ok(text.includes("High:Low ratio: n/a (no low-priority tickets)"));
    const json = JSON.parse(rw("--json", "report", "health", "--project", "P", "--threshold", "-1").stdout);
    assert.partialDeepStrictEqual(json, { highToLowRatio: null, lowPriorityCount: 0 });
  });

  it("rejects integer options with fractions or trailing garbage", () => {
    for (const [option, value] of [["--top", "1.5"], ["--top", "3abc"]]) {
      const r = rw("report", "summary", "--project", "P", option, value);
      assert.equal(r.code, 1, `${option} ${value}`);
      assert.ok(r.stderr.includes(`"${value}" is not a valid integer`));
    }
    assert.ok(rw("ticket", "list", "--project", "P", "--limit", "2abc").stderr.includes("is not a valid integer"));
    assert.equal(rw("report", "summary", "--project", "P", "--top", "2").code, 0);
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
      assert.equal(r.code, 1, args.join(" "));
      assert.ok(r.stderr.includes(message), args.join(" "));
    }
    assert.ok(weights("--json").stdout.includes('"w1":1.5'));
    assert.ok(weights("--set", "--w1", "2.5").stdout.includes("w1=2.5"));
  });
});
