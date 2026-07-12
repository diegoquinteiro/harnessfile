import type { RuntimeProfileDef } from "../../ir/types.js";
import type {
  AgentRuntimeDriver,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeTask,
  RuntimeTokenUsage,
} from "../interface.js";
import { detectExecutableVersion, lines, SpawnProcessRunner, type ProcessHandle, type ProcessRunner } from "../process.js";
import { RuntimeSessionController } from "../session.js";

const PROTOCOL = "codex-app-server/v1";
const BLOCKED_ARGS = new Set(["--listen"]);

export class CodexRuntimeDriver implements AgentRuntimeDriver {
  protocol = PROTOCOL;
  defaultCommand = "codex";

  constructor(private runner: ProcessRunner = new SpawnProcessRunner()) {}

  async probe(_profileName: string, profile: RuntimeProfileDef): Promise<RuntimeCapabilities> {
    const command = profile.command ?? this.defaultCommand;
    const version = await detectExecutableVersion(this.runner, command);
    if (!version) throw new Error(`Codex executable '${command}' failed its version probe`);
    return capabilities(this.protocol, command, version);
  }

  async start(task: RuntimeTask) {
    const launch = filterArgs(task.instance.fixedArgs);
    const process = this.runner.start({
      command: task.instance.command,
      args: ["app-server", "--listen", "stdio://", ...launch.args],
      cwd: task.workspaceRoot,
      signal: task.signal,
      timeoutMs: task.timeoutMs,
      env: task.env,
    });
    const controller = new RuntimeSessionController(
      task.taskId,
      task.instance,
      () => process.cancel(),
    );
    controller.emit({ type: "status", status: "starting" });
    for (const flag of launch.blocked) {
      controller.emit({
        type: "warning",
        content: `Ignored protocol-critical Codex argument '${flag}'.`,
      });
    }
    const client = new CodexAppServerClient(process, controller);
    void consumeStderr(process.stderr, controller);
    void this.run(task, process, client, controller);
    return controller.session();
  }

  private async run(
    task: RuntimeTask,
    process: ProcessHandle,
    client: CodexAppServerClient,
    controller: RuntimeSessionController,
  ): Promise<void> {
    const startedAt = Date.now();
    void client.read();
    try {
      await client.request("initialize", {
        clientInfo: { name: "harnessfile", title: "Harnessfile", version: "0.2.0" },
        capabilities: { experimentalApi: true },
      });
      client.notify("initialized");

      const threadId = await startOrResumeThread(client, task, controller);
      client.threadId = threadId;
      controller.emit({ type: "status", status: "running", sessionId: threadId });

      const turnParams: Record<string, unknown> = {
        threadId,
        input: [{ type: "text", text: task.prompt }],
      };
      if (task.agent.thinkingLevel) turnParams["effort"] = task.agent.thinkingLevel;
      const turnCompletion = client.waitForTurn();
      await client.request("turn/start", turnParams);
      const turn = await turnCompletion;
      process.end();
      const processResult = await process.result;

      const status = processResult.timedOut
        ? "timeout"
        : processResult.cancelled
          ? "cancelled"
          : turn.error || processResult.exitCode !== 0
            ? "failed"
            : "completed";
      const error = turn.error || (status === "failed"
        ? processResult.stderr.trim() || `Codex app-server exited with code ${processResult.exitCode}`
        : undefined);
      if (error) controller.emit({ type: "error", content: error });
      controller.emit({ type: "status", status, sessionId: threadId });
      controller.complete({
        status,
        output: turn.output,
        error,
        sessionId: threadId,
        durationMs: Date.now() - startedAt,
        usage: task.agent.model && turn.usage ? { [task.agent.model]: turn.usage } : undefined,
        metadata: { turnId: client.turnId },
      });
    } catch (error) {
      await process.cancel();
      controller.fail(error);
    }
  }
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface TurnOutcome {
  output: string;
  error?: string;
  usage?: RuntimeTokenUsage;
}

class CodexAppServerClient {
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private turnOutcome?: (outcome: TurnOutcome) => void;
  private turnPromise?: Promise<TurnOutcome>;
  private output = "";
  private turnError?: string;
  private usage?: RuntimeTokenUsage;
  threadId = "";
  turnId = "";

  constructor(
    private process: ProcessHandle,
    private controller: RuntimeSessionController,
  ) {}

  async read(): Promise<void> {
    try {
      for await (const line of lines(this.process.stdout)) {
        const raw = parseObject(line);
        if (!raw) continue;
        const id = typeof raw["id"] === "number" ? raw["id"] : undefined;
        if (id !== undefined && ("result" in raw || "error" in raw)) {
          this.handleResponse(id, raw);
        } else if (id !== undefined && typeof raw["method"] === "string") {
          this.handleServerRequest(id, raw);
        } else if (typeof raw["method"] === "string") {
          this.handleNotification(raw);
        }
      }
      this.rejectPending(new Error("Codex app-server closed its output stream"));
    } catch (error) {
      this.rejectPending(error);
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextId;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
    });
    this.write({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  waitForTurn(): Promise<TurnOutcome> {
    if (!this.turnPromise) {
      this.turnPromise = new Promise((resolve) => {
        this.turnOutcome = resolve;
      });
    }
    return this.turnPromise;
  }

  private handleResponse(id: number, raw: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (raw["error"]) {
      const error = asObject(raw["error"]);
      pending.reject(new Error(`${pending.method}: ${string(error, "message") || "JSON-RPC error"}`));
    } else {
      pending.resolve(raw["result"]);
    }
  }

  private handleServerRequest(id: number, raw: Record<string, unknown>): void {
    const method = string(raw, "method");
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "execCommandApproval" ||
      method === "item/fileChange/requestApproval" ||
      method === "applyPatchApproval"
    ) {
      this.write({ jsonrpc: "2.0", id, result: { decision: "accept" } });
    } else if (method === "item/permissions/requestApproval") {
      const params = asObject(raw["params"]);
      const permissions = asObject(params["permissions"]);
      const granted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(permissions)) {
        if (key === "network" || key === "fileSystem") granted[key] = value;
        else this.controller.emit({
          type: "warning",
          content: `Codex requested an unknown permission '${key}'; it was not granted.`,
        });
      }
      this.write({ jsonrpc: "2.0", id, result: { permissions: granted, scope: "turn" } });
    } else if (method === "mcpServer/elicitation/request") {
      this.write({ jsonrpc: "2.0", id, result: { action: "accept", content: null, _meta: null } });
    } else {
      this.write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported request: ${method}` } });
    }
  }

  private handleNotification(raw: Record<string, unknown>): void {
    const method = string(raw, "method");
    const params = asObject(raw["params"]);
    const notificationThread = string(params, "threadId");
    if (notificationThread && this.threadId && notificationThread !== this.threadId) return;

    if (method === "turn/started") {
      this.turnId = nestedString(params, "turn", "id");
      this.controller.emit({ type: "status", status: "running", sessionId: this.threadId });
    } else if (method === "turn/completed") {
      this.turnId = nestedString(params, "turn", "id") || this.turnId;
      const turn = asObject(params["turn"]);
      const status = string(turn, "status");
      if (status === "failed") this.turnError = nestedString(turn, "error", "message") || "Codex turn failed";
      this.usage = parseUsage(asObject(turn["usage"])) ?? this.usage;
      this.finishTurn();
    } else if (method === "error") {
      if (params["willRetry"] !== true) {
        this.turnError = nestedString(params, "error", "message") || string(params, "message") || "Codex protocol error";
        this.finishTurn();
      } else {
        this.controller.emit({ type: "warning", content: "Codex reported a retryable protocol error" });
      }
    } else if (method === "thread/status/changed" && nestedString(params, "status", "type") === "idle") {
      this.finishTurn();
    } else if (method.startsWith("item/")) {
      this.handleItem(method, params);
    } else if (method === "codex/event" || method.startsWith("codex/event/")) {
      this.handleLegacyEvent(asObject(params["msg"]));
    }
  }

  private handleItem(method: string, params: Record<string, unknown>): void {
    const item = asObject(params["item"]);
    const itemType = string(item, "type");
    const callId = string(item, "id") || undefined;
    let event: RuntimeEvent | undefined;
    if (method === "item/started" && itemType === "commandExecution") {
      event = { type: "tool-use", tool: "exec_command", callId, input: { command: item["command"] } };
    } else if (method === "item/completed" && itemType === "commandExecution") {
      event = { type: "tool-result", tool: "exec_command", callId, output: string(item, "aggregatedOutput") };
    } else if (method === "item/started" && itemType === "fileChange") {
      event = { type: "tool-use", tool: "apply_patch", callId, input: item["changes"] };
    } else if (method === "item/completed" && itemType === "fileChange") {
      event = { type: "tool-result", tool: "apply_patch", callId };
    } else if (method === "item/completed" && itemType === "agentMessage") {
      const text = string(item, "text");
      if (text) {
        this.output += text;
        event = { type: "text", content: text };
      }
    }
    if (event) this.controller.emit(event);
  }

  private handleLegacyEvent(message: Record<string, unknown>): void {
    const type = string(message, "type");
    if (type === "agent_message") {
      const text = string(message, "message");
      this.output += text;
      if (text) this.controller.emit({ type: "text", content: text });
    } else if (type === "task_complete") {
      this.usage = parseUsage(asObject(message["usage"])) ?? this.usage;
      this.finishTurn();
    } else if (type === "turn_aborted") {
      this.turnError = "Codex turn was aborted";
      this.finishTurn();
    }
  }

  private finishTurn(): void {
    this.turnOutcome?.({ output: this.output, error: this.turnError, usage: this.usage });
    this.turnOutcome = undefined;
  }

  private rejectPending(error: unknown): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    if (this.turnOutcome) {
      this.turnError = error instanceof Error ? error.message : String(error);
      this.finishTurn();
    }
  }

  private write(value: Record<string, unknown>): void {
    this.process.write(`${JSON.stringify(value)}\n`);
  }
}

async function startOrResumeThread(
  client: CodexAppServerClient,
  task: RuntimeTask,
  controller: RuntimeSessionController,
): Promise<string> {
  if (task.resumeSessionId) {
    try {
      const result = await client.request("thread/resume", threadParams(task, task.resumeSessionId));
      const threadId = extractThreadId(result);
      if (threadId) return threadId;
    } catch (error) {
      controller.emit({
        type: "warning",
        content: `Codex session '${task.resumeSessionId}' could not be resumed; starting a fresh thread (${error instanceof Error ? error.message : String(error)})`,
      });
    }
  }
  const params = threadParams(task);
  Object.assign(params, {
    modelProvider: null,
    profile: null,
    approvalPolicy: null,
    sandbox: null,
    baseInstructions: null,
    compactPrompt: null,
    includeApplyPatchTool: null,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  });
  const result = await client.request("thread/start", params);
  const threadId = extractThreadId(result);
  if (!threadId) throw new Error("Codex thread/start returned no thread ID");
  return threadId;
}

function threadParams(task: RuntimeTask, threadId?: string): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (task.agent.thinkingLevel) config["model_reasoning_effort"] = task.agent.thinkingLevel;
  return {
    ...(threadId ? { threadId } : {}),
    cwd: task.workspaceRoot,
    model: task.agent.model ?? null,
    developerInstructions: task.agent.instructions || null,
    config: Object.keys(config).length > 0 ? config : null,
  };
}

function extractThreadId(value: unknown): string {
  const result = asObject(value);
  return nestedString(result, "thread", "id") || string(result, "threadId") || string(result, "id");
}

function capabilities(protocol: string, command: string, version?: string): RuntimeCapabilities {
  return {
    protocol,
    command,
    version,
    streaming: true,
    resume: true,
    cancel: true,
    structuredEvents: ["status", "text", "thinking", "tool-use", "tool-result", "log", "warning", "error"],
  };
}

function filterArgs(args: string[]): { args: string[]; blocked: string[] } {
  const result: string[] = [];
  const blocked: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const flag = arg.split("=", 1)[0];
    if (!BLOCKED_ARGS.has(flag)) result.push(arg);
    else {
      blocked.push(flag);
      if (!arg.includes("=") && i + 1 < args.length) i += 1;
    }
  }
  return { args: result, blocked };
}

function parseUsage(value: Record<string, unknown>): RuntimeTokenUsage | undefined {
  if (Object.keys(value).length === 0) return undefined;
  return {
    inputTokens: numeric(value, "inputTokens", "input_tokens"),
    outputTokens: numeric(value, "outputTokens", "output_tokens"),
    cacheReadTokens: numeric(value, "cachedInputTokens", "cache_read_input_tokens"),
  };
}

async function consumeStderr(
  stderr: AsyncIterable<string>,
  controller: RuntimeSessionController,
): Promise<void> {
  for await (const chunk of stderr) {
    const content = chunk.trim();
    if (content) controller.emit({ type: "log", level: "stderr", content });
  }
}

function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function nestedString(value: Record<string, unknown>, ...path: string[]): string {
  let current: unknown = value;
  for (const key of path) current = asObject(current)[key];
  return typeof current === "string" ? current : "";
}

function numeric(value: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof value[key] === "number") return value[key];
  return undefined;
}
