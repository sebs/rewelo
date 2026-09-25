import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// build/test -> repository root
const root = resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const server = JSON.parse(readFileSync(resolve(root, "server.json"), "utf-8"));
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf-8");

const npmPackage = server.packages.find((p: { registryType: string }) => p.registryType === "npm");
const ociPackage = server.packages.find((p: { registryType: string }) => p.registryType === "oci");

// The MCP Registry checks the published npm package and image against the entry
describe("server.json (MCP Registry entry)", () => {
  it("has the name the npm package and the image claim", () => {
    assert.equal(server.name, "io.github.sebs/rewelo");
    assert.equal(pkg.mcpName, server.name);
    assert.match(dockerfile, new RegExp(`^LABEL io\\.modelcontextprotocol\\.server\\.name="${server.name.replace(/\./g, "\\.")}"$`, "m"));
  });

  it("is at package.json's version, and points to that npm version and image", () => {
    assert.equal(server.version, pkg.version);
    assert.deepEqual([npmPackage.identifier, npmPackage.version], [pkg.name, pkg.version]);
    assert.equal(ociPackage.identifier, `ghcr.io/sebs/rewelo:${pkg.version}`);
    // An OCI package names its version in the tag only
    assert.equal(ociPackage.version, undefined);
  });

  it("is kept at that version by npm version", () => {
    assert.match(pkg.scripts.version, /sync-server-json\.mjs && git add server\.json/);
  });

  it("starts the server with serve, and fits the registry's limits", () => {
    for (const p of server.packages) assert.deepEqual(p.packageArguments, [{ type: "positional", value: "serve" }]);
    assert.ok(server.description.length <= 100, `${server.description.length} characters`);
  });

  it("runs the image as mcp.md recommends", () => {
    const args = ociPackage.runtimeArguments.map((a: { name?: string; value: string }) => (a.name ? `${a.name}=${a.value}` : a.value));
    for (const flag of ["--init", "--read-only", "--cap-drop=ALL", "--tmpfs=/tmp", "--memory=256m", "--volume=rw-data:/data"]) {
      assert.ok(args.includes(flag), flag);
    }
  });
});
