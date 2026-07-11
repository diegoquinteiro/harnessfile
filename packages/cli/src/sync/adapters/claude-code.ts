import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { SyncAdapter, SyncContext, SyncResult } from "../types.js";

// claude-code/v1 — materializes .claude/{agents,skills} as relative symlinks
// into .agents/. Idempotent; never deletes user data (real directories are
// reported as drift and skipped).

export class ClaudeCodeAdapter implements SyncAdapter {
  provider = "claude-code/v1";

  async sync(ctx: SyncContext): Promise<SyncResult> {
    const result: SyncResult = { actions: [], warnings: [], notes: [] };

    const links: Array<{ link: string; target: string }> = [
      {
        link: join(ctx.root, ".claude", "agents"),
        target: join(ctx.agentsDir, "agents"),
      },
      {
        link: join(ctx.root, ".claude", "skills"),
        target: join(ctx.agentsDir, "skills"),
      },
    ];

    for (const { link, target } of links) {
      const relLink = relative(ctx.root, link);
      const relTarget = relative(dirname(link), target);

      if (!existsSync(target)) {
        result.actions.push({
          kind: "skip",
          description: `${relLink} — source ${relative(ctx.root, target)} does not exist`,
        });
        continue;
      }

      let existing: "none" | "symlink" | "real" = "none";
      let currentTarget: string | undefined;
      try {
        const stat = lstatSync(link);
        if (stat.isSymbolicLink()) {
          existing = "symlink";
          currentTarget = readlinkSync(link);
        } else {
          existing = "real";
        }
      } catch {
        existing = "none";
      }

      if (existing === "real") {
        result.actions.push({
          kind: "skip",
          description: `${relLink} — exists and is not a symlink (drift)`,
        });
        result.warnings.push(
          `${relLink} exists as a real directory/file — refusing to touch it. Move it aside to let sync manage it.`,
        );
        continue;
      }

      if (existing === "symlink" && currentTarget === relTarget) {
        result.actions.push({
          kind: "unchanged",
          description: `${relLink} → ${relTarget}`,
        });
        continue;
      }

      const verb = existing === "symlink" ? "update" : "create";
      result.actions.push({
        kind: verb,
        description: `symlink ${relLink} → ${relTarget}${
          existing === "symlink" ? ` (was → ${currentTarget})` : ""
        }`,
      });

      if (ctx.apply) {
        mkdirSync(dirname(link), { recursive: true });
        if (existing === "symlink") unlinkSync(link);
        symlinkSync(relTarget, link, "dir");
      }
    }

    return result;
  }
}
