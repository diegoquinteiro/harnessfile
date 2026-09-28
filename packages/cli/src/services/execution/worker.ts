import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RuntimeDispatcher } from "../../agent-runtimes/dispatcher.js";
import { builtinRuntimeDrivers } from "../../agent-runtimes/registry.js";
import { ServiceRegistry, loadPlugins } from "../registry.js";
import { encodeMessage, type WorkerRequest, type WorkerMessage } from "./protocol.js";
import type { RuntimeTaskResult } from "../../agent-runtimes/interface.js";
import { loadTaskServices, workerFactoryContext } from "./task-services.js";
import { runDetachedWorker } from "./detached-worker.js";
import { prepareTaskRuntime } from "./task-runtime.js";

const exec = promisify(execFile);

export async function prepareWorkerWorkspace(request: WorkerRequest): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "harnessfile-worker-"));
  const workspace = join(root, "workspace");
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (process.env.HARNESSFILE_GIT_TOKEN) {
    // The helper reads its token at execution time; neither URL nor .git/config stores it.
    const helper = join(root, "git-credentials.cjs");
    await writeFile(helper, `#!/usr/bin/env node\nif (process.argv[2] === 'get') process.stdout.write('username=' + (process.env.HARNESSFILE_GIT_USERNAME || 'x-access-token') + '\\npassword=' + process.env.HARNESSFILE_GIT_TOKEN + '\\n');\n`, { mode: 0o700 });
    Object.assign(gitEnv, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: helper });
    // Subsequent driver processes also need Git authentication to push authorized work.
    Object.assign(process.env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: helper });
  }
  const options = { env: gitEnv, timeout: Math.min(request.timeoutMs, 120_000), maxBuffer: 1024 * 1024 };
  await exec("git", ["clone", "--no-checkout", "--", request.repository, workspace], options);
  if (request.ref) await exec("git", ["-C", workspace, "fetch", "--no-tags", "origin", request.ref], options);
  await exec("git", ["-C", workspace, "checkout", "--detach", request.ref ? "FETCH_HEAD" : "HEAD"], options);
  return workspace;
}

/** Reuses installed runtime drivers; infrastructure SDKs are never needed in the worker. */
export async function executeWorker(request: WorkerRequest, workspace: string, send: (message: WorkerMessage) => void, deferResult = false): Promise<RuntimeTaskResult> {
  const gitOptions = { cwd: workspace, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 };
  const baseCommit = (await exec("git", ["rev-parse", "HEAD"], gitOptions)).stdout.trim();
  const registry = new ServiceRegistry();
  for (const driver of builtinRuntimeDrivers()) registry.registerRuntime(driver);
  await loadPlugins(registry, request.plugins, "/opt/harnessfile");
  let ir = request.ir;
  const scope = request.detached ?? request.taskScope;
  const taskRuntime = scope ? await prepareTaskRuntime(scope, workerFactoryContext(request), request.plugins) : undefined;
  const previousEnv = Object.fromEntries(Object.keys(taskRuntime?.env ?? {}).map(key => [key, process.env[key]]));
  if (taskRuntime) {
    Object.assign(process.env, taskRuntime.env);
    const agent = ir.agents[request.agentName];
    ir = { ...ir, agents: { ...ir.agents, [request.agentName]: { ...agent, instructions: agent.instructions + taskRuntime.promptSuffix } } };
  }
  try {
  const dispatcher = new RuntimeDispatcher(ir, { workspaceRoot: workspace, drivers: registry.runtimeDrivers() });
  const result = await dispatcher.execute(request.agentName, request.prompt, {
    taskId: request.taskId, timeoutMs: request.timeoutMs,
    onEvent: event => send({ version: 1, type: "event", event }),
  });
  // Preserve edits before destroying the sandbox, including untracked, nonignored files.
  // A patch is evidence/artifact data; the host never applies it automatically.
  try {
    await exec("git", ["add", "--intent-to-add", "--all"], gitOptions);
    const patch = (await exec("git", ["diff", "--binary", baseCommit, "--"], gitOptions)).stdout;
    result.metadata = { ...result.metadata, workspaceBaseCommit: baseCommit, workspacePatch: patch };
  } catch {
    send({ version: 1, type: "event", event: { type: "warning", content: "Could not export workspace patch (maximum 4 MiB). Persist changes with Git before the sandbox exits." } });
    result.metadata = { ...result.metadata, workspaceExportFailed: true };
  }
  delete result.resume;
  if (!deferResult) send({ version: 1, type: "result", result });
  return result;
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await taskRuntime?.cleanup();
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const send = (message: WorkerMessage) => { process.stdout.write(encodeMessage(message)); };
  try {
    const path = process.argv[2];
    if (!path) throw new Error("Missing worker request path");
    const request = JSON.parse(await readFile(path, "utf8")) as WorkerRequest;
    await unlink(path);
    if (request.version !== 1 || typeof request.repository !== "string" || !request.ir || !Array.isArray(request.plugins)) throw new Error("Invalid worker request");
    if (request.detached) {
      const services = await loadTaskServices(request.detached, workerFactoryContext(request), request.plugins);
      try {
        const result = await runDetachedWorker(request, services, { prepare: prepareWorkerWorkspace, execute: (input, workspace) => executeWorker(input, workspace, send, true) });
        if (result) send({ version: 1, type: "result", result });
      } finally { await services.close(); }
    } else {
      const workspace = await prepareWorkerWorkspace(request);
      await executeWorker(request, workspace, send);
    }
  } catch {
    // Child-process and plugin exceptions can embed credentials. Return a safe diagnostic.
    send({ version: 1, type: "result", result: { status: "failed", output: "", error: "Worker failed to prepare the checkout or start the configured runtime. Verify the repository, ref, image, runtime installation, and authentication.", durationMs: Date.now() - startedAt } });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
