import { z } from "zod";
import { assignTags, prepareTags } from "../../app/tagging.js";
import { removeTag } from "../../tags/assignment.js";
import { createTag, deleteTag, getTag, listTags, renameTag } from "../../tags/repository.js";
import { AppError } from "../../errors.js";
import { validateTagPrefix, validateTagValue } from "../../validation/strings.js";
import { ADDS, CHANGES, CHANGES_IDEMPOTENT, DELETES, READ, resolveTicket, PROJECT_ARG, type McpContext } from "../toolkit.js";

export function registerTagTools(ctx: McpContext): void {
  const { tool, inProject } = ctx;

  tool(
    "tag_create",
    "Create a tag (prefix:value) without assigning it; tag_assign creates missing tags itself. Prefix and value must be lowercase alphanumeric/hyphens. Must be unique per project.",
    {
      ...PROJECT_ARG,
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    ADDS,
    async ({ project, prefix, value }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validValue = validateTagValue(value);
      return inProject(project, (db, proj) => createTag(db, proj.id, validPrefix, validValue));
    }
  );

  tool(
    "tag_assign",
    "Assign tags to tickets, creating tags that don't exist yet (marked tagCreated), as rw tag assign does. Supports batch: single or multiple tags × single or multiple tickets in one call. A ticket holds one value per prefix: assigning state:done replaces state:wip (reported as 'replaced'), and requesting two values of one prefix is an error.",
    {
      ...PROJECT_ARG,
      ticket: z.string().optional().describe("Ticket title (single)"),
      tickets: z.array(z.string()).optional().describe("Ticket titles (multiple)"),
      prefix: z.string().optional().describe("Tag prefix (single tag)"),
      value: z.string().optional().describe("Tag value (single tag)"),
      tags: z.array(z.object({ prefix: z.string(), value: z.string() })).optional().describe("Multiple tags to assign"),
    },
    CHANGES_IDEMPOTENT,
    async ({ project, ticket: ticketTitle, tickets: ticketTitles, prefix, value, tags: tagList }) => {
      // concat, not push(...): spreading a large array overflows the stack
      const allTickets: string[] = (ticketTitle ? [ticketTitle] : []).concat(ticketTitles ?? []);
      if (allTickets.length === 0) throw new AppError("Provide ticket or tickets");

      const allTags: { prefix: string; value: string }[] = [];
      // Half a tag is a mistake, even when tags is given as well
      if ((prefix === undefined) !== (value === undefined)) throw new AppError("Provide both prefix and value, or neither");
      if (prefix !== undefined && value !== undefined) allTags.push({ prefix, value });
      if (tagList) for (const t of tagList) allTags.push(t);
      if (allTags.length === 0) throw new AppError("Provide prefix+value or tags");
      const tags = prepareTags(allTags);

      // Tags are created as rw tag assign and the imports do: requiring
      // tag_create first made the documented examples fail
      return inProject(project, (db, proj) => assignTags(db, proj.id, allTickets, tags));
    }
  );

  tool(
    "tag_remove",
    "Remove a tag assignment from a ticket. The tag itself is not deleted.",
    {
      ...PROJECT_ARG,
      ticket: z.string().describe("Ticket title"),
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    CHANGES_IDEMPOTENT,
    async ({ project, ticket: ticketTitle, prefix, value }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validValue = validateTagValue(value);
      return inProject(project, async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, ticketTitle);
        const tag = await getTag(db, proj.id, validPrefix, validValue);
        if (!tag) throw new AppError("Tag not found");
        const wasRemoved = await removeTag(db, ticket.id, tag.id);
        return { ticket: ticket.title, tag: `${validPrefix}:${validValue}`, status: wasRemoved ? "removed" : "was_not_assigned" };
      });
    }
  );

  tool(
    "tag_list",
    "List all tags defined in a project, sorted by prefix then value.",
    { ...PROJECT_ARG },
    READ,
    ({ project }) => inProject(project, (db, proj) => listTags(db, proj.id))
  );

  tool(
    "tag_delete",
    "Delete a tag that no ticket holds (use tag_remove on its tickets first). Tickets' tag history is kept.",
    {
      ...PROJECT_ARG,
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    DELETES,
    async ({ project, prefix, value }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validValue = validateTagValue(value);
      return inProject(project, async (db, proj) => {
        const tag = await getTag(db, proj.id, validPrefix, validValue);
        if (!tag) throw new AppError("Tag not found");
        await deleteTag(db, proj.id, tag.id);
        return { deleted: true, tag: `${validPrefix}:${validValue}` };
      });
    }
  );

  tool(
    "tag_rename",
    "Rename a tag's value. All ticket assignments carry over. New value must not conflict with an existing tag under the same prefix.",
    {
      ...PROJECT_ARG,
      prefix: z.string().describe("Tag prefix"),
      oldValue: z.string().describe("Current tag value"),
      newValue: z.string().describe("New tag value"),
    },
    CHANGES,
    async ({ project, prefix, oldValue, newValue }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validOldValue = validateTagValue(oldValue);
      const validNewValue = validateTagValue(newValue);
      return inProject(project, async (db, proj) => {
        const tag = await getTag(db, proj.id, validPrefix, validOldValue);
        if (!tag) throw new AppError("Tag not found");
        return renameTag(db, proj.id, tag.id, validPrefix, validNewValue);
      });
    }
  );
}
