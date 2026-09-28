import type { Harnessfile } from "../ir/types.js";
import type { CompiledHarness, ProviderOptions } from "../providers/interface.js";
import type { Closable, FactoryContext, ProjectManagementService } from "./contracts.js";
import { createServiceRegistry } from "./builtins.js";
import { loadPlugins, providerConfig, type ServiceRegistry } from "./registry.js";
import { TaskExecutor } from "./task-executor.js";

export interface CompositionOptions extends ProviderOptions {
  registry?: ServiceRegistry;
  plugins?: string[];
  /** Compatibility alias for --provider; changes orchestration only. */
  provider?: string;
  secret?: FactoryContext["secret"];
}

export interface ComposedServices {
  harness: CompiledHarness;
  projectManagement?: ProjectManagementService;
  close(): Promise<void>;
}

export async function composeServices(ir: Harnessfile, options: CompositionOptions = {}): Promise<ComposedServices> {
  const registry = options.registry ?? createServiceRegistry();
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  await loadPlugins(registry, options.plugins ?? [], workspaceRoot);
  const orchestration = options.provider
    ? (options.provider === "langgraph" ? "langgraph/v1" : options.provider)
    : ir.orchestration?.provider ?? "langgraph/v1";
  const execution = ir.execution?.provider ?? "local/v1";
  const identity = ir.identity?.provider ?? "local/v1";
  // Resolve every selection before opening resources or provisioning infrastructure.
  registry.assertAvailable("orchestration", orchestration);
  registry.assertAvailable("execution", execution);
  registry.assertAvailable("identity", identity);
  if (ir.projectManagement) registry.assertAvailable("project-management", ir.projectManagement.provider);

  const context: FactoryContext = {
    ir, workspaceRoot, drivers: registry.runtimeDrivers(),
    secret: options.secret ?? (async (name) => {
      const value = process.env[name];
      if (!value) throw new Error(`Required secret '${name}' is not set in the host environment`);
      return value;
    }),
  };
  const resources: Closable[] = [];
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    const errors: unknown[] = [];
    for (const resource of resources.slice().reverse()) {
      try { await resource.close?.(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Provider cleanup failed");
  })();

  try {
    const identities = await registry.create("identity", identity, context);
    resources.push(identities);
    const projectManagement = ir.projectManagement
      ? await registry.create("project-management", ir.projectManagement.provider, context) : undefined;
    if (projectManagement) resources.push(projectManagement);
    const environment = await registry.create("execution", execution, context);
    resources.push(environment);
    const runtime = options.runtimeExecutor ?? environment;
    const runtimeExecutor = projectManagement
      ? new TaskExecutor(runtime, projectManagement, identities, projectManagement.audience ?? providerConfig(ir.projectManagement!.provider).type)
      : runtime;
    if (runtimeExecutor instanceof TaskExecutor) resources.push(runtimeExecutor);
    const engine = await registry.create("orchestration", orchestration, context);
    const engineOptions = { ...options, workspaceRoot, runtimeExecutor };
    const validation = engine.validate(ir, engineOptions);
    if (!validation.valid) {
      throw new Error(`Orchestration provider '${providerConfig(orchestration).type}' rejected the harness: ${validation.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
    }
    const harness = await engine.compile(ir, engineOptions);
    // Stop execution before closing the graph and its task/identity services.
    resources.splice(resources.indexOf(environment), 0, { close: () => harness.shutdown() });
    return { harness, projectManagement, close };
  } catch (error) {
    try { await close(); } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Provider startup and cleanup failed");
    }
    throw error;
  }
}
