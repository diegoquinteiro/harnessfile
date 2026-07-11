import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { AgentDef } from "../../ir/types.js";
import type { SyncAdapter, SyncContext, SyncResult } from "../types.js";

// github-agent-hq/v1 — generates .github/agents/<slug>.md (Markdown + frontmatter).
// Kept minimal: name, description, and the role-card body.

export function renderGithubAgent(slug: string, agent: AgentDef): string {
  const frontmatter: Record<string, unknown> = {
    name: agent.name ?? slug,
  };
  if (agent.description) frontmatter["description"] = agent.description;
  return `---\n${stringifyYaml(frontmatter)}---\n\n${agent.instructions.trimEnd()}\n`;
}

export class GithubAgentHqAdapter implements SyncAdapter {
  provider = "github-agent-hq/v1";

  async sync(ctx: SyncContext): Promise<SyncResult> {
    const result: SyncResult = { actions: [], warnings: [], notes: [] };
    const outDir = join(ctx.root, ".github", "agents");

    for (const [slug, agent] of Object.entries(ctx.ir.agents)) {
      const path = join(outDir, `${slug}.md`);
      const relPath = relative(ctx.root, path);
      const content = renderGithubAgent(slug, agent);

      if (existsSync(path)) {
        const existing = readFileSync(path, "utf-8");
        if (existing === content) {
          result.actions.push({ kind: "unchanged", description: relPath });
          continue;
        }
        result.actions.push({ kind: "update", description: relPath });
      } else {
        result.actions.push({ kind: "create", description: relPath });
      }

      if (ctx.apply) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(path, content, "utf-8");
      }
    }

    return result;
  }
}
