import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// build/test -> repository root
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8"));

describe("package.json", () => {
  it("does not offer the CLI entry point as a library to require()", () => {
    // require("rewelo") ran the CLI: it printed the help and exited, or with
    // matching argv created ./relative-weight.db
    assert.ok(!Object.values(pkg.bin).includes(pkg.main), "main must not be the CLI");
  });
});
