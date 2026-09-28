import type { Harnessfile, ProviderRef } from "../ir/types.js";
import type { AgentRuntimeDriver, RuntimeExecutor, RuntimeStatus } from "../agent-runtimes/interface.js";
import type { HarnessProvider } from "../providers/interface.js";
import type { SyncAdapter } from "../sync/types.js";

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

export interface ProjectManagementService extends Closable {
  /** Credential audience, typically the exact API base URL. Defaults to the provider ID. */
  readonly audience?: string;
  /** Repeated create calls with the same id MUST return the same task. */
  createTask(task: ProjectTask, actor: ActorIdentity): Promise<TaskReference>;
  updateTask(task: TaskReference, update: TaskUpdate, actor: ActorIdentity): Promise<void>;
  comment(task: TaskReference, body: string, actor: ActorIdentity): Promise<void>;
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
}

export type ServiceKind = keyof ServiceTypes;
export interface FactoryContext extends ServiceContext {
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
