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

  it("builds before packing, so a tarball from a clean checkout contains dist/", () => {
    assert.match(pkg.scripts.prepack ?? "", /npm run build/);
    assert.ok(pkg.files.includes("dist/"));
  });

  it("names the GitHub repository, which npm checks provenance against", () => {
    // Publishing with --provenance failed with E422: "repository.url" is ""
    assert.match(pkg.repository?.url ?? "", /github\.com\/sebs\/rewelo(\.git)?$/);
  });

  it("leaves source maps out of the package, as their sources aren't in it", () => {
    assert.ok(pkg.files.includes("!dist/**/*.map"));
  });
});
