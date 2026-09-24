import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "fs";
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

  it("reports a config that is not an object", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify([1, 2, 3]));
    assert.throws(() => loadConfig(dir), /must contain a JSON object/);
  });

  it("reports an empty or non-string project instead of ignoring it", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "   " }));
    assert.throws(() => loadConfig(dir), /"project" field .* must be a non-empty string/);
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: 42 }));
    assert.throws(() => loadConfig(dir), /"project" field .* must be a non-empty string/);
  });

  it("accepts a config without a project field", () => {
    writeFileSync(join(dir, ".rewelo.json"), "{}");
    assert.deepEqual(loadConfig(dir), {});
  });

  it("accepts a UTF-8 BOM", () => {
    writeFileSync(join(dir, ".rewelo.json"), '\uFEFF{"project":"acme"}');
    assert.equal(loadConfig(dir).project, "acme");
  });

  it("reports a directory named .rewelo.json instead of using a parent's config", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "parent" }));
    const child = join(dir, "child");
    mkdirSync(join(child, ".rewelo.json"), { recursive: true });
    assert.throws(() => loadConfig(child), /Cannot read/);
  });

  it("reports unknown keys, such as a misspelt project", () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ Project: "acme" }));
    assert.throws(() => loadConfig(dir), /Unknown key "Project" .*the only key is "project"/);
  });

  it("refuses a symlinked .rewelo.json, whose errors could reveal the linked file", () => {
    writeFileSync(join(dir, "secret.txt"), "SECRET_TOKEN=abcdef123456");
    symlinkSync(join(dir, "secret.txt"), join(dir, ".rewelo.json"));
    assert.throws(() => loadConfig(dir), (err: Error) => /not a symbolic link/.test(err.message) && !err.message.includes("SECRET"));
  });

  it("never quotes the file's content in a JSON error", () => {
    writeFileSync(join(dir, ".rewelo.json"), "SECRET_TOKEN=abcdef123456");
    assert.throws(() => loadConfig(dir), (err: Error) => /^Invalid JSON in /.test(err.message) && !err.message.includes("SECRET"));
  });

  it("reports an unreadable file without the raw OS error", { skip: process.getuid?.() === 0 }, () => {
    writeFileSync(join(dir, ".rewelo.json"), "{}");
    chmodSync(join(dir, ".rewelo.json"), 0o000);
    assert.throws(() => loadConfig(dir), (err: Error) => /: permission denied$/.test(err.message) && !err.message.includes("EACCES"));
  });
});
