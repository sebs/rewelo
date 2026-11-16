import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject, type Project } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { versionFilePath, watchDashboard } from "../../src/cli/dashboard-watch.js";
import { BIN, childEnv, runCli } from "./run.js";

/** Wait until check() holds, or fail after ms */
async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) assert.fail("timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("watchDashboard", () => {
  let dir: string;
  let path: string;
  let watching: DB;
  let other: DB;
  let project: Project;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "rewelo-watch-"));
    path = join(dir, "rw.db");
    watching = await DB.open(path);
    await migrate(watching);
    other = await DB.open(path);
    project = await createProject(other, "Live");
  });

  afterEach(async () => {
    await watching.close();
    await other.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("names the version file after the page", () => {
    assert.equal(versionFilePath(join("out", "dash.html")), join("out", "dash.version.js"));
  });

  it("writes the page again when another process changes the database, and only then", async () => {
    const output = join(dir, "dash.html");
    const stop = new AbortController();
    const versions: string[] = [];
    const watch = watchDashboard({ db: watching, project, output, signal: stop.signal, intervalMs: 20, written: (v) => versions.push(v) });

    await until(() => versions.length === 1);
    const page = readFileSync(output, "utf-8");
    assert.match(page, new RegExp(`<meta name="rewelo-version" content="${versions[0]}">`));
    assert.match(page, /script\.src = "dash\.version\.js" \+ "\?"/);
    assert.equal(readFileSync(versionFilePath(output), "utf-8"), `reweloDashboardVersion(${JSON.stringify(versions[0])});\n`);

    // Nothing changed: no new write
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(versions.length, 1);

    await createTicket(other, { projectId: project.id, title: "Arrived meanwhile" });
    await until(() => versions.length === 2);
    assert.match(readFileSync(output, "utf-8"), /Arrived meanwhile/);
    assert.match(readFileSync(versionFilePath(output), "utf-8"), new RegExp(versions[1]));
    assert.ok(!existsSync(`${output}.${process.pid}.partial`));

    stop.abort();
    await watch;
  });

  it("shows a renamed project's new name and stops when it is deleted", async () => {
    const output = join(dir, "dash.html");
    const stop = new AbortController();
    let writes = 0;
    const watch = watchDashboard({ db: watching, project, output, signal: stop.signal, intervalMs: 20, written: () => writes++ });
    await until(() => writes === 1);

    await other.run("UPDATE projects SET name = 'Renamed' WHERE id = ?", project.id);
    await until(() => readFileSync(output, "utf-8").includes("<h1>Renamed</h1>"));

    await other.run("DELETE FROM projects WHERE id = ?", project.id);
    await assert.rejects(watch, /Project "Live" was deleted/);
  });
});

describe("rw report dashboard --watch", () => {
  it("keeps the file up to date until it is stopped, then exits normally", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rewelo-watch-cli-"));
    try {
      const db = join(dir, "rw.db");
      const output = join(dir, "dash.html");
      assert.equal(runCli(["--db", db, "project", "create", "Acme"]).code, 0);

      const child = spawn(process.execPath, [BIN, "--db", db, "report", "dashboard", "--project", "Acme", "--output", output, "--watch"], {
        env: childEnv(),
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));

      await until(() => stdout.includes("watching for changes"));
      assert.match(readFileSync(output, "utf-8"), /<h1>Acme<\/h1>/);
      assert.ok(existsSync(join(dir, "dash.version.js")));

      assert.equal(runCli(["--db", db, "ticket", "create", "--project", "Acme", "--title", "From another process"]).code, 0);
      await until(() => readFileSync(output, "utf-8").includes("From another process"));
      assert.match(stdout, /Dashboard updated at /);

      child.kill("SIGINT");
      assert.equal(await exited, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes no script without --watch", () => {
    const dir = mkdtempSync(join(tmpdir(), "rewelo-nowatch-"));
    try {
      const db = join(dir, "rw.db");
      runCli(["--db", db, "project", "create", "Acme"]);
      assert.equal(runCli(["--db", db, "report", "dashboard", "--project", "Acme", "--output", join(dir, "d.html")]).code, 0);
      assert.doesNotMatch(readFileSync(join(dir, "d.html"), "utf-8"), /<script/);
      assert.ok(!existsSync(join(dir, "d.version.js")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
