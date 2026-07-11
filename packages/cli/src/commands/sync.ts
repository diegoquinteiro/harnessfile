import { loadHarnessDirectory } from "../parser/directory.js";
import { validateHarnessfile } from "../validator/validate.js";
import { runSync, formatSyncResult } from "../sync/engine.js";
import { logInfo, logWarn, logError } from "../runtime/logger.js";

export interface SyncOptions {
  target?: string;
  apply?: boolean;
  prune?: boolean;
}

export async function sync(
  path: string | undefined,
  options: SyncOptions,
): Promise<void> {
  try {
    if (!options.target) {
      throw new Error("Missing required option --target <name>");
    }

    const harness = loadHarnessDirectory(path);
    logInfo(`Loaded ${harness.harnessPath}`);

    const validation = validateHarnessfile(harness.ir);
    for (const warning of validation.warnings) {
      logWarn(`${warning.path}: ${warning.message}`);
    }
    if (!validation.valid) {
      for (const error of validation.errors) {
        logError(`${error.path}: ${error.message}`);
      }
      console.log(
        `\n  Validation failed with ${validation.errors.length} error(s) — fix them before syncing.`,
      );
      process.exit(1);
    }

    const apply = options.apply ?? false;
    const result = await runSync(harness, {
      targetName: options.target,
      apply,
      prune: options.prune ?? false,
    });

    const target = harness.ir.targets![options.target];
    const provider =
      typeof target.provider === "string"
        ? target.provider
        : target.provider?.type ?? "";
    console.log(
      formatSyncResult(result, {
        targetName: options.target,
        provider,
        apply,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(message);
    process.exit(1);
  }
}
