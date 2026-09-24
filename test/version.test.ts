import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VERSION } from "../src/version.generated.js";

describe("version.generated", () => {
  it("exports a semver-like version string", () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+/);
  });

  it("is not the dev placeholder", () => {
    // After `npm run build`, VERSION should match package.json
    assert.notEqual(VERSION, "0.0.0-dev");
  });
});
