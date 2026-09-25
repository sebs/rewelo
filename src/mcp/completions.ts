import { listProjects } from "../projects/repository.js";
import { listTickets } from "../tickets/repository.js";
import type { McpContext } from "./toolkit.js";

// Completion values: MCP allows at most 100
const MAX_COMPLETIONS = 100;
const matching = (values: string[], typed: string) =>
  values.filter((v) => v.toLowerCase().includes(typed.toLowerCase())).slice(0, MAX_COMPLETIONS);

/** Completions for project names and ticket titles, in prompt arguments and resource URIs */
export function completers({ withDb, withProject, config }: McpContext) {
  const completeProject = async (typed: string | undefined) =>
    matching((await withDb((db) => listProjects(db))).map((p) => p.name), typed ?? "");

  // Titles in the project the prompt names so far, or the default one
  const completeTicket = async (typed: string | undefined, context?: { arguments?: Record<string, string> }) => {
    const name = context?.arguments?.project || config.project;
    if (!name) return [];
    try {
      const tickets = await withProject(name, (db, proj) => listTickets(db, proj.id, { withDescription: false }));
      return matching(tickets.map((t) => t.title), typed ?? "");
    } catch {
      return []; // an unknown project has no titles to offer
    }
  };

  return { completeProject, completeTicket };
}
