import { describe, it, expect } from "vitest";
import { validateDbPath, validateExportPath } from "../../src/validation/paths.js";
import { ValidationError } from "../../src/validation/strings.js";

describe("validateDbPath", () => {
  it("allows :memory:", () => {
    expect(validateDbPath(":memory:")).toBe(":memory:");
  });

  it("allows valid .duckdb paths", () => {
    const result = validateDbPath("./my-data.duckdb");
    expect(result).toContain("my-data.duckdb");
    expect(result).toMatch(/^\//); // resolved to absolute
  });

  it("rejects non-.duckdb extensions", () => {
    expect(() => validateDbPath("./data.sqlite")).toThrow("duckdb extension");
    expect(() => validateDbPath("./data.txt")).toThrow("duckdb extension");
  });

  it("rejects null bytes", () => {
    expect(() => validateDbPath("./data\0.duckdb")).toThrow("null bytes");
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
});
