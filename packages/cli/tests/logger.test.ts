import { describe, it, expect, vi, beforeEach } from "vitest";
import { logEvent, logInfo, logWarn, logError } from "../src/runtime/logger.js";
import type { HarnessEvent } from "../src/providers/interface.js";

function makeEvent(
  overrides: Partial<HarnessEvent> = {},
): HarnessEvent {
  return {
    type: "run-start",
    threadId: "abcdef12-3456-7890-abcd-ef1234567890",
    timestamp: new Date("2026-01-01T12:00:00Z"),
    ...overrides,
  };
}

describe("logEvent", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args.join(" "));
    });
  });

  it("logs run-start event", () => {
    logEvent(makeEvent({ type: "run-start" }));
    expect(logged[0]).toContain("Run started");
    expect(logged[0]).toContain("abcdef12");
  });

  it("logs run-end event", () => {
    logEvent(makeEvent({ type: "run-end" }));
    expect(logged[0]).toContain("Run ended");
  });

  it("logs step-start event", () => {
    logEvent(makeEvent({ type: "step-start", step: "research" }));
    expect(logged[0]).toContain("research");
  });

  it("logs step-end event", () => {
    logEvent(makeEvent({ type: "step-end", step: "research" }));
    expect(logged[0]).toContain("research");
  });

  it("logs step-error event", () => {
    logEvent(
      makeEvent({ type: "step-error", step: "research", data: "timeout" }),
    );
    expect(logged[0]).toContain("research");
    expect(logged[0]).toContain("timeout");
  });

  it("logs gate-pending event with resume hint", () => {
    logEvent(
      makeEvent({
        type: "gate-pending",
        step: "review",
        threadId: "abcdef12-3456-7890-abcd-ef1234567890",
      }),
    );
    expect(logged[0]).toContain("Gate suspended");
    expect(logged[0]).toContain("review");
    expect(logged[1]).toContain("/gate/");
  });

  it("logs gate-resolved event", () => {
    logEvent(makeEvent({ type: "gate-resolved", step: "review" }));
    expect(logged[0]).toContain("Gate approved");
  });

  it("logs eval event", () => {
    logEvent(makeEvent({ type: "eval", step: "write-spec" }));
    expect(logged[0]).toContain("Eval");
    expect(logged[0]).toContain("write-spec");
  });

  it("logs hook event", () => {
    logEvent(makeEvent({ type: "hook", step: "after-step" }));
    expect(logged[0]).toContain("Hook");
  });
});

describe("logInfo / logWarn / logError", () => {
  it("logInfo outputs with checkmark", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("test message");
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(lastCall).toContain("test message");
    spy.mockRestore();
  });

  it("logWarn outputs with warning", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logWarn("warn message");
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(lastCall).toContain("warn message");
    spy.mockRestore();
  });

  it("logError outputs to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("error message");
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(lastCall).toContain("error message");
    spy.mockRestore();
  });
});
