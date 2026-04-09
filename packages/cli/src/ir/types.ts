// Harnessfile IR — typed intermediate representation of a parsed harnessfile.
// YAML kebab-case is normalized to camelCase by the normalizer.

// ---- Top-level ----

export interface Harnessfile {
  version: string;
  name?: string;
  agents: Record<string, AgentDef>;
  steps?: Record<string, StepDef>;
  hooks?: HooksDef;
  observability?: ObservabilityDef;
  memory?: MemoryDef;
  security?: SecurityDef;
  resilience?: ResilienceDef;
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
