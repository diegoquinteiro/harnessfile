import { describe, expect, it, vi } from "vitest";
import type { FactoryContext } from "../src/services/contracts.js";
import { RemoteExecutionEnvironment, type RemoteSandbox } from "../src/services/execution/remote.js";
import { createModalExecution, type ModalSdk } from "../src/services/execution/modal.js";
import { createE2bExecution, type E2bSdk } from "../src/services/execution/e2b.js";
import { createDaytonaExecution, type DaytonaSdk } from "../src/services/execution/daytona.js";
import { encodeMessage, WorkerDecoder, type WorkerRequest } from "../src/services/execution/protocol.js";
import type { RuntimeEvent } from "../src/agent-runtimes/interface.js";

const context = (): FactoryContext => ({
  ir: { version: "0.2", agents: { coder: { instructions: "Implement carefully", runtime: "claude" } }, runtimes: { claude: { protocol: "claude-code/v1" } } },
  workspaceRoot: "/tmp", drivers: [], secret: vi.fn(async name => `secret:${name}`),
});
const config = { repository: "https://github.com/example/repo.git", ref: "main", envSecrets: { ANTHROPIC_API_KEY: "agent-auth" } };
const frames = encodeMessage({ version: 1, type: "event", event: { type: "text", content: "working" } }) +
  encodeMessage({ version: 1, type: "result", result: { status: "completed", output: "done", durationMs: 3, resume: { sessionId: "abc", instanceId: "local", workspaceRoot: "/tmp" }, metadata: { workspacePatch: "patch" } } });
async function* stream(value: string) { yield value.slice(0, 13); yield value.slice(13); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("remote SDK providers", () => {
  it("launches Modal, forwards streamed frames, passes only resolved worker secrets, and terminates", async () => {
    const requests: WorkerRequest[] = [];
    const terminate = vi.fn(async () => {});
    const exec = vi.fn(async (argv: string[]) => {
      const upload = argv[1] === "-e";
      if (upload) requests.push(JSON.parse(Buffer.from(argv[4], "base64").toString()));
      return { stdout: stream(upload ? "" : frames), stderr: stream(""), wait: async () => 0 };
    });
    const create = vi.fn(async () => ({ sandboxId: "modal-sb", exec, terminate }));
    const close = vi.fn();
    const constructor = vi.fn();
    const sdk: ModalSdk = { ModalClient: class {
      constructor(options: Record<string, unknown>) { constructor(options); }
      apps = { fromName: vi.fn(async () => ({})) };
      images = { fromRegistry: vi.fn(() => ({})) };
      sandboxes = { create }; close = close;
    } };
    const events: RuntimeEvent[] = [];
    const environment = await createModalExecution({ type: "modal/v1", ...config, image: "example/worker:1" }, context(), sdk);
    const result = await environment.execute("coder", "fix bug", { onEvent: event => events.push(event) });
    expect(result).toMatchObject({ status: "completed", output: "done", metadata: { sandboxId: "modal-sb", workspacePatch: "patch" } });
    expect(result.resume).toBeUndefined();
    expect(events).toContainEqual({ type: "text", content: "working" });
    expect(requests[0]).toMatchObject({ agentName: "coder", prompt: "fix bug", repository: config.repository });
    expect(JSON.stringify(requests)).not.toContain("secret:agent-auth");
    expect(create.mock.calls[0]).toEqual([{}, {}, { env: { ANTHROPIC_API_KEY: "secret:agent-auth" }, timeoutMs: 900000 }]);
    expect(constructor).toHaveBeenCalledWith({ tokenId: "secret:MODAL_TOKEN_ID", tokenSecret: "secret:MODAL_TOKEN_SECRET", timeoutMs: 60000 });
    expect(terminate).toHaveBeenCalledOnce();
    await environment.close(); expect(close).toHaveBeenCalledOnce();
  });

  it("streams E2B callbacks, safely quotes command args, uploads request, and kills sandbox", async () => {
    const write = vi.fn(async () => {}), kill = vi.fn(async () => true);
    const run = vi.fn(async (_command: string, opts: { onStdout: (chunk: string) => void }) => { opts.onStdout(frames); return { exitCode: 0 }; });
    const create = vi.fn(async () => ({ sandboxId: "e2b-sb", files: { write }, commands: { run }, kill }));
    const environment = await createE2bExecution({ type: "e2b/v1", ...config, template: "worker", workerCommand: ["node", "/worker with 'quote'.js"] }, context(), { Sandbox: { create } } as E2bSdk);
    expect((await environment.execute("coder", "task")).status).toBe("completed");
    expect(create.mock.calls[0]).toEqual(["worker", { apiKey: "secret:E2B_API_KEY", envs: { ANTHROPIC_API_KEY: "secret:agent-auth" }, timeoutMs: 900000, requestTimeoutMs: 60000 }]);
    expect(run.mock.calls[0][0]).toContain("'/worker with '\\''quote'\\''.js'");
    expect(write).toHaveBeenCalledOnce(); expect(kill).toHaveBeenCalledOnce();
  });

  it("streams Daytona session logs and waits for deletion", async () => {
    const uploadFile = vi.fn(async () => {});
    const createSession = vi.fn(async () => {});
    const executeSessionCommand = vi.fn(async () => ({ cmdId: "command" }));
    const getSessionCommandLogs = vi.fn(async (_s: string, _c: string, out: (chunk: string) => void) => { out(frames); });
    const sandbox = { id: "daytona-sb", fs: { uploadFile }, process: { createSession, executeSessionCommand, getSessionCommandLogs, getSessionCommand: vi.fn(async () => ({ exitCode: 0 })) } };
    const create = vi.fn(async () => sandbox), remove = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    const sdk: DaytonaSdk = { Daytona: class { create = create; delete = remove; [Symbol.asyncDispose] = dispose; } };
    const environment = await createDaytonaExecution({ type: "daytona/v1", ...config, snapshot: "worker" }, context(), sdk);
    expect((await environment.execute("coder", "task")).status).toBe("completed");
    expect(create.mock.calls[0]).toEqual([{ snapshot: "worker", envVars: { ANTHROPIC_API_KEY: "secret:agent-auth" }, ephemeral: true, autoStopInterval: 15, ttlMinutes: 15 }, { timeout: 60 }]);
    expect(executeSessionCommand.mock.calls[0][1]).toMatchObject({ runAsync: true, suppressInputEcho: true });
    expect(remove).toHaveBeenCalledWith(sandbox, 60, true);
    expect(uploadFile).toHaveBeenCalledOnce();
    await environment.close(); expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("remote lifecycle", () => {
  function fixture(overrides: Partial<RemoteSandbox> = {}) {
    const sandbox: RemoteSandbox = { id: "sb", writeFile: vi.fn(async () => {}), run: vi.fn(async (_command, out) => { out(frames); return 0; }), destroy: vi.fn(async () => {}), ...overrides };
    const create = vi.fn(async () => sandbox);
    return { sandbox, create, environment: new RemoteExecutionEnvironment({ type: "fake/v1", ...config }, context(), { create }) };
  }

  it("always cleans up malformed streams and redacts SDK errors", async () => {
    const { environment, sandbox } = fixture({ run: async () => { throw new Error("Authorization: secret-token"); } });
    const result = await environment.execute("coder", "task");
    expect(result.status).toBe("failed"); expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it("does not report success when the stream is truncated or process fails", async () => {
    for (const malformed of ["garbage\n", "", encodeMessage({ version: 1, type: "event", event: { type: "text", content: "partial" } })]) {
      const { environment, sandbox } = fixture({ run: async (_args, out) => { out(malformed); return 0; } });
      expect((await environment.execute("coder", "task")).status).toBe("failed");
      expect(sandbox.destroy).toHaveBeenCalledOnce();
    }
    const { environment } = fixture({ run: async (_args, out) => { out(frames); return 3; } });
    expect((await environment.execute("coder", "task")).status).toBe("failed");
  });

  it("contains decoder errors delivered outside the SDK promise chain", async () => {
    const exit = deferred<number>();
    const { environment, sandbox } = fixture({
      run: async (_args, out) => { setImmediate(() => out("malformed\n")); return exit.promise; },
      destroy: vi.fn(async () => { exit.resolve(137); }),
    });
    expect((await environment.execute("coder", "task")).status).toBe("failed");
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it("cancels active work, terminates once, and does not emit a resume pointer", async () => {
    const running = deferred<void>(), exit = deferred<number>();
    const { environment, sandbox } = fixture({ run: async () => { running.resolve(); return exit.promise; }, destroy: vi.fn(async () => { exit.resolve(137); }) });
    const session = await environment.start("coder", "task");
    await running.promise; await session.cancel(); await session.cancel();
    expect(await session.result).toMatchObject({ status: "cancelled" });
    expect(sandbox.destroy).toHaveBeenCalledOnce();
    await environment.close();
  });

  it("honors aborts before provisioning and timeout while work is running", async () => {
    const { environment, create } = fixture();
    const abort = new AbortController(); abort.abort();
    expect((await environment.execute("coder", "task", { signal: abort.signal })).status).toBe("cancelled");
    expect(create).not.toHaveBeenCalled();
    const exit = deferred<number>();
    const slow = fixture({ run: async () => exit.promise, destroy: vi.fn(async () => { exit.resolve(137); }) });
    expect((await slow.environment.execute("coder", "task", { timeoutMs: 5 })).status).toBe("timeout");
    expect(slow.sandbox.destroy).toHaveBeenCalledOnce();
  });

  it("destroys sandboxes that finish provisioning after cancellation before closing client", async () => {
    const provisioning = deferred<RemoteSandbox>();
    const started = deferred<void>();
    const order: string[] = [];
    const sandbox: RemoteSandbox = { id: "late", writeFile: vi.fn(async () => {}), run: vi.fn(async () => 0), destroy: async () => { order.push("destroy"); } };
    const environment = new RemoteExecutionEnvironment({ type: "fake/v1", ...config }, context(), {
      create: async () => { started.resolve(); return provisioning.promise; }, close: async () => { order.push("close"); },
    });
    const session = await environment.start("coder", "task"); await started.promise;
    await session.cancel(); expect((await session.result).status).toBe("cancelled");
    const closing = environment.close(); provisioning.resolve(sandbox); await closing;
    expect(order).toEqual(["destroy", "close"]); expect(sandbox.writeFile).not.toHaveBeenCalled();
  });

  it("reports cleanup failure without exposing provider response", async () => {
    const { environment } = fixture({ destroy: async () => { throw new Error("secret-token"); } });
    const result = await environment.execute("coder", "task");
    expect(result.metadata).toMatchObject({ cleanupFailed: true }); expect(JSON.stringify(result)).not.toContain("secret-token");
    await expect(environment.close()).rejects.toThrow("Failed to clean up 1 remote sandbox(s)");
  });

  it("rejects unsafe repository credentials and missing runtime before provisioning", async () => {
    expect(() => new RemoteExecutionEnvironment({ type: "fake/v1", repository: "https://secret@github.com/example/repo" }, context(), { create: vi.fn() })).toThrow("without credentials");
    const { environment, create } = fixture();
    await expect(environment.start("unknown", "task")).rejects.toThrow("Unknown agent");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("worker wire protocol", () => {
  it("accepts split frames and rejects duplicate terminal results", () => {
    const received: unknown[] = []; const decoder = new WorkerDecoder(message => received.push(message));
    decoder.push(frames.slice(0, 7)); decoder.push(frames.slice(7)); decoder.end(); expect(received).toHaveLength(2);
    expect(() => decoder.push(frames)).toThrow("after its terminal result");
  });
  it("rejects invalid event contents, statuses, versions, and oversized frames", () => {
    for (const message of [
      { version: 2, type: "result" }, { version: 1, type: "event", event: { type: "text", content: {} } },
      { version: 1, type: "event", event: { type: "status", status: "invented" } },
    ]) expect(() => new WorkerDecoder(() => {}).push(JSON.stringify(message) + "\n")).toThrow();
    expect(() => new WorkerDecoder(() => {}).push("x".repeat(16 * 1024 * 1024 + 1))).toThrow("frame limit");
  });
});
