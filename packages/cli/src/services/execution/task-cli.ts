import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkerRequest } from "./protocol.js";
import { loadTaskServices, workerFactoryContext, type TaskServices } from "./task-services.js";

/** The helper exposes only tools declared by the selected provider and this task scope. */
export async function invokeTaskTool(services: TaskServices, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { scope, memory, board, identities } = services;
  if (name === "task_read" || name === "task_comment") {
    if (!board || !identities) throw new Error("Task board access requires an injected board and identity binding");
    const actor = await identities.resolve(scope.agent, board.audience ?? scope.board.provider);
    if (name === "task_read") {
      if (!board.readTask) throw new Error("This task board does not support reading context");
      return board.readTask(scope.task, actor);
    }
    if (typeof input.body !== "string" || !input.body.trim()) throw new Error("task_comment requires a nonempty body");
    await board.comment(scope.task, input.body, actor); return { published: true };
  }
  if (!memory?.capabilities.tools.some(tool => tool.name === name)) throw new Error(`Task-memory provider does not declare tool '${name}'`);
  return memory.invokeTool(name, input, scope);
}

async function main(): Promise<void> {
  let services: TaskServices | undefined;
  try {
    const path = process.env.HARNESSFILE_TASK_SCOPE_FILE;
    if (!path) throw new Error("Task capability scope is not configured");
    const request = JSON.parse(await readFile(path, "utf8")) as WorkerRequest;
    const scope = request.detached ?? request.taskScope;
    if (!scope) throw new Error("Missing task scope");
    services = await loadTaskServices(scope, workerFactoryContext(request), request.plugins);
    const command = process.argv[2] ?? "tools";
    if (command === "tools") {
      const tools = [...services.memory?.capabilities.tools ?? []];
      if (services.board && services.identities) tools.push(
        { name: "task_read", description: "Read this task and its discussion", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
        { name: "task_comment", description: "Comment on this task using the configured agent account", inputSchema: { type: "object", properties: { body: { type: "string" } }, required: ["body"], additionalProperties: false } },
      );
      process.stdout.write(JSON.stringify({ scope: services.scope, tools }) + "\n");
    } else {
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of process.stdin) { length += chunk.length; if (length > 1024 * 1024) throw new Error("Task tool input exceeds 1 MiB"); chunks.push(Buffer.from(chunk)); }
      const text = Buffer.concat(chunks).toString("utf8");
      const input = text.trim() ? JSON.parse(text) : {};
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Task tool input must be a JSON object");
      process.stdout.write(JSON.stringify(await invokeTaskTool(services, command, input)) + "\n");
    }
  } catch {
    process.stderr.write("Task capability operation failed. Check its declared schema and configured provider permissions.\n"); process.exitCode = 1;
  } finally { await services?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
