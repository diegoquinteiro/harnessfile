import { randomUUID } from "node:crypto";
import type { RuntimeExecutor, RuntimeExecuteOptions, RuntimeSession, RuntimeTaskResult } from "../agent-runtimes/interface.js";
import type { IdentityService, ProjectManagementService, TaskReference, TaskUpdate } from "./contracts.js";

/** Projects agent dispatches onto a task board without coupling either engine to that board. */
export class TaskExecutor implements RuntimeExecutor {
  private sessions = new Set<RuntimeSession>();
  private closed = false;
  private starts = new Set<Promise<RuntimeSession>>();
  private startingControllers = new Set<AbortController>();
  constructor(
    private runtime: RuntimeExecutor,
    private tasks: ProjectManagementService,
    private identities: IdentityService,
    private audience: string,
  ) {}

  start(agent: string, prompt: string, options: RuntimeExecuteOptions = {}): Promise<RuntimeSession> {
    if (this.closed) return Promise.reject(new Error("Task executor is closed"));
    const controller = new AbortController();
    this.startingControllers.add(controller);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const start = this.startTask(agent, prompt, { ...options, signal });
    this.starts.add(start);
    const settled = () => { this.starts.delete(start); this.startingControllers.delete(controller); };
    void start.then(settled, settled);
    return start;
  }

  private async startTask(agent: string, prompt: string, options: RuntimeExecuteOptions): Promise<RuntimeSession> {
    if (this.closed) throw new Error("Task executor is closed");
    options.signal?.throwIfAborted();
    const taskId = options.taskId ?? randomUUID();
    const actor = await this.identities.resolve(agent, this.audience);
    options.signal?.throwIfAborted();
    const task = await this.tasks.createTask({
      ...options.context, id: taskId, agent, prompt,
    }, actor);
    const update = async (value: TaskUpdate) => {
      // Resolve again for each operation so long-running tasks can refresh credentials.
      await this.tasks.updateTask(task, value, await this.identities.resolve(agent, this.audience));
    };
    let session: RuntimeSession;
    try {
      options.signal?.throwIfAborted();
      await update({ status: "running" });
      if (this.closed) throw new Error("Task executor closed during startup");
      session = await this.runtime.start(agent, prompt, { ...options, taskId });
    } catch (error) {
      await this.reportFailure(task, agent, error, options.signal?.aborted ? "cancelled" : "failed");
      throw error;
    }
    const result = session.result.then(async (value) => {
      await update({ status: value.status, output: value.output, error: value.error });
      return { ...value, task };
    }, async (error) => {
      await this.reportFailure(task, agent, error, "failed");
      throw error;
    });
    // Consumers may drain events before awaiting result; keep early rejections handled.
    void result.catch(() => {});
    const tracked = { ...session, result };
    this.sessions.add(tracked);
    void result.then(() => this.sessions.delete(tracked), () => this.sessions.delete(tracked));
    if (this.closed) await tracked.cancel();
    return tracked;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.startingControllers) controller.abort();
    await Promise.allSettled([...this.starts]);
    const outcomes = await Promise.allSettled([...this.sessions].map(async (session) => {
      await session.cancel();
      await session.result;
    }));
    const errors = outcomes.filter((result) => result.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map((result) => result.reason), "Task cleanup failed");
  }

  async execute(agent: string, prompt: string, options?: RuntimeExecuteOptions): Promise<RuntimeTaskResult> {
    const session = await this.start(agent, prompt, options);
    try {
      for await (const _event of session.events) { /* Driver owns the onEvent callback. */ }
    } catch (error) {
      await session.cancel();
      throw error;
    }
    return session.result;
  }

  private async reportFailure(task: TaskReference, agent: string, error: unknown, status: "failed" | "cancelled") {
    try {
      await this.tasks.updateTask(task, {
        status,
        error: error instanceof Error ? error.message : String(error),
      }, await this.identities.resolve(agent, this.audience));
    } catch (reportError) {
      throw new AggregateError([error, reportError], "Agent dispatch and task status update both failed");
    }
  }
}
