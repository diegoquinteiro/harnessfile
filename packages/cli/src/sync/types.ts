import type { Harnessfile, TargetDef } from "../ir/types.js";

// ---- Sync contract ----

export interface SyncContext {
  /** The directory containing .agents/ — sync targets are materialized here. */
  root: string;
  /** Absolute path to the .agents/ directory. */
  agentsDir: string;
  ir: Harnessfile;
  targetName: string;
  target: TargetDef;
  /** false = dry run (default): compute and print the plan, mutate nothing. */
  apply: boolean;
  /** true = include destructive remote deletions (--prune). Default false. */
  prune: boolean;
}

export type SyncActionKind =
  | "create"
  | "update"
  | "delete"
  | "unchanged"
  | "skip"
  | "run";

export interface SyncAction {
  kind: SyncActionKind;
  description: string;
}

export interface SyncResult {
  actions: SyncAction[];
  warnings: string[];
  /** Free-form notes about the plan (e.g. "multica CLI not found — remote state unknown"). */
  notes: string[];
  /** Deletions omitted from the plan because --prune was not passed. */
  skippedDeletions?: number;
}

export interface SyncAdapter {
  /** Provider id this adapter implements, e.g. "codex/v1". */
  provider: string;
  sync(ctx: SyncContext): Promise<SyncResult>;
}
