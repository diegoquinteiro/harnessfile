import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { AIMessage } from "@langchain/core/messages";
import { loadHarnessDirectory } from "../src/parser/directory.js";
import { LangGraphProvider } from "../src/providers/langgraph/index.js";
import type { Harnessfile } from "../src/ir/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadIR(fixture: string): Harnessfile {
  return loadHarnessDirectory(resolve(FIXTURES, fixture)).ir;
}

// Mock chat models for the squad orchestration loop.
// The leader model is recognized by the protocol block in its system prompt; its
// behavior is switched per test via globalThis.__squadLeaderMode.
declare global {
  // eslint-disable-next-line no-var
  var __squadLeaderMode: "normal" | "never-done" | "prose" | undefined;
}

vi.mock("../src/providers/langgraph/model-factory.js", () => {
  return {
    createChatModel: (_modelSpec: string) => {
      let leaderTurn = 0;
      return {
        invoke: vi.fn(async (messages: any[]) => {
          const systemMsg = messages.find(
            (m: any) =>
              m._getType?.() === "system" ||
              m.constructor?.name === "SystemMessage",
          );
          const content: string =
            typeof systemMsg?.content === "string" ? systemMsg.content : "";

          const isLeader = content.includes("You are the squad leader");
          if (isLeader) {
            const mode = globalThis.__squadLeaderMode ?? "normal";
            if (mode === "never-done") {
              return new AIMessage(
                '{"action": "dispatch", "member": "researcher", "instruction": "keep digging"}',
              );
            }
            if (mode === "prose") {
              return new AIMessage("I cannot decide what to do next.");
            }
            leaderTurn++;
            if (leaderTurn === 1) {
              return new AIMessage(
                '{"action": "dispatch", "member": "researcher", "instruction": "gather context on the issue"}',
              );
            }
            if (leaderTurn === 2) {
              return new AIMessage(
                '{"action": "dispatch", "member": "engineer", "instruction": "implement the fix"}',
              );
            }
            return new AIMessage(
              '{"action": "done", "summary": "Fix implemented and verified."}',
            );
          }

          // Member models: identify themselves by their role card
          if (content.includes("You research")) {
            return new AIMessage("Research findings: the bug is in module X.");
          }
          if (content.includes("You implement")) {
            return new AIMessage("Implemented the fix in module X, PR opened.");
          }
          return new AIMessage("Generic member output.");
        }),
        constructor: { name: "MockChatModel" },
      };
    },
  };
});

beforeEach(() => {
  globalThis.__squadLeaderMode = "normal";
});

describe("execution — squad orchestration loop", () => {
  const provider = new LangGraphProvider();

  it("runs the leader loop: dispatch, dispatch, done", async () => {
    const ir = loadIR("squad");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });

    const handle = await compiled.createRun({ issue: "Fix the bug" });
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
    expect(result.output!["dev-squad"]).toBe(
      "Fix implemented and verified.",
    );
    const dispatches = result.output!["dev-squad_dispatches"] as Array<{
      member: string;
      instruction: string;
    }>;
    expect(dispatches.map((d) => d.member)).toEqual([
      "researcher",
      "engineer",
    ]);
    expect(dispatches[0].instruction).toBe("gather context on the issue");
  });

  it("emits step events per dispatch", async () => {
    const ir = loadIR("squad");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });

    const handle = await compiled.createRun({ issue: "Fix the bug" });
    const events: any[] = [];
    for await (const event of handle.events) {
      events.push(event);
    }

    const stepStarts = events.filter((e) => e.type === "step-start");
    const stepEnds = events.filter((e) => e.type === "step-end");
    expect(stepStarts.map((e) => e.step)).toEqual([
      "dev-squad:researcher",
      "dev-squad:engineer",
    ]);
    expect(stepEnds.map((e) => e.step)).toEqual([
      "dev-squad:researcher",
      "dev-squad:engineer",
    ]);
    expect(stepEnds[0].data.output).toContain("Research findings");
  });

  it("caps the loop at 25 iterations and emits a warning event", async () => {
    globalThis.__squadLeaderMode = "never-done";
    const ir = loadIR("squad");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });

    const handle = await compiled.createRun({ issue: "Endless" });
    const events: any[] = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(String(result.output!["dev-squad"])).toContain("iteration cap");

    const dispatches = result.output!["dev-squad_dispatches"] as unknown[];
    expect(dispatches).toHaveLength(25);

    const warning = events.find((e) => e.type === "warning");
    expect(warning).toBeDefined();
    expect(warning!.data.message).toContain("25-iteration cap");
  });

  it("treats non-JSON leader output as the final summary with a warning", async () => {
    globalThis.__squadLeaderMode = "prose";
    const ir = loadIR("squad");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });

    const handle = await compiled.createRun({ issue: "Confusing" });
    const events: any[] = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(result.output!["dev-squad"]).toBe(
      "I cannot decide what to do next.",
    );
    const warning = events.find((e) => e.type === "warning");
    expect(warning).toBeDefined();
    expect(warning!.data.message).toContain("non-JSON");
  });
});
