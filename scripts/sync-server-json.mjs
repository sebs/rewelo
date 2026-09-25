#!/usr/bin/env node
// Writes package.json's version into server.json, the MCP Registry entry:
// the entry's version and the npm and Docker image versions it points to.
// Runs as npm's "version" script, so `npm version` commits both together.
import { readFileSync, writeFileSync } from "fs";

const { version } = JSON.parse(readFileSync("package.json", "utf-8"));
const server = JSON.parse(readFileSync("server.json", "utf-8"));

server.version = version;
for (const pkg of server.packages) {
  if (pkg.registryType === "npm") pkg.version = version;
  // An OCI package names its version in the image tag
  if (pkg.registryType === "oci") pkg.identifier = `${pkg.identifier.replace(/:[^:/]+$/, "")}:${version}`;
}

writeFileSync("server.json", `${JSON.stringify(server, null, 2)}\n`);
