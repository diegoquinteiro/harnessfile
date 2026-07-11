import type { LoadedHarness } from "../parser/directory.js";
import type { ProviderRef } from "../ir/types.js";
import type { SyncAdapter, SyncContext, SyncResult } from "./types.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { CodexAdapter } from "./adapters/codex.js";
import { GithubAgentHqAdapter } from "./adapters/github.js";
import { MulticaAdapter } from "./adapters/multica.js";

// The sync engine: resolves the target's provider to an adapter and runs it.
// Dry run by default; --apply mutates (D45). Ownership semantics live in
// ownership.ts and are shared by adapters (D42).

const builtinAdapters: SyncAdapter[] = [
  new ClaudeCodeAdapter(),
  new CodexAdapter(),
  new GithubAgentHqAdapter(),
  new MulticaAdapter(),
];

export function getAdapter(
  provider: string | ProviderRef | undefined,
  extra: SyncAdapter[] = [],
): SyncAdapter {
  const providerId =
    typeof provider === "string" ? provider : provider?.type ?? "";
  const adapter = [...extra, ...builtinAdapters].find(
    (a) => a.provider === providerId,
  );
  if (!adapter) {
    const available = builtinAdapters.map((a) => a.provider).join(", ");
    throw new Error(
      `No sync adapter for provider '${providerId}'. Available: ${available}`,
    );
  }
  return adapter;
}

export interface SyncRunOptions {
  targetName: string;
  apply: boolean;
  /** Include destructive remote deletions in the plan (default false). */
  prune?: boolean;
  adapters?: SyncAdapter[];
}

export async function runSync(
  harness: LoadedHarness,
  options: SyncRunOptions,
): Promise<SyncResult> {
  const targets = harness.ir.targets ?? {};
  const target = targets[options.targetName];
  if (!target) {
    const available = Object.keys(targets);
    throw new Error(
      `Target '${options.targetName}' is not defined in harness.yaml.${
        available.length > 0 ? ` Available targets: ${available.join(", ")}` : " No targets are defined."
      }`,
    );
  }

  const adapter = getAdapter(target.provider, options.adapters ?? []);
  const ctx: SyncContext = {
    root: harness.root,
    agentsDir: harness.agentsDir,
    ir: harness.ir,
    targetName: options.targetName,
    target,
    apply: options.apply,
    prune: options.prune ?? false,
  };
  return adapter.sync(ctx);
}

const KIND_SYMBOLS: Record<string, string> = {
  create: "+",
  update: "~",
  delete: "-",
  unchanged: "=",
  skip: "·",
  run: "*",
};

export function formatSyncResult(
  result: SyncResult,
  options: { targetName: string; provider: string; apply: boolean },
): string {
  const lines: string[] = [];
  const mode = options.apply ? "APPLY (mutating)" : "DRY RUN (no changes)";
  lines.push(
    `Sync target '${options.targetName}' (${options.provider}) — ${mode}`,
  );
  for (const note of result.notes) {
    lines.push(`  note: ${note}`);
  }
  if (result.actions.length === 0) {
    lines.push("  (nothing to do)");
  }
  for (const action of result.actions) {
    const symbol = KIND_SYMBOLS[action.kind] ?? "*";
    lines.push(`  ${symbol} ${action.kind.padEnd(9)} ${action.description}`);
  }
  for (const warning of result.warnings) {
    lines.push(`  ! ${warning}`);
  }
  const skippedDeletions = result.skippedDeletions ?? 0;
  if (skippedDeletions > 0) {
    lines.push(
      `  ${skippedDeletions} deletion(s) skipped (pass --prune to include)`,
    );
  }
  if (!options.apply) {
    lines.push("");
    lines.push("Dry run complete. Re-run with --apply to execute.");
  }
  return lines.join("\n");
}
