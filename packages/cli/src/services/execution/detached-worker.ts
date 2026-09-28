import type { RuntimeTaskResult } from "../../agent-runtimes/interface.js";
import type { TaskHandoff } from "../contracts.js";
import type { WorkerRequest } from "./protocol.js";
import type { TaskServices } from "./task-services.js";

export interface DetachedWorkerOperations {
  prepare(request: WorkerRequest): Promise<string>;
  execute(request: WorkerRequest, workspace: string): Promise<RuntimeTaskResult>;
}

/** A durable CAS claim fences duplicate sandbox deliveries, including provider preemption. */
export async function runDetachedWorker(request: WorkerRequest, services: TaskServices, operations: DetachedWorkerOperations): Promise<RuntimeTaskResult | undefined> {
  const task = request.detached;
  if (!task) throw new Error("Detached worker requires delivery context");
  const memory = services.memory;
  if (!memory) throw new Error("Detached worker requires durable task memory");
  const matches = (handoff: TaskHandoff) => handoff.dispatchId === task.id && handoff.runId === task.context.runId && handoff.step === task.context.step && handoff.agent === task.agent;
  for (let attempt = 0; ; attempt++) {
    const current = await memory.read(task.delivery.task);
    if (current.handoffs.some(matches)) return;
    if (!current.checkpoint) throw new Error("Detached dispatch intent must be persisted before worker startup");
    const claims = current.checkpoint.workerClaims as Record<string, unknown> | undefined;
    if (claims?.[task.id]) return;
    try {
      await memory.compareAndSwap(task.delivery.task, current.revision, { ...current.checkpoint,
        workerClaims: { ...claims, [task.id]: { claimedAt: new Date().toISOString(), deadlineAt: task.deadlineAt, agent: task.agent } } });
      break;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TaskMemoryConflictError" || attempt >= 7) throw error;
    }
  }
  const startedAt = Date.now();
  let result: RuntimeTaskResult;
  try {
    if (Date.parse(task.deadlineAt) <= Date.now()) {
      result = { status: "timeout", output: "", durationMs: 0 };
    } else {
      const workspace = await operations.prepare(request);
      const remaining = Date.parse(task.deadlineAt) - Date.now() - 20_000;
      result = remaining <= 0 ? { status: "timeout", output: "", durationMs: Date.now() - startedAt }
        : await operations.execute({ ...request, timeoutMs: Math.min(request.timeoutMs, remaining) }, workspace);
    }
  } catch {
    result = { status: "failed", output: "", error: "Detached worker failed to prepare the checkout or run the configured coding agent.", durationMs: Date.now() - startedAt };
  }
  const fallback: TaskHandoff = { id: task.id, dispatchId: task.id, runId: task.context.runId, step: task.context.step, agent: task.agent,
    status: result.status, summary: result.output || result.error || `Agent execution ${result.status}`, result, createdAt: new Date().toISOString() };
  // Agent-authored handoffs win. If absent, publish the normalized runtime result.
  // Re-publishing an existing handoff retries its issue-note wakeup projection safely.
  for (let attempt = 0; ; attempt++) {
    try {
      const before = await memory.read(task.delivery.task);
      const handoff = before.handoffs.find(matches) ?? fallback;
      await memory.publishHandoff(task.delivery.task, handoff);
      const confirmed = (await memory.read(task.delivery.task)).handoffs.find(matches);
      if (!confirmed) throw new Error("Task handoff was not visible after publication");
      return confirmed.result ?? { status: confirmed.status, output: confirmed.summary, durationMs: Date.now() - startedAt, metadata: { artifacts: confirmed.artifacts, next: confirmed.next } };
    } catch (error) {
      if (attempt >= 2 || Date.now() >= Date.parse(task.deadlineAt) + 45_000) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}
