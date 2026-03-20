import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rewelo-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty config when no .rewelo.json exists", () => {
    const config = loadConfig(dir);
    expect(config).toEqual({});
  });

  it("reads project from .rewelo.json in the given directory", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "acme" }));
    const config = loadConfig(dir);
    expect(config.project).toBe("acme");
  });

  it("trims whitespace from project name", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "  acme  " }));
    const config = loadConfig(dir);
    expect(config.project).toBe("acme");
  });

  it("walks up to find .rewelo.json in parent directory", () => {
    const { mkdirSync } = require("fs");
    const nested = join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "root-project" }));
    const config = loadConfig(nested);
    expect(config.project).toBe("root-project");
  });

  it("ignores invalid JSON", () => {
    writeFileSync(join(dir, ".rewelo.json"), "not json {{{");
    const config = loadConfig(dir);
    expect(config).toEqual({});
  });

  it("ignores non-object JSON (array)", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify([1, 2, 3]));
    const config = loadConfig(dir);
    expect(config).toEqual({});
  });

  it("ignores empty project string", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "   " }));
    const config = loadConfig(dir);
    expect(config.project).toBeUndefined();
  });

  it("ignores non-string project value", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: 42 }));
    const config = loadConfig(dir);
    expect(config.project).toBeUndefined();
  });
});
