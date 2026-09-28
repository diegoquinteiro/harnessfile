import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FactoryContext } from "../contracts.js";
import type { TaskRuntimeScope } from "./detached.js";
import { shellQuote, type WorkerRequest } from "./protocol.js";
import { taskSecretEnvironment } from "./task-services.js";

export interface PreparedTaskRuntime {
  promptSuffix: string;
  env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

/** Materializes only the fixed task scope; usable by local and remote coding-agent drivers. */
export async function prepareTaskRuntime(task: TaskRuntimeScope, context: FactoryContext, plugins: string[] = []): Promise<PreparedTaskRuntime> {
  const prepared = await taskSecretEnvironment(task, context);
  const request: WorkerRequest = { version: 1, taskId: task.id, agentName: task.agent, prompt: task.prompt, ir: context.ir,
    repository: "", timeoutMs: 0, plugins, taskScope: prepared.task, secretEnv: prepared.secretEnv };
  const directory = await mkdtemp(join(tmpdir(), "harnessfile-capabilities-"));
  try {
    const scopeFile = join(directory, "scope.json");
    await writeFile(scopeFile, JSON.stringify(request), { mode: 0o600 });
    let cliPath = fileURLToPath(new URL("./task-cli.js", import.meta.url));
    if (!existsSync(cliPath)) cliPath = fileURLToPath(new URL("../../../dist/src/services/execution/task-cli.js", import.meta.url));
    if (!existsSync(cliPath)) throw new Error("Build the CLI before materializing task capabilities");
    await writeFile(join(directory, "harnessfile-task"), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"\n`, { mode: 0o700 });
    const promptSuffix = `\n\nTask: ${task.delivery.task.key ?? task.delivery.task.id}${task.delivery.task.url ? ` (${task.delivery.task.url})` : ""}. Task capabilities are available through \`harnessfile-task tools\`, which lists the selected provider's tools and JSON schemas. Invoke a declared tool as \`harnessfile-task TOOL_NAME\` with one JSON object on stdin. Task, dispatch, run, step, and agent identity are fixed by the injected scope. Read the shared task context before working. ${task.delivery.memory ? "Publish your final handoff with the provider's declared completion tool. " : ""}\`task_read\` and \`task_comment\` use your configured account when a task board is available. Credentials are supplied through the environment, never through your prompt.`;
    return { promptSuffix, env: { ...prepared.env, HARNESSFILE_TASK_SCOPE_FILE: scopeFile, HARNESSFILE_TASK_PLUGIN_ROOT: context.workspaceRoot,
      PATH: `${directory}:${process.env.PATH ?? ""}` }, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
