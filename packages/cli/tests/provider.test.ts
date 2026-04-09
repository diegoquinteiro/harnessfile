import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { parseHarnessfile } from "../src/parser/parse.js";
import { normalize } from "../src/ir/normalize.js";
import { createChatModel } from "../src/providers/langgraph/model-factory.js";
import { buildStateAnnotation } from "../src/providers/langgraph/state-builder.js";
import { buildNodeFunctions } from "../src/providers/langgraph/node-builder.js";
import { LangGraphProvider } from "../src/providers/langgraph/index.js";
import { getProvider, listProviders } from "../src/providers/registry.js";
import type { Harnessfile, StepDef } from "../src/ir/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadIR(fixture: string): Harnessfile {
  const raw = parseHarnessfile(resolve(FIXTURES, fixture));
  return normalize(raw as Record<string, unknown>);
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

// ---- Model factory ----

describe("createChatModel", () => {
  it("creates ChatAnthropic for anthropic/ prefix", () => {
    const model = createChatModel("anthropic/claude-sonnet-4-6");
    expect(model).toBeDefined();
    // Check it's an Anthropic model by examining constructor name
    expect(model.constructor.name).toBe("ChatAnthropic");
  });

  it("creates ChatOpenAI for openai/ prefix", () => {
    const model = createChatModel("openai/gpt-4");
    expect(model).toBeDefined();
    expect(model.constructor.name).toBe("ChatOpenAI");
  });

  it("throws for model without slash", () => {
    expect(() => createChatModel("no-slash")).toThrow(
      "Expected 'provider/model-name'",
    );
  });

  it("throws for unsupported provider", () => {
    expect(() => createChatModel("google/gemini-pro")).toThrow(
      "Unsupported model provider",
    );
  });
});

// ---- State builder ----

describe("buildStateAnnotation", () => {
  it("builds state for minimal harness", () => {
    const ir = loadIR("minimal.yaml");
    const state = buildStateAnnotation(ir);
    expect(state).toBeDefined();
    expect(state.spec).toBeDefined();
  });

  it("builds state for harness with steps", () => {
    const ir = loadIR("pipeline.yaml");
    const state = buildStateAnnotation(ir);
    expect(state).toBeDefined();
  });

  it("builds state for harness with output schemas", () => {
    const ir = loadIR("full.yaml");
    const state = buildStateAnnotation(ir);
    expect(state).toBeDefined();
  });
});

// ---- Node builder ----

describe("buildNodeFunctions", () => {
  it("returns empty map for harness without steps", () => {
    const ir = loadIR("minimal.yaml");
    const nodes = buildNodeFunctions(ir);
    expect(nodes.size).toBe(0);
  });

  it("builds nodes for pipeline steps", () => {
    const ir = loadIR("pipeline.yaml");
    const nodes = buildNodeFunctions(ir);
    expect(nodes.size).toBe(3); // start, research, write
    expect(nodes.has("start")).toBe(true);
    expect(nodes.has("research")).toBe(true);
    expect(nodes.has("write")).toBe(true);
  });

  it("builds nodes for all step types", () => {
    const ir = loadIR("full.yaml");
    const nodes = buildNodeFunctions(ir);
    expect(nodes.has("trigger")).toBe(true); // trigger
    expect(nodes.has("classify")).toBe(true); // router
    expect(nodes.has("review")).toBe(true); // gate
    expect(nodes.has("write")).toBe(true); // agent
    expect(nodes.has("done")).toBe(true); // output
  });

  it("trigger node returns current step", async () => {
    const ir = loadIR("pipeline.yaml");
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
    const ir = loadIR("full.yaml");
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
      version: "0.1",
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
      version: "0.1",
      agents: {},
      steps: {
        r: { type: "router", routes: { a: "b" } } as StepDef,
      },
    };
    expect(() => buildNodeFunctions(ir)).toThrow(
      "must reference an agent",
    );
  });

  it("throws when orchestrator step has no agent", () => {
    const ir: Harnessfile = {
      version: "0.1",
      agents: {},
      steps: {
        o: { type: "orchestrator", pool: ["a"] } as StepDef,
      },
    };
    expect(() => buildNodeFunctions(ir)).toThrow(
      "must reference an agent",
    );
  });
});

// ---- LangGraph provider validate ----

describe("LangGraphProvider.validate", () => {
  const provider = new LangGraphProvider();

  it("validates minimal harness", () => {
    const ir = loadIR("minimal.yaml");
    const result = provider.validate(ir);
    expect(result.valid).toBe(true);
  });

  it("validates pipeline harness", () => {
    const ir = loadIR("pipeline.yaml");
    const result = provider.validate(ir);
    expect(result.valid).toBe(true);
  });

  it("validates full harness", () => {
    const ir = loadIR("full.yaml");
    const result = provider.validate(ir);
    expect(result.valid).toBe(true);
  });

  it("errors on invalid model format", () => {
    const ir: Harnessfile = {
      version: "0.1",
      agents: {
        a: { model: "no-slash", instructions: "test" },
      },
    };
    const result = provider.validate(ir);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("provider/model-name");
  });

  it("warns on unsupported model provider", () => {
    const ir: Harnessfile = {
      version: "0.1",
      agents: {
        a: { model: "google/gemini-pro", instructions: "test" },
      },
    };
    const result = provider.validate(ir);
    expect(result.valid).toBe(true); // warning, not error
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("may not be supported");
  });
});

// ---- LangGraph provider compile ----

describe("LangGraphProvider.compile", () => {
  const provider = new LangGraphProvider();

  it("compiles a pipeline harness", async () => {
    const ir = loadIR("pipeline.yaml");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    expect(compiled).toBeDefined();
    expect(typeof compiled.createRun).toBe("function");
    expect(typeof compiled.resumeRun).toBe("function");
    expect(typeof compiled.listRuns).toBe("function");
    expect(typeof compiled.shutdown).toBe("function");
  });

  it("compiles a gate harness", async () => {
    const ir = loadIR("gate.yaml");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    expect(compiled).toBeDefined();
  });

  it("compiles a router harness", async () => {
    const ir = loadIR("router.yaml");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    expect(compiled).toBeDefined();
  });

  it("compiles a fanout harness", async () => {
    const ir = loadIR("fanout.yaml");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    expect(compiled).toBeDefined();
  });

  it("compiled harness starts with empty run list", async () => {
    const ir = loadIR("pipeline.yaml");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    const runs = await compiled.listRuns();
    expect(runs).toHaveLength(0);
  });

  it("compiled harness shuts down cleanly", async () => {
    const ir = loadIR("pipeline.yaml");
    const compiled = await provider.compile(ir, { checkpointer: "memory" });
    await expect(compiled.shutdown()).resolves.toBeUndefined();
  });
});
