import { loadHarnessDirectory } from "../parser/directory.js";
import { validateHarnessfile } from "../validator/validate.js";
import { getProvider } from "../providers/registry.js";
import type { ProviderOptions } from "../providers/interface.js";
import { RunManager } from "./run-manager.js";
import { TriggerListener } from "./trigger-listener.js";
import { GateResolver } from "./gate-resolver.js";
import { logInfo, logError, logWarn } from "./logger.js";

export interface ServerOptions {
  file?: string;
  provider?: string;
  port?: number;
  gatePort?: number;
  watch?: boolean;
  checkpointer?: "memory" | "sqlite";
}

export class HarnessServer {
  private runManager: RunManager | null = null;
  private triggerListener: TriggerListener | null = null;
  private gateResolver: GateResolver | null = null;
  private shutdownRequested = false;

  async start(options: ServerOptions = {}): Promise<void> {
    // 1. Parse the .agents/ directory
    const harness = loadHarnessDirectory(options.file);
    logInfo(`Loaded ${harness.harnessPath}`);
    const ir = harness.ir;

    // 2. Validate
    const validation = validateHarnessfile(ir);
    for (const warning of validation.warnings) {
      logWarn(`${warning.path}: ${warning.message}`);
    }
    if (!validation.valid) {
      for (const error of validation.errors) {
        logError(`${error.path}: ${error.message}`);
      }
      throw new Error("Harnessfile validation failed");
    }

    // 3. Get provider and validate compatibility
    const providerName = options.provider ?? "langgraph";
    const provider = getProvider(providerName);
    logInfo(`Provider: ${provider.displayName}`);

    const providerValidation = provider.validate(ir);
    for (const warning of providerValidation.warnings) {
      logWarn(`[${providerName}] ${warning.path}: ${warning.message}`);
    }
    if (!providerValidation.valid) {
      for (const error of providerValidation.errors) {
        logError(`[${providerName}] ${error.path}: ${error.message}`);
      }
      throw new Error(`Provider '${providerName}' cannot execute this harness`);
    }

    // 4. Compile
    const providerOptions: ProviderOptions = {
      checkpointer: options.checkpointer ?? "memory",
      workspaceRoot: harness.root,
    };
    const compiledHarness = await provider.compile(ir, providerOptions);
    logInfo("Graph compiled");

    // 5. Start runtime
    this.runManager = new RunManager(compiledHarness);

    // 6. Start trigger listeners
    this.triggerListener = new TriggerListener(ir, this.runManager);

    if (this.triggerListener.hasTriggers()) {
      // Start gate resolver on separate port
      this.gateResolver = new GateResolver(this.runManager);
      await this.gateResolver.start({ port: options.gatePort ?? 8081 });

      // Start trigger listener (this blocks for webhook-based triggers)
      await this.triggerListener.start({ port: options.port ?? 8080 });

      // Server is now running — wait for shutdown signal
      console.log(
        "\n  Harness is running. Press Ctrl+C to stop.\n",
      );
      await this.waitForShutdown();
    } else {
      // No triggers — single run, then exit
      await this.triggerListener.start();
    }
  }

  async stop(): Promise<void> {
    this.shutdownRequested = true;
    logInfo("Shutting down...");

    if (this.triggerListener) {
      await this.triggerListener.stop();
    }
    if (this.gateResolver) {
      await this.gateResolver.stop();
    }
    if (this.runManager) {
      await this.runManager.shutdown();
    }

    logInfo("Harness stopped");
  }

  private waitForShutdown(): Promise<void> {
    return new Promise((resolve) => {
      const handler = async () => {
        process.removeListener("SIGINT", handler);
        process.removeListener("SIGTERM", handler);
        await this.stop();
        resolve();
      };

      process.on("SIGINT", handler);
      process.on("SIGTERM", handler);

      // Also resolve if shutdown was requested programmatically
      const check = () => {
        if (this.shutdownRequested) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      };
      check();
    });
  }
}
