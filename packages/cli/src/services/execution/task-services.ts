import { createHash } from "node:crypto";
import type { ServiceBinding, ProviderRef } from "../../ir/types.js";
import type { FactoryContext, IdentityService, ProjectManagementService, TaskCapabilityScope, TaskMemoryService } from "../contracts.js";
import { ServiceRegistry, loadPlugins, providerConfig } from "../registry.js";
import { registerIdentityProviders } from "../identity/index.js";
import { registerProjectManagementProviders } from "../project-management/index.js";
import { registerTaskMemoryProviders } from "../task-memory/index.js";
import type { TaskRuntimeScope } from "./detached.js";
import type { WorkerRequest } from "./protocol.js";

/** Do not ship other agents' account mappings or private key references to this worker. */
export function scopedIdentity(binding: ServiceBinding | undefined, agent: string): ServiceBinding | undefined {
  if (!binding) return;
  const ref = providerConfig(binding.provider);
  if (!["github-app/v1", "gitlab-service-account/v1"].includes(ref.type)) return binding;
  const agents = ref.agents as Record<string, unknown> | undefined;
  const selected = agents?.[agent] ?? ref.default;
  if (!selected) throw new Error(`Identity mapping missing for remote agent '${agent}'`);
  const { agents: _agents, default: _fallback, ...rest } = ref;
  return { ...binding, provider: { ...rest, agents: { [agent]: selected } } };
}

/** Only declared secret references are resolved; resolved values never enter the request. */
export async function taskSecretEnvironment<T extends TaskRuntimeScope>(task: T, context: FactoryContext): Promise<{ task: T; env: Record<string, string>; secretEnv: Record<string, string> }> {
  const scoped = { ...task, delivery: { ...task.delivery, identity: scopedIdentity(task.delivery.identity, task.agent) } };
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (/Secret$/.test(key) && typeof child === "string") names.add(child);
      else if (typeof child === "object") visit(child);
    }
  };
  visit(scoped.delivery);
  const env: Record<string, string> = {}, secretEnv: Record<string, string> = {};
  for (const name of names) {
    const variable = `HARNESSFILE_SECRET_${createHash("sha256").update(name).digest("hex").slice(0, 24).toUpperCase()}`;
    secretEnv[name] = variable; env[variable] = await context.secret(name);
  }
  return { task: scoped, env, secretEnv };
}

export interface TaskServices {
  memory?: TaskMemoryService;
  board?: ProjectManagementService;
  identities?: IdentityService;
  scope: TaskCapabilityScope;
  close(): Promise<void>;
}

export async function loadTaskServices(task: TaskRuntimeScope, context: FactoryContext, plugins: string[] = []): Promise<TaskServices> {
  const registry = context.registry ?? new ServiceRegistry();
  if (!context.registry) {
    registerIdentityProviders(registry); registerProjectManagementProviders(registry); registerTaskMemoryProviders(registry);
    registry.register("identity", "local/v1", () => ({ async resolve(agent) { return { subject: agent }; } }));
    await loadPlugins(registry, plugins, context.workspaceRoot);
  }
  const identities = task.delivery.identity ? await registry.create("identity", task.delivery.identity.provider, context) : undefined;
  const withIdentity = Object.assign({}, context, { identities });
  const memoryRef: ProviderRef | undefined = task.delivery.memory ? { ...providerConfig(task.delivery.memory.provider), identityAgent: task.agent } : undefined;
  let memory: TaskMemoryService | undefined;
  try {
    memory = memoryRef ? await registry.create("task-memory", memoryRef, withIdentity) : undefined;
    const board = task.delivery.projectManagement ? await registry.create("project-management", task.delivery.projectManagement.provider, withIdentity) : undefined;
    const scope: TaskCapabilityScope = { task: task.delivery.task, dispatchId: task.id, runId: task.context.runId, step: task.context.step, agent: task.agent,
      board: { provider: task.delivery.projectManagement ? providerConfig(task.delivery.projectManagement.provider).type : "none", url: task.delivery.task.url },
      memory: { provider: memoryRef?.type ?? "none" } };
    return { memory, board, identities, scope, async close() { await board?.close?.(); await memory?.close?.(); await identities?.close?.(); } };
  } catch (error) { await memory?.close?.(); await identities?.close?.(); throw error; }
}

export function workerFactoryContext(request: WorkerRequest): FactoryContext {
  return { ir: request.ir, workspaceRoot: process.env.HARNESSFILE_TASK_PLUGIN_ROOT ?? "/opt/harnessfile", drivers: [],
    async secret(name) {
      const variable = request.secretEnv?.[name];
      const value = variable && process.env[variable];
      if (!value) throw new Error(`Worker secret reference '${name}' was not injected`);
      return value;
    } };
}
