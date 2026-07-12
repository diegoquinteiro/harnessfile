import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { loadHarnessDirectory } from "../src/parser/directory.js";
import { LangGraphProvider } from "../src/providers/langgraph/index.js";
import type { Harnessfile } from "../src/ir/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadIR(fixture: string): Harnessfile {
  return loadHarnessDirectory(resolve(FIXTURES, fixture)).ir;
}

// Mock coding-agent runtimes for the squad orchestration loop.
// The leader is recognized by the protocol block in its task prompt; its
// behavior is switched per test via globalThis.__squadLeaderMode.
declare global {
  // eslint-disable-next-line no-var
  var __squadLeaderMode: "normal" | "never-done" | "prose" | undefined;
}

vi.mock("../src/agent-runtimes/dispatcher.js", () => {
  return {
    RuntimeDispatcher: class {
      leaderTurn = 0;
      execute = vi.fn(async (agentName: string, prompt: string) => {
          const isLeader = prompt.includes("You are the squad leader");
          if (isLeader) {
            const mode = globalThis.__squadLeaderMode ?? "normal";
            if (mode === "never-done") {
              return { output: '{"action": "dispatch", "member": "researcher", "instruction": "keep digging"}' };
            }
            if (mode === "prose") {
              return { output: "I cannot decide what to do next." };
            }
            this.leaderTurn++;
            if (this.leaderTurn === 1) {
              return { output: '{"action": "dispatch", "member": "researcher", "instruction": "gather context on the issue"}' };
            }
            if (this.leaderTurn === 2) {
              return { output: '{"action": "dispatch", "member": "engineer", "instruction": "implement the fix"}' };
            }
            return { output: '{"action": "done", "summary": "Fix implemented and verified."}' };
          }

          if (agentName === "researcher") {
            return { output: "Research findings: the bug is in module X." };
          }
          if (agentName === "engineer") {
            return { output: "Implemented the fix in module X, PR opened." };
          }
          return { output: "Generic member output." };
      });
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

  it("checkpoints and resumes each coding agent's native session", async () => {
    const ir = loadIR("squad");
    const calls: Array<{ agent: string; options: any }> = [];
    let leaderTurn = 0;
    const runtimeExecutor = {
      start: vi.fn(),
      execute: vi.fn(async (agent: string, _prompt: string, options?: any) => {
        calls.push({ agent, options });
        const output = agent === "pm"
          ? (++leaderTurn === 1
              ? '{"action":"dispatch","member":"researcher","instruction":"investigate"}'
              : '{"action":"done","summary":"complete"}')
          : "findings";
        return {
          status: "completed" as const,
          output,
          durationMs: 1,
          resume: {
            sessionId: `${agent}-session`,
            instanceId: `${agent}-instance`,
            workspaceRoot: "/repo",
          },
        };
      }),
    };
    const compiled = await provider.compile(ir, {
      checkpointer: "memory",
      runtimeExecutor,
    });

    const result = await (await compiled.createRun({ issue: "Resume sessions" })).result;
    expect(result.status).toBe("completed");
    const leaderCalls = calls.filter((call) => call.agent === "pm");
    expect(leaderCalls).toHaveLength(2);
    expect(leaderCalls[0].options.resume).toBeUndefined();
    expect(leaderCalls[1].options.resume).toEqual({
      sessionId: "pm-session",
      instanceId: "pm-instance",
      workspaceRoot: "/repo",
    });
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
