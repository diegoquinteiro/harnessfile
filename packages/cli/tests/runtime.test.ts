import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { resolve } from "node:path";
import { parseHarnessfile } from "../src/parser/parse.js";
import { normalize } from "../src/ir/normalize.js";
import { LangGraphProvider } from "../src/providers/langgraph/index.js";
import { RunManager } from "../src/runtime/run-manager.js";
import { TriggerListener } from "../src/runtime/trigger-listener.js";
import { GateResolver } from "../src/runtime/gate-resolver.js";
import type { Harnessfile } from "../src/ir/types.js";
import type { CompiledHarness } from "../src/providers/interface.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadIR(fixture: string): Harnessfile {
  const raw = parseHarnessfile(resolve(FIXTURES, fixture));
  return normalize(raw as Record<string, unknown>);
}

// ---- TriggerListener ----

describe("TriggerListener", () => {
  it("detects triggers in harnessfile", () => {
    const ir = loadIR("pipeline.yaml");
    const listener = new TriggerListener(ir, null as any);
    expect(listener.hasTriggers()).toBe(true);
  });

  it("detects no triggers in minimal harnessfile", () => {
    const ir = loadIR("minimal.yaml");
    const listener = new TriggerListener(ir, null as any);
    expect(listener.hasTriggers()).toBe(false);
  });

  it("detects no triggers in fanout harnessfile", () => {
    const ir = loadIR("fanout.yaml");
    const listener = new TriggerListener(ir, null as any);
    expect(listener.hasTriggers()).toBe(false);
  });
});

// ---- GateResolver HTTP endpoints ----

describe("GateResolver", () => {
  let resolver: GateResolver;
  let mockRunManager: RunManager;
  const PORT = 18081;

  beforeAll(async () => {
    // Create a mock compiled harness for RunManager
    const mockHarness: CompiledHarness = {
      async createRun() {
        throw new Error("not implemented in test");
      },
      async resumeRun() {
        throw new Error("not implemented in test");
      },
      async listRuns() {
        return [
          {
            threadId: "test-thread-1",
            status: "running" as const,
            startedAt: new Date("2026-01-01"),
          },
          {
            threadId: "test-thread-2",
            status: "suspended" as const,
            startedAt: new Date("2026-01-01"),
            suspendedAt: "review",
          },
        ];
      },
      async shutdown() {},
    };

    mockRunManager = new RunManager(mockHarness);
    resolver = new GateResolver(mockRunManager);
    await resolver.start({ port: PORT });
  });

  afterAll(async () => {
    await resolver.stop();
  });

  it("lists runs via GET /runs", async () => {
    const res = await fetch(`http://localhost:${PORT}/runs`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.runs).toHaveLength(2);
    expect(data.runs[0].threadId).toBe("test-thread-1");
    expect(data.runs[1].status).toBe("suspended");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://localhost:${PORT}/unknown`);
    expect(res.status).toBe(404);
  });

  it("returns error for gate resume on non-existent run", async () => {
    const res = await fetch(`http://localhost:${PORT}/gate/nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toBeDefined();
  });
});

// ---- TriggerListener HTTP endpoints ----

describe("TriggerListener HTTP", () => {
  let listener: TriggerListener;
  let runManager: RunManager;
  const PORT = 18082;

  beforeAll(async () => {
    const ir = loadIR("pipeline.yaml");

    // Mock compiled harness that tracks runs
    const runs: Array<{ threadId: string; input: any }> = [];
    const mockHarness: CompiledHarness = {
      async createRun(input) {
        const threadId = `run-${runs.length + 1}`;
        runs.push({ threadId, input });
        return {
          threadId,
          events: {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  return { value: undefined as any, done: true };
                },
              };
            },
          },
          result: Promise.resolve({
            status: "completed" as const,
            threadId,
            output: {},
          }),
        };
      },
      async resumeRun() {
        throw new Error("not needed");
      },
      async listRuns() {
        return [];
      },
      async shutdown() {},
    };

    runManager = new RunManager(mockHarness);
    listener = new TriggerListener(ir, runManager);
    await listener.start({ port: PORT });
  });

  afterAll(async () => {
    await listener.stop();
  });

  it("accepts trigger POST and starts a run", async () => {
    const res = await fetch(`http://localhost:${PORT}/trigger/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    });
    expect(res.status).toBe(202);
    const data = (await res.json()) as any;
    expect(data.threadId).toBeDefined();
    expect(data.status).toBe("started");
  });

  it("accepts multiple concurrent triggers", async () => {
    const responses = await Promise.all([
      fetch(`http://localhost:${PORT}/trigger/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "a" }),
      }),
      fetch(`http://localhost:${PORT}/trigger/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "b" }),
      }),
      fetch(`http://localhost:${PORT}/trigger/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "c" }),
      }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(202);
      const data = (await res.json()) as any;
      expect(data.threadId).toBeDefined();
    }
  });

  it("accepts empty body", async () => {
    const res = await fetch(`http://localhost:${PORT}/trigger/start`, {
      method: "POST",
    });
    expect(res.status).toBe(202);
  });

  it("returns 404 for unknown trigger", async () => {
    const res = await fetch(`http://localhost:${PORT}/trigger/unknown`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const data = (await res.json()) as any;
    expect(data.error).toContain("Unknown trigger");
    expect(data.available).toContain("start");
  });

  it("returns 404 for non-trigger routes", async () => {
    const res = await fetch(`http://localhost:${PORT}/other`);
    expect(res.status).toBe(404);
  });
});

// ---- RunManager ----

describe("RunManager", () => {
  it("tracks started runs", async () => {
    let runCount = 0;
    const mockHarness: CompiledHarness = {
      async createRun(input) {
        runCount++;
        const threadId = `run-${runCount}`;
        return {
          threadId,
          events: {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  return { value: undefined as any, done: true };
                },
              };
            },
          },
          result: Promise.resolve({
            status: "completed" as const,
            threadId,
            output: {},
          }),
        };
      },
      async resumeRun() {
        throw new Error("not needed");
      },
      async listRuns() {
        return [];
      },
      async shutdown() {},
    };

    const manager = new RunManager(mockHarness);
    const handle = await manager.startRun({ test: true });
    expect(handle.threadId).toBe("run-1");

    const handle2 = await manager.startRun({ test: true });
    expect(handle2.threadId).toBe("run-2");
  });

  it("shuts down cleanly", async () => {
    let shutdownCalled = false;
    const mockHarness: CompiledHarness = {
      async createRun() {
        throw new Error("not needed");
      },
      async resumeRun() {
        throw new Error("not needed");
      },
      async listRuns() {
        return [];
      },
      async shutdown() {
        shutdownCalled = true;
      },
    };

    const manager = new RunManager(mockHarness);
    await manager.shutdown();
    expect(shutdownCalled).toBe(true);
  });
});
