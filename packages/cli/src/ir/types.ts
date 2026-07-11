// Harnessfile IR — typed intermediate representation of a parsed .agents/ harness (spec v0.2).
// YAML kebab-case is normalized to camelCase by the normalizer.

// ---- Top-level ----

export interface Harnessfile {
  version: string;
  name?: string;
  agents: Record<string, AgentDef>;
  squads?: Record<string, SquadDef>;
  /** Names of skills present in skills/<name>/SKILL.md. */
  skills?: string[];
  steps?: Record<string, StepDef>;
  targets?: Record<string, TargetDef>;
  hooks?: HooksDef;
  observability?: ObservabilityDef;
  memory?: MemoryDef;
  security?: SecurityDef;
  resilience?: ResilienceDef;
}

// ---- Agents ----

export interface AgentDef {
  /** Slug (from frontmatter `name` or the file name). */
  name?: string;
  description?: string;
  /** Portable default model — optional in v0.2; targets may own this field (D42). */
  model?: string;
  /** System prompt — the Markdown body of the role card. */
  instructions: string;
  tools?: ToolRef[];
  /** Skill names resolved in skills/<name>/SKILL.md. */
  skills?: string[];
  /** Unknown namespaced frontmatter keys (e.g. `multica: {...}`) passed through to targets. */
  passthrough?: Record<string, unknown>;
}

export type ToolRef = string | { mcp: string };

// ---- Squads ----

export interface SquadMember {
  agent: string;
  role?: string;
}

export interface SquadDef {
  name?: string;
  description?: string;
  /** Leader agent slug — must also appear in members. */
  leader: string;
  members: SquadMember[];
  /** Leader orchestration instructions — the Markdown body of the squad file. */
  instructions: string;
  /** Unknown namespaced frontmatter keys (e.g. `multica: {...}`) passed through to targets. */
  passthrough?: Record<string, unknown>;
}

// ---- Targets ----

export const KNOWN_OWNED_FIELDS = [
  "model",
  "runtime",
  "concurrency",
  "env",
  "mcp",
  "tools",
] as const;

export interface TargetDef {
  provider?: string | ProviderRef;
  /** Fields owned by this target: seeded at bootstrap, never overwritten by sync (D42). */
  owns?: string[];
  /** x- extension keys. */
  extra?: Record<string, unknown>;
}

// ---- Steps ----

export type StepType =
  | "trigger"
  | "output"
  | "gate"
  | "router"
  | "squad"
  | "orchestrator" // superseded by squads in v0.2 — parsed with a validation warning
  | "agent";

export interface StepDef {
  type: StepType;
  agent?: string;
  /** Squad slug — resolves to squads/<slug>.md. Squads are agent-compatible (D40). */
  squad?: string;
  next?: string | string[];

  // Eval loop
  eval?: EvalDef[];
  maxIterations?: number;

  // Data flow
  context?: string;
  output?: Record<string, string>;

  // Error handling
  timeout?: string;
  retry?: RetryDef;
  onError?: "fail" | "skip" | "continue";

  // Trigger fields
  event?: string;
  filter?: string;
  /** Cron expression — makes this a scheduled trigger (D41). */
  schedule?: string;
  timezone?: string;
  /** Resolved prompt text (inline string, or the contents of the referenced file). */
  prompt?: string;
  /** Original prompt path when `prompt:` referenced a Markdown file. */
  promptPath?: string;

  // Gate fields
  approve?: "human";
  channel?: string;
  fallback?: "reject" | "approve" | "escalate";

  // Router fields
  routes?: Record<string, string>;

  // Orchestrator fields (v0.1 legacy)
  pool?: string[];
  maxAgents?: number;

  // Output step fields
  input?: Record<string, string>;

  // Provider (inline reference)
  provider?: string | ProviderRef;

  // Per-step hooks
  hooks?: HooksDef;
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
