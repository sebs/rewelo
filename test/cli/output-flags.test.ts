import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("global output flags (CLI)", () => {
  let dir: string;
  let rw: (...args: string[]) => ReturnType<typeof runCli>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    const db = join(dir, "x.db");
    rw = (...args) => runCli(["--db", db, ...args]);
    rw("project", "create", "P");
    rw("ticket", "create", "--project", "P", "--title", "A, with comma");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("--csv turns every table into CSV", () => {
    assert.equal(rw("--csv", "project", "list").stdout.split("\n")[0], "Name,UUID,Created");
    rw("tag", "assign", "state:wip", "--project", "P", "--ticket", "A, with comma");
    assert.equal(rw("--csv", "tag", "list", "--project", "P").stdout, "prefix,value\nstate,wip\n");
    assert.ok(!rw("--csv", "tag", "log", "--project", "P", "--ticket", "A, with comma").stdout.includes(" | "));
    const priority = rw("--csv", "calc", "priority", "--project", "P").stdout;
    assert.equal(priority.split("\n")[0], "Title,Priority,Weighted");
    assert.ok(priority.includes('"A, with comma",'));
    assert.ok(!priority.includes(" | "));
  });

  it("--json is honoured by delete and assign commands", () => {
    rw("ticket", "create", "--project", "P", "--title", "B");
    assert.deepEqual(JSON.parse(rw("--json", "tag", "assign", "state:wip", "--project", "P", "--ticket", "B").stdout), [
      { ticket: "B", tag: "state:wip", status: "assigned" },
    ]);
    assert.deepEqual(JSON.parse(rw("--json", "ticket", "delete", "--project", "P", "--title", "B").stdout), {
      deleted: true,
      title: "B",
    });
    assert.deepEqual(JSON.parse(rw("--json", "project", "delete", "P", "--force").stdout), { deleted: true, name: "P" });
  });

  it("--quiet is honoured by ticket upsert and config weights", () => {
    assert.match(rw("--quiet", "ticket", "upsert", "--project", "P", "--title", "U").stdout.trim(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(rw("--quiet", "config", "weights", "--project", "P", "--set", "--w1", "2").stdout, "");
    assert.equal(rw("--quiet", "config", "weights", "--project", "P", "--reset").stdout, "");
  });

  it("--quiet silences commands that change data and shortens lists", () => {
    const t = "A, with comma";
    rw("ticket", "create", "--project", "P", "--title", "B");
    const quiet = (...args: string[]) => rw("--quiet", ...args).stdout;
    assert.equal(quiet("ticket", "update", "--project", "P", "--title", t, "--benefit", "2"), "");
    assert.equal(quiet("tag", "create", "--project", "P", "team:x"), "");
    assert.equal(quiet("tag", "assign", "team:x", "--project", "P", "--ticket", t), "");
    assert.equal(quiet("tag", "list", "--project", "P"), "team:x\n");
    assert.equal(quiet("tag", "log", "--project", "P", "--ticket", t), "added\tteam:x\n");
    assert.equal(quiet("tag", "rename", "--project", "P", "--prefix", "team", "--old", "x", "--new", "y"), "");
    assert.equal(quiet("tag", "remove", "team:y", "--project", "P", "--ticket", t), "");
    assert.equal(quiet("relation", "create", "--project", "P", "--source", t, "--type", "blocks", "--target", "B"), "");
    assert.equal(quiet("relation", "list-all", "--project", "P"), `${t}\tblocks\tB\n`);
    assert.equal(quiet("relation", "list", "--project", "P", "--ticket", "B"), `is-blocked-by\t${t}\n`);
    assert.equal(quiet("relation", "remove", "--project", "P", "--source", t, "--type", "blocks", "--target", "B"), "");
    assert.match(quiet("ticket", "history", "--project", "P", "--title", t), /^\d{4}-\d\d-\d\dT[\d:.]+Z\n$/);
    assert.match(quiet("project", "history", "--project", "P"), /^\d{4}-\d\d-\d\dT[\d:.]+Z\tA, with comma\n$/);
    assert.equal(quiet("ticket", "delete", "--project", "P", "--title", "B"), "");
    assert.equal(quiet("project", "delete", "P", "--force"), "");
  });

  it("--csv and --json never fall back to prose for empty results", () => {
    const empty = (...args: string[]) => runCli(["--db", join(dir, "empty.db"), ...args]).stdout;
    assert.equal(empty("--csv", "project", "list"), "Name,UUID,Created\n");
    const t = "A, with comma";
    const csv = (...args: string[]) => rw("--csv", ...args).stdout;
    assert.equal(csv("relation", "list-all", "--project", "P"), "Source,Type,Target\n");
    assert.equal(csv("relation", "list", "--project", "P", "--ticket", t), "Type,Direction,Ticket\n");
    assert.equal(csv("tag", "log", "--project", "P", "--ticket", t), "Action,Tag,Changed At\n");
    assert.equal(csv("ticket", "history", "--project", "P", "--title", t), "#,Title,B,P,E,R,Tags,Revised At\n");
    assert.equal(csv("report", "times", "--project", "P"), "Title,Lead Time,Cycle Time\n");
    assert.equal(csv("config", "weights", "--project", "P"), "w1,w2,w3,w4\n1.5,1.5,1.5,1.5\n");
    assert.equal(csv("report", "event-log", "--project", "P").split("\n")[0], "Timestamp,Type,Ticket,Detail");

    rw("tag", "create", "--project", "P", "a:b");
    assert.deepEqual(JSON.parse(rw("--json", "tag", "remove", "a:b", "--project", "P", "--ticket", t).stdout), {
      ticket: t,
      tag: "a:b",
      status: "was_not_assigned",
    });
  });

  it("echoes the stored tag and ticket names, not the raw input", () => {
    const out = rw("tag", "assign", "STATE:Done", "--project", "P", "--ticket", "  A, with comma ").stdout;
    assert.equal(out, 'Assigned "state:done" to "A, with comma"\n');
    assert.equal(
      rw("tag", "remove", "STATE:DONE", "--project", "P", "--ticket", " A, with comma").stdout,
      'Removed "state:done" from "A, with comma"\n'
    );
  });

  it("tag assign reports a tag or ticket named twice once", () => {
    const t = "A, with comma";
    const out = rw("tag", "assign", "state:done", "STATE:Done", "--project", "P", "--ticket", t, "--ticket", ` ${t}`).stdout;
    assert.equal(out, `Assigned "state:done" to "${t}"\n`);
  });

  it("project delete without --force and without a terminal fails clearly", () => {
    const missing = rw("project", "delete", "Nope");
    assert.equal(missing.code, 1);
    assert.ok(missing.stderr.includes('Project "Nope" not found'));

    const noTty = rw("project", "delete", "P");
    assert.equal(noTty.code, 1);
    assert.ok(noTty.stderr.includes("pass --force"));
    assert.ok(rw("project", "list").stdout.includes("P"));
  });

  it("aligns table columns by display width and right-aligns numbers", () => {
    rw("ticket", "create", "--project", "P", "--title", "日本語テスト", "--benefit", "13");
    const lines = rw("ticket", "list", "--project", "P").stdout.trimEnd().split("\n");
    // Every row puts its column separators at the same display column
    const width = (s: string) => [...s].reduce((w, ch) => w + (/[\u3000-\u9fff]/.test(ch) ? 2 : 1), 0);
    const pipes = (line: string) => {
      const cols: number[] = [];
      let col = 0;
      for (const ch of line) {
        if (ch === "|") cols.push(col);
        col += width(ch);
      }
      return cols.join(",");
    };
    assert.equal(new Set(lines.map(pipes)).size, 1);
    // Numeric columns are right-aligned: " 1 |" rather than "1  |" under "B "
    const row = lines.find((l) => l.startsWith("A, with comma"))!;
    assert.match(row, /\|  1 \|/);
  });

  it("treats an empty RW_DB_PATH as unset", () => {
    const r = runCli(["project", "create", "Default"], { cwd: dir, env: { RW_DB_PATH: "" } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(existsSync(join(dir, "relative-weight.db")), true);
  });
});
