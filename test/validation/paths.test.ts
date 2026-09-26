import { describe, it, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDbPath, validateExportPath, validateImportPath } from "../../src/validation/paths.js";
import { ValidationError } from "../../src/errors.js";

describe("validateDbPath", () => {
  it("allows :memory:", () => {
    assert.equal(validateDbPath(":memory:"), ":memory:");
  });

  it("allows valid .db paths", () => {
    const result = validateDbPath("./my-data.db");
    assert.ok(result.includes("my-data.db"));
    assert.match(result, /^\//); // resolved to absolute
  });

  it("accepts the .db extension in any case", () => {
    assert.ok(validateDbPath("./DATA.DB").includes("DATA.DB"));
  });

  it("rejects non-.db extensions", () => {
    assert.throws(() => validateDbPath("./data.sqlite"), /\.db extension/);
    assert.throws(() => validateDbPath("./data.txt"), /\.db extension/);
    assert.throws(() => validateDbPath("./data.duckdb"), /\.db extension/);
  });

  it("rejects null bytes", () => {
    assert.throws(() => validateDbPath("./data\0.db"), /null bytes/);
  });
});

describe("validateDbPath on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-dbpath-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("rejects a symlink to a non-.db file", () => {
    writeFileSync(join(dir, "notes.conf"), "");
    symlinkSync(join(dir, "notes.conf"), join(dir, "link.db"));
    assert.throws(() => validateDbPath(join(dir, "link.db")), /resolves to a disallowed location/);
  });

  it("rejects a dangling symlink", () => {
    symlinkSync(join(dir, "missing.conf"), join(dir, "dangling.db"));
    assert.throws(() => validateDbPath(join(dir, "dangling.db")), /resolves to a disallowed location/);
  });

  it("allows a symlink to another .db file", () => {
    writeFileSync(join(dir, "real.db"), "");
    symlinkSync(join(dir, "real.db"), join(dir, "alias.db"));
    assert.equal(validateDbPath(join(dir, "alias.db")), join(dir, "alias.db"));
  });
});

describe("validateExportPath", () => {
  it("allows .json extensions", () => {
    const result = validateExportPath("./export.json");
    assert.ok(result.includes("export.json"));
  });

  it("allows .csv extensions", () => {
    const result = validateExportPath("./export.csv");
    assert.ok(result.includes("export.csv"));
  });

  it("rejects other extensions", () => {
    assert.throws(() => validateExportPath("./export.sh"), ValidationError);
    assert.throws(() => validateExportPath("./export.exe"), ValidationError);
  });

  it("rejects null bytes", () => {
    assert.throws(() => validateExportPath("./export\0.json"), /null bytes/);
  });

  describe("on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-export-"));
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir);
    });
    after(() => rmSync(dir, { recursive: true, force: true }));

    it("allows overwriting a regular file", () => {
      writeFileSync(join(dir, "out.csv"), "old");
      assert.equal(validateExportPath(join(dir, "out.csv")), join(dir, "out.csv"));
    });

    it("rejects a symlink", () => {
      writeFileSync(join(dir, "target.txt"), "keep");
      symlinkSync(join(dir, "target.txt"), join(dir, "link.csv"));
      assert.throws(() => validateExportPath(join(dir, "link.csv")), /symbolic link/);
    });

    it("rejects a dangling symlink", () => {
      symlinkSync(join(dir, "missing.txt"), join(dir, "dangling.csv"));
      assert.throws(() => validateExportPath(join(dir, "dangling.csv")), /symbolic link/);
    });

    it("rejects a directory", () => {
      mkdirSync(join(dir, "d.csv"));
      assert.throws(() => validateExportPath(join(dir, "d.csv")), /regular file/);
    });

    it("rejects a missing parent directory", () => {
      assert.throws(() => validateExportPath(join(dir, "nope", "out.csv")), /directory does not exist/);
    });

    it("checks the path as written, not as resolve() simplifies it", () => {
      writeFileSync(join(dir, "file.json"), "{}");
      assert.throws(() => validateExportPath(`${join(dir, "file.json")}/../out.json`), /directory does not exist/);
      assert.throws(() => validateExportPath(`${join(dir, "t1.json")}/`), /not end in a slash/);
      assert.throws(() => validateDbPath(`${join(dir, "missing")}/../a.db`), /Database directory does not exist/);
    });
  });
});

describe("validateImportPath", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-import-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("checks the extension of the path as typed as well as of a symlink's target", () => {
    writeFileSync(join(dir, "data.csv"), "title\nA\n");
    symlinkSync(join(dir, "data.csv"), join(dir, "link.txt"));
    symlinkSync(join(dir, "data.csv"), join(dir, "link.csv"));
    assert.throws(() => validateImportPath(join(dir, "link.txt"), [".csv"]), /extensions: \.csv/);
    assert.ok(validateImportPath(join(dir, "link.csv"), [".csv"]).endsWith("data.csv"));
  });
});

