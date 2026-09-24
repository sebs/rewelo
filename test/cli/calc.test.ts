import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

    const huge = rw("calc", "priority", "--project", "P", "--w1", "1000", "--w2", "1000");
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
      [["--set", "--w1", "0x10"], '"0x10" is not a valid number'],
      [["--set", "--w1", "1e2"], '"1e2" is not a valid number'],
    ];
    for (const [args, message] of cases) {
      const r = weights(...args);
      assert.equal(r.code, 1, args.join(" "));
      assert.ok(r.stderr.includes(message), args.join(" "));
    }
    assert.ok(weights("--json").stdout.includes('"w1":1.5'));
    assert.ok(weights("--set", "--w1", "2.5").stdout.includes("w1=2.5"));
    assert.ok(weights("--set", "--w1", ".5").stdout.includes("w1=0.5"));
  });

  it("calc weights rounds halves up in the table", () => {
    rw("project", "create", "W");
    for (const [title, benefit] of [["X", "3"], ["Y", "21"], ["Z", "13"], ["V", "3"]]) {
      rw("ticket", "create", "--project", "W", "--title", title, "--benefit", benefit);
    }
    const out = rw("calc", "weights", "--project", "W").stdout;
    assert.match(out, /X +\| +0\.08 /);
    assert.match(out, /Y +\| +0\.53 /);
  });

  it("calc weights --csv writes numbers, not the table's <0.01", () => {
    rw("project", "create", "Big");
    const csv = join(dir, "big.csv");
    writeFileSync(csv, "title\n" + Array.from({ length: 250 }, (_, i) => `T${i}`).join("\n"));
    rw("import", "csv", csv, "--project", "Big");
    const lines = rw("--csv", "calc", "weights", "--project", "Big").stdout.trim().split("\n");
    assert.equal(lines[1], "T0,0.004,0.004,0.004,0.004");
  });

  it("calc weights intersects repeated --tag, and weights can't be given twice", () => {
    rw("project", "create", "T");
    for (const [title, tags] of [["A", ["feature:x", "state:done"]], ["B", ["feature:x"]], ["C", ["state:done"]]] as const) {
      rw("ticket", "create", "--project", "T", "--title", title);
      rw("tag", "assign", ...tags, "--project", "T", "--ticket", title);
    }
    const titles = JSON.parse(rw("--json", "calc", "weights", "--project", "T", "--tag", "feature:x", "--tag", "state:done").stdout).map((r: any) => r.title);
    assert.deepEqual(titles, ["A"]);

    const twice = rw("calc", "priority", "--project", "T", "--w1", "1", "--w1", "2");
    assert.equal(twice.code, 1);
    assert.match(twice.stderr, /option '--w1 <n>' was given more than once/);
    assert.doesNotMatch(twice.stderr, /invalid/);
  });

  it("refuses any single-value option given twice, but still collects --tag", () => {
    rw("project", "create", "T");
    for (const args of [
      ["ticket", "create", "--project", "T", "--title", "D", "--title", "E"],
      ["ticket", "create", "--project", "T", "--title", "D", "--benefit", "5", "--benefit", "8"],
      ["--db", "x.db", "--db", "y.db", "project", "list"],
      ["ticket", "list", "--project", "T", "--project", "U"],
    ]) {
      const r = rw(...args);
      assert.equal(r.code, 1, args.join(" "));
      assert.match(r.stderr, /was given more than once/);
    }
    assert.doesNotMatch(rw("--json", "ticket", "list", "--project", "T").stdout, /"title"/);
    assert.equal(rw("ticket", "list", "--project", "T", "--tag", "a:b", "--tag", "c:d").code, 0);
  });

  it("calc priority can be scoped to tags like calc weights", () => {
    rw("project", "create", "S");
    rw("ticket", "create", "--project", "S", "--title", "In");
    rw("ticket", "create", "--project", "S", "--title", "Out");
    rw("tag", "assign", "feature:x", "--project", "S", "--ticket", "In");
    const titles = JSON.parse(rw("--json", "calc", "priority", "--project", "S", "--tag", "feature:x").stdout).map((r: any) => r.title);
    assert.deepEqual(titles, ["In"]);
  });
});
