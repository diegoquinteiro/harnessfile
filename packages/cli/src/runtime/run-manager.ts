import type {
  CompiledHarness,
  RunHandle,
  RunInfo,
  HarnessEvent,
} from "../providers/interface.js";
import { logEvent } from "./logger.js";

// Manages concurrent runs through the compiled harness.
// Dispatches trigger events to createRun(), gate approvals to resumeRun().

export class RunManager {
  private activeHandles = new Map<string, RunHandle>();

  constructor(private harness: CompiledHarness) {}

  async startRun(input: Record<string, unknown>): Promise<RunHandle> {
    const handle = await this.harness.createRun(input);
    this.activeHandles.set(handle.threadId, handle);

    // Stream events in background
    this.streamEvents(handle);

    return handle;
  }

  async resumeRun(
    threadId: string,
    input: Record<string, unknown>,
  ): Promise<RunHandle> {
    const handle = await this.harness.resumeRun(threadId, input);
    this.activeHandles.set(handle.threadId, handle);

    // Stream events in background
    this.streamEvents(handle);

    return handle;
  }

  async listRuns(): Promise<RunInfo[]> {
    return this.harness.listRuns();
  }

  async shutdown(): Promise<void> {
    await this.harness.shutdown();
    this.activeHandles.clear();
  }

  private streamEvents(handle: RunHandle): void {
    // Fire-and-forget: consume events and log them
    (async () => {
      try {
        for await (const event of handle.events) {
          logEvent(event);
        }
      } catch {
        // Stream ended or errored — that's fine
      }
      // Clean up handle when run is done
      handle.result.then((result) => {
        if (result.status !== "suspended") {
          this.activeHandles.delete(handle.threadId);
        }
      });
    })();
  }
}
