import type { ServiceBinding } from "../../ir/types.js";
import type { TaskReference } from "../contracts.js";

/** Persist this envelope before submission and reuse it unchanged on delivery retries. */
export interface DetachedTask {
  id: string;
  agent: string;
  prompt: string;
  context: { runId: string; step: string };
  delivery: {
    task: TaskReference;
    memory: ServiceBinding;
    projectManagement?: ServiceBinding;
    identity?: ServiceBinding;
  };
  /** Stable absolute deadline bounds both sandbox lifetime and replay acceptance. */
  deadlineAt: string;
}

export interface DetachedReceipt {
  id: string;
  provider: string;
  resourceId?: string;
  state: "accepted" | "completed";
}

/** Continuous executions can expose task-board tools without configuring durable memory. */
export type TaskRuntimeScope = Omit<DetachedTask, "delivery"> & {
  delivery: Omit<DetachedTask["delivery"], "memory"> & { memory?: ServiceBinding };
};

/** Detached acceptance is separate from a live RuntimeSession stream and its ownership. */
export interface DetachedExecution {
  submit(task: DetachedTask): Promise<DetachedReceipt>;
}
