import type { Harnessfile, ProviderRef } from "../ir/types.js";
import type { AgentRuntimeDriver, RuntimeExecutor, RuntimeStatus, RuntimeTaskResult } from "../agent-runtimes/interface.js";
import type { HarnessProvider } from "../providers/interface.js";
import type { SyncAdapter } from "../sync/types.js";
import type { ServiceRegistry } from "./registry.js";

export interface ServiceContext {
  ir: Harnessfile;
  workspaceRoot: string;
  /** Operational secrets are resolved by name, never copied into the IR. */
  secret(name: string): Promise<string>;
}

export interface Closable {
  close?(): Promise<void>;
}

/** Each environment supplies an executor; protocol drivers run inside that environment. */
export interface ExecutionEnvironment extends RuntimeExecutor, Closable {}

export interface ActorIdentity {
  subject: string;
  /** Private to the identity provider and the integration receiving it. Never log or persist. */
  credential?: string;
}

export interface IdentityService extends Closable {
  resolve(agent: string, audience: string): Promise<ActorIdentity>;
}

export interface TaskReference {
  id: string;
  url?: string;
  /** Canonical provider/API/project/issue namespace; mandatory for durable memory. */
  key?: string;
}

export interface TaskContext {
  runId?: string;
  step?: string;
  parent?: TaskReference;
  requestedBy?: string;
}

export interface ProjectTask extends TaskContext {
  /** An idempotency key supplied by the caller, distinct from the external issue ID. */
  id: string;
  agent: string;
  prompt: string;
}

export interface TaskUpdate {
  status: RuntimeStatus;
  output?: string;
  error?: string;
}

export interface TaskEvent {
  /** Stable source event ID, suitable for deduplication by a durable host. */
  id: string;
  task: TaskReference;
  input: Record<string, unknown>;
}

/** An agent-authored immutable completion, bound to one persisted dispatch intent. */
export interface TaskHandoff {
  /** Equal to dispatchId: retries publish the same logical handoff. */
  id: string;
  dispatchId: string;
  runId: string;
  step: string;
  agent: string;
  status: RuntimeTaskResult["status"];
  summary: string;
  artifacts?: Array<{ url: string; label?: string }>;
  next?: string;
  createdAt: string;
  result?: RuntimeTaskResult;
}

export interface TaskMemorySnapshot {
  /** null means no record exists. Every checkpoint or handoff write changes the revision. */
  revision: string | null;
  checkpoint?: Record<string, unknown>;
  handoffs: TaskHandoff[];
}

export interface TaskMemoryService extends Closable {
  readonly capabilities: { durable: true; atomicCompareAndSwap: true; tools: TaskMemoryTool[] };
  read(task: TaskReference): Promise<TaskMemorySnapshot>;
  /** Fails on a stale revision; preserves immutable handoffs in the same atomic record. */
  compareAndSwap(task: TaskReference, expectedRevision: string | null, checkpoint: Record<string, unknown>): Promise<TaskMemorySnapshot>;
  /** Same ID and content is idempotent; an existing ID can never be overwritten. */
  publishHandoff(task: TaskReference, handoff: TaskHandoff): Promise<TaskHandoff>;
  invokeTool(name: string, input: Record<string, unknown>, scope: TaskCapabilityScope): Promise<unknown>;
}

export interface TaskMemoryTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A runtime receives only this task/dispatch scope, never unrestricted account credentials in its prompt. */
export interface TaskCapabilityScope {
  task: TaskReference;
  dispatchId: string;
  runId: string;
  step: string;
  agent: string;
  board: { provider: string; url?: string };
  memory: { provider: string };
}

export type TaskCapabilityRequest =
  | { operation: "read" }
  | { operation: "comment"; body: string }
  | { operation: "handoff"; handoff: TaskHandoff };

export interface TaskConversation {
  task: TaskReference;
  title: string;
  body: string;
  comments: Array<{ id: string; body: string; subject?: string; createdAt?: string }>;
}

export interface ProjectManagementService extends Closable {
  /** Opt in only when a separate scoped helper can reconstruct this task board. */
  readonly capabilities?: { agentTools: boolean };
  /** Credential audience, typically the exact API base URL. Defaults to the provider ID. */
  readonly audience?: string;
  /** Repeated create calls with the same id MUST return the same task. */
  createTask(task: ProjectTask, actor: ActorIdentity): Promise<TaskReference>;
  updateTask(task: TaskReference, update: TaskUpdate, actor: ActorIdentity): Promise<void>;
  comment(task: TaskReference, body: string, actor: ActorIdentity): Promise<void>;
  /** Agent-facing shared context, restricted by the injected task capability scope. */
  readTask?(task: TaskReference, actor: ActorIdentity): Promise<TaskConversation>;
  /** Optional ingress. The host acknowledges by resolving the callback. */
  subscribe?(receive: (event: TaskEvent) => Promise<void>): Promise<() => Promise<void>>;
  /** An optional authenticated ingress adapter; receives the exact UTF-8 body for signature checks. */
  handleWebhook?(body: string, headers: Record<string, string | undefined>): Promise<void>;
}

export interface ServiceTypes {
  orchestration: HarnessProvider;
  execution: ExecutionEnvironment;
  "project-management": ProjectManagementService;
  identity: IdentityService;
  "task-memory": TaskMemoryService;
}

export type ServiceKind = keyof ServiceTypes;
export interface FactoryContext extends ServiceContext {
  /** Trusted host plugin modules; workers use their separately configured installed modules. */
  plugins?: string[];
  /** Reuse explicitly registered host plugins; remote workers load their own approved plugins. */
  registry?: ServiceRegistry;
  /** Optional composed identities for storage writes and per-agent handoff attribution. */
  identities?: IdentityService;
  /** Drivers available to local execution. Remote workers must install their own drivers. */
  drivers: AgentRuntimeDriver[];
}

export type ServiceFactory<K extends ServiceKind> = (
  config: ProviderRef,
  context: FactoryContext,
) => ServiceTypes[K] | Promise<ServiceTypes[K]>;

export interface ProviderRegistrar {
  register<K extends ServiceKind>(kind: K, id: string, factory: ServiceFactory<K>): void;
  registerRuntime(driver: AgentRuntimeDriver): void;
  registerSync(adapter: SyncAdapter): void;
}

/** One package can supply any subset of capabilities, without coupling their selection. */
export interface ProviderPlugin {
  apiVersion: 1;
  register(registry: ProviderRegistrar): void | Promise<void>;
}
