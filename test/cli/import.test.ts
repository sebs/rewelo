import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw import (CLI)", () => {
  let dir: string;
  let db: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    db = join(dir, "x.db");
    assert.equal(runCli(["--db", db, "project", "create", "P"]).code, 0);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const importCsv = (file: string) => runCli(["--db", db, "import", "csv", file, "--project", "P"]);

  it("imports a regular .csv file", () => {
    writeFileSync(join(dir, "ok.csv"), "title\nA\n");
    const r = importCsv(join(dir, "ok.csv"));
    assert.ok(r.stdout.includes("Imported 1 ticket\n"));
  });

  it("leaves no new database behind when import json fails, and names the missing file", () => {
    writeFileSync(join(dir, "bad.json"), "{");
    for (const [file, message] of [["nonexist.json", /nonexist\.json does not exist/], ["bad.json", /Invalid JSON/]] as const) {
      const fresh = join(dir, `fresh-${file}.db`);
      const r = runCli(["--db", fresh, "import", "json", join(dir, file), "--project", "X"]);
      assert.equal(r.code, 1, file);
      assert.match(r.stderr, message, file);
      assert.equal(existsSync(fresh), false, `${file}: ${fresh} was created`);
    }
    writeFileSync(join(dir, "good.json"), '{"tickets":[{"title":"a"}]}');
    const fresh = join(dir, "fresh-name.db");
    const r = runCli(["--db", fresh, "import", "json", join(dir, "good.json"), "--project", "bad/name"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Project name must contain only/);
    assert.equal(existsSync(fresh), false, `${fresh} was created`);

    // Nor when it fails inside the database, on a relation to a missing ticket
    writeFileSync(join(dir, "bad-relation.json"), JSON.stringify({ tickets: [{ title: "A" }], relations: [{ source: "A", type: "blocks", target: "Zed" }] }));
    const late = join(dir, "fresh-late.db");
    const failed = runCli(["--db", late, "import", "json", join(dir, "bad-relation.json"), "--project", "P"]);
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /Relation 1: ticket "Zed" not found/);
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("fresh-late")), []);

    // Named as stored
    const created = runCli(["--db", join(dir, "named.db"), "import", "json", join(dir, "good.json"), "--project", " Sp "]);
    assert.match(created.stdout, /^Created project "Sp"$/m);
  });

  it("says a NUL byte in a UTF-8 file is a NUL byte, not UTF-16", () => {
    writeFileSync(join(dir, "nul.csv"), "title,description\nabc,de\0f\n");
    writeFileSync(join(dir, "nulbom.csv"), "\uFEFFtitle,description\nabc,de\0f\n");
    for (const file of ["nul.csv", "nulbom.csv"]) {
      const r = runCli(["--db", db, "import", "csv", join(dir, file), "--project", "P"]);
      assert.equal(r.code, 1, file);
      assert.match(r.stderr, /must not contain null bytes/, file);
    }
  });

  it("says a UTF-16 file is UTF-16, instead of missing columns or invalid JSON", () => {
    const utf16 = (text: string, bom: number[]) => Buffer.concat([Buffer.from(bom), Buffer.from(text, "utf16le")]);
    writeFileSync(join(dir, "le.csv"), utf16("title,benefit\r\ncafe,3\r\n", [0xff, 0xfe]));
    writeFileSync(join(dir, "le.json"), utf16('{"tickets":[{"title":"x"}]}', [0xff, 0xfe]));
    writeFileSync(join(dir, "nobom.csv"), utf16("title\nx\n", []));
    // Mostly non-ASCII: only the start shows NUL bytes
    writeFileSync(join(dir, "ja.csv"), utf16("title\n" + "日本語のチケット\n".repeat(50), []));
    writeFileSync(join(dir, "ja.json"), utf16('{"tickets":[' + '{"title":"日本語のチケット"},'.repeat(40) + '{"title":"x"}]}', []));
    for (const [kind, file] of [["csv", "le.csv"], ["json", "le.json"], ["csv", "nobom.csv"], ["csv", "ja.csv"], ["json", "ja.json"]]) {
      const r = runCli(["--db", db, "import", kind, join(dir, file), "--project", "P"]);
      assert.equal(r.code, 1, file);
      assert.match(r.stderr, /is UTF-16; save it as UTF-8/, file);
    }
  });

  it("refuses a file over 50 MB before reading it", () => {
    const huge = join(dir, "huge.csv");
    writeFileSync(huge, "");
    truncateSync(huge, 3 * 1024 * 1024 * 1024); // sparse: 3 GB without using disk
    const r = importCsv(huge);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /huge\.csv is 3072\.0 MB; imports take at most 50 MB/);
  });

  it("rejects a file with the wrong extension", () => {
    writeFileSync(join(dir, "t.txt"), "title\nA\n");
    const r = importCsv(join(dir, "t.txt"));
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("Import file must have one of these extensions: .csv"));
  });

  it("rejects a JSON file for CSV import", () => {
    writeFileSync(join(dir, "t.json"), "{}");
    assert.ok((importCsv(join(dir, "t.json")).stderr).includes("extensions: .csv"));
  });

  it("rejects a directory", () => {
    mkdirSync(join(dir, "d.csv"));
    const r = importCsv(join(dir, "d.csv"));
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("must be a regular file"));
  });

  it("rejects a missing file with a clear message", () => {
    const r = importCsv(join(dir, "nope.csv"));
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("does not exist"));
  });

  it("rejects a symlink to a non-CSV file", () => {
    symlinkSync("/etc/hosts", join(dir, "h.csv"));
    const r = importCsv(join(dir, "h.csv"));
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("extensions: .csv"));
  });

  it("validates the JSON import path too", () => {
    writeFileSync(join(dir, "t.csv"), "title\nA\n");
    const r = runCli(["--db", db, "import", "json", join(dir, "t.csv"), "--project", "P"]);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("extensions: .json"));
  });
});

describe("rw import json into a new project (CLI)", () => {
  it("creates the project and restores tickets and tags", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    const db = join(dir, "x.db");
    try {
      runCli(["--db", db, "project", "create", "P"]);
      runCli(["--db", db, "ticket", "create", "--project", "P", "--title", "A", "--benefit", "5"]);
      runCli(["--db", db, "tag", "assign", "state:wip", "--project", "P", "--ticket", "A"]);
      runCli(["--db", db, "export", "json", "--project", "P", "--output", join(dir, "p.json")]);

      const r = runCli(["--db", db, "import", "json", join(dir, "p.json"), "--project", "NewProject"]);
      assert.ok(r.stdout.includes('Created project "NewProject"'));
      assert.ok(r.stdout.includes("Imported 1 ticket\n"));

      const list = runCli(["--db", db, "--json", "ticket", "list", "--project", "NewProject", "--tag", "state:wip"]);
      assert.deepEqual(JSON.parse(list.stdout).items.map((t: { title: string }) => t.title), ["A"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("rw history tables (CLI)", () => {
  let dir: string;
  let db: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    db = join(dir, "x.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints line breaks in an imported revision title escaped, not as rows", () => {
    const revision = { title: "old\nB | 21 | 21", benefit: 1, penalty: 1, estimate: 1, risk: 1, tags: [], revised_at: "2025-01-02T00:00:00.000Z" };
    writeFileSync(join(dir, "h.json"), JSON.stringify({ tickets: [{ title: "A", createdAt: "2025-01-01T00:00:00.000Z", revisions: [revision] }] }));
    assert.equal(runCli(["--db", db, "import", "json", join(dir, "h.json"), "--project", "Q"]).code, 0);
    for (const args of [["ticket", "history", "--project", "Q", "--title", "A"], ["project", "history", "--project", "Q"]]) {
      const out = runCli(["--db", db, ...args]).stdout;
      assert.equal(out.trim().split("\n").length, 3, out);
      assert.ok(out.includes("old\\nB | 21 | 21"), out);
    }
    // CSV keeps the text as it is, quoted
    assert.ok(runCli(["--db", db, "--csv", "ticket", "history", "--project", "Q", "--title", "A"]).stdout.includes('"old\nB | 21 | 21"'));
  });
});
