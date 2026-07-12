import type {
  RuntimeEvent,
  RuntimeInstance,
  RuntimeSession,
  RuntimeTaskResult,
} from "./interface.js";
import { AsyncQueue } from "./process.js";

export class RuntimeSessionController {
  private queue = new AsyncQueue<RuntimeEvent>(512);
  private resolveResult!: (result: RuntimeTaskResult) => void;
  private rejectResult!: (error: unknown) => void;
  readonly result: Promise<RuntimeTaskResult>;

  constructor(
    private taskId: string,
    private instance: RuntimeInstance,
    private cancelOperation: () => Promise<void>,
  ) {
    this.result = new Promise((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
  }

  session(): RuntimeSession {
    return {
      taskId: this.taskId,
      instance: this.instance,
      events: this.queue,
      result: this.result,
      cancel: this.cancelOperation,
    };
  }

  emit(event: RuntimeEvent): void {
    this.queue.push(event);
  }

  complete(result: RuntimeTaskResult): void {
    this.queue.close();
    this.resolveResult(result);
  }

  fail(error: unknown): void {
    this.queue.close();
    this.rejectResult(error);
  }
}
