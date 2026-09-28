import type { ProviderRegistrar } from "../contracts.js";
import { createModalExecution } from "./modal.js";
import { createDaytonaExecution } from "./daytona.js";
import { createE2bExecution } from "./e2b.js";

export function registerRemoteExecutionProviders(registry: ProviderRegistrar): void {
  registry.register("execution", "modal/v1", createModalExecution);
  registry.register("execution", "daytona/v1", createDaytonaExecution);
  registry.register("execution", "e2b/v1", createE2bExecution);
}
