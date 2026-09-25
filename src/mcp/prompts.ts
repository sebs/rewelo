import { completable } from "@modelcontextprotocol/server";
import { z } from "zod";
import { PROMPTS } from "./prompts.generated.js";
import { completers } from "./completions.js";
import type { McpContext } from "./toolkit.js";

export function registerPrompts(ctx: McpContext): void {
  const { server, config } = ctx;
  const { completeProject, completeTicket } = completers(ctx);

  // What an argument left out stands for in the prompt's text
  const unset = (arg: string) =>
    arg === "project"
      ? config.project ?? "(no project given: ask the user which one, or call project_list)"
      : "(not given)";

  for (const prompt of PROMPTS) {
    const args = Object.fromEntries(
      prompt.arguments.map((arg) => {
        const schema = z.string().describe(arg === "project" ? "Project name (falls back to .rewelo.json)" : arg.replace(/-/g, " "));
        // Completable inside optional(): the SDK looks for it there
        if (arg === "project") return [arg, completable(schema, completeProject).optional()];
        if (arg === "ticket-title") return [arg, completable(schema, completeTicket).optional()];
        return [arg, schema.optional()];
      })
    );
    server.registerPrompt(prompt.name, { description: prompt.description, argsSchema: z.object(args) }, (values: Record<string, string | undefined>) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            // $0, $1, … are the arguments in order, as in the skill
            text: prompt.body.replace(/\$(\d)/g, (placeholder, i: string) => {
              const arg = prompt.arguments[Number(i)];
              if (arg === undefined) return placeholder;
              return values[arg]?.trim() || unset(arg);
            }),
          },
        },
      ],
    }));
  }
}
