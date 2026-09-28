import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryContext, TaskHandoff, TaskMemorySnapshot } from "../src/services/contracts.js";
import type { DetachedTask } from "../src/services/execution/detached.js";
import { createModalExecution, type ModalSdk } from "../src/services/execution/modal.js";
import * as taskServices from "../src/services/execution/task-services.js";
import { runDetachedWorker } from "../src/services/execution/detached-worker.js";
import { invokeTaskTool } from "../src/services/execution/task-cli.js";
import type { WorkerRequest } from "../src/services/execution/protocol.js";
import { prepareTaskRuntime } from "../src/services/execution/task-runtime.js";
import { canonicalTaskKey, FilesystemTaskMemory } from "../src/services/task-memory/index.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { ServiceRegistry } from "../src/services/registry.js";

const ir = { version: "0.2", agents: { coder: { instructions: "Do work", runtime: "claude" } }, runtimes: { claude: { protocol: "claude-code/v1" } } };
const task = (): DetachedTask => ({ id: "dispatch-1", agent: "coder", prompt: "Do work", context: { runId: "run", step: "build" }, deadlineAt: new Date(Date.now() + 120000).toISOString(), delivery: { task: { id: "3", key: "task:test" }, memory: { provider: { type: "gitlab/v1", project: "owner/repo", stateBranch: "state", tokenSecret: "MEMORY_TOKEN" } } } });
function services() {
  let state: TaskMemorySnapshot = { revision: "1", checkpoint: { run: "state" }, handoffs: [] };
  const memory = {
    capabilities: { durable: true as const, atomicCompareAndSwap: true as const, tools: [{ name: "custom_completion", description: "custom", inputSchema: {} }] },
    read: vi.fn(async () => structuredClone(state)),
    compareAndSwap: vi.fn(async (_task, revision, checkpoint) => {
      if (revision !== state.revision) throw Object.assign(new Error("conflict"), { name: "TaskMemoryConflictError" });
      state = { ...state, revision: String(Number(state.revision) + 1), checkpoint }; return structuredClone(state);
    }),
    publishHandoff: vi.fn(async (_task, handoff: TaskHandoff) => { if (!state.handoffs.some(h => h.id === handoff.id)) state.handoffs.push(handoff); return handoff; }),
    invokeTool: vi.fn(async () => ({ ok: true })),
  };
  const result: taskServices.TaskServices = { memory, scope: { task: task().delivery.task, dispatchId: "dispatch-1", runId: "run", step: "build", agent: "coder", board: { provider: "gitlab/v1" }, memory: { provider: "gitlab/v1" } }, close: vi.fn(async () => {}) };
  return { service: result, memory, snapshot: () => state };
}
const request = (detached = task()): WorkerRequest => ({ version: 1, taskId: detached.id, agentName: detached.agent, prompt: detached.prompt, ir, repository: "https://example.test/repo.git", plugins: [], timeoutMs: 90000, detached });
afterEach(() => vi.restoreAllMocks());

describe("detached Modal acceptance", () => {
  function fixture() {
    const state = services(); vi.spyOn(taskServices, "loadTaskServices").mockResolvedValue(state.service);
    let accepted = false;
    const terminate = vi.fn(async () => {}), detach = vi.fn();
    const sandbox = { sandboxId: "sb-detached", terminate, detach, exec: vi.fn() };
    const fromName = vi.fn(async () => { if (accepted) return sandbox; throw Object.assign(new Error("missing"), { name: "NotFoundError" }); });
    const create = vi.fn(async () => { accepted = true; return sandbox; });
    const close = vi.fn();
    const sdk: ModalSdk = { ModalClient: class {
      apps = { fromName: async () => ({}) }; images = { fromRegistry: () => ({}) }; sandboxes = { create, fromName }; close = close;
    } };
    const context: FactoryContext = { ir, workspaceRoot: "/tmp", drivers: [], secret: vi.fn(async name => `resolved:${name}`) };
    return { ...state, create, fromName, close, terminate, detach, sandbox, sdk, context };
  }

  it("starts atomically through sandbox creation and releases host without terminating worker", async () => {
    const f = fixture(); const environment = await createModalExecution({ type: "modal/v1", image: "worker:1", repository: "https://example.test/repo.git" }, f.context, f.sdk);
    const input = task(); const first = await environment.submit(input); const replay = await environment.submit(input);
    expect(first).toEqual({ id: input.id, provider: "modal/v1", resourceId: "sb-detached", state: "accepted" }); expect(replay).toEqual(first);
    expect(f.create).toHaveBeenCalledOnce(); expect(f.sandbox.exec).not.toHaveBeenCalled();
    const options = f.create.mock.calls[0][2] as Record<string, any>;
    expect(options.name).toMatch(/^hfd-[a-f0-9]{48}$/); expect(options.command.slice(0, 2)).toEqual(["node", "-e"]);
    const payload = JSON.parse(Buffer.from(options.env.HARNESSFILE_DETACHED_REQUEST, "base64").toString());
    expect(payload.detached.id).toBe(input.id); expect(JSON.stringify(payload)).not.toContain("resolved:");
    expect(Object.values(options.env)).toContain("resolved:MEMORY_TOKEN");
    await environment.close(); expect(f.terminate).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce();
  });

  it("recovers ambiguous accepted creation by deterministic name", async () => {
    const f = fixture(); const original = f.create.getMockImplementation()!;
    f.create.mockImplementationOnce(async () => { await original(); throw new Error("lost response"); });
    const environment = await createModalExecution({ type: "modal/v1", image: "worker:1", repository: "https://example.test/repo.git" }, f.context, f.sdk);
    expect((await environment.submit(task())).resourceId).toBe("sb-detached"); expect(f.create).toHaveBeenCalledOnce(); await environment.close();
  });

  it("does not create a second worker after a durable claim or handoff", async () => {
    const f = fixture(); const input = task();
    f.snapshot().checkpoint!.workerClaims = { [input.id]: { claimedAt: "now" } };
    const environment = await createModalExecution({ type: "modal/v1", image: "worker:1", repository: "https://example.test/repo.git" }, f.context, f.sdk);
    expect((await environment.submit(input)).state).toBe("accepted"); expect(f.create).not.toHaveBeenCalled();
    f.snapshot().handoffs.push({ id: input.id, dispatchId: input.id, runId: "run", step: "build", agent: "coder", status: "completed", summary: "done", createdAt: new Date().toISOString() });
    expect((await environment.submit(input)).state).toBe("completed"); expect(f.create).not.toHaveBeenCalled(); await environment.close();
  });

  it("rejects expired dispatches instead of treating retries as new work", async () => {
    const f = fixture(); const environment = await createModalExecution({ type: "modal/v1", image: "worker:1", repository: "https://example.test/repo.git" }, f.context, f.sdk);
    await expect(environment.submit({ ...task(), deadlineAt: new Date(Date.now() - 1).toISOString() })).rejects.toThrow("expired");
    expect(f.create).not.toHaveBeenCalled(); await environment.close();
  });
});

describe("detached worker delivery", () => {
  it("claims once, publishes verified normalized fallback, and skips replay", async () => {
    const f = services(), input = request();
    const operations = { prepare: vi.fn(async () => "/workspace"), execute: vi.fn(async () => ({ status: "completed" as const, output: "finished", durationMs: 5 })) };
    expect(await runDetachedWorker(input, f.service, operations)).toMatchObject({ status: "completed", output: "finished" });
    expect(f.snapshot().handoffs).toHaveLength(1); expect(f.snapshot().checkpoint?.run).toBe("state");
    await runDetachedWorker(input, f.service, operations); expect(operations.execute).toHaveBeenCalledOnce();
  });

  it("two duplicate workers race on CAS and only one starts the coding agent", async () => {
    const f = services(), input = request();
    const operations = { prepare: vi.fn(async () => "/workspace"), execute: vi.fn(async () => ({ status: "completed" as const, output: "done", durationMs: 5 })) };
    await Promise.all([runDetachedWorker(input, f.service, operations), runDetachedWorker(input, f.service, operations)]);
    expect(operations.execute).toHaveBeenCalledOnce(); expect(f.snapshot().handoffs).toHaveLength(1);
  });

  it("honors agent-authored handoff and retries its wakeup projection", async () => {
    const f = services(), input = request();
    const handoff: TaskHandoff = { id: "dispatch-1", dispatchId: "dispatch-1", runId: "run", step: "build", agent: "coder", status: "completed", summary: "Agent-authored summary", createdAt: new Date().toISOString() };
    const operations = { prepare: async () => "/workspace", execute: async () => { f.snapshot().handoffs.push(handoff); return { status: "completed" as const, output: "runtime text", durationMs: 3 }; } };
    expect(await runDetachedWorker(input, f.service, operations)).toMatchObject({ output: "Agent-authored summary" });
    expect(f.memory.publishHandoff).toHaveBeenCalledWith(input.detached!.delivery.task, handoff);
  });

  it("publishes preparation failure independently of the originating host", async () => {
    const f = services();
    const result = await runDetachedWorker(request(), f.service, { prepare: async () => { throw new Error("secret:bad-token"); }, execute: vi.fn() });
    expect(result?.status).toBe("failed"); expect(JSON.stringify(f.snapshot())).not.toContain("bad-token");
  });
});

describe("task capabilities and identity isolation", () => {
  it("reuses host plugin factories rather than silently selecting builtin providers", async () => {
    const f = services(); const registry = new ServiceRegistry(); const factory = vi.fn(() => f.memory);
    registry.register("task-memory", "custom/v1", factory);
    const input = task(); input.delivery.memory = { provider: "custom/v1" };
    const loaded = await taskServices.loadTaskServices(input, { ir, workspaceRoot: "/tmp", drivers: [], secret: async () => "", registry });
    expect(loaded.memory).toBe(f.memory); expect(factory).toHaveBeenCalledOnce(); await loaded.close();
  });

  it("materializes a working local helper with provider schemas, fixed scope, and cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-runtime-test-"));
    const input = task(); input.delivery.task.key = canonicalTaskKey("github/v1", "https://api.github.com", "owner/repo", "3");
    input.delivery.memory = { provider: { type: "filesystem/v1", path: join(root, "memory") } };
    input.delivery.identity = { provider: "local/v1" };
    const prepared = await prepareTaskRuntime(input, { ir, workspaceRoot: root, drivers: [], secret: async () => { throw new Error("No secrets expected"); } });
    try {
      const helper = join(dirname(prepared.env.HARNESSFILE_TASK_SCOPE_FILE!), "harnessfile-task");
      const call = (name: string, body = {}) => new Promise<any>((resolve, reject) => {
        const child = spawn(helper, [name], { env: { ...process.env, ...prepared.env }, stdio: "pipe" });
        let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", reject); child.on("exit", code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
        child.stdin.end(JSON.stringify(body));
      });
      const listed = await call("tools"); expect(listed.tools.map((tool: { name: string }) => tool.name)).toContain("task_memory_publish_handoff");
      await call("task_memory_publish_handoff", { status: "completed", summary: "Published through the real helper" });
      const memory = new FilesystemTaskMemory({ type: "filesystem/v1", path: join(root, "memory") }, { workspaceRoot: root });
      expect((await memory.read(input.delivery.task)).handoffs[0]).toMatchObject({ dispatchId: input.id, agent: "coder", summary: "Published through the real helper" });
      await expect(call("task_memory_publish_handoff", { status: "completed", summary: "override", dispatchId: "another" })).rejects.toThrow("Task capability operation failed");
      expect(prepared.promptSuffix).toContain(input.delivery.task.key);
    } finally { await prepared.cleanup(); await rm(root, { recursive: true, force: true }); }
    await expect(readFile(prepared.env.HARNESSFILE_TASK_SCOPE_FILE!)).rejects.toThrow();
  });

  it("forwards only the selected agent's secret refs and supports GitHub private keys", async () => {
    const input = task(); input.delivery.identity = { provider: { type: "github-app/v1", agents: {
      coder: { appId: 1, installationId: 2, privateKeySecret: "CODER_KEY", subject: "coder[bot]" },
      other: { appId: 3, installationId: 4, privateKeySecret: "OTHER_KEY", subject: "other[bot]" },
    } } };
    const secret = vi.fn(async name => `value:${name}`);
    const result = await taskServices.taskSecretEnvironment(input, { ir, workspaceRoot: "/tmp", drivers: [], secret });
    expect(secret.mock.calls.map(call => call[0])).toEqual(["MEMORY_TOKEN", "CODER_KEY"]);
    expect(JSON.stringify(result.task)).not.toContain("OTHER_KEY"); expect(JSON.stringify(result.task)).not.toContain("value:");
  });

  it("uses provider-declared tools and refreshes actual board identity for each operation", async () => {
    const f = services(); const resolve = vi.fn(async () => ({ subject: "service-account", credential: "fresh-token" }));
    const comment = vi.fn(async () => {}); const readTask = vi.fn(async () => ({ task: f.service.scope.task, title: "task", body: "context", comments: [] }));
    f.service.identities = { resolve }; f.service.board = { audience: "https://gitlab.test/api/v4", comment, readTask, createTask: vi.fn(), updateTask: vi.fn() };
    await invokeTaskTool(f.service, "custom_completion", { summary: "done" });
    expect(f.memory.invokeTool).toHaveBeenCalledWith("custom_completion", { summary: "done" }, f.service.scope);
    await invokeTaskTool(f.service, "task_read", {}); await invokeTaskTool(f.service, "task_comment", { body: "progress", task: { id: "another" } });
    expect(resolve).toHaveBeenCalledTimes(2); expect(comment).toHaveBeenCalledWith(f.service.scope.task, "progress", { subject: "service-account", credential: "fresh-token" });
    await expect(invokeTaskTool(f.service, "invented", {})).rejects.toThrow("does not declare");
  });
});
