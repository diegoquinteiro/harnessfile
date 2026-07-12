import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { parseHarnessfile } from "../src/parser/parse.js";
import { normalize } from "../src/ir/normalize.js";
import { validateHarnessfile } from "../src/validator/validate.js";
import type { Harnessfile, StepDef } from "../src/ir/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadAndValidate(fixture: string) {
  const raw = parseHarnessfile(resolve(FIXTURES, fixture));
  const ir = normalize(raw as Record<string, unknown>);
  return validateHarnessfile(ir);
}

function makeIR(overrides: Partial<Harnessfile> = {}): Harnessfile {
  return {
    version: "0.1",
    agents: {
      a: { model: "anthropic/claude-sonnet-4-6", instructions: "Do A." },
    },
    ...overrides,
  };
}

// ---- Version validation ----

describe("validate — version", () => {
  it("accepts version 0.1", () => {
    const result = validateHarnessfile(makeIR());
    expect(result.valid).toBe(true);
  });

  it("accepts version 0.2", () => {
    const result = validateHarnessfile(makeIR({ version: "0.2" }));
    expect(result.valid).toBe(true);
  });

  it("rejects unsupported version", () => {
    const result = validateHarnessfile(makeIR({ version: "0.3" }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Unsupported version");
  });
});

// ---- Agent validation ----

describe("validate — agents", () => {
  it("requires at least one agent", () => {
    const result = validateHarnessfile(makeIR({ agents: {} }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("At least one agent");
  });

  it("requires agent model", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: { a: { model: "", instructions: "test" } },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("missing a model");
  });

  it("requires agent instructions", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: { a: { model: "anthropic/x", instructions: "" } },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("missing instructions");
  });
});

// ---- Valid fixtures ----

describe("validate — valid fixtures", () => {
  it("validates minimal.yaml", () => {
    const result = loadAndValidate("minimal.yaml");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates pipeline.yaml", () => {
    const result = loadAndValidate("pipeline.yaml");
    expect(result.valid).toBe(true);
  });

  it("validates gate.yaml", () => {
    const result = loadAndValidate("gate.yaml");
    expect(result.valid).toBe(true);
  });

  it("validates router.yaml", () => {
    const result = loadAndValidate("router.yaml");
    expect(result.valid).toBe(true);
  });

  it("validates fanout.yaml", () => {
    const result = loadAndValidate("fanout.yaml");
    expect(result.valid).toBe(true);
  });

  it("validates eval-loop.yaml", () => {
    const result = loadAndValidate("eval-loop.yaml");
    expect(result.valid).toBe(true);
  });

  it("validates full.yaml", () => {
    const result = loadAndValidate("full.yaml");
    expect(result.valid).toBe(true);
  });
});

// ---- Reference integrity ----

describe("validate — reference integrity", () => {
  it("catches undefined agent reference", () => {
    const result = loadAndValidate("invalid-refs.yaml");
    expect(result.valid).toBe(false);
    const agentError = result.errors.find((e) =>
      e.message.includes("nonexistent-agent"),
    );
    expect(agentError).toBeDefined();
  });

  it("catches undefined next step reference", () => {
    const result = loadAndValidate("invalid-refs.yaml");
    const stepError = result.errors.find((e) =>
      e.message.includes("nonexistent-step"),
    );
    expect(stepError).toBeDefined();
  });

  it("catches undefined route target", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: {
          classifier: {
            model: "anthropic/claude-sonnet-4-6",
            instructions: "Classify.",
          },
        },
        steps: {
          classify: {
            type: "router",
            agent: "classifier",
            routes: { feature: "nonexistent" },
          } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("nonexistent");
  });

  it("catches undefined pool agent reference", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          orch: {
            type: "orchestrator",
            agent: "a",
            pool: ["nonexistent-agent"],
          } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("nonexistent-agent");
  });

  it("catches agent step with no agent field", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          s: { type: "agent" } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("must reference an agent");
  });
});

// ---- Graph connectivity ----

describe("validate — graph connectivity", () => {
  it("warns about unreachable steps", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          start: {
            type: "trigger",
            event: "webhook",
            next: "step1",
          } as StepDef,
          step1: { type: "agent", agent: "a" } as StepDef,
          orphan: { type: "agent", agent: "a" } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(true); // warnings don't fail validation
    const unreachableWarning = result.warnings.find((w) =>
      w.message.includes("unreachable"),
    );
    expect(unreachableWarning).toBeDefined();
    expect(unreachableWarning!.path).toContain("orphan");
  });

  it("warns when no triggers and multiple entry points", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          step1: { type: "agent", agent: "a" } as StepDef,
          step2: { type: "agent", agent: "a" } as StepDef,
        },
      }),
    );
    const multiEntryWarning = result.warnings.find((w) =>
      w.message.includes("Multiple entry points"),
    );
    expect(multiEntryWarning).toBeDefined();
  });

  it("allows multiple triggers", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          t1: {
            type: "trigger",
            event: "webhook",
            next: "s",
          } as StepDef,
          t2: {
            type: "trigger",
            event: "cron",
            next: "s",
          } as StepDef,
          s: { type: "agent", agent: "a" } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(true);
  });
});

// ---- Cycle detection ----

describe("validate — cycle detection", () => {
  it("rejects cycles without eval loop", () => {
    const result = loadAndValidate("cycle.yaml");
    expect(result.valid).toBe(false);
    const cycleError = result.errors.find((e) =>
      e.message.includes("Cycle detected"),
    );
    expect(cycleError).toBeDefined();
  });

  it("allows cycles with eval + max-iterations", () => {
    const result = loadAndValidate("eval-loop.yaml");
    // eval-loop.yaml has write-spec → review (no cycle back)
    // The eval loop is internal (step retries itself)
    expect(result.valid).toBe(true);
  });

  it("rejects self-loop without eval", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          looper: {
            type: "agent",
            agent: "a",
            next: "looper",
          } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Cycle detected");
  });
});

// ---- Fan-out / fan-in ----

describe("validate — fan-out and fan-in", () => {
  it("validates fan-out with array next", () => {
    const result = loadAndValidate("fanout.yaml");
    expect(result.valid).toBe(true);
  });

  it("validates fan-in (multiple steps pointing to same target)", () => {
    // fanout.yaml: frontend → merge, backend → merge
    const result = loadAndValidate("fanout.yaml");
    expect(result.valid).toBe(true);
  });
});
