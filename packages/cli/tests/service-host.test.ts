import { createHmac } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSession } from "../src/agent-runtimes/interface.js";
import type { CompiledHarness, RunHandle } from "../src/providers/interface.js";
import { HarnessServer } from "../src/runtime/server.js";
import type { ProjectManagementService, TaskEvent } from "../src/services/contracts.js";
import { GitHubProjectManagement } from "../src/services/project-management/index.js";
import { ServiceRegistry } from "../src/services/registry.js";

const roots: string[] = [];
const active: Array<{ host: HarnessServer; running: Promise<void> }> = [];
const emptyEvents = async function* () {};

afterEach(async () => {
  for (const { host, running } of active.splice(0)) {
    await host.stop().catch(() => {});
    await running.catch(() => {});
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(triggers: string[] = [], pmType = "github/v1", triggerProvider = pmType): string {
  const root = mkdtempSync(join(tmpdir(), "harness-service-host-"));
  roots.push(root);
  const agents = join(root, ".agents");
  mkdirSync(join(agents, "agents"), { recursive: true });
  writeFileSync(join(agents, "agents/engineer.md"), "---\nname: engineer\ndescription: Implements tasks.\n---\nImplement the task.\n");
  writeFileSync(join(agents, "harness.yaml"), JSON.stringify({
    harnessfile: "0.2", name: "service-host-test",
    orchestration: { provider: "test-engine/v1" }, execution: { provider: "test-execution/v1" },
    identity: { provider: "test-identity/v1" }, "project-management": { provider: pmType },
    steps: { ...Object.fromEntries(triggers.map((name) => [name, { type: "trigger", provider: triggerProvider, event: "issue", next: "work" }])), work: { agent: "engineer" } },
  }));
  return root;
}

function registryFor(tasks: ProjectManagementService, providerId = "github/v1", beforeExecution?: () => Promise<void>) {
  const registry = new ServiceRegistry();
  const calls: string[] = [];
  const inputs: Record<string, unknown>[] = [];
  const resolve = vi.fn(async () => ({ subject: "test-bot", credential: "test-token" }));
  const start = vi.fn(async (_agent: string, _prompt: string, options?: { taskId?: string }): Promise<RuntimeSession> => ({
    taskId: options?.taskId ?? "task", instance: {
      id: "test-instance", profileName: "test", protocol: "test-runtime/v1", command: "test", fixedArgs: [], status: "online",
      capabilities: { protocol: "test-runtime/v1", command: "test", streaming: true, resume: false, cancel: true, structuredEvents: [] },
    },
    events: emptyEvents(), result: Promise.resolve({ status: "completed", output: "Done", durationMs: 1 }),
    cancel: async () => {},
  }));
  registry.register("identity", "test-identity/v1", () => ({ resolve, close: async () => { calls.push("identity.close"); } }));
  registry.register("execution", "test-execution/v1", async () => {
    await beforeExecution?.();
    return { start, execute: async () => { throw new Error("Composed execution should use start"); }, close: async () => { calls.push("execution.close"); } };
  });
  registry.register("project-management", providerId, () => tasks);
  registry.register("orchestration", "test-engine/v1", () => ({
    name: "test-engine", displayName: "Test engine", validate: () => ({ valid: true, errors: [], warnings: [] }),
    async compile(_ir, options): Promise<CompiledHarness> {
      return {
        async createRun(input): Promise<RunHandle> {
          inputs.push(input);
          const threadId = `run-${inputs.length}`;
          const result = options.runtimeExecutor!.execute("engineer", String(input.prompt ?? "Single run"), {
            taskId: `${threadId}:work`, context: { runId: threadId, step: "work", parent: input.task as { id: string; url?: string } | undefined },
          }).then(() => ({ status: "completed" as const, threadId }));
          return { threadId, events: emptyEvents(), result };
        },
        resumeRun: async () => { throw new Error("Unused"); }, listRuns: async () => [],
        shutdown: async () => { calls.push("engine.shutdown"); },
      };
    },
  }));
  return { registry, inputs, calls, resolve, start };
}

async function serve(file: string, registry: ServiceRegistry) {
  const host = new HarnessServer();
  const running = host.start({ file, registry, port: 0, gatePort: 0 });
  void running.catch(() => {});
  active.push({ host, running });
  // Production APIs accept port 0; inspect the bound address only inside this test.
  const address = () => (host as unknown as { triggerListener?: { server?: Server } }).triggerListener?.server?.address();
  await vi.waitFor(() => { expect(address()).toBeTruthy(); });
  const bound = address();
  if (!bound || typeof bound === "string") throw new Error("Expected TCP address");
  return { host, running, url: `http://127.0.0.1:${bound.port}` };
}

function memoryTasks(overrides: Partial<ProjectManagementService> = {}): ProjectManagementService {
  return {
    createTask: vi.fn(async (task) => ({ id: task.id })), updateTask: vi.fn(async () => {}), comment: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("composed service host", () => {
  it("authenticates GitHub ingress, selects its managed trigger, suppresses duplicate deliveries and blocks direct trigger bypass", async () => {
    const issues: Record<string, unknown>[] = [];
    const notes: Record<string, unknown>[] = [];
    const tasks = new GitHubProjectManagement({ type: "github/v1", repository: "acme/app", webhook: { secret: "WEBHOOK_KEY", taskLabel: "harnessfile", agent: "engineer" } }, { secret: async () => "webhook-key" }, async (url, options) => {
      if (options!.method === "GET") return new Response(JSON.stringify(String(url).includes("/comments") ? notes : issues));
      const body = JSON.parse(options!.body as string);
      if (String(url).endsWith("/comments")) notes.push(body);
      else if (options!.method === "POST") issues.push({ ...body, number: 10, html_url: "https://github.com/acme/app/issues/10" });
      return new Response(JSON.stringify(issues[0] ?? body));
    });
    const services = registryFor(tasks);
    const { host, running, url } = await serve(fixture(["incoming"]), services.registry);
    const raw = JSON.stringify({ action: "opened", repository: { full_name: "acme/app" }, sender: { login: "person", type: "User" }, issue: { number: 9, state: "open", title: "Fix bug", body: "Details", html_url: "https://github.com/acme/app/issues/9", labels: [{ name: "harnessfile" }] } });
    const headers = { "x-github-event": "issues", "x-github-delivery": "unique-delivery", "x-hub-signature-256": `sha256=${createHmac("sha256", "webhook-key").update(raw).digest("hex")}` };
    const rejected = await fetch(`${url}/providers/project-management/webhook`, { method: "POST", body: raw, headers: { ...headers, "x-hub-signature-256": "invalid" } });
    expect(rejected.status).toBe(401);
    expect(services.inputs).toEqual([]);
    const responses = await Promise.all([1, 2].map(() => fetch(`${url}/providers/project-management/webhook`, { method: "POST", body: raw, headers })));
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    await vi.waitFor(() => expect(notes.some((note) => String(note.body).includes("completed"))).toBe(true));
    expect(services.inputs).toHaveLength(1);
    expect(services.inputs[0]).toMatchObject({ trigger: "incoming", prompt: "Fix bug\n\nDetails", task: { id: "9" } });
    expect(services.start).toHaveBeenCalledTimes(1);
    expect(services.resolve).toHaveBeenCalledTimes(3);
    expect(issues[0].body).toContain("Parent task: https://github.com/acme/app/issues/9");
    const bypass = await fetch(`${url}/trigger/incoming`, { method: "POST", body: JSON.stringify({ prompt: "unsigned" }) });
    expect(bypass.status).toBe(404);
    expect(services.inputs).toHaveLength(1);
    await host.stop();
    await running;
    expect(services.calls).toEqual(["execution.close", "engine.shutdown", "identity.close"]);
  });

  it("rejects events selecting an unrelated trigger and permits a corrected delivery retry", async () => {
    let receive: ((event: TaskEvent) => Promise<void>) | undefined;
    const unsubscribe = vi.fn(async () => {});
    const tasks = memoryTasks({
      subscribe: async (callback) => { receive = callback; return unsubscribe; },
      handleWebhook: async (raw) => { await receive!(JSON.parse(raw)); },
    });
    const services = registryFor(tasks, "test-board/v1");
    const { host, running, url } = await serve(fixture(["features"], "test-board/v1"), services.registry);
    const send = (trigger?: string) => fetch(`${url}/providers/project-management/webhook`, { method: "POST", body: JSON.stringify({ id: "same-delivery", task: { id: "external-1" }, input: { prompt: "Task", ...(trigger ? { trigger } : {}) } }) });
    expect((await send("unknown")).status).toBe(500);
    expect(services.inputs).toEqual([]);
    expect((await send("features")).status).toBe(202);
    expect(services.inputs).toHaveLength(1);
    expect(services.inputs[0].trigger).toBe("features");
    await vi.waitFor(() => expect(tasks.updateTask).toHaveBeenCalledTimes(2));
    await host.stop();
    await running;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("rejects ambiguous provider triggers at startup and closes composed resources", async () => {
    const subscribe = vi.fn(async () => async () => {});
    const close = vi.fn(async () => {});
    const tasks = memoryTasks({ subscribe, close });
    const services = registryFor(tasks);
    await expect(new HarnessServer().start({ file: fixture(["bugs", "features"]), registry: services.registry, port: 0, gatePort: 0 })).rejects.toThrow("requires exactly one trigger");
    expect(subscribe).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(services.calls).toEqual(["execution.close", "engine.shutdown", "identity.close"]);
  });

  it("rejects a subscribed task provider when graph triggers only belong to another provider", async () => {
    const subscribe = vi.fn(async () => async () => {});
    const close = vi.fn(async () => {});
    const services = registryFor(memoryTasks({ subscribe, close }));
    await expect(new HarnessServer().start({ file: fixture(["incoming"], "github/v1", "unrelated/v1"), registry: services.registry, port: 0, gatePort: 0 })).rejects.toThrow("requires exactly one trigger");
    expect(subscribe).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(services.inputs).toEqual([]);
  });

  it("closes composed resources and removes signal listeners when subscription startup fails", async () => {
    const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
    const close = vi.fn(async () => {});
    const tasks = memoryTasks({ subscribe: async () => { throw new Error("Subscription unavailable"); }, close });
    const services = registryFor(tasks);
    const host = new HarnessServer();
    await expect(host.start({ file: fixture(["incoming"]), registry: services.registry, port: 0, gatePort: 0 })).rejects.toThrow("Subscription unavailable");
    expect(close).toHaveBeenCalledTimes(1);
    expect(services.calls).toEqual(["execution.close", "engine.shutdown", "identity.close"]);
    expect(process.listenerCount("SIGINT")).toBe(before.int);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
    await host.stop();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reports a gate port conflict while closing subscriptions and all provider resources", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => { occupied.once("error", reject); occupied.listen(0, resolve); });
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const unsubscribe = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const tasks = memoryTasks({ subscribe: async () => unsubscribe, close });
    const services = registryFor(tasks);
    const host = new HarnessServer();
    try {
      await expect(host.start({ file: fixture(["incoming"]), registry: services.registry, port: 0, gatePort: address.port })).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(services.calls).toEqual(["execution.close", "engine.shutdown", "identity.close"]);
    } finally {
      await host.stop().catch(() => {});
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it("runs once and returns for ordinary project management without an ingress subscription", async () => {
    const close = vi.fn(async () => {});
    const tasks = memoryTasks({ close });
    const services = registryFor(tasks);
    const host = new HarnessServer();
    const running = host.start({ file: fixture(), registry: services.registry, port: 0, gatePort: 0 });
    active.push({ host, running });
    await running;
    expect(services.inputs).toEqual([{}]);
    expect(services.start).toHaveBeenCalledTimes(1);
    expect(tasks.updateTask).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(services.calls).toEqual(["execution.close", "engine.shutdown", "identity.close"]);
    expect((host as unknown as { gateResolver: unknown }).gateResolver).toBeNull();
  });

  it("waits for pending composition and closes late-created resources when stopped during startup", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const beforeExecution = vi.fn(() => pending);
    const close = vi.fn(async () => {});
    const services = registryFor(memoryTasks({ close }), "github/v1", beforeExecution);
    const host = new HarnessServer();
    const running = host.start({ file: fixture(), registry: services.registry });
    active.push({ host, running });
    await vi.waitFor(() => expect(beforeExecution).toHaveBeenCalledOnce());
    let stopped = false;
    const stopping = host.stop().then(() => { stopped = true; });
    try {
      await Promise.resolve();
      expect(stopped).toBe(false);
    } finally { release(); }
    await Promise.all([running, stopping]);
    expect(services.inputs).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
    expect(services.calls).toEqual(["execution.close", "engine.shutdown", "identity.close"]);
    await host.stop();
    expect(close).toHaveBeenCalledOnce();
  });

  it("unsubscribes a late subscription before stop and start settle", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const unsubscribe = vi.fn(async () => {});
    const subscribe = vi.fn(async () => { await pending; return unsubscribe; });
    const close = vi.fn(async () => {});
    const services = registryFor(memoryTasks({ subscribe, close }));
    const host = new HarnessServer();
    const running = host.start({ file: fixture(["incoming"]), registry: services.registry, port: 0, gatePort: 0 });
    active.push({ host, running });
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
    const stopping = host.stop();
    release();
    await Promise.all([running, stopping]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect((host as unknown as { gateResolver: unknown }).gateResolver).toBeNull();
  });

  it("cancels a running one-shot execution when the host receives a termination signal", async () => {
    const close = vi.fn(async () => {});
    const services = registryFor(memoryTasks({ close }));
    let complete!: (result: { status: "cancelled"; output: string; durationMs: number }) => void;
    const result = new Promise<{ status: "cancelled"; output: string; durationMs: number }>((resolve) => { complete = resolve; });
    const cancel = vi.fn(async () => { complete({ status: "cancelled", output: "", durationMs: 1 }); });
    const normalStart = services.start.getMockImplementation()!;
    services.start.mockImplementation(async (...args) => ({ ...await normalStart(...args), result, cancel }));
    const host = new HarnessServer();
    const before = new Set(process.listeners("SIGTERM"));
    const running = host.start({ file: fixture(), registry: services.registry });
    active.push({ host, running });
    await vi.waitFor(() => expect(services.start).toHaveBeenCalledOnce());
    // Invoke this host's listener only; do not signal the test runner or sibling hosts.
    const signal = process.listeners("SIGTERM").find((listener) => !before.has(listener));
    expect(signal).toBeDefined();
    signal!("SIGTERM");
    await running;
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(services.calls).toEqual(["execution.close", "engine.shutdown", "identity.close"]);
    expect(process.listeners("SIGTERM")).not.toContain(signal);
  });
});
