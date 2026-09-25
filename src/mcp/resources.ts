import { ResourceNotFoundError, ResourceTemplate, type Variables } from "@modelcontextprotocol/server";
import { cost, priority, value } from "../calculations/priority.js";
import { rank } from "../calculations/scenario.js";
import { weightedPriority } from "../calculations/weighted-priority.js";
import { exportCsv } from "../transfer/csv/export.js";
import { listProjects } from "../projects/repository.js";
import { listRelations } from "../relations/repository.js";
import { doneTicketIds } from "../workflow/states.js";
import { getProjectTicketTags, getTicketTags } from "../tags/assignment.js";
import { listTickets } from "../tickets/repository.js";
import { sanitizeError, AppError } from "../errors.js";
import { getWeights } from "../weights/repository.js";
import { checkDocumentSize, dashboard, jsonExport, MAX_DOCUMENT_BYTES, resourceUri } from "./documents.js";
import { MAX_RESULT_BYTES, shorten } from "./results.js";
import { completers } from "./completions.js";
import { resolveTicket, type McpContext } from "./toolkit.js";

export function registerResources(ctx: McpContext): void {
  const { withDb, withProject, server } = ctx;
  const { completeProject, completeTicket } = completers(ctx);

  // A template variable as the URI has it, percent-encoded
  const variable = (vars: Variables, name: string) => {
    const raw = vars[name];
    return decodeURIComponent(Array.isArray(raw) ? raw[0] : raw);
  };

  async function readResource(uri: URL, mimeType: string, read: () => Promise<unknown>, maxBytes = MAX_RESULT_BYTES) {
    try {
      const data = await read();
      const text = checkDocumentSize(typeof data === "string" ? data : JSON.stringify(data), maxBytes);
      return { contents: [{ uri: uri.href, mimeType, text }] };
    } catch (err) {
      const message = shorten(sanitizeError(err));
      if (err instanceof AppError && /not found/.test(message)) throw new ResourceNotFoundError(uri.href, message);
      throw new AppError(message);
    }
  }

  const tagLabels = (tags: { prefix: string; value: string }[]) => tags.map((t) => `${t.prefix}:${t.value}`);

  // One resource per project, for the templates that have one
  const perProject = (path: string, what: string, mimeType: string) => async () => ({
    resources: (await withDb((db) => listProjects(db))).map((p) => ({
      uri: resourceUri(p.name, path),
      name: `${p.name} ${what}`,
      mimeType,
    })),
  });

  server.registerResource(
    "backlog",
    new ResourceTemplate("rewelo://{project}/backlog", {
      list: perProject("backlog", "backlog", "application/json"),
      complete: { project: completeProject },
    }),
    {
      title: "Backlog",
      description: "A project's open tickets (not state:done), ranked as calc_priority ranks them, with scores, priorities and tags",
      mimeType: "application/json",
    },
    (uri, vars) =>
      readResource(uri, "application/json", () =>
        withProject(variable(vars, "project"), async (db, proj) => {
          const tickets = await listTickets(db, proj.id, { withDescription: false });
          const done = await doneTicketIds(db, proj.id);
          const tags = await getProjectTicketTags(db, proj.id);
          const { w1, w2, w3, w4 } = await getWeights(db, proj.id);
          const weights = { w1, w2, w3, w4 };
          const open = rank(tickets.filter((t) => !done.has(t.id)), weights);
          return {
            project: proj.name,
            weights,
            openTickets: open.length,
            doneTickets: tickets.length - open.length,
            tickets: open.map((t, i) => ({
              rank: i + 1,
              title: t.title,
              benefit: t.benefit,
              penalty: t.penalty,
              estimate: t.estimate,
              risk: t.risk,
              priority: priority(t),
              weighted: weightedPriority(t, weights),
              tags: tagLabels(tags.get(t.id) ?? []),
            })),
          };
        })
      )
  );

  server.registerResource(
    "ticket",
    // Not listed: a project can have thousands; complete the title instead
    new ResourceTemplate("rewelo://{project}/ticket/{title}", {
      list: undefined,
      complete: { project: completeProject, title: completeTicket },
    }),
    {
      title: "Ticket",
      description: "One ticket with its description, scores, priorities, tags and relations. The title is percent-encoded in the URI.",
      mimeType: "application/json",
    },
    (uri, vars) =>
      readResource(uri, "application/json", () =>
        withProject(variable(vars, "project"), async (db, proj) => {
          const t = await resolveTicket(db, proj.id, variable(vars, "title"));
          const weights = await getWeights(db, proj.id);
          return {
            project: proj.name,
            id: t.id,
            title: t.title,
            description: t.description,
            benefit: t.benefit,
            penalty: t.penalty,
            estimate: t.estimate,
            risk: t.risk,
            value: value(t),
            cost: cost(t),
            priority: priority(t),
            weighted: weightedPriority(t, weights),
            tags: tagLabels(await getTicketTags(db, t.id)),
            relations: await listRelations(db, proj.id, t.id),
            created_at: t.created_at,
            updated_at: t.updated_at,
          };
        })
      )
  );

  server.registerResource(
    "dashboard",
    new ResourceTemplate("rewelo://{project}/dashboard", {
      list: perProject("dashboard", "dashboard", "text/html"),
      complete: { project: completeProject },
    }),
    {
      title: "Dashboard",
      description: "A project's self-contained HTML dashboard (tickets, distribution, health, relations), as report_dashboard renders it",
      mimeType: "text/html",
    },
    (uri, vars) => readResource(uri, "text/html", () => withProject(variable(vars, "project"), (db, proj) => dashboard(db, proj)), MAX_DOCUMENT_BYTES)
  );

  // Where report_dashboard links to with a limit
  server.registerResource(
    "dashboard-rows",
    new ResourceTemplate("rewelo://{project}/dashboard/{limit}", { list: undefined, complete: { project: completeProject } }),
    {
      title: "Dashboard with a row limit",
      description: "The dashboard with at most limit rows per table",
      mimeType: "text/html",
    },
    (uri, vars) =>
      readResource(
        uri,
        "text/html",
        () => {
          const limit = variable(vars, "limit");
          if (!/^\d{1,9}$/.test(limit)) throw new AppError(`Invalid limit "${limit}": expected a whole number`);
          return withProject(variable(vars, "project"), (db, proj) => dashboard(db, proj, Number(limit)));
        },
        MAX_DOCUMENT_BYTES
      )
  );

  const EXPORT_FORMATS: Record<string, string> = {
    csv: "text/csv",
    "csv-with-calculations": "text/csv",
    json: "application/json",
    "json-with-history": "application/json",
  };

  // Where export_csv and export_json link to when an export is too large
  server.registerResource(
    "export",
    new ResourceTemplate("rewelo://{project}/export/{format}", {
      list: undefined,
      complete: { project: completeProject, format: (typed) => Object.keys(EXPORT_FORMATS).filter((f) => f.startsWith(typed ?? "")) },
    }),
    {
      title: "Export",
      description: "A project's export as export_csv or export_json returns it. format: csv, csv-with-calculations, json or json-with-history.",
    },
    async (uri, vars) => {
      const format = variable(vars, "format");
      const mimeType = EXPORT_FORMATS[format];
      if (!mimeType) throw new ResourceNotFoundError(uri.href, `Unknown export format "${format}": use ${Object.keys(EXPORT_FORMATS).join(", ")}`);
      return readResource(
        uri,
        mimeType,
        () =>
          withProject(variable(vars, "project"), (db, proj) =>
            format.startsWith("csv")
              ? exportCsv(db, proj.id, { withCalculations: format === "csv-with-calculations" })
              : jsonExport(db, proj.id, format === "json-with-history", MAX_DOCUMENT_BYTES)
          ),
        MAX_DOCUMENT_BYTES
      );
    }
  );
}
