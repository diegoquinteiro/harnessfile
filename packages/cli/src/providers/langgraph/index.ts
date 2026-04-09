import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { Harnessfile } from "../../ir/types.js";
import type {
  HarnessProvider,
  ValidationResult,
  ProviderOptions,
  CompiledHarness,
  RunHandle,
  RunInfo,
  RunResult,
  HarnessEvent,
} from "../interface.js";
import { buildGraph } from "./graph-builder.js";

export class LangGraphProvider implements HarnessProvider {
  name = "langgraph";
  displayName = "LangGraph (TypeScript)";

  validate(ir: Harnessfile): ValidationResult {
    const errors: ValidationResult["errors"] = [];
    const warnings: ValidationResult["warnings"] = [];

    // Check that all agent models use supported providers
    for (const [name, agent] of Object.entries(ir.agents)) {
      const slash = agent.model.indexOf("/");
      if (slash === -1) {
        errors.push({
          path: `agents.${name}.model`,
          message: `Model '${agent.model}' must be in 'provider/model-name' format.`,
        });
        continue;
      }
      const provider = agent.model.slice(0, slash);
      if (!["anthropic", "openai"].includes(provider)) {
        warnings.push({
          path: `agents.${name}.model`,
          message: `Model provider '${provider}' may not be supported. Supported: anthropic, openai.`,
        });
      }
    }

    // Check that agent steps reference valid agents
    if (ir.steps) {
      for (const [name, step] of Object.entries(ir.steps)) {
        if (
          step.type === "agent" &&
          step.agent &&
          !ir.agents[step.agent]
        ) {
          errors.push({
            path: `steps.${name}.agent`,
            message: `References undefined agent '${step.agent}'.`,
          });
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async compile(
    ir: Harnessfile,
    options: ProviderOptions,
  ): Promise<CompiledHarness> {
    const compiled = buildGraph(ir, options);
    return new LangGraphCompiledHarness(compiled, ir);
  }
}

class LangGraphCompiledHarness implements CompiledHarness {
  private runs = new Map<
    string,
    { status: RunInfo["status"]; startedAt: Date; suspendedAt?: string }
  >();

  constructor(
    private graph: ReturnType<typeof buildGraph>,
    private ir: Harnessfile,
  ) {}

  async createRun(input: Record<string, unknown>): Promise<RunHandle> {
    const threadId = randomUUID();
    this.runs.set(threadId, { status: "running", startedAt: new Date() });

    const config = { configurable: { thread_id: threadId } };

    const initialInput = {
      messages: [new HumanMessage(JSON.stringify(input))],
      _triggerData: input,
    };

    return this.executeRun(threadId, initialInput, config);
  }

  async resumeRun(
    threadId: string,
    input: Record<string, unknown>,
  ): Promise<RunHandle> {
    const run = this.runs.get(threadId);
    if (!run) {
      throw new Error(`Run '${threadId}' not found`);
    }
    if (run.status !== "suspended") {
      throw new Error(
        `Run '${threadId}' is not suspended (status: ${run.status})`,
      );
    }

    run.status = "running";
    run.suspendedAt = undefined;

    const config = { configurable: { thread_id: threadId } };

    // Resume with Command
    const resumeInput = new Command({ resume: input });

    return this.executeRun(threadId, resumeInput, config);
  }

  async listRuns(): Promise<RunInfo[]> {
    return [...this.runs.entries()].map(([threadId, info]) => ({
      threadId,
      status: info.status,
      startedAt: info.startedAt,
      suspendedAt: info.suspendedAt,
    }));
  }

  async shutdown(): Promise<void> {
    // For v0.1, just clear the runs map
    this.runs.clear();
  }

  private executeRun(
    threadId: string,
    input: unknown,
    config: { configurable: { thread_id: string } },
  ): RunHandle {
    const events: HarnessEvent[] = [];
    const self = this;

    const resultPromise = (async (): Promise<RunResult> => {
      try {
        events.push({
          type: "run-start",
          threadId,
          timestamp: new Date(),
        });

        const result = await self.graph.invoke(input as any, config);

        // Check if the run was interrupted (gate)
        const state = await self.graph.getState(config);
        if (state.next && state.next.length > 0) {
          // Graph has pending nodes — it was interrupted
          const suspendedStep = state.next[0];
          self.runs.set(threadId, {
            status: "suspended",
            startedAt: self.runs.get(threadId)!.startedAt,
            suspendedAt: suspendedStep,
          });

          events.push({
            type: "gate-pending",
            threadId,
            step: suspendedStep,
            timestamp: new Date(),
          });

          return {
            status: "suspended",
            threadId,
            suspendedAt: suspendedStep,
          };
        }

        // Completed
        self.runs.set(threadId, {
          status: "completed",
          startedAt: self.runs.get(threadId)!.startedAt,
        });

        events.push({
          type: "run-end",
          threadId,
          data: result,
          timestamp: new Date(),
        });

        return {
          status: "completed",
          threadId,
          output: result._stepOutputs ?? {},
        };
      } catch (error) {
        const existing = self.runs.get(threadId);
        self.runs.set(threadId, {
          status: "failed",
          startedAt: existing?.startedAt ?? new Date(),
        });

        const message =
          error instanceof Error ? error.message : String(error);

        events.push({
          type: "run-end",
          threadId,
          data: { error: message },
          timestamp: new Date(),
        });

        return {
          status: "failed",
          threadId,
          error: message,
        };
      }
    })();

    // Create async iterable from events array (simple polling-based for v0.1)
    const eventIterable: AsyncIterable<HarnessEvent> = {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next() {
            // Wait for new events or completion
            while (index >= events.length) {
              const run = self.runs.get(threadId);
              if (
                run &&
                (run.status === "completed" ||
                  run.status === "failed" ||
                  run.status === "suspended")
              ) {
                // Drain remaining events
                if (index < events.length) {
                  return { value: events[index++], done: false };
                }
                return { value: undefined as any, done: true };
              }
              await new Promise((r) => setTimeout(r, 50));
            }
            return { value: events[index++], done: false };
          },
        };
      },
    };

    return {
      threadId,
      events: eventIterable,
      result: resultPromise,
    };
  }
}
