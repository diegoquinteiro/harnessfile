import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { loadHarnessDirectory } from "../src/parser/directory.js";
import { RunManager } from "../src/runtime/run-manager.js";
import { TriggerListener } from "../src/runtime/trigger-listener.js";
import { GateResolver } from "../src/runtime/gate-resolver.js";
import { cronMatches, minuteKey, parseCronExpression } from "../src/runtime/cron.js";
import type { Harnessfile } from "../src/ir/types.js";
import type { CompiledHarness, RunHandle } from "../src/providers/interface.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadIR(fixture: string): Harnessfile {
  return loadHarnessDirectory(resolve(FIXTURES, fixture)).ir;
}

function makeRecordingHarness(runs: Array<{ threadId: string; input: any }>): CompiledHarness {
  return {
    async createRun(input) {
      const threadId = `run-${runs.length + 1}`;
      runs.push({ threadId, input });
      const handle: RunHandle = {
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
      return handle;
    },
    async resumeRun() {
      throw new Error("not needed");
    },
    async listRuns() {
      return [];
    },
    async shutdown() {},
  };
}

// ---- Cron matcher ----

describe("cron matcher", () => {
  // 2026-07-08 is a Wednesday
  const wed1030 = new Date(2026, 6, 8, 10, 30, 0);

  it("matches wildcard expression", () => {
    expect(cronMatches("* * * * *", wed1030)).toBe(true);
  });

  it("matches exact minute and hour", () => {
    expect(cronMatches("30 10 * * *", wed1030)).toBe(true);
    expect(cronMatches("31 10 * * *", wed1030)).toBe(false);
    expect(cronMatches("30 11 * * *", wed1030)).toBe(false);
  });

  it("matches hourly (0 * * * *) only at minute zero", () => {
    expect(cronMatches("0 * * * *", new Date(2026, 6, 8, 10, 0, 0))).toBe(true);
    expect(cronMatches("0 * * * *", wed1030)).toBe(false);
  });

  it("matches step values", () => {
    expect(cronMatches("*/15 * * * *", new Date(2026, 6, 8, 10, 45, 0))).toBe(true);
    expect(cronMatches("*/15 * * * *", new Date(2026, 6, 8, 10, 50, 0))).toBe(false);
  });

  it("matches ranges and lists", () => {
    expect(cronMatches("30 9-11 * * *", wed1030)).toBe(true);
    expect(cronMatches("30 12-14 * * *", wed1030)).toBe(false);
    expect(cronMatches("15,30,45 * * * *", wed1030)).toBe(true);
    expect(cronMatches("15,45 * * * *", wed1030)).toBe(false);
  });

  it("matches ranges with steps", () => {
    expect(cronMatches("0-58/2 * * * *", wed1030)).toBe(true);
    expect(cronMatches("1-59/2 * * * *", wed1030)).toBe(false);
  });

  it("matches day of month and month", () => {
    expect(cronMatches("30 10 8 7 *", wed1030)).toBe(true);
    expect(cronMatches("30 10 9 7 *", wed1030)).toBe(false);
    expect(cronMatches("30 10 * 8 *", wed1030)).toBe(false);
  });

  it("matches day of week, with 7 as Sunday", () => {
    expect(cronMatches("30 10 * * 3", wed1030)).toBe(true); // Wednesday
    expect(cronMatches("30 10 * * 0", wed1030)).toBe(false);
    const sunday = new Date(2026, 6, 12, 10, 30, 0);
    expect(cronMatches("30 10 * * 0", sunday)).toBe(true);
    expect(cronMatches("30 10 * * 7", sunday)).toBe(true);
  });

  it("evaluates in the trigger timezone", () => {
    // 12:00 UTC == 09:00 America/Sao_Paulo (UTC-3)
    const noonUtc = new Date(Date.UTC(2026, 6, 8, 12, 0, 0));
    expect(cronMatches("0 9 * * *", noonUtc, "America/Sao_Paulo")).toBe(true);
    expect(cronMatches("0 12 * * *", noonUtc, "America/Sao_Paulo")).toBe(false);
    expect(cronMatches("0 12 * * *", noonUtc, "UTC")).toBe(true);
  });

  it("rejects malformed expressions", () => {
    expect(() => parseCronExpression("0 * * *")).toThrow("expected 5 fields");
    expect(() => cronMatches("99 * * * *", wed1030)).toThrow("out of range");
    expect(() => cronMatches("x * * * *", wed1030)).toThrow("Invalid cron");
  });

  it("computes stable minute keys per timezone", () => {
    const a = new Date(Date.UTC(2026, 6, 8, 12, 0, 10));
    const b = new Date(Date.UTC(2026, 6, 8, 12, 0, 50));
    const c = new Date(Date.UTC(2026, 6, 8, 12, 1, 5));
    expect(minuteKey(a, "UTC")).toBe(minuteKey(b, "UTC"));
    expect(minuteKey(a, "UTC")).not.toBe(minuteKey(c, "UTC"));
  });
});

// ---- TriggerListener ----

describe("TriggerListener", () => {
  it("detects triggers in the harness", () => {
    const ir = loadIR("pipeline");
    const listener = new TriggerListener(ir, null as any);
    expect(listener.hasTriggers()).toBe(true);
  });

  it("detects scheduled triggers", () => {
    const ir = loadIR("scheduled-trigger");
    const listener = new TriggerListener(ir, null as any);
    expect(listener.hasTriggers()).toBe(true);
  });

  it("detects no triggers in minimal harness", () => {
    const ir = loadIR("minimal");
    const listener = new TriggerListener(ir, null as any);
    expect(listener.hasTriggers()).toBe(false);
  });

  it("detects no triggers in fanout harness", () => {
    const ir = loadIR("fanout");
    const listener = new TriggerListener(ir, null as any);
    expect(listener.hasTriggers()).toBe(false);
  });
});

// ---- Scheduled trigger firing ----

describe("TriggerListener — scheduled triggers", () => {
  it("fires a scheduled trigger with the resolved prompt as run input", async () => {
    const ir = loadIR("scheduled-trigger");
    const runs: Array<{ threadId: string; input: any }> = [];
    const manager = new RunManager(makeRecordingHarness(runs));
    const listener = new TriggerListener(ir, manager);

    // 06:00 America/Sao_Paulo == 09:00 UTC — matches "0 * * * *"
    const topOfHour = new Date(Date.UTC(2026, 6, 8, 9, 0, 0));
    const fired = await listener.checkScheduledTriggers(topOfHour);

    expect(fired).toContain("hourly-sweep");
    const run = runs.find((r) => r.input.trigger === "hourly-sweep");
    expect(run).toBeDefined();
    expect(run!.input.scheduled).toBe(true);
    expect(run!.input.prompt).toContain("Run a triage sweep now.");
  });

  it("fires the inline-prompt trigger with the inline text", async () => {
    const ir = loadIR("scheduled-trigger");
    const runs: Array<{ threadId: string; input: any }> = [];
    const manager = new RunManager(makeRecordingHarness(runs));
    const listener = new TriggerListener(ir, manager);

    const fiveMinuteMark = new Date(Date.UTC(2026, 6, 8, 9, 5, 0));
    const fired = await listener.checkScheduledTriggers(fiveMinuteMark);

    expect(fired).toEqual(["inline-sweep"]);
    expect(runs[0].input.prompt).toBe("Run a quick inline sweep.");
  });

  it("fires only once per matching minute", async () => {
    const ir = loadIR("scheduled-trigger");
    const runs: Array<{ threadId: string; input: any }> = [];
    const manager = new RunManager(makeRecordingHarness(runs));
    const listener = new TriggerListener(ir, manager);

    const t0 = new Date(Date.UTC(2026, 6, 8, 9, 0, 0));
    const t1 = new Date(Date.UTC(2026, 6, 8, 9, 0, 30));
    await listener.checkScheduledTriggers(t0);
    await listener.checkScheduledTriggers(t1);

    const hourlyRuns = runs.filter((r) => r.input.trigger === "hourly-sweep");
    expect(hourlyRuns).toHaveLength(1);

    // Next hour fires again
    const t2 = new Date(Date.UTC(2026, 6, 8, 10, 0, 0));
    await listener.checkScheduledTriggers(t2);
    expect(
      runs.filter((r) => r.input.trigger === "hourly-sweep"),
    ).toHaveLength(2);
  });

  it("does not fire when the cron does not match", async () => {
    const ir = loadIR("scheduled-trigger");
    const runs: Array<{ threadId: string; input: any }> = [];
    const manager = new RunManager(makeRecordingHarness(runs));
    const listener = new TriggerListener(ir, manager);

    const offSchedule = new Date(Date.UTC(2026, 6, 8, 9, 7, 0));
    const fired = await listener.checkScheduledTriggers(offSchedule);
    expect(fired).toEqual([]);
    expect(runs).toHaveLength(0);
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
    const ir = loadIR("pipeline");

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
