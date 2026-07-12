import { describe, expect, it, vi } from "vitest";
import { ClaudeCodeRuntimeDriver } from "../src/agent-runtimes/drivers/claude-code.js";
import { CodexRuntimeDriver } from "../src/agent-runtimes/drivers/codex.js";
import { RuntimeDispatcher } from "../src/agent-runtimes/dispatcher.js";
import { LocalRuntimeRegistry } from "../src/agent-runtimes/registry.js";
import { prepareRuntimeEnvironment } from "../src/agent-runtimes/environment.js";
import { AsyncQueue, type ProcessHandle, type ProcessInvocation, type ProcessResult, type ProcessRunner } from "../src/agent-runtimes/process.js";
import type {
  AgentRuntimeDriver,
  RuntimeEvent,
  RuntimeInstance,
  RuntimeSession,
  RuntimeTask,
  RuntimeTaskResult,
} from "../src/agent-runtimes/interface.js";
import type { Harnessfile, RuntimeProfileDef } from "../src/ir/types.js";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

class ScriptedHandle implements ProcessHandle {
  stdoutQueue = new AsyncQueue<string>();
  stderrQueue = new AsyncQueue<string>();
  writes: Array<Record<string, unknown>> = [];
  ended = false;
  cancelled = false;
  private resolveResult!: (result: ProcessResult) => void;
  result = new Promise<ProcessResult>((resolve) => { this.resolveResult = resolve; });

  constructor(private onWrite: (value: Record<string, unknown>, handle: ScriptedHandle) => void) {}

  get stdout() { return this.stdoutQueue; }
  get stderr() { return this.stderrQueue; }

  write(data: string): void {
    for (const line of data.trim().split(/\r?\n/)) {
      const value = JSON.parse(line) as Record<string, unknown>;
      this.writes.push(value);
      this.onWrite(value, this);
    }
  }

  push(value: Record<string, unknown>): void {
    this.stdoutQueue.push(`${JSON.stringify(value)}\n`);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.stdoutQueue.close();
    this.stderrQueue.close();
    this.resolveResult({ stdout: "", stderr: "", exitCode: 0, timedOut: false, cancelled: false });
  }

  async cancel(): Promise<void> {
    if (this.ended) return;
    this.cancelled = true;
    this.ended = true;
    this.stdoutQueue.close();
    this.stderrQueue.close();
    this.resolveResult({ stdout: "", stderr: "", exitCode: 130, timedOut: false, cancelled: true });
  }
}

class ScriptedRunner implements ProcessRunner {
  invocation?: ProcessInvocation;
  handle?: ScriptedHandle;

  constructor(private script: (value: Record<string, unknown>, handle: ScriptedHandle) => void) {}

  start(invocation: ProcessInvocation): ProcessHandle {
    this.invocation = invocation;
    this.handle = new ScriptedHandle(this.script);
    return this.handle;
  }
}

function instance(protocol: string, command: string): RuntimeInstance {
  return {
    id: `local:test:${protocol}`,
    profileName: protocol.startsWith("claude") ? "claude" : "codex",
    protocol,
    command,
    fixedArgs: [],
    status: "online",
    capabilities: {
      protocol,
      command,
      streaming: true,
      resume: true,
      cancel: true,
      structuredEvents: ["status", "text", "tool-use", "tool-result"],
    },
  };
}

function task(overrides: Partial<RuntimeTask> = {}): RuntimeTask {
  const protocol = "claude-code/v1";
  return {
    taskId: "task-1",
    agentName: "engineer",
    agent: {
      name: "engineer",
      runtime: "claude",
      model: "claude-sonnet-5",
      thinkingLevel: "high",
      description: "Implements changes.",
      instructions: "Implement the requested change.",
    },
    profileName: "claude",
    profile: { protocol },
    instance: instance(protocol, "/usr/local/bin/claude"),
    workspaceRoot: "/workspace",
    prompt: "Fix the bug.",
    ...overrides,
  };
}

async function collect(session: RuntimeSession): Promise<{ events: RuntimeEvent[]; result: RuntimeTaskResult }> {
  const events: RuntimeEvent[] = [];
  for await (const event of session.events) events.push(event);
  return { events, result: await session.result };
}

describe("Claude Code runtime driver", () => {
  it("probes the concrete executable version", async () => {
    const capabilities = await new ClaudeCodeRuntimeDriver().probe("claude", {
      protocol: "claude-code/v1",
      command: process.execPath,
    });
    expect(capabilities.command).toBe(process.execPath);
    expect(capabilities.version).toMatch(/^v\d+/);
  });

  it("uses bidirectional stream-json and emits structured events", async () => {
    const runner = new ScriptedRunner((value, handle) => {
      if (value["type"] !== "user") return;
      handle.push({ type: "system", session_id: "session-1" });
      handle.push({
        type: "assistant",
        message: {
          model: "claude-sonnet-5",
          content: [
            { type: "text", text: "done" },
            { type: "tool_use", id: "call-1", name: "Bash", input: { command: "npm test" } },
          ],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      });
      handle.push({ type: "result", result: "done", session_id: "session-1" });
    });
    const session = await new ClaudeCodeRuntimeDriver(runner).start(task());
    const { events, result } = await collect(session);

    expect(runner.invocation?.args).toContain("stream-json");
    expect(runner.invocation?.args).toContain("--append-system-prompt");
    expect(runner.handle?.writes[0]).toMatchObject({ type: "user" });
    expect(events).toContainEqual({ type: "text", content: "done" });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-use", tool: "Bash" }));
    expect(result).toMatchObject({ status: "completed", output: "done", sessionId: "session-1" });
  });

  it("passes resume through the native CLI", async () => {
    const runner = new ScriptedRunner((value, handle) => {
      if (value["type"] === "user") handle.push({ type: "result", result: "resumed", session_id: "session-1" });
    });
    const session = await new ClaudeCodeRuntimeDriver(runner).start(task({ resumeSessionId: "session-1" }));
    await collect(session);
    expect(runner.invocation?.args).toContain("--resume");
    expect(runner.invocation?.args).toContain("session-1");
  });
});

describe("runtime environment", () => {
  it("isolates CODEX_HOME per workspace and seeds local CLI credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessfile-runtime-"));
    const source = join(root, "source-codex");
    const state = join(root, "state");
    await mkdir(source);
    await writeFile(join(source, "auth.json"), '{"token":"test"}');
    try {
      const env = await prepareRuntimeEnvironment(
        instance("codex-app-server/v1", "/usr/local/bin/codex"),
        "/workspace/project",
        { CODEX_HOME: source, HARNESSFILE_STATE_DIR: state },
      );
      expect(env.CODEX_HOME).toContain(join(state, "runtime-state"));
      expect(env.CODEX_HOME).not.toBe(source);
      expect(await readFile(join(env.CODEX_HOME!, "auth.json"), "utf-8")).toContain("test");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Codex runtime driver", () => {
  it("does not advertise a runtime whose executable fails the version probe", async () => {
    const runner = new ScriptedRunner(() => undefined);
    await expect(new CodexRuntimeDriver(runner).probe("codex", {
      protocol: "codex-app-server/v1",
      command: "/broken/codex",
    })).rejects.toThrow("failed its version probe");
  });

  it("drives app-server over JSON-RPC and streams tool events", async () => {
    const runner = codexRunner();
    const protocol = "codex-app-server/v1";
    const session = await new CodexRuntimeDriver(runner).start(task({
      agent: { ...task().agent, runtime: "codex", model: "gpt-5.5-codex" },
      profileName: "codex",
      profile: { protocol },
      instance: instance(protocol, "/usr/local/bin/codex"),
    }));
    const { events, result } = await collect(session);

    expect(runner.invocation?.args.slice(0, 3)).toEqual(["app-server", "--listen", "stdio://"]);
    expect(runner.handle?.writes.map((value) => value["method"]).filter(Boolean)).toEqual([
      "initialize", "initialized", "thread/start", "turn/start",
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-use", tool: "exec_command" }));
    expect(events).toContainEqual({ type: "text", content: "implemented" });
    expect(events).toContainEqual(expect.objectContaining({ type: "warning", content: expect.stringContaining("unknown permission") }));
    expect(runner.handle?.writes).toContainEqual(expect.objectContaining({
      id: 99,
      result: { permissions: { network: "enabled" }, scope: "turn" },
    }));
    expect(result).toMatchObject({ status: "completed", output: "implemented", sessionId: "thread-1" });
  });

  it("falls back to a fresh thread when resume is stale", async () => {
    const runner = codexRunner({ rejectResume: true });
    const protocol = "codex-app-server/v1";
    const session = await new CodexRuntimeDriver(runner).start(task({
      resumeSessionId: "stale-thread",
      profileName: "codex",
      profile: { protocol },
      instance: instance(protocol, "/usr/local/bin/codex"),
    }));
    const { events, result } = await collect(session);
    expect(events.some((event) => event.type === "warning" && event.content.includes("fresh thread"))).toBe(true);
    expect(result.sessionId).toBe("thread-1");
  });
});

function codexRunner(options: { rejectResume?: boolean } = {}): ScriptedRunner {
  return new ScriptedRunner((value, handle) => {
    const id = value["id"] as number | undefined;
    const method = value["method"];
    if (!id) return;
    if (method === "initialize") {
      handle.push({ jsonrpc: "2.0", id, result: {} });
    } else if (method === "thread/resume" && options.rejectResume) {
      handle.push({ jsonrpc: "2.0", id, error: { code: -32000, message: "thread not found" } });
    } else if (method === "thread/resume" || method === "thread/start") {
      handle.push({ jsonrpc: "2.0", id, result: { thread: { id: "thread-1" } } });
    } else if (method === "turn/start") {
      handle.push({ jsonrpc: "2.0", id, result: { turn: { id: "turn-1" } } });
      handle.push({ jsonrpc: "2.0", method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
      handle.push({
        jsonrpc: "2.0",
        id: 99,
        method: "item/permissions/requestApproval",
        params: { permissions: { network: "enabled", futureCapability: true } },
      });
      handle.push({
        jsonrpc: "2.0",
        method: "item/started",
        params: { threadId: "thread-1", item: { id: "call-1", type: "commandExecution", command: "npm test" } },
      });
      handle.push({
        jsonrpc: "2.0",
        method: "item/completed",
        params: { threadId: "thread-1", item: { id: "message-1", type: "agentMessage", text: "implemented" } },
      });
      handle.push({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", usage: { inputTokens: 12, outputTokens: 5 } } },
      });
    }
  });
}

describe("runtime dispatcher", () => {
  const ir: Harnessfile = {
    version: "0.2",
    name: "test",
    runtimes: { codex: { protocol: "test-runtime/v1", command: process.execPath } },
    agents: {
      engineer: {
        name: "engineer",
        description: "Implements changes.",
        instructions: "Implement.",
        runtime: "codex",
      },
    },
  };

  it("resolves a portable profile to a concrete instance and driver", async () => {
    const start = vi.fn(async (runtimeTask: RuntimeTask): Promise<RuntimeSession> => ({
      taskId: runtimeTask.taskId,
      instance: runtimeTask.instance,
      events: (async function* () { yield { type: "text", content: "ok" } as RuntimeEvent; })(),
      result: Promise.resolve({ status: "completed", output: "ok", durationMs: 1 }),
      cancel: async () => undefined,
    }));
    const driver: AgentRuntimeDriver = {
      protocol: "test-runtime/v1",
      defaultCommand: process.execPath,
      probe: async (_name: string, profile: RuntimeProfileDef) => ({
        protocol: "test-runtime/v1",
        command: profile.command!,
        streaming: true,
        resume: true,
        cancel: true,
        structuredEvents: ["text"],
      }),
      start,
    };
    const onEvent = vi.fn();
    const dispatcher = new RuntimeDispatcher(ir, { workspaceRoot: "/repo", drivers: [driver] });

    await expect(dispatcher.execute("engineer", "Do it", { onEvent })).resolves.toMatchObject({ output: "ok" });
    expect(start.mock.calls[0][0]).toMatchObject({
      agentName: "engineer",
      profileName: "codex",
      workspaceRoot: "/repo",
      instance: { status: "online", protocol: "test-runtime/v1" },
    });
    expect(onEvent).toHaveBeenCalledWith({ type: "text", content: "ok" });
  });

  it("reports unavailable profiles as offline during discovery", async () => {
    const registry = new LocalRuntimeRegistry({ drivers: [] });
    const discovered = await registry.discover({
      missing: { protocol: "missing/v1", command: "missing-agent" },
    });
    expect(discovered).toEqual([
      expect.objectContaining({ profileName: "missing", status: "offline" }),
    ]);
  });

  it("rejects an undefined runtime profile", async () => {
    const broken: Harnessfile = {
      ...ir,
      agents: { engineer: { ...ir.agents.engineer, runtime: "missing" } },
    };
    await expect(new RuntimeDispatcher(broken).execute("engineer", "Do it"))
      .rejects.toThrow("undefined runtime profile");
  });

  it("starts fresh when a saved session belongs to another instance", async () => {
    const start = vi.fn(async (runtimeTask: RuntimeTask): Promise<RuntimeSession> => ({
      taskId: runtimeTask.taskId,
      instance: runtimeTask.instance,
      events: (async function* () {})(),
      result: Promise.resolve({ status: "completed", output: "fresh", durationMs: 1 }),
      cancel: async () => undefined,
    }));
    const driver: AgentRuntimeDriver = {
      protocol: "test-runtime/v1",
      defaultCommand: process.execPath,
      probe: async (_name, profile) => ({
        protocol: "test-runtime/v1",
        command: profile.command!,
        streaming: true,
        resume: true,
        cancel: true,
        structuredEvents: ["warning"],
      }),
      start,
    };
    const warnings: RuntimeEvent[] = [];
    const dispatcher = new RuntimeDispatcher(ir, { workspaceRoot: "/repo", drivers: [driver] });
    await dispatcher.execute("engineer", "Do it", {
      resume: { sessionId: "session-1", instanceId: "another-instance", workspaceRoot: "/repo" },
      onEvent: (event) => warnings.push(event),
    });

    expect(start.mock.calls[0][0].resumeSessionId).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining({ type: "warning" }));
  });
});
