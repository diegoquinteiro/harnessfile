import { loadHarnessDirectory } from "../parser/directory.js";
import { validateHarnessfile } from "../validator/validate.js";
import { createServiceRegistry } from "../services/builtins.js";
import { loadPlugins } from "../services/registry.js";
import { logInfo, logWarn, logError } from "../runtime/logger.js";

export interface ValidateOptions {
  provider?: string;
  plugin?: string[];
}

export async function validate(
  path: string | undefined,
  options: ValidateOptions,
): Promise<void> {
  try {
    const harness = loadHarnessDirectory(path);
    logInfo(`Loaded ${harness.harnessPath}`);
    logInfo(
      `Parsed ${Object.keys(harness.ir.agents).length} agent(s), ` +
        `${Object.keys(harness.ir.squads ?? {}).length} squad(s), ` +
        `${(harness.ir.skills ?? []).length} skill(s)`,
    );

    // Structural validation
    const result = validateHarnessfile(harness.ir);

    for (const warning of result.warnings) {
      logWarn(`${warning.path}: ${warning.message}`);
    }

    if (!result.valid) {
      for (const error of result.errors) {
        logError(`${error.path}: ${error.message}`);
      }
      console.log(`\n  Validation failed with ${result.errors.length} error(s).`);
      process.exit(1);
    }

    // Provider compatibility check
    if (options.provider || options.plugin?.length) {
      const registry = createServiceRegistry();
      await loadPlugins(registry, options.plugin ?? [], harness.root);
      const selected = options.provider === "langgraph" ? "langgraph/v1" : options.provider ?? harness.ir.orchestration?.provider ?? "langgraph/v1";
      registry.assertAvailable("execution", harness.ir.execution?.provider ?? "local/v1");
      registry.assertAvailable("identity", harness.ir.identity?.provider ?? "local/v1");
      if (harness.ir.projectManagement) registry.assertAvailable("project-management", harness.ir.projectManagement.provider);
      const provider = await registry.create("orchestration", selected, {
        ir: harness.ir, workspaceRoot: harness.root, drivers: registry.runtimeDrivers(),
        async secret() { throw new Error("Validation cannot resolve secrets"); },
      });
      const providerResult = provider.validate(harness.ir);

      for (const warning of providerResult.warnings) {
        logWarn(`[${options.provider}] ${warning.path}: ${warning.message}`);
      }

      if (!providerResult.valid) {
        for (const error of providerResult.errors) {
          logError(`[${options.provider}] ${error.path}: ${error.message}`);
        }
        console.log(
          `\n  Provider '${options.provider}' compatibility check failed.`,
        );
        process.exit(1);
      }

      logInfo(`Compatible with provider: ${provider.displayName}`);
    }

    logInfo("Harness is valid");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(message);
    process.exit(1);
  }
}
