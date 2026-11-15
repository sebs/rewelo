import { memorySkillFiles, SkillsExtension, type SkillCatalog } from "@modelcontextprotocol/server/ext/skills";
import { PROMPTS } from "./prompts.generated.js";

// The skills in .claude/skills as the Skills extension (SEP-2640) serves
// them: a client that knows skills gets each SKILL.md as it is, under
// skill://rewelo/<name>/SKILL.md, and the prompts stay for those that don't.
// The files are compiled in (no path to find in the package or the Docker
// image); one catalog serves every server, as building it digests them all.
// Strict: a skill the SDK finds invalid fails the tests, not quietly a client.
let catalog: Promise<SkillCatalog> | undefined;

export function skillCatalog(): Promise<SkillCatalog> {
  catalog ??= SkillsExtension.load(memorySkillFiles(Object.fromEntries(PROMPTS.map((p) => [`${p.dir}/SKILL.md`, p.file]))), {
    prefix: "rewelo",
    strict: true,
  });
  return catalog;
}
