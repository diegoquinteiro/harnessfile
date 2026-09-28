import { loadHarnessDirectory } from "../parser/directory.js";
import { validateHarnessfile } from "../validator/validate.js";
import { composeServices, type ComposedServices, type CompositionOptions } from "../services/compose.js";
import { providerConfig } from "../services/registry.js";
import { RunManager } from "./run-manager.js";
import { TriggerListener } from "./trigger-listener.js";
import { GateResolver } from "./gate-resolver.js";
import { logInfo, logError, logWarn } from "./logger.js";

export interface ServerOptions extends CompositionOptions {
  file?: string;
  port?: number;
  gatePort?: number;
  watch?: boolean;
}

export class HarnessServer {
  private runManager: RunManager | null = null;
  private triggerListener: TriggerListener | null = null;
  private gateResolver: GateResolver | null = null;
  private services?: ComposedServices;
  private unsubscribe?: () => Promise<void>;
  private stopping?: Promise<void>;
  private startupSettled?: Promise<void>;
  private resolveShutdown?: () => void;
  private shutdownRequested = false;

  async start(options: ServerOptions = {}): Promise<void> {
    if (this.shutdownRequested) return;
    const harness = loadHarnessDirectory(options.file);
    logInfo(`Loaded ${harness.harnessPath}`);
    const ir = harness.ir;
    const validation = validateHarnessfile(ir);
    for (const warning of validation.warnings) logWarn(`${warning.path}: ${warning.message}`);
    if (!validation.valid) {
      for (const error of validation.errors) logError(`${error.path}: ${error.message}`);
      throw new Error("Harnessfile validation failed");
    }
    const signal = () => { this.shutdownRequested = true; this.resolveShutdown?.(); };
    const shutdown = new Promise<void>((resolve) => { this.resolveShutdown = resolve; });
    let finishStartup!: () => void;
    this.startupSettled = new Promise<void>((resolve) => { finishStartup = resolve; });
    process.on("SIGINT", signal);
    process.on("SIGTERM", signal);
    try {
      this.services = await composeServices(ir, { ...options, workspaceRoot: harness.root });
      logInfo("Providers composed; graph compiled");
      if (this.shutdownRequested) return;
      this.runManager = new RunManager(this.services.harness);
      const tasks = this.services.projectManagement;
      const taskProvider = ir.projectManagement && providerConfig(ir.projectManagement.provider).type;
      const managedTriggers = Object.entries(ir.steps ?? {}).filter(([, step]) =>
        step.type === "trigger" && !step.schedule && step.provider &&
        providerConfig(step.provider).type === taskProvider,
      ).map(([name]) => name);
      if (tasks?.subscribe) {
        const triggers = Object.values(ir.steps ?? {}).filter((step) => step.type === "trigger");
        if (triggers.length && managedTriggers.length !== 1) {
          throw new Error("Project-management ingress requires exactly one trigger with the selected project-management provider, or a graph without triggers");
        }
        // Bounded, process-local deduplication. Durable providers/hosts must persist deliveries.
        const deliveries = new Map<string, Promise<void>>();
        this.unsubscribe = await tasks.subscribe((event) => {
          const existing = deliveries.get(event.id);
          if (existing) return existing;
          const delivery = Promise.resolve().then(async () => {
            if (this.shutdownRequested) throw new Error("Harness is shutting down");
            const trigger = event.input.trigger ?? (managedTriggers.length === 1 ? managedTriggers[0] : undefined);
            if (managedTriggers.length > 1 && !trigger) throw new Error("Project event must select a trigger when multiple provider triggers exist");
            if (trigger && !managedTriggers.includes(String(trigger))) throw new Error("Project event selected an unknown provider trigger");
            await this.runManager!.startRun({ ...event.input, task: event.task, trigger });
          });
          deliveries.set(event.id, delivery);
          void delivery.then(() => {
            if (deliveries.size > 10000) deliveries.delete(deliveries.keys().next().value!);
          }, () => deliveries.delete(event.id));
          return delivery;
        });
        if (this.shutdownRequested) return;
      }
      this.triggerListener = new TriggerListener(ir, this.runManager, {
        projectManagement: tasks,
        managedTriggers: tasks?.subscribe ? managedTriggers : [],
      });
      if (this.triggerListener.hasTriggers() || tasks?.subscribe) {
        this.gateResolver = new GateResolver(this.runManager);
        await this.gateResolver.start({ port: options.gatePort ?? 8081 });
        if (this.shutdownRequested) return;
        if (this.triggerListener.hasTriggers()) await this.triggerListener.start({ port: options.port ?? 8080 });
        finishStartup();
        logInfo("Harness is running. Press Ctrl+C to stop.");
        await shutdown;
      } else {
        // A one-shot run can remain active until shutdown cancels its execution.
        finishStartup();
        await Promise.race([this.triggerListener.start(), shutdown]);
      }
    } finally {
      // Release stop before awaiting it: stop waits only for resource acquisition,
      // never for this start() promise or for a long-running graph to finish.
      finishStartup();
      process.removeListener("SIGINT", signal);
      process.removeListener("SIGTERM", signal);
      await this.stop();
    }
  }

  stop(): Promise<void> {
    this.shutdownRequested = true;
    this.resolveShutdown?.();
    return this.stopping ??= (async () => {
      await this.startupSettled;
      const errors: unknown[] = [];
      // Stop ingress first, then execution, engine state, task integration and identity.
      for (const cleanup of [
        () => this.triggerListener?.stop(),
        () => this.unsubscribe?.(),
        () => this.gateResolver?.stop(),
        () => this.services?.close(),
      ]) {
        try { await cleanup(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Harness shutdown failed");
      logInfo("Harness stopped");
    })();
  }
}
