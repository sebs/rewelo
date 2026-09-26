import { inputRequired, inputResponse } from "@modelcontextprotocol/server";
import { z } from "zod";
import { normalizeName } from "../../text.js";
import { createProject, deleteProject, listProjects } from "../../projects/repository.js";
import { AppError } from "../../errors.js";
import { countTickets } from "../../tickets/repository.js";
import { validateProjectName } from "../../validation/strings.js";
import { VERSION } from "../../version.generated.js";
import { ADDS, DELETES, READ, type McpContext } from "../toolkit.js";

export function registerProjectTools(ctx: McpContext): void {
  const { tool, withDb, withProject, canAskUser } = ctx;

  tool(
    "server_version",
    "Return the server version string. Use to verify which build is running.",
    {},
    READ,
    async () => ({ version: VERSION })
  );


  tool(
    "project_create",
    "Create a new project. Name must be unique; letters, digits, spaces, hyphens and underscores (not starting with a space), max 100 characters.",
    { name: z.string().describe("Project name") },
    ADDS,
    async ({ name }) => {
      const validName = validateProjectName(name);
      return withDb((db) => createProject(db, validName));
    }
  );

  tool("project_list", "List all projects with their IDs and creation dates.", {}, READ,
    () => withDb((db) => listProjects(db))
  );

  tool(
    "project_delete",
    "Delete a project and all its tickets, tags, relations, and history. Irreversible. When the client supports forms (elicitation), the user is asked to confirm first, as rw project delete does.",
    { name: z.string().describe("Project name") },
    DELETES,
    async ({ name }, ctx) => {
      // The name as stored and looked up (" Sq " finds Sq), as the CLI shows it
      const stored = normalizeName(name);
      const answer = inputResponse(ctx.mcpReq.inputResponses, "confirm");
      if (answer.kind === "missing" && canAskUser()) {
        // Like every other tool (and the CLI), a missing project is an
        // error, and asking to confirm its deletion is pointless
        const tickets = await withProject(name, (db, proj) => countTickets(db, proj.id));
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Delete project "${stored}" and all its data (${tickets} ticket${tickets === 1 ? "" : "s"}, their tags, relations and history)? This cannot be undone.`,
              requestedSchema: {
                type: "object",
                properties: { confirm: { type: "boolean", title: "Delete the project", default: false } },
                required: ["confirm"],
              },
            }),
          },
        });
      }
      if (answer.kind !== "missing" && !(answer.kind === "elicit" && answer.action === "accept" && answer.content?.confirm === true)) {
        throw new AppError(`Project "${stored}" was not deleted: the user did not confirm.`);
      }
      if (!(await withDb((db) => deleteProject(db, name)))) throw new AppError("Project not found");
      return { deleted: true };
    }
  );
}
