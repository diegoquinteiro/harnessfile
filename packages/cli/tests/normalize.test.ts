import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadHarnessDirectory } from "../src/parser/directory.js";
import { normalize } from "../src/ir/normalize.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

function loadAndNormalize(fixture: string) {
  return loadHarnessDirectory(resolve(FIXTURES, fixture)).ir;
}

// ---- Basic normalization ----

describe("normalize — basics", () => {
  it("normalizes a minimal harness", () => {
    const ir = loadAndNormalize("minimal");
    expect(ir.version).toBe("0.2");
    expect(ir.name).toBe("minimal");
    expect(ir.agents["my-agent"].model).toBe("anthropic/claude-sonnet-4-6");
    expect(ir.agents["my-agent"].instructions).toBe("Do something useful.");
    expect(ir.agents["my-agent"].description).toBe("A minimal agent.");
    expect(ir.steps).toBeUndefined();
  });

  it("normalizes the name field", () => {
    const ir = loadAndNormalize("full");
    expect(ir.name).toBe("test-pipeline");
  });

  it("requires version field", () => {
    expect(() => normalize({ agents: {} })).toThrow("harnessfile version");
  });

  it("tolerates a missing agents map (empty agents/)", () => {
    const ir = normalize({ harnessfile: "0.2", name: "x" });
    expect(ir.agents).toEqual({});
  });

  it("allows agents without a model (portable default is optional)", () => {
    const ir = normalize({
      harnessfile: "0.2",
      name: "x",
      agents: { a: { description: "d", instructions: "test" } },
    });
    expect(ir.agents["a"].model).toBeUndefined();
    expect(ir.agents["a"].instructions).toBe("test");
  });
});

// ---- Triggers sugar ----

describe("normalize — triggers sugar", () => {
  it("merges top-level triggers into steps as type: trigger", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["trigger"].type).toBe("trigger");
    expect(ir.steps!["trigger"].next).toBe("classify");
  });

  it("infers trigger type from schedule", () => {
    const ir = normalize({
      harnessfile: "0.2",
      name: "x",
      agents: { a: { description: "d", instructions: "y" } },
      steps: {
        sweep: { schedule: "0 * * * *", prompt: "go", next: "s" },
        s: { agent: "a" },
      },
    });
    expect(ir.steps!["sweep"].type).toBe("trigger");
    expect(ir.steps!["sweep"].schedule).toBe("0 * * * *");
  });

  it("rejects a step defined in both triggers and steps", () => {
    expect(() =>
      normalize({
        harnessfile: "0.2",
        name: "x",
        triggers: { dup: { event: "webhook" } },
        steps: { dup: { agent: "a" } },
      }),
    ).toThrow("defined both in triggers and steps");
  });

  it("normalizes schedule, timezone, and prompt on scheduled triggers", () => {
    const ir = loadAndNormalize("scheduled-trigger");
    const step = ir.steps!["hourly-sweep"];
    expect(step.type).toBe("trigger");
    expect(step.schedule).toBe("0 * * * *");
    expect(step.timezone).toBe("America/Sao_Paulo");
    expect(step.prompt).toContain("Run a triage sweep now.");
  });
});

// ---- Step type inference ----

describe("normalize — step type inference", () => {
  it("infers trigger from event field", () => {
    const ir = loadAndNormalize("pipeline");
    expect(ir.steps!["start"].type).toBe("trigger");
  });

  it("infers agent type for steps with agent field", () => {
    const ir = loadAndNormalize("pipeline");
    expect(ir.steps!["research"].type).toBe("agent");
    expect(ir.steps!["write"].type).toBe("agent");
  });

  it("infers gate from approve field", () => {
    const ir = loadAndNormalize("gate");
    expect(ir.steps!["review"].type).toBe("gate");
  });

  it("infers router from routes field", () => {
    const ir = loadAndNormalize("router");
    expect(ir.steps!["classify"].type).toBe("router");
  });

  it("infers squad type from squad field", () => {
    const ir = loadAndNormalize("squad");
    expect(ir.steps!["dev-squad"].type).toBe("squad");
    expect(ir.steps!["dev-squad"].squad).toBe("development");
  });

  it("infers output from input field without agent", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["done"].type).toBe("output");
  });

  it("still parses legacy orchestrator steps", () => {
    const ir = normalize({
      harnessfile: "0.2",
      name: "x",
      agents: { a: { description: "d", instructions: "y" } },
      steps: {
        orch: { agent: "a", pool: ["a"] },
      },
    });
    expect(ir.steps!["orch"].type).toBe("orchestrator");
    expect(ir.steps!["orch"].pool).toEqual(["a"]);
  });
});

// ---- Squads ----

describe("normalize — squads", () => {
  it("normalizes squad frontmatter and body", () => {
    const ir = loadAndNormalize("squad");
    const dev = ir.squads!["development"];
    expect(dev.name).toBe("development");
    expect(dev.description).toBe(
      "Researches, plans, and implements features.",
    );
    expect(dev.leader).toBe("pm");
    expect(dev.members.map((m) => m.agent)).toEqual([
      "pm",
      "researcher",
      "engineer",
    ]);
    expect(dev.instructions).toContain("Research first, then implement.");
  });

  it("collects unknown squad frontmatter as passthrough", () => {
    const ir = loadAndNormalize("squad");
    expect(ir.squads!["development"].passthrough).toEqual({
      multica: { display_name: "Development" },
    });
  });
});

// ---- Agent passthrough ----

describe("normalize — agent passthrough", () => {
  it("collects unknown namespaced frontmatter keys", () => {
    const ir = normalize({
      harnessfile: "0.2",
      name: "x",
      agents: {
        a: {
          description: "d",
          instructions: "y",
          multica: { display_name: "A" },
          "custom-key": 42,
        },
      },
    });
    expect(ir.agents["a"].passthrough).toEqual({
      multica: { display_name: "A" },
      "custom-key": 42,
    });
  });

  it("leaves passthrough undefined when all keys are known", () => {
    const ir = loadAndNormalize("minimal");
    expect(ir.agents["my-agent"].passthrough).toBeUndefined();
  });
});

// ---- Targets ----

describe("normalize — targets", () => {
  it("normalizes provider and owns", () => {
    const ir = loadAndNormalize("targets");
    expect(ir.targets!["multica"].provider).toBe("multica/v1");
    expect(ir.targets!["multica"].owns).toEqual([
      "model",
      "runtime",
      "concurrency",
      "env",
      "mcp",
    ]);
    expect(ir.targets!["claude-code"].owns).toBeUndefined();
  });
});

// ---- Kebab-case → camelCase ----

describe("normalize — kebab to camel conversion", () => {
  it("converts on-error to onError", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["research"].onError).toBe("skip");
  });

  it("converts max-iterations to maxIterations", () => {
    const ir = loadAndNormalize("eval-loop");
    expect(ir.steps!["write-spec"].maxIterations).toBe(3);
  });

  it("converts max-tokens/max-cost in budget", () => {
    const ir = loadAndNormalize("full");
    expect(ir.security!.budget!.maxTokens).toBe(100000);
    expect(ir.security!.budget!.maxCost).toBe("$5.00");
  });

  it("converts hook kebab-case keys", () => {
    const ir = loadAndNormalize("full");
    expect(ir.hooks!.onError).toBe("slack:#alerts");
    expect(ir.hooks!.afterStep).toBe("./scripts/notify.sh");
  });
});

// ---- Eval normalization ----

describe("normalize — eval defaults", () => {
  it("applies default type: code and pass: true", () => {
    const ir = loadAndNormalize("full");
    const testsPassEval = ir.steps!["write"].eval!.find(
      (e) => e.metric === "tests-pass",
    );
    expect(testsPassEval!.type).toBe("code");
    expect(testsPassEval!.pass).toBe(true);
  });

  it("applies default aggregate: all", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["write"].eval![0].aggregate).toBe("all");
  });

  it("preserves explicit eval fields", () => {
    const ir = loadAndNormalize("full");
    const llmEval = ir.steps!["write"].eval!.find(
      (e) => e.metric === "llm-judge",
    );
    expect(llmEval!.type).toBe("llm");
    expect(llmEval!.pass).toBe(0.8);
    expect(llmEval!.prompt).toBe("Is this report complete?");
  });

  it("normalizes multiple evals on one step", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["write"].eval).toHaveLength(2);
  });
});

// ---- Retry normalization ----

describe("normalize — retry shorthand", () => {
  it("converts number shorthand to RetryDef", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["research"].retry).toEqual({
      max: 3,
      backoff: "none",
    });
  });

  it("passes through full retry object", () => {
    const ir = normalize({
      harnessfile: "0.2",
      name: "x",
      agents: { a: { description: "d", instructions: "y" } },
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
    const ir = loadAndNormalize("pipeline");
    expect(ir.steps!["research"].next).toBe("write");
  });

  it("preserves array next for fan-out", () => {
    const ir = loadAndNormalize("fanout");
    expect(ir.steps!["plan"].next).toEqual(["frontend", "backend"]);
  });

  it("handles missing next (end of path)", () => {
    const ir = loadAndNormalize("pipeline");
    expect(ir.steps!["write"].next).toBeUndefined();
  });
});

// ---- Tools and skills ----

describe("normalize — tools and skills", () => {
  it("normalizes MCP tools", () => {
    const ir = loadAndNormalize("full");
    expect(ir.agents.researcher.tools).toEqual([
      { mcp: "./tools/web-search.json" },
    ]);
  });

  it("normalizes skills as name array", () => {
    const ir = loadAndNormalize("full");
    expect(ir.agents.writer.skills).toEqual(["writing"]);
  });
});

// ---- Cross-cutting concerns ----

describe("normalize — observability / memory / security / resilience", () => {
  it("normalizes observability section", () => {
    const ir = loadAndNormalize("full");
    expect(ir.observability).toEqual({
      tracing: "langfuse/v1",
      sampling: 0.5,
      level: "steps",
      metrics: undefined,
    });
  });

  it("normalizes memory section", () => {
    const ir = loadAndNormalize("full");
    expect(ir.memory).toEqual({
      backend: "postgres/v1",
      scope: "thread",
      type: "checkpoint",
      ttl: "24h",
    });
  });

  it("normalizes guardrails and audit", () => {
    const ir = loadAndNormalize("full");
    expect(ir.security!.guardrails!.input).toEqual(["injection-detect"]);
    expect(ir.security!.guardrails!.output).toEqual(["pii-scrub"]);
    expect(ir.security!.audit).toEqual({
      destination: "stdout",
      level: "actions",
    });
  });

  it("normalizes resilience section", () => {
    const ir = loadAndNormalize("full");
    expect(ir.resilience).toEqual({
      timeout: "1h",
      checkpoint: true,
    });
  });
});

// ---- Hooks ----

describe("normalize — hooks", () => {
  it("normalizes string shorthand hooks", () => {
    const ir = loadAndNormalize("full");
    expect(ir.hooks!.onError).toBe("slack:#alerts");
    expect(ir.hooks!.afterStep).toBe("./scripts/notify.sh");
  });

  it("normalizes per-step hooks", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["write"].hooks!.afterStep).toBe(
      "./scripts/post-write.sh",
    );
  });

  it("normalizes full-form hooks with can", () => {
    const ir = normalize({
      harnessfile: "0.2",
      name: "x",
      agents: { a: { description: "d", instructions: "y" } },
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
    const ir = loadAndNormalize("full");
    expect(ir.steps!["review"].provider).toBe("slack/v1");
  });
});

// ---- Context field ----

describe("normalize — data flow", () => {
  it("preserves context selection", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["write"].context).toBe("research.summary");
  });

  it("preserves output schema on trigger", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["trigger"].output).toEqual({ query: "string" });
  });

  it("preserves input schema on output step", () => {
    const ir = loadAndNormalize("full");
    expect(ir.steps!["done"].input).toEqual({ report: "string" });
  });
});
