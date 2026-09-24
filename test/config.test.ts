import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs";
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
    assert.deepEqual(config, {});
  });

  it("reads project from .rewelo.json in the given directory", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "acme" }));
    const config = loadConfig(dir);
    assert.equal(config.project, "acme");
  });

  it("trims whitespace from project name", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "  acme  " }));
    const config = loadConfig(dir);
    assert.equal(config.project, "acme");
  });

  it("walks up to find .rewelo.json in parent directory", () => {
    const { mkdirSync } = require("fs");
    const nested = join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "root-project" }));
    const config = loadConfig(nested);
    assert.equal(config.project, "root-project");
  });

  it("reports invalid JSON instead of skipping to a parent config", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "parent" }));
    const child = join(dir, "child");
    mkdirSync(child);
    writeFileSync(join(child, ".rewelo.json"), '{"project":"child",}');
    assert.throws(() => loadConfig(child), `Invalid JSON in ${join(child, ".rewelo.json")}`);
  });

  it("ignores non-object JSON (array)", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify([1, 2, 3]));
    const config = loadConfig(dir);
    assert.deepEqual(config, {});
  });

  it("ignores empty project string", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "   " }));
    const config = loadConfig(dir);
    assert.equal(config.project, undefined);
  });

  it("ignores non-string project value", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: 42 }));
    const config = loadConfig(dir);
    assert.equal(config.project, undefined);
  });
});
