import { builtinRuntimeDrivers } from "../agent-runtimes/registry.js";
import { RuntimeDispatcher } from "../agent-runtimes/dispatcher.js";
import { LangGraphProvider } from "../providers/langgraph/index.js";
import { StatelessLangGraphProvider } from "../providers/langgraph-stateless/index.js";
import { registerTaskMemoryProviders } from "./task-memory/index.js";
import { ServiceRegistry } from "./registry.js";
import { builtinAdapters } from "../sync/engine.js";
import { registerProjectManagementProviders } from "./project-management/index.js";
import { registerIdentityProviders } from "./identity/index.js";
import { registerRemoteExecutionProviders } from "./execution/index.js";
import type { ActorIdentity, ProjectManagementService, ProjectTask, TaskReference, TaskUpdate } from "./contracts.js";

/** Ephemeral reference task board; useful for local development and contract tests. */
export class MemoryProjectManagement implements ProjectManagementService {
  readonly tasks = new Map<string, ProjectTask & TaskUpdate & { subject: string; comments: string[] }>();

  async createTask(task: ProjectTask, actor: ActorIdentity): Promise<TaskReference> {
    if (!this.tasks.has(task.id)) {
      this.tasks.set(task.id, { ...task, status: "starting", subject: actor.subject, comments: [] });
    }
    return { id: task.id };
  }
  async updateTask(task: TaskReference, update: TaskUpdate, _actor: ActorIdentity): Promise<void> {
    Object.assign(this.get(task), update);
  }
  async comment(task: TaskReference, body: string, _actor: ActorIdentity): Promise<void> {
    this.get(task).comments.push(body);
  }
  private get(task: TaskReference) {
    const record = this.tasks.get(task.id);
    if (!record) throw new Error(`Task '${task.id}' not found`);
    return record;
  }
}

export function createServiceRegistry(): ServiceRegistry {
  const registry = new ServiceRegistry();
  for (const driver of builtinRuntimeDrivers()) registry.registerRuntime(driver);
  for (const adapter of builtinAdapters) registry.registerSync(adapter);
  registerProjectManagementProviders(registry);
  registerIdentityProviders(registry);
  registerRemoteExecutionProviders(registry);
  registerTaskMemoryProviders(registry);
  registry.register("orchestration", "langgraph/v1", () => new LangGraphProvider());
  registry.register("orchestration", "langgraph-stateless/v1", () => new StatelessLangGraphProvider());
  registry.register("execution", "local/v1", (_config, context) => new RuntimeDispatcher(context.ir, {
    workspaceRoot: context.workspaceRoot,
    drivers: context.drivers,
    context,
  }));
  registry.register("identity", "local/v1", () => ({
    async resolve(agent) { return { subject: agent }; },
  }));
  registry.register("project-management", "memory/v1", () => new MemoryProjectManagement());
  return registry;
}
