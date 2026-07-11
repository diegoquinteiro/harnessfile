import type { Harnessfile } from "../ir/types.js";

// ---- Provider contract ----

export interface HarnessProvider {
  name: string;
  displayName: string;

  /** Check if this provider can execute the given IR. */
  validate(ir: Harnessfile): ValidationResult;

  /** Compile the IR into a reusable graph. Called once at startup. */
  compile(
    ir: Harnessfile,
    options: ProviderOptions,
  ): Promise<CompiledHarness>;
}

export interface ProviderOptions {
  checkpointer?: "memory" | "sqlite";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

// ---- Compiled harness (returned by provider) ----

export interface CompiledHarness {
  /** Start a new run through the graph. */
  createRun(input: Record<string, unknown>): Promise<RunHandle>;

  /** Resume a suspended run (e.g., after gate approval). */
  resumeRun(
    threadId: string,
    input: Record<string, unknown>,
  ): Promise<RunHandle>;

  /** List active/suspended runs. */
  listRuns(): Promise<RunInfo[]>;

  /** Shut down cleanly. */
  shutdown(): Promise<void>;
}

// ---- Run types ----

export interface RunHandle {
  threadId: string;
  events: AsyncIterable<HarnessEvent>;
  result: Promise<RunResult>;
}

export type RunStatus = "running" | "completed" | "suspended" | "failed";

export interface RunInfo {
  threadId: string;
  status: RunStatus;
  startedAt: Date;
  suspendedAt?: string; // step name
}

export interface RunResult {
  status: "completed" | "suspended" | "failed";
  threadId: string;
  output?: Record<string, unknown>;
  suspendedAt?: string; // step name if gate
  error?: string;
}

export type HarnessEventType =
  | "step-start"
  | "step-end"
  | "step-error"
  | "gate-pending"
  | "gate-resolved"
  | "hook"
  | "eval"
  | "warning"
  | "run-start"
  | "run-end";

export interface HarnessEvent {
  type: HarnessEventType;
  threadId: string;
  step?: string;
  data?: unknown;
  timestamp: Date;
}
