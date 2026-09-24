import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VERSION } from "../src/version.generated.js";

describe("version.generated", () => {
  it("exports a semver-like version string", () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+/);
  });

  it("is the version in package.json (unless APP_VERSION overrides it)", () => {
    // build/test -> repository root
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8"));
    assert.equal(VERSION, process.env.APP_VERSION || pkg.version);
  });
});
