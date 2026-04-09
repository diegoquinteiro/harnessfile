// Core Harnessfile types matching the v0.1 spec

export interface HarnessFile {
  harnessfile: string;
  name?: string;
  agents: Record<string, Agent>;
  steps: Record<string, Step>;
  observability?: Observability;
  memory?: Memory;
  security?: Security;
  resilience?: Resilience;
  hooks?: HooksConfig;
}

export interface Agent {
  model: string;
  instructions: string;
  tools?: Tool[];
  skills?: string[];
}

export interface Tool {
  mcp?: string;
  [key: string]: unknown;
}

// Step types
export type StepType = 'agent' | 'trigger' | 'output' | 'gate' | 'router' | 'orchestrator';

export interface BaseStep {
  type?: StepType;
  next?: string | string[];
  timeout?: string;
  retry?: number | RetryConfig;
  'on-error'?: 'fail' | 'skip' | 'continue';
  hooks?: HooksConfig;
}

export interface AgentStep extends BaseStep {
  type?: 'agent';
  agent: string;
  eval?: EvalConfig[];
  'max-iterations'?: number;
  output?: Record<string, string>;
  context?: string;
}

export interface TriggerStep extends BaseStep {
  type: 'trigger';
  event: string;
  filter?: string;
  provider?: string | ProviderConfig;
  output?: Record<string, string>;
}

export interface OutputStep extends BaseStep {
  type: 'output';
  input?: Record<string, string>;
}

export interface GateStep extends BaseStep {
  type: 'gate';
  approve: 'human';
  provider?: string | ProviderConfig;
  channel?: string;
  timeout?: string;
  fallback?: 'reject' | 'approve' | 'escalate';
}

export interface RouterStep extends BaseStep {
  type: 'router';
  agent: string;
  routes: Record<string, string>;
}

export interface OrchestratorStep extends BaseStep {
  type: 'orchestrator';
  agent: string;
  pool: string[];
  'max-agents'?: number;
  timeout?: string;
}

export type Step = AgentStep | TriggerStep | OutputStep | GateStep | RouterStep | OrchestratorStep;

export interface RetryConfig {
  max: number;
  backoff?: 'none' | 'linear' | 'exponential';
}

export interface ProviderConfig {
  type: string;
  [key: string]: unknown;
}

export interface EvalConfig {
  metric: string;
  type?: 'code' | 'llm' | 'human';
  pass?: number | string | boolean;
  aggregate?: 'mean' | 'min' | 'all';
  agent?: string;         // for type: llm — which agent judges
  prompt?: string;        // for type: llm — the evaluation prompt
  dataset?: string;
  expected?: string;
}

export interface Observability {
  tracing?: string;
  metrics?: string;
  sampling?: number;
  level?: 'calls' | 'steps' | 'harness';
}

export interface Memory {
  backend: string;
  scope?: 'thread' | 'shared' | 'global';
  type?: 'checkpoint' | 'conversation' | 'semantic';
  ttl?: string;
}

export interface Security {
  guardrails?: {
    input?: string[];
    output?: string[];
    provider?: string;
  };
  budget?: {
    'max-tokens'?: number;
    'max-cost'?: string;
  };
  audit?: {
    destination?: string;
    level?: 'actions' | 'reasoning' | 'full';
  };
}

export interface Resilience {
  timeout?: string;
  checkpoint?: boolean;
}

export interface HooksConfig {
  'on-start'?: string | HookFullConfig;
  'before-step'?: string | HookFullConfig;
  'after-step'?: string | HookFullConfig;
  'on-error'?: string | HookFullConfig;
  'on-gate-pending'?: string | HookFullConfig;
  'on-gate-resolved'?: string | HookFullConfig;
  'on-complete'?: string | HookFullConfig;
}

export interface HookFullConfig {
  run: string;
  can?: ('abort' | 'modify')[];
}
