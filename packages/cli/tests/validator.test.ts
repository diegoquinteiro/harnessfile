import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadHarnessDirectory } from "../src/parser/directory.js";
import { validateHarnessfile } from "../src/validator/validate.js";
import type { Harnessfile, StepDef } from "../src/ir/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadAndValidate(fixture: string) {
  const { ir } = loadHarnessDirectory(resolve(FIXTURES, fixture));
  return validateHarnessfile(ir);
}

function makeIR(overrides: Partial<Harnessfile> = {}): Harnessfile {
  return {
    version: "0.2",
    name: "test",
    agents: {
      a: {
        name: "a",
        description: "Does A.",
        model: "anthropic/claude-sonnet-4-6",
        instructions: "Do A.",
      },
    },
    ...overrides,
  };
}

// ---- Version validation ----

describe("validate — version", () => {
  it("accepts version 0.2", () => {
    const result = validateHarnessfile(makeIR());
    expect(result.valid).toBe(true);
  });

  it("rejects version 0.1", () => {
    const result = validateHarnessfile(makeIR({ version: "0.1" }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Unsupported version");
  });
});

// ---- Name validation ----

describe("validate — name", () => {
  it("requires a harness name", () => {
    const result = validateHarnessfile(makeIR({ name: undefined }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("name is required");
  });
});

// ---- Agent validation ----

describe("validate — agents", () => {
  it("requires at least one agent", () => {
    const result = validateHarnessfile(makeIR({ agents: {} }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("At least one agent");
  });

  it("requires agent description", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: { a: { name: "a", instructions: "test" } },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("missing a description");
  });

  it("requires agent instructions", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: { a: { name: "a", description: "d", instructions: "" } },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("missing instructions");
  });

  it("does not require a model (portable default is optional)", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: { a: { name: "a", description: "d", instructions: "x" } },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("errors when an agent references a missing skill", () => {
    const result = validateHarnessfile(
      makeIR({
        skills: ["existing"],
        agents: {
          a: {
            name: "a",
            description: "d",
            instructions: "x",
            skills: ["existing", "ghost"],
          },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain(
      "skill 'ghost' with no skills/ghost/SKILL.md",
    );
  });

  it("accepts skills that resolve to skills/<name>/SKILL.md", () => {
    const result = loadAndValidate("full");
    expect(result.valid).toBe(true);
  });
});

// ---- Squad validation ----

describe("validate — squads", () => {
  const baseAgents = {
    pm: { name: "pm", description: "PM.", instructions: "Lead." },
    dev: { name: "dev", description: "Dev.", instructions: "Build." },
  };

  it("validates the squad fixture", () => {
    const result = loadAndValidate("squad");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("errors when leader is not a defined agent", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: baseAgents,
        squads: {
          s: {
            leader: "ghost",
            members: [{ agent: "pm" }],
            instructions: "x",
          },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("leader 'ghost'")),
    ).toBe(true);
  });

  it("errors when a member is not a defined agent", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: baseAgents,
        squads: {
          s: {
            leader: "pm",
            members: [{ agent: "pm" }, { agent: "ghost" }],
            instructions: "x",
          },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("member 'ghost'")),
    ).toBe(true);
  });

  it("errors when the leader is not in members", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: baseAgents,
        squads: {
          s: {
            leader: "pm",
            members: [{ agent: "dev" }],
            instructions: "x",
          },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.message.includes("must also appear in members"),
      ),
    ).toBe(true);
  });

  it("errors when a squad has no members", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: baseAgents,
        squads: {
          s: { leader: "pm", members: [], instructions: "x" },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("no members"))).toBe(
      true,
    );
  });

  it("errors when a step references an undefined squad", () => {
    const result = loadAndValidate("invalid-refs");
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.message.includes("undefined squad 'nonexistent-squad'"),
      ),
    ).toBe(true);
  });

  it("errors when a step declares both agent and squad", () => {
    const result = validateHarnessfile(
      makeIR({
        agents: baseAgents,
        squads: {
          s: {
            leader: "pm",
            members: [{ agent: "pm" }],
            instructions: "x",
          },
        },
        steps: {
          both: { type: "squad", agent: "pm", squad: "s" } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("both agent and squad")),
    ).toBe(true);
  });
});

// ---- Target validation ----

describe("validate — targets", () => {
  it("validates known targets", () => {
    const result = loadAndValidate("targets");
    expect(result.valid).toBe(true);
  });

  it("errors when a target has no provider", () => {
    const result = validateHarnessfile(
      makeIR({
        targets: { t: {} },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("missing a provider");
  });

  it("warns on unknown owned fields", () => {
    const result = loadAndValidate("targets");
    const warning = result.warnings.find((w) =>
      w.message.includes("flux-capacitor"),
    );
    expect(warning).toBeDefined();
    expect(warning!.path).toBe("targets.bad-owns.owns");
  });

  it("accepts the known owned field names", () => {
    const result = validateHarnessfile(
      makeIR({
        targets: {
          t: {
            provider: "multica/v1",
            owns: ["model", "runtime", "concurrency", "env", "mcp", "tools"],
          },
        },
      }),
    );
    expect(result.warnings.filter((w) => w.path.includes("owns"))).toHaveLength(
      0,
    );
  });
});

// ---- Scheduled triggers ----

describe("validate — scheduled triggers", () => {
  it("validates the scheduled-trigger fixture", () => {
    const result = loadAndValidate("scheduled-trigger");
    expect(result.valid).toBe(true);
  });

  it("errors when a scheduled trigger has no next", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          sweep: {
            type: "trigger",
            schedule: "0 * * * *",
            prompt: "go",
          } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("must declare a next step")),
    ).toBe(true);
  });
});

// ---- Orchestrator deprecation ----

describe("validate — orchestrator superseded", () => {
  it("warns that orchestrator is superseded by squads", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          orch: { type: "orchestrator", agent: "a", pool: ["a"] } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(true);
    expect(
      result.warnings.some((w) =>
        w.message.includes("superseded by squads in v0.2"),
      ),
    ).toBe(true);
  });
});

// ---- Valid fixtures ----

describe("validate — valid fixtures", () => {
  for (const fixture of [
    "minimal",
    "pipeline",
    "gate",
    "router",
    "fanout",
    "eval-loop",
    "full",
    "squad",
    "scheduled-trigger",
    "targets",
  ]) {
    it(`validates ${fixture}`, () => {
      const result = loadAndValidate(fixture);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});

// ---- Reference integrity ----

describe("validate — reference integrity", () => {
  it("catches undefined agent reference", () => {
    const result = loadAndValidate("invalid-refs");
    expect(result.valid).toBe(false);
    const agentError = result.errors.find((e) =>
      e.message.includes("nonexistent-agent"),
    );
    expect(agentError).toBeDefined();
  });

  it("catches undefined next step reference", () => {
    const result = loadAndValidate("invalid-refs");
    const stepError = result.errors.find((e) =>
      e.message.includes("nonexistent-step"),
    );
    expect(stepError).toBeDefined();
  });

  it("catches undefined skill reference", () => {
    const result = loadAndValidate("invalid-refs");
    const skillError = result.errors.find((e) =>
      e.message.includes("nonexistent-skill"),
    );
    expect(skillError).toBeDefined();
  });

  it("catches undefined route target", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          classify: {
            type: "router",
            agent: "a",
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

  it("catches squad step with no squad field", () => {
    const result = validateHarnessfile(
      makeIR({
        steps: {
          s: { type: "squad" } as StepDef,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("must reference a squad");
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
    const result = loadAndValidate("cycle");
    expect(result.valid).toBe(false);
    const cycleError = result.errors.find((e) =>
      e.message.includes("Cycle detected"),
    );
    expect(cycleError).toBeDefined();
  });

  it("allows internal eval loops", () => {
    const result = loadAndValidate("eval-loop");
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
    const result = loadAndValidate("fanout");
    expect(result.valid).toBe(true);
  });
});
