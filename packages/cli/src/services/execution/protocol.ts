import type { Harnessfile } from "../../ir/types.js";
import type { RuntimeEvent, RuntimeTaskResult } from "../../agent-runtimes/interface.js";
import type { DetachedTask, TaskRuntimeScope } from "./detached.js";

export interface WorkerRequest {
  version: 1;
  taskId: string;
  ir: Harnessfile;
  agentName: string;
  prompt: string;
  repository: string;
  ref?: string;
  timeoutMs: number;
  plugins: string[];
  detached?: DetachedTask;
  taskScope?: TaskRuntimeScope;
  /** Secret-reference to environment-variable map; contains names only, never values. */
  secretEnv?: Record<string, string>;
}

export type WorkerMessage =
  | { version: 1; type: "event"; event: RuntimeEvent }
  | { version: 1; type: "result"; result: RuntimeTaskResult };

/** Stdout is reserved for this versioned protocol; stderr is diagnostic only. */
export function encodeMessage(message: WorkerMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** The worker is remote code: validate envelopes and bound memory before accepting output. */
export class WorkerDecoder {
  private pending = "";
  private finished = false;
  constructor(private receive: (message: WorkerMessage) => void) {}

  push(chunk: string): void {
    this.pending += chunk;
    if (this.pending.length > 16 * 1024 * 1024) throw new Error("Remote worker exceeded its 16 MiB frame limit");
    let newline: number;
    while ((newline = this.pending.indexOf("\n")) !== -1) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      if (!line.trim()) continue;
      if (this.finished) throw new Error("Remote worker sent data after its terminal result");
      let message: WorkerMessage;
      try { message = JSON.parse(line); } catch { throw new Error("Invalid remote worker JSON frame"); }
      if (!message || message.version !== 1) throw new Error("Unsupported remote worker protocol version");
      if (message.type === "event") {
        const event = message.event;
        if (!event || !["status", "text", "thinking", "tool-use", "tool-result", "log", "warning", "error"].includes(event.type)) {
          throw new Error("Invalid remote worker event");
        }
        if (event.type === "status" && !["starting", "running", "completed", "failed", "cancelled", "timeout"].includes(event.status)) {
          throw new Error("Invalid remote worker status");
        }
        if (["text", "thinking", "log", "warning", "error"].includes(event.type) && typeof (event as { content?: unknown }).content !== "string") {
          throw new Error("Invalid remote worker content");
        }
      } else if (message.type === "result") {
        const result = message.result;
        if (!result || !["completed", "failed", "cancelled", "timeout"].includes(result.status) || typeof result.output !== "string" || !Number.isFinite(result.durationMs)) {
          throw new Error("Invalid remote worker result");
        }
        this.finished = true;
      } else {
        throw new Error("Invalid remote worker message type");
      }
      this.receive(message);
    }
  }

  end(): void {
    if (this.pending.trim()) this.push("\n");
    if (!this.finished) throw new Error("Remote worker exited without a terminal result");
  }
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
