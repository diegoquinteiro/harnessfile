import { createHash, randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import { Command, interrupt, MemorySaver } from "@langchain/langgraph";
import type { Harnessfile } from "../../ir/types.js";
import type { RuntimeExecutor, RuntimeTaskResult } from "../../agent-runtimes/interface.js";
import type { TaskMemoryService, TaskReference, TaskHandoff } from "../../services/contracts.js";
import type { DetachedTask } from "../../services/execution/detached.js";
import type { CompiledHarness, HarnessEvent, HarnessProvider, ProviderOptions, RunHandle, RunResult, ValidationResult } from "../interface.js";
import { LangGraphProvider } from "../langgraph/index.js";
import { buildGraph } from "../langgraph/graph-builder.js";
import { taskReferenceFromKey } from "../../services/task-memory/key.js";

interface AgentInterrupt { kind: "agent-dispatch"; id: string; agent: string; prompt: string; step: string }
interface Ledger extends Record<string, unknown> {
  version: 1;
  task: TaskReference;
  definition: string;
  input: Record<string, unknown>;
  startedAt: string;
  status: RunResult["status"];
  saver?: unknown;
  pending?: DetachedTask;
  result?: RunResult;
  lease?: { owner: string; until: number };
  receipts?: Record<string, RunResult>;
}
const LEASE_MS = 120_000;
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function taskOf(input: Record<string, unknown>): TaskReference {
  const task = input.task as TaskReference | undefined;
  if (!task || typeof task.id !== "string" || !task.id || typeof task.key !== "string" || !task.key) {
    throw new Error("Stateless orchestration requires input.task with its external id and canonical provider key");
  }
  return task;
}
// MemorySaver serializes message objects before storage. Preserve its byte arrays, not
// deserialized messages or provider-specific class instances, across process boundaries.
function pack(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(pack);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pack(v)]));
  return value;
}
function unpack(value: any): any {
  if (value && typeof value === "object" && typeof value.$bytes === "string") return Uint8Array.from(Buffer.from(value.$bytes, "base64"));
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unpack(v)]));
  return value;
}
function snapshotSaver(saver: MemorySaver): unknown {
  // Recovery needs the current checkpoint and its parent's pending sends, not
  // an ever-growing copy of every historical checkpoint on every issue update.
  const storage: MemorySaver["storage"] = {};
  const keep = new Set<string>();
  for (const [thread, namespaces] of Object.entries(saver.storage)) {
    storage[thread] = {};
    for (const [namespace, checkpoints] of Object.entries(namespaces)) {
      const latest = Object.keys(checkpoints).sort().at(-1);
      const ids = latest ? [latest, checkpoints[latest][2]].filter((id): id is string => !!id && !!checkpoints[id]) : [];
      storage[thread][namespace] = Object.fromEntries(ids.map(id => [id, checkpoints[id]]));
      ids.forEach(id => keep.add(JSON.stringify([thread, namespace, id])));
    }
  }
  const writes = Object.fromEntries(Object.entries(saver.writes).filter(([key]) => keep.has(key)));
  return pack({ storage, writes });
}

/** Each invocation performs a bounded graph segment; no process waits for an agent. */
export class StatelessLangGraphProvider implements HarnessProvider {
  name = "langgraph-stateless";
  displayName = "LangGraph (stateless task handoffs)";
  readonly capabilities = { eventDriven: true, taskMemory: true, detachedExecution: true };
  validate(ir: Harnessfile, options?: ProviderOptions): ValidationResult {
    const result = new LangGraphProvider().validate(ir, options);
    if (!ir.taskMemory) result.errors.push({ path: "task-memory", message: "Stateless orchestration requires task memory" });
    for (const [name, step] of Object.entries(ir.steps ?? {})) {
      if (Array.isArray(step.next) && step.next.length > 1) result.errors.push({ path: `steps.${name}.next`, message: "The stateless provider currently supports sequential graphs; fan-out requires a provider with parallel resume support" });
    }
    if (options) {
      if (!options.taskMemory?.capabilities.durable || !options.taskMemory.capabilities.atomicCompareAndSwap) result.errors.push({ path: "task-memory", message: "Task memory must declare durable and atomicCompareAndSwap capabilities" });
      if (!options.detachedExecution?.submit) result.errors.push({ path: "execution", message: "Stateless orchestration requires detached, idempotent submission" });
    }
    result.valid = result.errors.length === 0;
    return result;
  }
  async compile(ir: Harnessfile, options: ProviderOptions): Promise<CompiledHarness> {
    const validation = this.validate(ir, options);
    if (!validation.valid) throw new Error(validation.errors.map(e => `${e.path}: ${e.message}`).join("; "));
    return new StatelessHarness(ir, options);
  }
}

class StatelessHarness implements CompiledHarness {
  private closed = false;
  private active = new Set<Promise<RunResult>>();
  constructor(private ir: Harnessfile, private options: ProviderOptions) {}
  async createRun(input: Record<string, unknown>): Promise<RunHandle> { return this.run(taskOf(input), input); }
  async resumeRun(threadId: string, input: Record<string, unknown>): Promise<RunHandle> {
    const task = taskOf({ ...input, task: input.task ?? taskReferenceFromKey(threadId) });
    if (task.key !== threadId) throw new Error("Resume task key does not match the run ID");
    return this.run(task, input);
  }
  async listRuns() { return []; } // Providers need not enumerate a board to resume a known task.
  async shutdown() { this.closed = true; await Promise.allSettled([...this.active]); }

  private run(task: TaskReference, input: Record<string, unknown>): RunHandle {
    if (this.closed) throw new Error("Orchestration provider is closed");
    const events: HarnessEvent[] = [];
    const result = this.advance(task, input, events);
    this.active.add(result);
    void result.then(() => this.active.delete(result), () => this.active.delete(result));
    return {
      threadId: task.key!, result,
      events: { async *[Symbol.asyncIterator]() { await result; yield* events; } },
    };
  }

  private async advance(task: TaskReference, input: Record<string, unknown>, events: HarnessEvent[]): Promise<RunResult> {
    const memory = this.options.taskMemory!;
    const owner = randomUUID();
    let snapshot = await memory.read(task);
    const definition = digest(this.ir);
    const eventId = typeof input.eventId === "string" && input.eventId ? digest(input.eventId) : undefined;
    let ledger = snapshot.checkpoint as Ledger | undefined;
    if (ledger && (ledger.version !== 1 || ledger.definition !== definition)) throw new Error("The persisted run uses a different harness definition; resume with its original version");
    if (ledger?.result && ledger.status !== "suspended") return ledger.result;
    if (ledger?.lease && ledger.lease.until > Date.now()) throw new Error("Task is being advanced by another invocation; retry this event");
    ledger = { ...(ledger ?? { version: 1, task, definition, input, startedAt: new Date().toISOString(), status: "suspended" }), lease: { owner, until: Date.now() + LEASE_MS } } as Ledger;
    // CAS acquisition fences overlapping invocations. Never dispatch before the intent is durable.
    await memory.compareAndSwap(task, snapshot.revision, ledger);
    const save = async () => {
      for (let retry = 0; retry < 12; retry++) {
        const current = await memory.read(task);
        const stored = current.checkpoint as Ledger;
        if (stored?.lease?.owner !== owner || stored.lease.until <= Date.now()) throw new Error("Task lease expired or changed; retry this event");
        ledger = { ...stored, ...ledger!, pending: ledger!.pending, workerClaims: stored.workerClaims, lease: { owner, until: Date.now() + LEASE_MS } };
        try { await memory.compareAndSwap(task, current.revision, ledger); return; }
        catch (error) { if (!isConflict(error)) throw error; }
      }
      throw new Error("Task memory changed repeatedly; retry this event");
    };
    try {
      snapshot = await memory.read(task);
      if (eventId && ledger.receipts?.[eventId]) {
        // Recover a saved-but-not-submitted intent, without replaying a consumed transition.
        if (ledger.pending) await this.options.detachedExecution!.submit(ledger.pending);
        // Hosts maintain a reconciliation index from this response. Report the
        // current state, not an old gate receipt that could hide a newer worker.
        return ledger.result ?? ledger.receipts[eventId];
      }
      let resume: unknown;
      if (ledger.pending) {
        const pending = ledger.pending;
        let handoff = snapshot.handoffs.find(h => h.dispatchId === pending.id);
        if (!handoff && Date.now() >= Date.parse(pending.deadlineAt)) {
          const result: RuntimeTaskResult = { status: "timeout", output: "", error: "Detached agent did not publish a handoff before its deadline", durationMs: 0 };
          const expired: TaskHandoff = { id: pending.id, dispatchId: pending.id, runId: task.key!, step: pending.context.step, agent: pending.agent, status: "timeout", summary: result.error!, createdAt: pending.deadlineAt, result };
          handoff = await memory.publishHandoff(task, expired);
        }
        if (!handoff) {
          await this.options.detachedExecution!.submit(pending);
          return { status: "suspended", threadId: task.key!, suspendedAt: pending.context.step };
        }
        if (handoff.runId !== task.key || handoff.agent !== pending.agent || handoff.step !== pending.context.step) throw new Error("Handoff does not match its persisted dispatch intent");
        const artifactText = handoff.artifacts?.map(artifact => `${artifact.label ?? "Artifact"}: ${artifact.url}`).join("\n");
        const result = handoff.result ?? { status: handoff.status, output: [handoff.summary, artifactText].filter(Boolean).join("\n\n"), durationMs: 0,
          metadata: { artifacts: handoff.artifacts } };
        if (result.status !== handoff.status) throw new Error("Handoff status disagrees with its result");
        resume = { dispatchId: pending.id, result };
      } else if (ledger.saver) {
        // Gates are resumed only through the trusted explicit CLI/API approval path.
        if (!input.approval || typeof input.approval !== "object") return ledger.result ?? { status: "suspended", threadId: task.key! };
        if (!ledger.result?.resumeToken || (input.approval as Record<string, unknown>).resumeToken !== ledger.result.resumeToken) throw new Error("Approval must include the resumeToken of the current gate interruption");
        resume = input.approval;
      }
      const saver = new MemorySaver();
      if (ledger.saver) Object.assign(saver, unpack(ledger.saver));
      const runtime: RuntimeExecutor = {
        async start() { throw new Error("Stateless graph nodes must use execute"); },
        async execute(agent, prompt, options) {
          if (!options?.taskId || !options.context?.step) throw new Error("Stateless agent dispatch requires a deterministic task ID and step");
          const id = digest({ task: task.key, dispatch: options.taskId });
          const value = interrupt<AgentInterrupt, { dispatchId: string; result: RuntimeTaskResult }>({ kind: "agent-dispatch", id, agent, prompt, step: options.context.step });
          if (!value || value.dispatchId !== id || !value.result) throw new Error("Resume result does not match the interrupted agent dispatch");
          return { ...value.result, task };
        },
      };
      const graph = buildGraph(this.ir, { ...this.options, checkpointer: "memory", runtimeExecutor: runtime }, (threadId, event) => {
        events.push({ ...event, threadId: threadId ?? task.key!, timestamp: new Date() });
      }, saver);
      const config = { configurable: { thread_id: task.key! } };
      let output: any;
      let failure: unknown;
      try {
        output = await graph.invoke(ledger.saver ? new Command({ resume }) : { messages: [new HumanMessage(JSON.stringify(ledger.input))], _triggerData: ledger.input }, config);
      } catch (error) { failure = error; }
      const state = await graph.getState(config);
      const interruptions = state.tasks.flatMap((t: any) => t.interrupts ?? []);
      ledger.saver = snapshotSaver(saver);
      delete ledger.pending;
      if (failure) {
        ledger.status = "failed";
        ledger.result = { status: "failed", threadId: task.key!, error: failure instanceof Error ? failure.message : String(failure) };
      } else if (state.next.length || interruptions.length) {
        const dispatch = interruptions.map((i: any) => i.value).find((v: any) => v?.kind === "agent-dispatch") as AgentInterrupt | undefined;
        ledger.status = "suspended";
        ledger.result = { status: "suspended", threadId: task.key!, suspendedAt: dispatch?.step ?? state.next[0] };
        if (dispatch) {
          const config = this.ir.execution?.provider;
          const timeout = typeof config === "object" && typeof config.timeoutMs === "number" ? config.timeoutMs : 900_000;
          ledger.pending = { id: dispatch.id, agent: dispatch.agent, prompt: dispatch.prompt, context: { runId: task.key!, step: dispatch.step }, deadlineAt: new Date(Date.now() + timeout).toISOString(), delivery: { task, memory: this.ir.taskMemory!, projectManagement: this.ir.projectManagement, identity: this.ir.identity } };
        } else ledger.result.resumeToken = digest({ task: task.key, checkpoint: state.config, interruptions });
      } else {
        ledger.status = "completed";
        ledger.result = { status: "completed", threadId: task.key!, output: output?._stepOutputs ?? {} };
      }
      if (eventId) {
        if (Object.keys(ledger.receipts ?? {}).length >= 10_000) throw new Error("Task delivery receipt limit reached; start a new task");
        const { output: _output, ...receipt } = ledger.result!;
        ledger.receipts = { ...ledger.receipts, [eventId]: receipt };
      }
      await save();
      if (ledger.pending) await this.options.detachedExecution!.submit(ledger.pending);
      events.push({ type: ledger.status === "suspended" ? "gate-pending" : "run-end", threadId: task.key!, timestamp: new Date(), data: ledger.result });
      return ledger.result!;
    } finally {
      // Handoffs can arrive during submission. Preserve them and worker-owned ledger keys.
      for (let retry = 0; retry < 12; retry++) {
        const current = await memory.read(task);
        const checkpoint = current.checkpoint as Ledger | undefined;
        if (checkpoint?.lease?.owner !== owner) break;
        const released = { ...checkpoint }; delete released.lease;
        try { await memory.compareAndSwap(task, current.revision, released); break; }
        catch (error) { if (!isConflict(error)) throw error; }
      }
    }
  }
}
function isConflict(error: unknown): boolean { return error instanceof Error && error.name === "TaskMemoryConflictError"; }
