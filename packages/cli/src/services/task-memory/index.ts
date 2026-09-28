import type { ProviderRef } from "../../ir/types.js";
import type { ProviderRegistrar, TaskMemoryService } from "../contracts.js";
import { FilesystemTaskMemory } from "./filesystem.js";
import { GitHubTaskMemory, GitLabTaskMemory, type TaskMemoryContext } from "./repository.js";
export { FilesystemTaskMemory } from "./filesystem.js";
export { GitHubTaskMemory, GitLabTaskMemory, type TaskMemoryContext } from "./repository.js";
export { TaskMemoryConflictError } from "./base.js";
export { canonicalTaskKey, taskMemoryKey, taskReferenceFromKey } from "./key.js";
export { handoffNoteMarker, parseHandoffNote } from "./handoff-note.js";

export function createTaskMemory(config: ProviderRef, context: TaskMemoryContext): TaskMemoryService {
  switch (config.type) {
    case "filesystem/v1": return new FilesystemTaskMemory(config, context);
    case "gitlab/v1": return new GitLabTaskMemory(config, context);
    case "github/v1": return new GitHubTaskMemory(config, context);
    default: throw new Error(`Unknown built-in task-memory provider '${config.type}'`);
  }
}
export function registerTaskMemoryProviders(registry: ProviderRegistrar): void {
  for (const type of ["filesystem/v1", "gitlab/v1", "github/v1"]) registry.register("task-memory", type, (config, context) => createTaskMemory(config, context));
}
