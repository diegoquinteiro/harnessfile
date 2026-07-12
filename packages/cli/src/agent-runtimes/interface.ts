import type { AgentDef, RuntimeProfileDef } from "../ir/types.js";

export type RuntimeStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export interface RuntimeTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type RuntimeEvent =
  | { type: "status"; status: RuntimeStatus; sessionId?: string }
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool-use"; tool: string; callId?: string; input?: unknown }
  | { type: "tool-result"; tool?: string; callId?: string; output?: string }
  | { type: "log"; level?: string; content: string }
  | { type: "warning"; content: string }
  | { type: "error"; content: string };

export interface RuntimeCapabilities {
  protocol: string;
  command: string;
  version?: string;
  streaming: boolean;
  resume: boolean;
  cancel: boolean;
  structuredEvents: RuntimeEvent["type"][];
}

/** A concrete executable runtime discovered by an execution target. */
export interface RuntimeInstance {
  id: string;
  profileName: string;
  protocol: string;
  command: string;
  fixedArgs: string[];
  status: "online" | "offline";
  capabilities: RuntimeCapabilities;
}

export interface RuntimeTask {
  taskId: string;
  agentName: string;
  agent: AgentDef;
  profileName: string;
  profile: RuntimeProfileDef;
  instance: RuntimeInstance;
  workspaceRoot: string;
  /** User/task input. The driver supplies agent.instructions through its native prompt surface. */
  prompt: string;
  resumeSessionId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface RuntimeTaskResult {
  status: Exclude<RuntimeStatus, "starting" | "running">;
  output: string;
  error?: string;
  sessionId?: string;
  durationMs: number;
  usage?: Record<string, RuntimeTokenUsage>;
  /** Portable checkpoint pointer guarded by concrete instance and workspace identity. */
  resume?: RuntimeResumePointer;
  metadata?: Record<string, unknown>;
}

export interface RuntimeResumePointer {
  sessionId: string;
  instanceId: string;
  workspaceRoot: string;
}

export interface RuntimeSession {
  taskId: string;
  instance: RuntimeInstance;
  events: AsyncIterable<RuntimeEvent>;
  result: Promise<RuntimeTaskResult>;
  cancel(): Promise<void>;
}

/** A coding-agent protocol adapter, not a model API client (D52, D53). */
export interface AgentRuntimeDriver {
  protocol: string;
  defaultCommand: string;
  probe(profileName: string, profile: RuntimeProfileDef): Promise<RuntimeCapabilities>;
  start(task: RuntimeTask): Promise<RuntimeSession>;
}

export interface RuntimeExecuteOptions {
  taskId?: string;
  resume?: RuntimeResumePointer;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: RuntimeEvent) => void;
}

export interface RuntimeExecutor {
  start(
    agentName: string,
    prompt: string,
    options?: RuntimeExecuteOptions,
  ): Promise<RuntimeSession>;
  execute(
    agentName: string,
    prompt: string,
    options?: RuntimeExecuteOptions,
  ): Promise<RuntimeTaskResult>;
}
