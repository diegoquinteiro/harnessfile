import { randomUUID } from "node:crypto";
import type { TaskCapabilityScope, TaskHandoff, TaskMemoryService, TaskMemorySnapshot, TaskMemoryTool, TaskReference } from "../contracts.js";
import { taskMemoryKey } from "./key.js";

export class TaskMemoryConflictError extends Error {
  constructor() { super("Task memory changed; reload its revision before retrying"); this.name = "TaskMemoryConflictError"; }
}

export interface StoredTaskMemory {
  format: 1;
  key: string;
  revision: string;
  checkpoint?: Record<string, unknown>;
  handoffs: TaskHandoff[];
}
export interface StoredVersion { data: StoredTaskMemory; storageRevision: string }
export const MAX_TASK_MEMORY_BYTES = 16 * 1024 * 1024;
export function checkRecordSize(raw: string | Buffer): void {
  if (Buffer.byteLength(raw) > MAX_TASK_MEMORY_BYTES) throw new Error("Task memory exceeds the 16 MiB record limit");
}

export function canonicalJson(value: unknown): string {
  function sorted(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sorted);
    if (input !== null && typeof input === "object") return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, sorted(value)]));
    return input;
  }
  return JSON.stringify(sorted(value));
}

export function validateHandoff(value: TaskHandoff): void {
  for (const key of ["id", "dispatchId", "runId", "step", "agent", "createdAt"] as const) {
    if (typeof value[key] !== "string" || !value[key]) throw new Error(`Handoff ${key} must be a nonempty string`);
  }
  if (value.id !== value.dispatchId) throw new Error("Handoff id must equal dispatchId");
  if (!["completed", "failed", "cancelled", "timeout"].includes(value.status) || typeof value.summary !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("Invalid handoff completion");
  if (value.result && (value.result.status !== value.status || typeof value.result.output !== "string" || typeof value.result.durationMs !== "number" || !Number.isFinite(value.result.durationMs))) throw new Error("Handoff result must agree with its terminal status");
  if (value.artifacts !== undefined && (!Array.isArray(value.artifacts) || value.artifacts.some((artifact) => !artifact || typeof artifact.url !== "string" || (artifact.label !== undefined && typeof artifact.label !== "string")))) throw new Error("Invalid handoff artifacts");
  if (value.next !== undefined && typeof value.next !== "string") throw new Error("Invalid handoff next step");
}

export function parseStored(raw: string, key: string): StoredTaskMemory {
  checkRecordSize(raw);
  let data: StoredTaskMemory;
  try { data = JSON.parse(raw); } catch { throw new Error("Task memory record is not valid JSON"); }
  if (data.format !== 1 || data.key !== key || typeof data.revision !== "string" || !data.revision || !Array.isArray(data.handoffs)) throw new Error("Task memory record has an invalid format or task key");
  if (data.checkpoint !== undefined && (!data.checkpoint || typeof data.checkpoint !== "object" || Array.isArray(data.checkpoint))) throw new Error("Task memory checkpoint must be an object");
  data.handoffs.forEach(validateHandoff);
  if (new Set(data.handoffs.map((value) => value.id)).size !== data.handoffs.length) throw new Error("Task memory contains duplicate handoff IDs");
  return data;
}

const tools: TaskMemoryTool[] = [
  { name: "task_memory_read", description: "Read this task's durable checkpoint and agent handoffs.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "task_memory_publish_handoff", description: "Publish an immutable completion for this agent dispatch; task, agent and dispatch identity are fixed by the runtime.", inputSchema: { type: "object", required: ["status", "summary"], properties: { status: { enum: ["completed", "failed", "cancelled", "timeout"] }, summary: { type: "string" }, artifacts: { type: "array", items: { type: "object", required: ["url"], properties: { url: { type: "string" }, label: { type: "string" } }, additionalProperties: false } }, next: { type: "string" }, result: { type: "object" } }, additionalProperties: false } },
];

export abstract class AtomicTaskMemory implements TaskMemoryService {
  readonly capabilities = { durable: true as const, atomicCompareAndSwap: true as const, tools };
  protected abstract load(task: TaskReference): Promise<StoredVersion | undefined>;
  protected abstract save(task: TaskReference, expectedStorageRevision: string | null, value: StoredTaskMemory): Promise<void>;
  protected async projectHandoff(_task: TaskReference, _handoff: TaskHandoff): Promise<void> {}

  async read(task: TaskReference): Promise<TaskMemorySnapshot> {
    taskMemoryKey(task);
    const record = await this.load(task);
    return record ? { revision: record.data.revision, checkpoint: record.data.checkpoint, handoffs: record.data.handoffs } : { revision: null, handoffs: [] };
  }

  async compareAndSwap(task: TaskReference, expectedRevision: string | null, checkpoint: Record<string, unknown>): Promise<TaskMemorySnapshot> {
    const key = taskMemoryKey(task);
    if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) throw new Error("Checkpoint must be an object");
    const old = await this.load(task);
    if ((old?.data.revision ?? null) !== expectedRevision) throw new TaskMemoryConflictError();
    const data: StoredTaskMemory = { format: 1, key, revision: randomUUID(), checkpoint: JSON.parse(canonicalJson(checkpoint)), handoffs: old?.data.handoffs ?? [] };
    await this.save(task, old?.storageRevision ?? null, data);
    return { revision: data.revision, checkpoint: data.checkpoint, handoffs: data.handoffs };
  }

  async publishHandoff(task: TaskReference, handoff: TaskHandoff): Promise<TaskHandoff> {
    const key = taskMemoryKey(task);
    validateHandoff(handoff);
    const immutable: TaskHandoff = JSON.parse(canonicalJson(handoff));
    for (let attempt = 0; attempt < 30; attempt++) {
      const old = await this.load(task);
      const existing = old?.data.handoffs.find((value) => value.id === immutable.id);
      if (existing) {
        if (canonicalJson(existing) !== canonicalJson(immutable)) throw new Error("A handoff ID is immutable and cannot be reused with different content");
        await this.projectHandoff(task, existing);
        return existing;
      }
      const data: StoredTaskMemory = { format: 1, key, revision: randomUUID(), checkpoint: old?.data.checkpoint, handoffs: [...old?.data.handoffs ?? [], immutable] };
      try { await this.save(task, old?.storageRevision ?? null, data); }
      catch (error) { if (error instanceof TaskMemoryConflictError) continue; throw error; }
      await this.projectHandoff(task, immutable);
      return immutable;
    }
    throw new TaskMemoryConflictError();
  }

  async invokeTool(name: string, input: Record<string, unknown>, scope: TaskCapabilityScope): Promise<unknown> {
    if (name === "task_memory_read") {
      if (Object.keys(input).length) throw new Error("Task memory read accepts no task override");
      return this.read(scope.task);
    }
    if (name !== "task_memory_publish_handoff") throw new Error(`Unknown task-memory tool '${name}'`);
    if (Object.keys(input).some((key) => !["status", "summary", "artifacts", "next", "result"].includes(key))) throw new Error("Handoff tool cannot override task or dispatch scope");
    const existing = (await this.read(scope.task)).handoffs.find((value) => value.id === scope.dispatchId);
    const handoff = { ...input, id: scope.dispatchId, dispatchId: scope.dispatchId, runId: scope.runId, step: scope.step, agent: scope.agent, createdAt: existing?.createdAt ?? new Date().toISOString() } as TaskHandoff;
    return this.publishHandoff(scope.task, handoff);
  }
}
