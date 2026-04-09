import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { parseHarnessfile } from "../src/parser/parse.js";
import { normalize } from "../src/ir/normalize.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadAndNormalize(fixture: string) {
  const raw = parseHarnessfile(resolve(FIXTURES, fixture));
  return normalize(raw as Record<string, unknown>);
}

// ---- Basic normalization ----

describe("normalize — basics", () => {
  it("normalizes a minimal harnessfile", () => {
    const ir = loadAndNormalize("minimal.yaml");
    expect(ir.version).toBe("0.1");
    expect(ir.agents["my-agent"].model).toBe("anthropic/claude-sonnet-4-6");
    expect(ir.agents["my-agent"].instructions).toBe("Do something useful.");
    expect(ir.steps).toBeUndefined();
  });

  it("normalizes the name field", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.name).toBe("test-pipeline");
  });

  it("requires version field", () => {
    expect(() => normalize({ agents: {} })).toThrow("harnessfile version");
  });

  it("requires agents map", () => {
    expect(() => normalize({ harnessfile: "0.1" })).toThrow("agents map");
  });

  it("requires agent model", () => {
    expect(() =>
      normalize({
        harnessfile: "0.1",
        agents: { a: { instructions: "test" } },
      }),
    ).toThrow("model");
  });

  it("requires agent instructions", () => {
    expect(() =>
      normalize({
        harnessfile: "0.1",
        agents: { a: { model: "anthropic/test" } },
      }),
    ).toThrow("instructions");
  });
});

// ---- Step type inference ----

describe("normalize — step type inference", () => {
  it("infers trigger from event field", () => {
    const ir = loadAndNormalize("pipeline.yaml");
    expect(ir.steps!["start"].type).toBe("trigger");
  });

  it("infers agent type for steps with agent field", () => {
    const ir = loadAndNormalize("pipeline.yaml");
    expect(ir.steps!["research"].type).toBe("agent");
    expect(ir.steps!["write"].type).toBe("agent");
  });

  it("infers gate from approve field", () => {
    const ir = loadAndNormalize("gate.yaml");
    expect(ir.steps!["review"].type).toBe("gate");
  });

  it("infers router from routes field", () => {
    const ir = loadAndNormalize("router.yaml");
    expect(ir.steps!["classify"].type).toBe("router");
  });

  it("infers output from input field without agent", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.steps!["done"].type).toBe("output");
  });

  it("uses explicit type when provided", () => {
    const ir = loadAndNormalize("gate.yaml");
    // gate.yaml has type: gate explicitly
    expect(ir.steps!["review"].type).toBe("gate");
  });
});

// ---- Kebab-case → camelCase ----

describe("normalize — kebab to camel conversion", () => {
  it("converts on-error to onError", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.steps!["research"].onError).toBe("skip");
  });

  it("converts max-iterations to maxIterations", () => {
    const ir = loadAndNormalize("eval-loop.yaml");
    expect(ir.steps!["write-spec"].maxIterations).toBe(3);
  });

  it("converts max-tokens to maxTokens in budget", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.security!.budget!.maxTokens).toBe(100000);
  });

  it("converts max-cost to maxCost in budget", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.security!.budget!.maxCost).toBe("$5.00");
  });

  it("converts hook kebab-case keys", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.hooks!.onError).toBe("slack:#alerts");
    expect(ir.hooks!.afterStep).toBe("./scripts/notify.sh");
  });
});

// ---- Eval normalization ----

describe("normalize — eval defaults", () => {
  it("applies default type: code", () => {
    const ir = loadAndNormalize("full.yaml");
    const testsPassEval = ir.steps!["write"].eval!.find(
      (e) => e.metric === "tests-pass",
    );
    expect(testsPassEval!.type).toBe("code");
  });

  it("applies default pass: true", () => {
    const ir = loadAndNormalize("full.yaml");
    const testsPassEval = ir.steps!["write"].eval!.find(
      (e) => e.metric === "tests-pass",
    );
    expect(testsPassEval!.pass).toBe(true);
  });

  it("applies default aggregate: all", () => {
    const ir = loadAndNormalize("full.yaml");
    const eval0 = ir.steps!["write"].eval![0];
    expect(eval0.aggregate).toBe("all");
  });

  it("preserves explicit eval fields", () => {
    const ir = loadAndNormalize("full.yaml");
    const llmEval = ir.steps!["write"].eval!.find(
      (e) => e.metric === "llm-judge",
    );
    expect(llmEval!.type).toBe("llm");
    expect(llmEval!.pass).toBe(0.8);
    expect(llmEval!.prompt).toBe("Is this report complete?");
  });

  it("normalizes multiple evals on one step", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.steps!["write"].eval).toHaveLength(2);
  });
});

// ---- Retry normalization ----

describe("normalize — retry shorthand", () => {
  it("converts number shorthand to RetryDef", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.steps!["research"].retry).toEqual({
      max: 3,
      backoff: "none",
    });
  });

  it("passes through full retry object", () => {
    const ir = normalize({
      harnessfile: "0.1",
      agents: { a: { model: "anthropic/x", instructions: "y" } },
      steps: {
        s: {
          agent: "a",
          retry: { max: 5, backoff: "exponential" },
        },
      },
    });
    expect(ir.steps!["s"].retry).toEqual({
      max: 5,
      backoff: "exponential",
    });
  });
});

// ---- Next field ----

describe("normalize — next polymorphism", () => {
  it("preserves single next as string", () => {
    const ir = loadAndNormalize("pipeline.yaml");
    expect(ir.steps!["research"].next).toBe("write");
  });

  it("preserves array next for fan-out", () => {
    const ir = loadAndNormalize("fanout.yaml");
    expect(ir.steps!["plan"].next).toEqual(["frontend", "backend"]);
  });

  it("handles missing next (end of path)", () => {
    const ir = loadAndNormalize("pipeline.yaml");
    expect(ir.steps!["write"].next).toBeUndefined();
  });
});

// ---- Tools and skills ----

describe("normalize — tools and skills", () => {
  it("normalizes MCP tools", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.agents.researcher.tools).toEqual([
      { mcp: "./tools/web-search.json" },
    ]);
  });

  it("normalizes skills as string array", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.agents.writer.skills).toEqual(["./skills/writing.md"]);
  });
});

// ---- Cross-cutting concerns ----

describe("normalize — observability", () => {
  it("normalizes observability section", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.observability).toEqual({
      tracing: "langfuse/v1",
      sampling: 0.5,
      level: "steps",
      metrics: undefined,
    });
  });
});

describe("normalize — memory", () => {
  it("normalizes memory section", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.memory).toEqual({
      backend: "postgres/v1",
      scope: "thread",
      type: "checkpoint",
      ttl: "24h",
    });
  });
});

describe("normalize — security", () => {
  it("normalizes guardrails", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.security!.guardrails!.input).toEqual(["injection-detect"]);
    expect(ir.security!.guardrails!.output).toEqual(["pii-scrub"]);
  });

  it("normalizes audit", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.security!.audit).toEqual({
      destination: "stdout",
      level: "actions",
    });
  });
});

describe("normalize — resilience", () => {
  it("normalizes resilience section", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.resilience).toEqual({
      timeout: "1h",
      checkpoint: true,
    });
  });
});

// ---- Per-step hooks ----

describe("normalize — hooks", () => {
  it("normalizes string shorthand hooks", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.hooks!.onError).toBe("slack:#alerts");
    expect(ir.hooks!.afterStep).toBe("./scripts/notify.sh");
  });

  it("normalizes per-step hooks", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.steps!["write"].hooks!.afterStep).toBe(
      "./scripts/post-write.sh",
    );
  });

  it("normalizes full-form hooks with can", () => {
    const ir = normalize({
      harnessfile: "0.1",
      agents: { a: { model: "anthropic/x", instructions: "y" } },
      hooks: {
        "before-step": {
          run: "./scripts/inject.sh",
          can: ["abort", "modify"],
        },
      },
    });
    expect(ir.hooks!.beforeStep).toEqual({
      run: "./scripts/inject.sh",
      can: ["abort", "modify"],
    });
  });
});

// ---- Provider field ----

describe("normalize — provider", () => {
  it("preserves string provider shorthand", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.steps!["review"].provider).toBe("slack/v1");
  });
});

// ---- Context field ----

describe("normalize — data flow", () => {
  it("preserves context selection", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.steps!["write"].context).toBe("research.summary");
  });

  it("preserves output schema on trigger", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.steps!["trigger"].output).toEqual({ query: "string" });
  });

  it("preserves input schema on output step", () => {
    const ir = loadAndNormalize("full.yaml");
    expect(ir.steps!["done"].input).toEqual({ report: "string" });
  });
});
