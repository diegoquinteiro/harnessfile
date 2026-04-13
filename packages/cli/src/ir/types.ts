// Harnessfile IR — typed intermediate representation of a parsed harnessfile.
// YAML kebab-case is normalized to camelCase by the normalizer.

// ---- Top-level ----

export interface Harnessfile {
  version: string;
  name?: string;
  description?: string;
  /** Top-level execution provider (e.g., "archon/v1"). Steps without their own provider inherit this. */
  provider?: string;
  /** Top-level model default; agents/steps without their own model inherit this. */
  model?: string;
  agents: Record<string, AgentDef>;
  steps?: Record<string, StepDef>;
  hooks?: HooksDef;
  observability?: ObservabilityDef;
  memory?: MemoryDef;
  security?: SecurityDef;
  resilience?: ResilienceDef;
  /**
   * Unknown top-level fields preserved verbatim for provider-specific consumption.
   * Populated by the normalizer with any field not in the standard spec vocabulary.
   * Compile providers (e.g., archon/v1) read these to emit target-specific output.
   */
  raw?: Record<string, unknown>;
}

// ---- Agents ----

export interface AgentDef {
  model: string;
  instructions: string;
  tools?: ToolRef[];
  skills?: string[];
}

export interface ToolRef {
  mcp: string;
}

// ---- Steps ----

export type StepType =
  | "trigger"
  | "output"
  | "gate"
  | "router"
  | "orchestrator"
  | "agent";

export interface StepDef {
  type: StepType;
  agent?: string;
  next?: string | string[];

  /** Backward edges — alternative to forward `next:`. Archon-native form. */
  dependsOn?: string[];

  /**
   * Opaque expression string evaluated by the runtime. Not parsed by Harnessfile;
   * providers are responsible for interpreting the syntax. Archon uses
   * shell-style `$node.output[.field] == 'value'` expressions.
   */
  when?: string;

  /**
   * Fan-in mode when multiple steps converge on this one.
   * - all (default): wait for all dependencies to succeed
   * - any: propagate as soon as the first dependency succeeds
   * - all-done: wait for all dependencies to finish (success or failure)
   * - any-done: propagate as soon as the first dependency finishes
   */
  waitFor?: "all" | "any" | "all-done" | "any-done";

  // ---- Execution modes (mutually exclusive; one required unless step is trigger/output/gate/router/orchestrator) ----

  /** Inline prompt for an ad-hoc agent invocation (no pre-defined agent needed). */
  prompt?: string;
  /** Shell script body. Stdout becomes step output. */
  bash?: string;
  /** Archon command reference (e.g., "archon-investigate-issue"). Opaque to Harnessfile. */
  command?: string;
  /** Loop block: iterative execution terminated by promise marker or bash check. */
  loop?: LoopDef;

  /** Per-step model override (falls through to agent or top-level default). */
  model?: string;
  /** Restrict tool set available to this step. */
  allowedTools?: string[];
  /** Forbid specific tools for this step. */
  deniedTools?: string[];
  /**
   * Structured output contract. Accepts either a short-hand object
   * (field → type) or a full JSON Schema object.
   */
  outputFormat?: Record<string, unknown>;

  // Eval loop
  eval?: EvalDef[];
  maxIterations?: number;

  // Data flow
  context?: string;
  output?: Record<string, string> | Record<string, unknown>;

  // Error handling
  timeout?: string | number;
  retry?: RetryDef;
  onError?: "fail" | "skip" | "continue";

  // Trigger fields
  event?: string;
  filter?: string;

  // Gate fields
  approve?: "human";
  channel?: string;
  fallback?: "reject" | "approve" | "escalate";

  // Router fields
  routes?: Record<string, string>;

  // Orchestrator fields
  pool?: string[];
  maxAgents?: number;

  // Output step fields
  input?: Record<string, string>;

  // Provider (inline reference)
  provider?: string | ProviderRef;

  // Per-step hooks
  hooks?: HooksDef;

  /**
   * Unknown step fields preserved verbatim for provider-specific consumption.
   * Populated by the normalizer when the harness or step declares a provider.
   */
  raw?: Record<string, unknown>;
}

// ---- Loop ----

export interface LoopDef {
  /**
   * The agent prompt executed on each iteration. For Archon, this is
   * identical to a `prompt` node but repeated until the termination condition.
   */
  prompt?: string;
  /**
   * Termination marker — when the agent emits `<promise>{until}</promise>`,
   * the loop ends. Alternative: provide `untilBash` for a bash check.
   */
  until?: string;
  /** Alternative termination: bash script; exit-0 means stop. */
  untilBash?: string;
  /** Maximum iterations (safety bound). */
  maxIterations?: number;
  /** Reset agent context between iterations (re-read state from disk). */
  freshContext?: boolean;
  /** Pause after each iteration and wait for human input. */
  interactive?: boolean;
  /** Human-facing message when paused in interactive mode. */
  gateMessage?: string;
  /** Passthrough for provider-specific loop fields. */
  raw?: Record<string, unknown>;
}

export interface ProviderRef {
  type: string;
  [key: string]: unknown;
}

// ---- Evals ----

export interface EvalDef {
  metric: string;
  type: "code" | "llm" | "human";
  pass: number | string | boolean;
  aggregate: "mean" | "min" | "all";
  prompt?: string;
  dataset?: string;
  expected?: string;
}

// ---- Retry ----

export interface RetryDef {
  max: number;
  backoff: "none" | "linear" | "exponential";
}

// ---- Hooks ----

export type HookEntry = string | HookFullDef;

export interface HookFullDef {
  run: string;
  can?: Array<"abort" | "modify">;
}

export interface HooksDef {
  onStart?: HookEntry;
  beforeStep?: HookEntry;
  afterStep?: HookEntry;
  onError?: HookEntry;
  onGatePending?: HookEntry;
  onGateResolved?: HookEntry;
  onComplete?: HookEntry;
}

// ---- Observability ----

export interface ObservabilityDef {
  tracing?: string;
  metrics?: string;
  sampling?: number;
  level?: "calls" | "steps" | "harness";
}

// ---- Memory ----

export interface MemoryDef {
  backend: string;
  scope?: "thread" | "shared" | "global";
  type?: "checkpoint" | "conversation" | "semantic";
  ttl?: string;
}

// ---- Security ----

export interface SecurityDef {
  guardrails?: GuardrailsDef;
  budget?: BudgetDef;
  audit?: AuditDef;
}

export interface GuardrailsDef {
  input?: string[];
  output?: string[];
  provider?: string;
}

export interface BudgetDef {
  maxTokens?: number;
  maxCost?: string;
}

export interface AuditDef {
  destination?: string;
  level?: "actions" | "reasoning" | "full";
}

// ---- Resilience ----

export interface ResilienceDef {
  timeout?: string;
  checkpoint?: boolean;
}
