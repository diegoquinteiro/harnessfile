import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadHarnessDirectory } from "../src/parser/directory.js";
import { buildStateAnnotation } from "../src/providers/langgraph/state-builder.js";
import {
  buildNodeFunctions,
  parseLeaderDecision,
} from "../src/providers/langgraph/node-builder.js";
import { LangGraphProvider } from "../src/providers/langgraph/index.js";
import { getProvider, listProviders } from "../src/providers/registry.js";
import type { Harnessfile, StepDef } from "../src/ir/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadIR(fixture: string): Harnessfile {
  return loadHarnessDirectory(resolve(FIXTURES, fixture)).ir;
}

// ---- Provider registry ----

describe("provider registry", () => {
  it("lists langgraph provider", () => {
    expect(listProviders()).toContain("langgraph");
  });

  it("returns langgraph provider by name", () => {
    const provider = getProvider("langgraph");
    expect(provider.name).toBe("langgraph");
    expect(provider.displayName).toBe("LangGraph (TypeScript)");
  });

  it("throws for unknown provider", () => {
    expect(() => getProvider("nonexistent")).toThrow("Unknown provider");
  });
});

// ---- State builder ----

describe("buildStateAnnotation", () => {
  it("builds state for minimal harness", () => {
    const ir = loadIR("minimal");
    const state = buildStateAnnotation(ir);
    expect(state).toBeDefined();
    expect(state.spec).toBeDefined();
  });

  it("builds state for harness with steps", () => {
    const ir = loadIR("pipeline");
    const state = buildStateAnnotation(ir);
    expect(state).toBeDefined();
  });

  it("builds state for harness with output schemas", () => {
    const ir = loadIR("full");
    const state = buildStateAnnotation(ir);
    expect(state).toBeDefined();
  });
});

// ---- Node builder ----

describe("buildNodeFunctions", () => {
  it("returns empty map for harness without steps", () => {
    const ir = loadIR("minimal");
    const nodes = buildNodeFunctions(ir);
    expect(nodes.size).toBe(0);
  });

  it("builds nodes for pipeline steps", () => {
    const ir = loadIR("pipeline");
    const nodes = buildNodeFunctions(ir);
    expect(nodes.size).toBe(3); // start, research, write
    expect(nodes.has("start")).toBe(true);
    expect(nodes.has("research")).toBe(true);
    expect(nodes.has("write")).toBe(true);
  });

  it("builds nodes for all step types", () => {
    const ir = loadIR("full");
    const nodes = buildNodeFunctions(ir);
    expect(nodes.has("trigger")).toBe(true); // trigger
    expect(nodes.has("classify")).toBe(true); // router
    expect(nodes.has("review")).toBe(true); // gate
    expect(nodes.has("write")).toBe(true); // agent
    expect(nodes.has("done")).toBe(true); // output
  });

  it("builds a squad node", () => {
    const ir = loadIR("squad");
    const nodes = buildNodeFunctions(ir);
    expect(nodes.has("dev-squad")).toBe(true);
  });

  it("trigger node returns current step", async () => {
    const ir = loadIR("pipeline");
    const nodes = buildNodeFunctions(ir);
    const triggerFn = nodes.get("start")!;
    const result = await triggerFn({
      messages: [],
      _currentStep: "",
      _stepOutputs: {},
      _evalIterations: {},
      _triggerData: {},
    });
    expect(result._currentStep).toBe("start");
  });

  it("output node extracts fields from state", async () => {
    const ir = loadIR("full");
    const nodes = buildNodeFunctions(ir);
    const outputFn = nodes.get("done")!;
    const result = await outputFn({
      messages: [],
      _currentStep: "",
      _stepOutputs: { report: "test report" },
      _evalIterations: {},
      _triggerData: {},
    });
    expect(result._currentStep).toBe("done");
  });

  it("throws when agent step references missing agent", () => {
    const ir: Harnessfile = {
      version: "0.2",
      name: "x",
      agents: {},
      steps: {
        s: { type: "agent", agent: "missing" } as StepDef,
      },
    };
    expect(() => buildNodeFunctions(ir)).toThrow(
      "must reference an agent",
    );
  });

  it("throws when router step has no agent", () => {
    const ir: Harnessfile = {
      version: "0.2",
      name: "x",
      agents: {},
      steps: {
        r: { type: "router", routes: { a: "b" } } as StepDef,
      },
    };
    expect(() => buildNodeFunctions(ir)).toThrow(
      "must reference an agent",
    );
  });

  it("throws when squad step references missing squad", () => {
    const ir: Harnessfile = {
      version: "0.2",
      name: "x",
      agents: {},
      steps: {
        s: { type: "squad", squad: "missing" } as StepDef,
      },
    };
    expect(() => buildNodeFunctions(ir)).toThrow("must reference a squad");
  });
});

// ---- Leader decision parsing ----

describe("parseLeaderDecision", () => {
  it("parses a bare dispatch object", () => {
    expect(
      parseLeaderDecision(
        '{"action": "dispatch", "member": "researcher", "instruction": "dig in"}',
      ),
    ).toEqual({ action: "dispatch", member: "researcher", instruction: "dig in" });
  });

  it("parses a done object", () => {
    expect(parseLeaderDecision('{"action": "done", "summary": "shipped"}'))
      .toEqual({ action: "done", summary: "shipped" });
  });

  it("parses JSON inside a fenced code block", () => {
    const content =
      'Here you go:\n```json\n{"action": "done", "summary": "ok"}\n```';
    expect(parseLeaderDecision(content)).toEqual({
      action: "done",
      summary: "ok",
    });
  });

  it("parses the first brace block in prose", () => {
    const content =
      'I will dispatch. {"action": "dispatch", "member": "engineer", "instruction": "build"} Thanks.';
    expect(parseLeaderDecision(content)).toEqual({
      action: "dispatch",
      member: "engineer",
      instruction: "build",
    });
  });

  it("returns null for non-JSON prose", () => {
    expect(parseLeaderDecision("I think we should research first.")).toBeNull();
  });

  it("returns null for JSON without a valid action", () => {
    expect(parseLeaderDecision('{"foo": "bar"}')).toBeNull();
  });
});

// ---- LangGraph provider validate ----

describe("LangGraphProvider.validate", () => {
  const provider = new LangGraphProvider();

  it("validates minimal harness", () => {
    const ir = loadIR("minimal");
    const result = provider.validate(ir);
    expect(result.valid).toBe(true);
  });

  it("validates pipeline harness", () => {
    const ir = loadIR("pipeline");
    const result = provider.validate(ir);
    expect(result.valid).toBe(true);
  });

  it("validates squad harness", () => {
    const ir = loadIR("squad");
    const result = provider.validate(ir);
    expect(result.valid).toBe(true);
  });

  it("accepts opaque runtime-specific model names", () => {
    const ir: Harnessfile = {
      version: "0.2",
      name: "x",
      runtimes: { claude: { protocol: "claude-code/v1" } },
      agents: {
        a: { name: "a", description: "d", runtime: "claude", model: "no-slash", instructions: "test" },
      },
    };
    const result = provider.validate(ir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("warns on missing runtime profile", () => {
    const ir: Harnessfile = {
      version: "0.2",
      name: "x",
      agents: {
        a: { name: "a", description: "d", instructions: "test" },
      },
    };
    const result = provider.validate(ir);
    expect(result.valid).toBe(true);
    expect(result.warnings[0].message).toContain("no portable runtime profile");
  });

  it("errors when a locally executed agent has no runtime profile", () => {
    const ir: Harnessfile = {
      version: "0.2",
      name: "x",
      agents: { a: { name: "a", description: "d", instructions: "test" } },
      steps: { run: { type: "agent", agent: "a" } },
    };
    const result = provider.validate(ir);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("no portable runtime profile");
  });

  it("warns on unsupported local runtime protocol", () => {
    const ir: Harnessfile = {
      version: "0.2",
      name: "x",
      runtimes: { gemini: { protocol: "gemini-cli/v1" } },
      agents: {
        a: { name: "a", description: "d", runtime: "gemini", model: "gemini-pro", instructions: "test" },
      },
    };
    const result = provider.validate(ir);
    expect(result.valid).toBe(true); // warning, not error
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("no built-in local driver");
  });

  it("errors on squad step referencing an undefined squad", () => {
    const ir: Harnessfile = {
      version: "0.2",
      name: "x",
      runtimes: { claude: { protocol: "claude-code/v1" } },
      agents: {
        a: { name: "a", description: "d", runtime: "claude", model: "x", instructions: "t" },
      },
      steps: {
        s: { type: "squad", squad: "ghost" } as StepDef,
      },
    };
    const result = provider.validate(ir);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("undefined squad 'ghost'");
  });
});

// ---- LangGraph provider compile ----

describe("LangGraphProvider.compile", () => {
  const provider = new LangGraphProvider();

  it("compiles a pipeline harness", async () => {
    const ir = loadIR("pipeline");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    expect(compiled).toBeDefined();
    expect(typeof compiled.createRun).toBe("function");
    expect(typeof compiled.resumeRun).toBe("function");
    expect(typeof compiled.listRuns).toBe("function");
    expect(typeof compiled.shutdown).toBe("function");
  });

  it("compiles a gate harness", async () => {
    const ir = loadIR("gate");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    expect(compiled).toBeDefined();
  });

  it("compiles a router harness", async () => {
    const ir = loadIR("router");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    expect(compiled).toBeDefined();
  });

  it("compiles a fanout harness", async () => {
    const ir = loadIR("fanout");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    expect(compiled).toBeDefined();
  });

  it("compiles a squad harness", async () => {
    const ir = loadIR("squad");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    expect(compiled).toBeDefined();
  });

  it("compiled harness starts with empty run list", async () => {
    const ir = loadIR("pipeline");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    const runs = await compiled.listRuns();
    expect(runs).toHaveLength(0);
  });

  it("compiled harness shuts down cleanly", async () => {
    const ir = loadIR("pipeline");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    await expect(compiled.shutdown()).resolves.toBeUndefined();
  });
});
