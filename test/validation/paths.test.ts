import { describe, it, expect, afterEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDbPath, validateExportPath } from "../../src/validation/paths.js";
import { ValidationError } from "../../src/validation/strings.js";

describe("validateDbPath", () => {
  it("allows :memory:", () => {
    expect(validateDbPath(":memory:")).toBe(":memory:");
  });

  it("allows valid .db paths", () => {
    const result = validateDbPath("./my-data.db");
    expect(result).toContain("my-data.db");
    expect(result).toMatch(/^\//); // resolved to absolute
  });

  it("accepts the .db extension in any case", () => {
    expect(validateDbPath("./DATA.DB")).toContain("DATA.DB");
    expect(() => validateDbPath("./old.DUCKDB")).toThrow("rw export json");
  });

  it("rejects non-.db extensions", () => {
    expect(() => validateDbPath("./data.sqlite")).toThrow(".db extension");
    expect(() => validateDbPath("./data.txt")).toThrow(".db extension");
  });

  it("rejects legacy .duckdb files with a migration hint", () => {
    expect(() => validateDbPath("./data.duckdb")).toThrow("rw export json");
    // The hint names the last DuckDB release exactly: this build may share its version number
    expect(() => validateDbPath("./data.duckdb")).toThrow("npx rewelo@0.4.2");
  });

  it("rejects null bytes", () => {
    expect(() => validateDbPath("./data\0.db")).toThrow("null bytes");
  });
});

describe("validateDbPath on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-dbpath-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("rejects a symlink to a non-.db file", () => {
    writeFileSync(join(dir, "notes.conf"), "");
    symlinkSync(join(dir, "notes.conf"), join(dir, "link.db"));
    expect(() => validateDbPath(join(dir, "link.db"))).toThrow("resolves to a disallowed location");
  });

  it("rejects a dangling symlink", () => {
    symlinkSync(join(dir, "missing.conf"), join(dir, "dangling.db"));
    expect(() => validateDbPath(join(dir, "dangling.db"))).toThrow("resolves to a disallowed location");
  });

  it("allows a symlink to another .db file", () => {
    writeFileSync(join(dir, "real.db"), "");
    symlinkSync(join(dir, "real.db"), join(dir, "alias.db"));
    expect(validateDbPath(join(dir, "alias.db"))).toBe(join(dir, "alias.db"));
  });
});

describe("validateExportPath", () => {
  it("allows .json extensions", () => {
    const result = validateExportPath("./export.json");
    expect(result).toContain("export.json");
  });

  it("allows .csv extensions", () => {
    const result = validateExportPath("./export.csv");
    expect(result).toContain("export.csv");
  });

  it("rejects other extensions", () => {
    expect(() => validateExportPath("./export.sh")).toThrow(ValidationError);
    expect(() => validateExportPath("./export.exe")).toThrow(ValidationError);
  });

  it("rejects null bytes", () => {
    expect(() => validateExportPath("./export\0.json")).toThrow("null bytes");
  });

  describe("on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-export-"));
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir);
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("allows overwriting a regular file", () => {
      writeFileSync(join(dir, "out.csv"), "old");
      expect(validateExportPath(join(dir, "out.csv"))).toBe(join(dir, "out.csv"));
    });

    it("rejects a symlink", () => {
      writeFileSync(join(dir, "target.txt"), "keep");
      symlinkSync(join(dir, "target.txt"), join(dir, "link.csv"));
      expect(() => validateExportPath(join(dir, "link.csv"))).toThrow("symbolic link");
    });

    it("rejects a dangling symlink", () => {
      symlinkSync(join(dir, "missing.txt"), join(dir, "dangling.csv"));
      expect(() => validateExportPath(join(dir, "dangling.csv"))).toThrow("symbolic link");
    });

    it("rejects a directory", () => {
      mkdirSync(join(dir, "d.csv"));
      expect(() => validateExportPath(join(dir, "d.csv"))).toThrow("regular file");
    });

    it("rejects a missing parent directory", () => {
      expect(() => validateExportPath(join(dir, "nope", "out.csv"))).toThrow("directory does not exist");
    });
  });
});
