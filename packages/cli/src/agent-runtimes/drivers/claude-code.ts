import type {
  AgentRuntimeDriver,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeTask,
  RuntimeTokenUsage,
} from "../interface.js";
import { detectExecutableVersion, lines, SpawnProcessRunner, type ProcessRunner } from "../process.js";
import { RuntimeSessionController } from "../session.js";
import type { RuntimeProfileDef } from "../../ir/types.js";

const PROTOCOL = "claude-code/v1";
const BLOCKED_ARGS = new Map<string, boolean>([
  ["-p", false],
  ["--print", false],
  ["--output-format", true],
  ["--input-format", true],
  ["--permission-mode", true],
  ["--system-prompt", true],
  ["--append-system-prompt", true],
  ["--model", true],
  ["--effort", true],
  ["--resume", true],
]);

export class ClaudeCodeRuntimeDriver implements AgentRuntimeDriver {
  protocol = PROTOCOL;
  defaultCommand = "claude";

  constructor(private runner: ProcessRunner = new SpawnProcessRunner()) {}

  async probe(_profileName: string, profile: RuntimeProfileDef): Promise<RuntimeCapabilities> {
    const command = profile.command ?? this.defaultCommand;
    const version = await detectExecutableVersion(this.runner, command);
    if (!version) throw new Error(`Claude Code executable '${command}' failed its version probe`);
    return capabilities(this.protocol, command, version);
  }

  async start(task: RuntimeTask) {
    const launch = buildClaudeArgs(task);
    const process = this.runner.start({
      command: task.instance.command,
      args: launch.args,
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
    const session = controller.session();
    controller.emit({ type: "status", status: "starting" });
    for (const flag of launch.blocked) {
      controller.emit({
        type: "warning",
        content: `Ignored protocol-critical Claude Code argument '${flag}'.`,
      });
    }

    void consumeStderr(process.stderr, controller);
    void this.run(task, process, controller);
    process.write(`${JSON.stringify(claudeInput(task.prompt))}\n`);
    return session;
  }

  private async run(
    task: RuntimeTask,
    process: ReturnType<ProcessRunner["start"]>,
    controller: RuntimeSessionController,
  ): Promise<void> {
    const startedAt = Date.now();
    let output = "";
    let finalOutput: string | undefined;
    let sessionId: string | undefined;
    let resultError: string | undefined;
    let usage: Record<string, RuntimeTokenUsage> | undefined;

    try {
      for await (const line of lines(process.stdout)) {
        const message = parseObject(line);
        if (!message) continue;
        const type = string(message, "type");
        if (type === "system") {
          sessionId = string(message, "session_id") || sessionId;
          controller.emit({ type: "status", status: "running", sessionId });
        } else if (type === "assistant") {
          const parsed = parseClaudeContent(message["message"]);
          for (const event of parsed.events) {
            controller.emit(event);
            if (event.type === "text") output += event.content;
          }
          usage = mergeUsage(usage, parsed.model, parsed.usage);
        } else if (type === "user") {
          for (const event of parseClaudeToolResults(message["message"])) controller.emit(event);
        } else if (type === "result") {
          sessionId = string(message, "session_id") || sessionId;
          finalOutput = string(message, "result") || output;
          if (message["is_error"] === true) resultError = finalOutput || "Claude Code reported an error";
          usage = parseClaudeResultUsage(message, task.agent.model) ?? usage;
          process.end();
        } else if (type === "control_request") {
          process.write(`${JSON.stringify(claudeControlResponse(message))}\n`);
        } else if (type === "log") {
          const log = asObject(message["log"]);
          controller.emit({
            type: "log",
            level: string(log, "level") || undefined,
            content: string(log, "message"),
          });
        }
      }

      const processResult = await process.result;
      const status = processResult.timedOut
        ? "timeout"
        : processResult.cancelled
          ? "cancelled"
          : resultError || processResult.exitCode !== 0
            ? "failed"
            : "completed";
      const error = resultError || (status === "failed"
        ? processResult.stderr.trim() || `Claude Code exited with code ${processResult.exitCode}`
        : undefined);
      if (error) controller.emit({ type: "error", content: error });
      controller.emit({ type: "status", status, sessionId });
      controller.complete({
        status,
        output: finalOutput ?? output,
        error,
        sessionId,
        durationMs: Date.now() - startedAt,
        usage,
      });
    } catch (error) {
      await process.cancel();
      controller.fail(error);
    }
  }
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

function buildClaudeArgs(task: RuntimeTask): { args: string[]; blocked: string[] } {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
    "--disallowedTools", "AskUserQuestion",
  ];
  if (task.agent.model) args.push("--model", task.agent.model);
  if (task.agent.thinkingLevel) args.push("--effort", task.agent.thinkingLevel);
  if (task.agent.instructions) args.push("--append-system-prompt", task.agent.instructions);
  if (task.resumeSessionId) args.push("--resume", task.resumeSessionId);
  const filtered = filterArgs(task.instance.fixedArgs, BLOCKED_ARGS);
  args.push(...filtered.args);
  return { args, blocked: filtered.blocked };
}

function claudeInput(prompt: string): Record<string, unknown> {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text: prompt }] },
  };
}

function claudeControlResponse(message: Record<string, unknown>): Record<string, unknown> {
  const request = asObject(message["request"]);
  const input = { ...asObject(request["input"]) };
  if (input["run_in_background"] === true) input["run_in_background"] = false;
  return {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: string(message, "request_id"),
      response: { behavior: "allow", updatedInput: input },
    },
  };
}

function parseClaudeContent(value: unknown): {
  events: RuntimeEvent[];
  model?: string;
  usage?: RuntimeTokenUsage;
} {
  const message = asObject(value);
  const events: RuntimeEvent[] = [];
  for (const raw of Array.isArray(message["content"]) ? message["content"] : []) {
    const block = asObject(raw);
    const type = string(block, "type");
    if (type === "text" && string(block, "text")) {
      events.push({ type: "text", content: string(block, "text") });
    } else if (type === "thinking" && string(block, "thinking")) {
      events.push({ type: "thinking", content: string(block, "thinking") });
    } else if (type === "thinking" && string(block, "text")) {
      events.push({ type: "thinking", content: string(block, "text") });
    } else if (type === "tool_use") {
      events.push({
        type: "tool-use",
        tool: string(block, "name") || "tool",
        callId: string(block, "id") || undefined,
        input: block["input"],
      });
    }
  }
  return {
    events,
    model: string(message, "model") || undefined,
    usage: tokenUsage(asObject(message["usage"])),
  };
}

function parseClaudeToolResults(value: unknown): RuntimeEvent[] {
  const message = asObject(value);
  const events: RuntimeEvent[] = [];
  for (const raw of Array.isArray(message["content"]) ? message["content"] : []) {
    const block = asObject(raw);
    if (string(block, "type") !== "tool_result") continue;
    const content = typeof block["content"] === "string"
      ? block["content"]
      : JSON.stringify(block["content"] ?? "");
    events.push({
      type: "tool-result",
      callId: string(block, "tool_use_id") || undefined,
      output: content,
    });
  }
  return events;
}

function parseClaudeResultUsage(
  message: Record<string, unknown>,
  fallbackModel?: string,
): Record<string, RuntimeTokenUsage> | undefined {
  const modelUsage = asObject(message["modelUsage"]);
  if (Object.keys(modelUsage).length > 0) {
    const result: Record<string, RuntimeTokenUsage> = {};
    for (const [model, value] of Object.entries(modelUsage)) {
      const usage = tokenUsage(asObject(value));
      if (usage) result[model] = usage;
    }
    if (Object.keys(result).length > 0) return result;
  }
  const model = string(message, "model") || fallbackModel;
  const usage = tokenUsage(asObject(message["usage"]));
  return model && usage ? { [model]: usage } : undefined;
}

function mergeUsage(
  current: Record<string, RuntimeTokenUsage> | undefined,
  model: string | undefined,
  next: RuntimeTokenUsage | undefined,
): Record<string, RuntimeTokenUsage> | undefined {
  if (!model || !next) return current;
  const previous = current?.[model] ?? {};
  return {
    ...current,
    [model]: {
      inputTokens: (previous.inputTokens ?? 0) + (next.inputTokens ?? 0),
      outputTokens: (previous.outputTokens ?? 0) + (next.outputTokens ?? 0),
      cacheReadTokens: (previous.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0),
      cacheWriteTokens: (previous.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0),
    },
  };
}

function tokenUsage(value: Record<string, unknown>): RuntimeTokenUsage | undefined {
  if (Object.keys(value).length === 0) return undefined;
  return {
    inputTokens: number(value, "input_tokens", "inputTokens"),
    outputTokens: number(value, "output_tokens", "outputTokens"),
    cacheReadTokens: number(value, "cache_read_input_tokens", "cacheReadInputTokens"),
    cacheWriteTokens: number(value, "cache_creation_input_tokens", "cacheCreationInputTokens"),
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

function filterArgs(
  args: string[],
  blocked: Map<string, boolean>,
): { args: string[]; blocked: string[] } {
  const result: string[] = [];
  const blockedFlags: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const flag = arg.split("=", 1)[0];
    const takesValue = blocked.get(flag);
    if (takesValue === undefined) {
      result.push(arg);
      continue;
    }
    blockedFlags.push(flag);
    if (takesValue && !arg.includes("=") && i + 1 < args.length) i += 1;
  }
  return { args: result, blocked: blockedFlags };
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

function number(value: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof value[key] === "number") return value[key];
  return undefined;
}
