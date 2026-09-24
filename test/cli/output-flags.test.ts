import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
    expect(rw("--csv", "project", "list").stdout.split("\n")[0]).toBe("Name,UUID,Created");
    rw("tag", "assign", "state:wip", "--project", "P", "--ticket", "A, with comma");
    expect(rw("--csv", "tag", "list", "--project", "P").stdout).toBe("prefix,value\nstate,wip\n");
    expect(rw("--csv", "tag", "log", "--project", "P", "--ticket", "A, with comma").stdout).not.toContain(" | ");
    const priority = rw("--csv", "calc", "priority", "--project", "P").stdout;
    expect(priority).toContain('"A, with comma",');
    expect(priority).not.toContain(" | ");
  });

  it("--json is honoured by delete and assign commands", () => {
    rw("ticket", "create", "--project", "P", "--title", "B");
    expect(JSON.parse(rw("--json", "tag", "assign", "state:wip", "--project", "P", "--ticket", "B").stdout)).toEqual([
      { ticket: "B", tag: "state:wip", status: "assigned" },
    ]);
    expect(JSON.parse(rw("--json", "ticket", "delete", "--project", "P", "--title", "B").stdout)).toEqual({
      deleted: true,
      title: "B",
    });
    expect(JSON.parse(rw("--json", "project", "delete", "P", "--force").stdout)).toEqual({ deleted: true, name: "P" });
  });

  it("--quiet is honoured by ticket upsert and config weights", () => {
    expect(rw("--quiet", "ticket", "upsert", "--project", "P", "--title", "U").stdout.trim()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(rw("--quiet", "config", "weights", "--project", "P", "--set", "--w1", "2").stdout).toBe("");
    expect(rw("--quiet", "config", "weights", "--project", "P", "--reset").stdout).toBe("");
  });
});
