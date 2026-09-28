import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { composeServices } from "../src/services/compose.js";
import { createServiceRegistry, MemoryProjectManagement } from "../src/services/builtins.js";
import { loadPlugins, ServiceRegistry } from "../src/services/registry.js";
import { TaskExecutor } from "../src/services/task-executor.js";
import type { ExecutionEnvironment, IdentityService } from "../src/services/contracts.js";
import type { RuntimeExecuteOptions, RuntimeInstance, RuntimeTaskResult } from "../src/agent-runtimes/interface.js";
import type { Harnessfile } from "../src/ir/types.js";
import { loadHarnessDirectory } from "../src/parser/directory.js";

const instance: RuntimeInstance = {
  id: "test-instance", profileName: "test", protocol: "test/v1", command: "test", fixedArgs: [], status: "online",
  capabilities: { protocol: "test/v1", command: "test", streaming: true, resume: false, cancel: true, structuredEvents: ["text"] },
};
function executor(result: (agent: string, prompt: string, options?: RuntimeExecuteOptions) => Promise<RuntimeTaskResult> | RuntimeTaskResult): ExecutionEnvironment {
  return {
    async start(agent, prompt, options) {
      return { taskId: options?.taskId ?? "task", instance, cancel: async () => {},
        result: Promise.resolve(result(agent, prompt, options)),
        events: { async *[Symbol.asyncIterator]() { options?.onEvent?.({ type: "text", content: "streamed" }); yield { type: "text" as const, content: "streamed" }; } },
      };
    },
    async execute(agent, prompt, options) {
      const session = await this.start(agent, prompt, options);
      for await (const _event of session.events) {}
      return session.result;
    },
    close: vi.fn(async () => {}),
  };
}
function harness(): Harnessfile {
  return { version: "0.2", name: "composition", agents: { worker: { instructions: "Work", description: "Worker" } },
    execution: { provider: "test/v1" }, projectManagement: { provider: "memory/v1" }, identity: { provider: "test/v1" },
    steps: { work: { type: "agent", agent: "worker" } },
  };
}
function setup(ir = harness(), runtime = executor(() => ({ status: "completed", output: "done", durationMs: 0 }))) {
  const registry = createServiceRegistry();
  const board = new MemoryProjectManagement();
  const identity: IdentityService = { resolve: vi.fn(async agent => ({ subject: `bot:${agent}`, credential: "never-persist-this" })), close: vi.fn(async () => {}) };
  registry.register("execution", "test/v1", () => runtime);
  registry.register("identity", "test/v1", () => identity);
  registry.register("project-management", "test/v1", () => board);
  ir.projectManagement = { provider: "test/v1" };
  return { ir, registry, board, runtime, identity };
}

describe("provider composition", () => {
  it("selects providers by role and rejects collisions without leaking registrations", () => {
    const registry = new ServiceRegistry();
    registry.register("identity", "bundle/v1", () => ({ async resolve(agent) { return { subject: agent }; } }));
    registry.register("project-management", "bundle/v1", () => new MemoryProjectManagement());
    expect(() => registry.register("identity", "bundle/v1", () => ({} as any))).toThrow("Duplicate");
    expect(() => new ServiceRegistry().assertAvailable("identity", "bundle/v1")).toThrow("--plugin");
  });

  it("loads external modules only explicitly and checks plugin API versions", async () => {
    const root = mkdtempSync(join(tmpdir(), "harness-plugin-"));
    try {
      writeFileSync(join(root, "good.mjs"), 'export default {apiVersion:1,register(r){r.register("identity","external/v1",()=>({resolve:async agent=>({subject:agent})}))}}');
      writeFileSync(join(root, "bad.mjs"), 'export default {apiVersion:2,register(){}}');
      const registry = new ServiceRegistry();
      expect(() => registry.assertAvailable("identity", "external/v1")).toThrow();
      await loadPlugins(registry, ["./good.mjs"], root);
      expect(() => registry.assertAvailable("identity", "external/v1")).not.toThrow();
      await expect(loadPlugins(registry, ["./bad.mjs"], root)).rejects.toThrow("apiVersion: 1");
      await expect(loadPlugins(registry, ["./good.mjs"], root)).rejects.toThrow("Duplicate");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("runs a real graph through independently selected execution, identity and board services", async () => {
    const event = vi.fn();
    const runtime = executor(() => ({ status: "completed", output: "implemented", durationMs: 1,
      metadata: { workspacePatch: "diff --git a/file b/file", workspaceBaseCommit: "abc", privateTransportData: "must-not-escape" } }));
    const { ir, registry, board, identity } = setup(harness(), runtime);
    const services = await composeServices(ir, { registry });
    const handle = await services.harness.createRun({ task: { id: "issue-1", url: "https://example.com/1" } });
    for await (const item of handle.events) event(item);
    const result = await handle.result;
    expect(result.status).toBe("completed");
    expect(result.output?.work_artifacts).toEqual({ workspacePatch: "diff --git a/file b/file", workspaceBaseCommit: "abc" });
    const [task] = [...board.tasks.values()];
    expect(task).toMatchObject({ agent: "worker", status: "completed", subject: "bot:worker", parent: { id: "issue-1" }, runId: handle.threadId, step: "work" });
    expect(identity.resolve).toHaveBeenCalledTimes(3);
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ type: "runtime" }));
    expect(JSON.stringify([...board.tasks.values()])).not.toContain("never-persist-this");
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    await services.close();
    await services.close();
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("keeps squad delegation parent and requesting-agent attribution", async () => {
    const ir = loadHarnessDirectory(resolve(import.meta.dirname, "fixtures/squad")).ir;
    ir.execution = { provider: "test/v1" }; ir.identity = { provider: "test/v1" };
    let turn = 0;
    const runtime = executor(agent => ({ status: "completed", durationMs: 0,
      output: agent === "pm" ? (turn++ === 0 ? '{"action":"dispatch","member":"engineer","instruction":"implement"}' : '{"action":"done","summary":"done"}') : "implemented",
      ...(agent === "engineer" ? { metadata: { workspacePatch: "patch", workspaceBaseCommit: "abc" } } : {}),
    }));
    const { registry, board } = setup(ir, runtime);
    const services = await composeServices(ir, { registry });
    const handle = await services.harness.createRun({});
    const result = await handle.result;
    expect(result.status).toBe("completed");
    const tasks = [...board.tasks.values()];
    expect(tasks).toHaveLength(3);
    expect(tasks[1]).toMatchObject({ agent: "engineer", requestedBy: "pm", parent: { id: tasks[0].id }, status: "completed" });
    expect(JSON.stringify(result.output)).toContain('"workspacePatch":"patch"');
    await services.close();
  });

  it("uses a third-party orchestration engine without instantiating the reference graph", async () => {
    const { ir, registry } = setup();
    ir.orchestration = { provider: { type: "external/v1", x: 7 } };
    const compile = vi.fn(async (_ir, options) => {
      await options.runtimeExecutor.execute("worker", "from custom engine");
      return { createRun: vi.fn(), resumeRun: vi.fn(), listRuns: async () => [], shutdown: vi.fn(async () => {}) };
    });
    registry.register("orchestration", "external/v1", config => {
      expect(config.x).toBe(7);
      return { name: "external", displayName: "External", validate: () => ({ valid: true, errors: [], warnings: [] }), compile };
    });
    const services = await composeServices(ir, { registry });
    expect(compile).toHaveBeenCalledOnce();
    await services.close();
  });

  it("marks a failed runtime task and fails the graph instead of reporting success", async () => {
    const { ir, registry, board } = setup(harness(), executor(() => ({ status: "failed", output: "", error: "worker failed", durationMs: 0 })));
    const services = await composeServices(ir, { registry });
    const handle = await services.harness.createRun({});
    expect((await handle.result).status).toBe("failed");
    expect([...board.tasks.values()][0].status).toBe("failed");
    await services.close();
  });

  it("rejects missing capabilities before opening any resources", async () => {
    const { ir, registry, identity } = setup();
    ir.orchestration = { provider: "missing/v1" };
    await expect(composeServices(ir, { registry })).rejects.toThrow("No orchestration provider");
    expect(identity.close).not.toHaveBeenCalled();
  });

  it("rejects unimplemented durable checkpoint selection rather than using memory", async () => {
    const { ir, registry, runtime } = setup();
    await expect(composeServices(ir, { registry, checkpointer: "sqlite" })).rejects.toThrow("does not implement SQLite");
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("uses protocol drivers registered by an extension with the local execution provider", async () => {
    const ir = harness();
    ir.execution = { provider: "local/v1" };
    ir.identity = { provider: "local/v1" };
    ir.agents.worker.runtime = "extension";
    ir.runtimes = { extension: { protocol: "extension/v1" } };
    const registry = createServiceRegistry();
    const probe = vi.fn(async () => ({ ...instance.capabilities, protocol: "extension/v1", command: process.execPath }));
    registry.registerRuntime({ protocol: "extension/v1", defaultCommand: process.execPath, probe,
      async start(task) { return { taskId: task.taskId, instance: task.instance, events: (async function* () {})(),
        result: Promise.resolve({ status: "completed", output: "custom protocol", durationMs: 0 }), cancel: async () => {} }; },
    });
    const services = await composeServices(ir, { registry });
    const handle = await services.harness.createRun({});
    expect((await handle.result).output?.work).toBe("custom protocol");
    expect(probe).toHaveBeenCalledOnce();
    await services.close();
  });

  it("cleans up each opened provider even when compile and cleanup both fail", async () => {
    const order: string[] = [];
    const { ir, registry, runtime, identity } = setup();
    runtime.close = async () => { order.push("execution"); throw new Error("close failed"); };
    identity.close = async () => { order.push("identity"); };
    ir.orchestration = { provider: "broken/v1" };
    registry.register("orchestration", "broken/v1", () => ({ name: "broken", displayName: "Broken", validate: () => ({ valid: true, errors: [], warnings: [] }), compile: async () => { throw new Error("compile failed"); } }));
    await expect(composeServices(ir, { registry })).rejects.toThrow("startup and cleanup");
    expect(order).toEqual(["execution", "identity"]);
  });

  it("event streams terminate even if drained after engine shutdown", async () => {
    const { ir, registry } = setup();
    const services = await composeServices(ir, { registry });
    const handle = await services.harness.createRun({});
    await handle.result;
    await services.close();
    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.at(-1)?.type).toBe("run-end");
  });

  it("waits for an in-flight task create before dependencies can close", async () => {
    const board = new MemoryProjectManagement();
    const original = board.createTask.bind(board);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    board.createTask = async (...args) => { entered(); await blocked; return original(...args); };
    const runtime = executor(() => ({ status: "completed", output: "done", durationMs: 0 }));
    runtime.start = vi.fn(runtime.start);
    const tracked = new TaskExecutor(runtime, board, { resolve: async agent => ({ subject: agent }) }, "memory/v1");
    const start = tracked.start("worker", "work");
    void start.catch(() => {});
    await ready;
    let closed = false;
    const close = tracked.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await expect(start).rejects.toThrow();
    await close;
    expect([...board.tasks.values()][0].status).toBe("cancelled");
    expect(runtime.start).not.toHaveBeenCalled();
  });
});
