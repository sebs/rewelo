import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

const IMAGE = "rewelo-mcp";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function imageExists(): boolean {
  try {
    execSync(`docker image inspect ${IMAGE}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeDocker = dockerAvailable() && imageExists() ? describe : describe.skip;

describeDocker("Docker hardening", () => {
  it("runs with --cap-drop=ALL", () => {
    const result = execSync(
      `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | docker run --rm -i --init --cap-drop=ALL -v rw-test-data:/data ${IMAGE} serve`,
      { timeout: 15000, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim());
    expect(parsed.result.serverInfo.name).toBe("rewelo");
  });

  it("runs as non-root user", () => {
    const result = execSync(
      `docker run --rm --cap-drop=ALL --entrypoint id ${IMAGE}`,
      { timeout: 10000, encoding: "utf-8" }
    );
    expect(result).not.toContain("uid=0");
    expect(result).toContain("rw");
  });

  it("runs with read-only filesystem and writable /data", () => {
    const result = execSync(
      `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | docker run --rm -i --init --cap-drop=ALL --read-only --tmpfs /tmp -v rw-test-data:/data ${IMAGE} serve`,
      { timeout: 15000, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim());
    expect(parsed.result.serverInfo.name).toBe("rewelo");
  });

  it("runs with 256m memory limit", () => {
    const result = execSync(
      `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | docker run --rm -i --init --cap-drop=ALL --read-only --tmpfs /tmp --memory=256m -v rw-test-data:/data ${IMAGE} serve`,
      { timeout: 15000, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim());
    expect(parsed.result.serverInfo.name).toBe("rewelo");
  });
});
