import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, listTickets } from "../../src/tickets/repository.js";
import { listTags } from "../../src/tags/repository.js";
import { getTicketTags } from "../../src/tags/assignment.js";
import { importCsv } from "../../src/import/csv.js";
import { exportCsv } from "../../src/export/csv.js";
import { ValidationError } from "../../src/validation/strings.js";

describe("CSV import", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Import");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("imports tickets from CSV", async () => {
    const csv = `title,benefit,penalty,estimate,risk,tags
Login,8,3,5,2,state:backlog
Signup,5,2,3,1,state:wip`;

    const result = await importCsv(db, projectId, csv);
    assert.equal(result.imported, 2);

    const tickets = await listTickets(db, projectId);
    assert.equal(tickets.length, 2);
    assert.equal(tickets[0].title, "Login");
    assert.equal(tickets[0].benefit, 8);
  });

  it("auto-creates tags that don't exist", async () => {
    const csv = `title,benefit,penalty,estimate,risk,tags
Login,8,3,5,2,feature:auth`;

    await importCsv(db, projectId, csv);
    const tags = await listTags(db, projectId);
    assert.equal(tags.some((t) => t.prefix === "feature" && t.value === "auth"), true);
  });

  it("assigns tags to imported tickets", async () => {
    const csv = `title,benefit,penalty,estimate,risk,tags
Login,8,3,5,2,state:backlog`;

    await importCsv(db, projectId, csv);
    const tickets = await listTickets(db, projectId);
    const tags = await getTicketTags(db, tickets[0].id);
    assert.equal(tags.length, 1);
    assert.equal(tags[0].prefix, "state");
  });

  it("rejects invalid Fibonacci values with row number", async () => {
    const csv = `title,benefit,penalty,estimate,risk
Login,8,3,5,2
Bad,4,3,5,2`;

    // Rows count data rows, like JSON import's "Ticket N" (export-import.feature)
    await assert.rejects(importCsv(db, projectId, csv), /Row 2:/);
  });

  it("imports CSV with only title and partial scores (defaults to 1)", async () => {
    const csv = `title,benefit
Login,8`;

    const result = await importCsv(db, projectId, csv);
    assert.equal(result.imported, 1);
  });

  it("rejects CSV missing title column", async () => {
    const csv = `benefit,penalty
8,3`;

    await assert.rejects(importCsv(db, projectId, csv), /Missing required CSV column: title/);
  });

  it("rejects empty CSV", async () => {
    await assert.rejects(importCsv(db, projectId, ""), /CSV is empty/);
  });

  it("handles CSV with description column", async () => {
    const csv = `title,description,benefit,penalty,estimate,risk
Login,The login page,8,3,5,2`;

    await importCsv(db, projectId, csv);
    const tickets = await listTickets(db, projectId);
    assert.equal(tickets[0].description, "The login page");
  });

  it("imports nothing when a row clashes with an existing ticket", async () => {
    await createTicket(db, { projectId, title: "Existing" });
    const csv = `title,benefit,tags
New1,5,state:wip
Existing,3,
New2,2,`;

    await assert.rejects(importCsv(db, projectId, csv), /^ValidationError: Row 2: .*already exists/);
    const titles = (await listTickets(db, projectId)).map((t) => t.title);
    assert.deepEqual(titles, ["Existing"]);
    assert.equal((await listTags(db, projectId)).length, 0);
  });

  it("imports nothing when the file contains a duplicate title", async () => {
    const csv = `title,benefit
Dup,5
Dup,3`;

    await assert.rejects(importCsv(db, projectId, csv), /Row 2: A ticket with title "Dup" already exists/);
    assert.equal((await listTickets(db, projectId)).length, 0);
  });

  it("normalises tags like the CLI does", async () => {
    await importCsv(db, projectId, `title,tags
T,"State:WIP"`);
    const tags = await listTags(db, projectId);
    assert.deepEqual(tags.map((t) => `${t.prefix}:${t.value}`), ["state:wip"]);
  });

  it("rejects invalid tags with the row number", async () => {
    await assert.rejects(importCsv(db, projectId, `title,tags
T,"bad prefix:x"`), /Row 1: Tag prefix must start with a lowercase letter or digit/);
    await assert.rejects(importCsv(db, projectId, `title,tags
T,"state:wip,x"`), /Row 1: Tag "x" must be in prefix:value format/);
    assert.equal((await listTickets(db, projectId)).length, 0);
  });

  it("imports quoted fields that contain newlines", async () => {
    const csv = 'title,description,benefit\nMulti,"line1\nline2, ""q""",5\nNext,,3';
    const result = await importCsv(db, projectId, csv);
    assert.equal(result.imported, 2);
    const tickets = await listTickets(db, projectId);
    assert.partialDeepStrictEqual(tickets[0], { title: "Multi", description: 'line1\nline2, "q"', benefit: 5 });
    assert.partialDeepStrictEqual(tickets[1], { title: "Next", benefit: 3 });
  });

  it("round-trips multi-line descriptions through export and import", async () => {
    const source = await createProject(db, "Source");
    await createTicket(db, {
      projectId: source.id, title: "Multi", description: 'line1\r\nline2, "q"\nline3', benefit: 5,
    });
    await importCsv(db, projectId, await exportCsv(db, source.id));

    const [ticket] = await listTickets(db, projectId);
    assert.partialDeepStrictEqual(ticket, { title: "Multi", description: 'line1\r\nline2, "q"\nline3', benefit: 5 });
  });

  it("rejects non-integer and non-numeric scores instead of truncating them", async () => {
    await assert.rejects(importCsv(db, projectId, "title,benefit\nF,5.9"), /benefit must be a whole number without leading zeros, got "5\.9"/);
    await assert.rejects(importCsv(db, projectId, "title,benefit\nF,5.0"), /benefit must be a whole number/);
    await assert.rejects(importCsv(db, projectId, "title,estimate\nF,08"), /estimate must be a whole number/);
    await assert.rejects(importCsv(db, projectId, "title,estimate\nF,3abc"), /estimate must be a number, got "3abc"/);
    for (const raw of ["0x5", "1e0", "+3", "-1"]) {
      await assert.rejects(importCsv(db, projectId, `title,benefit\nF,${raw}`), /benefit must be a number/, raw);
    }
    assert.equal((await listTickets(db, projectId)).length, 0);
  });

  it("round-trips leading apostrophes, formula characters and whitespace exactly", async () => {
    const source = await createProject(db, "Source2");
    const samples = [
      { title: "'=already", description: "  padded  " },
      { title: "=formula", description: "'quoted" },
      { title: "''double", description: "-minus" },
    ];
    for (const d of samples) await createTicket(db, { projectId: source.id, ...d });

    await importCsv(db, projectId, await exportCsv(db, source.id));
    const imported = (await listTickets(db, projectId)).map((t) => ({ title: t.title, description: t.description }));
    assert.deepEqual(imported, samples);
  });

  it("rejects two values of one tag prefix in a row", async () => {
    await assert.rejects(importCsv(db, projectId, 'title,tags\nT,"state:wip,state:done"'), /Row 1: .*share the prefix "state"/);
  });

  it("normalises titles like ticket create does", async () => {
    await importCsv(db, projectId, 'title\n"  padded  "');
    assert.deepEqual((await listTickets(db, projectId)).map((t) => t.title), ["padded"]);
    await assert.rejects(importCsv(db, projectId, "title\n" + "x".repeat(501)), /Row 1: Ticket title must not exceed/);
  });

  it("rejects unknown, duplicate and extra columns instead of dropping them", async () => {
    await assert.rejects(importCsv(db, projectId, "title,benefit,benfit\nA,5,8"), /Unknown CSV column: "benfit"/);
    await assert.rejects(importCsv(db, projectId, "title,benefit,benefit\nA,5,8"), /Duplicate CSV column: "benefit"/);
    await assert.rejects(importCsv(db, projectId, "title,benefit\nZ,5,extra"), /Row 1: 3 fields but only 2 columns/);
    assert.equal((await listTickets(db, projectId)).length, 0);
  });

  it("accepts the calculated columns written by export --with-calculations", async () => {
    await createTicket(db, { projectId, title: "Calc", benefit: 5 });
    const csv = await exportCsv(db, projectId, { withCalculations: true });
    const target = await createProject(db, "Calc target");
    assert.deepEqual(await importCsv(db, target.id, csv), { imported: 1 });
  });

  it("accepts CR-only line endings", async () => {
    assert.deepEqual(await importCsv(db, projectId, "title,description\rB,x\rC,y\r"), { imported: 2 });
    assert.deepEqual((await listTickets(db, projectId)).map((t) => [t.title, t.description]), [["B", "x"], ["C", "y"]]);
  });

  it("rejects malformed quoting instead of reading it leniently", async () => {
    await assert.rejects(
      importCsv(db, projectId, 'title,description,benefit\nT10,"oops,3\nT11,fine,5\n'),
      /Row 1: a quoted field is never closed/
    );
    await assert.rejects(importCsv(db, projectId, 'title,description\nT9,a"b'), /Row 1: a quote inside an unquoted field/);
    await assert.rejects(importCsv(db, projectId, 'title,description\nT9,"a"b'), /Row 1: unexpected character after a closing quote/);
    assert.equal((await listTickets(db, projectId)).length, 0);
    assert.deepEqual(await importCsv(db, projectId, 'title,description\nOk, "quoted, fine"'), { imported: 1 });
  });
});
