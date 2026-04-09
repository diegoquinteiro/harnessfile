import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { substituteVariables } from "../src/parser/variables.js";
import {
  resolveHarnessfilePath,
  parseHarnessfile,
} from "../src/parser/parse.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

// ---- Variable substitution ----

describe("substituteVariables", () => {
  it("substitutes a simple variable", () => {
    const result = substituteVariables("model: ${MY_MODEL}", {
      MY_MODEL: "anthropic/claude-sonnet-4-6",
    });
    expect(result).toBe("model: anthropic/claude-sonnet-4-6");
  });

  it("substitutes a variable with default when var is unset", () => {
    const result = substituteVariables(
      "model: ${MY_MODEL:-anthropic/claude-haiku-4-5}",
      {},
    );
    expect(result).toBe("model: anthropic/claude-haiku-4-5");
  });

  it("uses variable value over default when set", () => {
    const result = substituteVariables(
      "model: ${MY_MODEL:-anthropic/claude-haiku-4-5}",
      { MY_MODEL: "openai/gpt-4" },
    );
    expect(result).toBe("model: openai/gpt-4");
  });

  it("throws when required variable is not set", () => {
    expect(() => substituteVariables("key: ${REQUIRED_VAR}", {})).toThrow(
      "Environment variable ${REQUIRED_VAR} is required but not set",
    );
  });

  it("handles multiple substitutions in one string", () => {
    const result = substituteVariables(
      "${A} and ${B:-default_b}",
      { A: "hello" },
    );
    expect(result).toBe("hello and default_b");
  });

  it("handles empty default value", () => {
    const result = substituteVariables("val: ${X:-}", {});
    expect(result).toBe("val: ");
  });

  it("preserves text without variables", () => {
    const result = substituteVariables("no variables here", {});
    expect(result).toBe("no variables here");
  });

  it("handles variable at start and end of string", () => {
    const result = substituteVariables("${START}middle${END}", {
      START: "A",
      END: "Z",
    });
    expect(result).toBe("AmiddleZ");
  });

  it("substitutes across multiple lines", () => {
    const input = `model: \${MODEL:-default}
channel: \${CHANNEL:-#general}`;
    const result = substituteVariables(input, {});
    expect(result).toBe("model: default\nchannel: #general");
  });

  it("uses process.env by default", () => {
    const original = process.env.TEST_HARNESSFILE_VAR;
    process.env.TEST_HARNESSFILE_VAR = "from-env";
    try {
      const result = substituteVariables("val: ${TEST_HARNESSFILE_VAR}");
      expect(result).toBe("val: from-env");
    } finally {
      if (original === undefined) {
        delete process.env.TEST_HARNESSFILE_VAR;
      } else {
        process.env.TEST_HARNESSFILE_VAR = original;
      }
    }
  });
});

// ---- File resolution ----

describe("resolveHarnessfilePath", () => {
  it("resolves an explicit file path", () => {
    const path = resolveHarnessfilePath(resolve(FIXTURES, "minimal.yaml"));
    expect(path).toBe(resolve(FIXTURES, "minimal.yaml"));
  });

  it("throws for non-existent explicit path", () => {
    expect(() =>
      resolveHarnessfilePath("/tmp/definitely-does-not-exist.yaml"),
    ).toThrow("Harnessfile not found");
  });

  it("throws when no default file exists", () => {
    expect(() =>
      resolveHarnessfilePath(undefined),
    ).toThrow("No harnessfile found");
  });
});

// ---- YAML parsing ----

describe("parseHarnessfile", () => {
  it("parses a minimal harnessfile", () => {
    const result = parseHarnessfile(resolve(FIXTURES, "minimal.yaml")) as any;
    expect(result.harnessfile).toBe("0.1");
    expect(result.agents["my-agent"].model).toBe("anthropic/claude-sonnet-4-6");
    expect(result.agents["my-agent"].instructions).toBe(
      "Do something useful.",
    );
  });

  it("parses a pipeline harnessfile", () => {
    const result = parseHarnessfile(resolve(FIXTURES, "pipeline.yaml")) as any;
    expect(result.harnessfile).toBe("0.1");
    expect(Object.keys(result.agents)).toEqual(["researcher", "writer"]);
    expect(Object.keys(result.steps)).toEqual(["start", "research", "write"]);
    expect(result.steps.start.type).toBe("trigger");
    expect(result.steps.start.next).toBe("research");
    expect(result.steps.research.next).toBe("write");
  });

  it("substitutes variables during parsing", () => {
    const result = parseHarnessfile(resolve(FIXTURES, "variables.yaml"), {
      AGENT_INSTRUCTIONS: "Test instructions",
    }) as any;
    expect(result.agents["my-agent"].model).toBe("anthropic/claude-sonnet-4-6");
    expect(result.agents["my-agent"].instructions).toBe("Test instructions");
  });

  it("throws when required variable is missing", () => {
    expect(() =>
      parseHarnessfile(resolve(FIXTURES, "variables.yaml"), {}),
    ).toThrow("AGENT_INSTRUCTIONS");
  });

  it("parses the full example with all sections", () => {
    const result = parseHarnessfile(resolve(FIXTURES, "full.yaml")) as any;
    expect(result.name).toBe("test-pipeline");
    expect(result.observability.tracing).toBe("langfuse/v1");
    expect(result.security.budget["max-tokens"]).toBe(100000);
    expect(result.memory.backend).toBe("postgres/v1");
    expect(result.resilience.timeout).toBe("1h");
    expect(result.hooks["on-error"]).toBe("slack:#alerts");
  });

  it("throws for non-existent file", () => {
    expect(() => parseHarnessfile("/nonexistent/file.yaml")).toThrow();
  });

  it("parses fan-out next as array", () => {
    const result = parseHarnessfile(resolve(FIXTURES, "fanout.yaml")) as any;
    expect(result.steps.plan.next).toEqual(["frontend", "backend"]);
  });

  it("parses eval array on steps", () => {
    const result = parseHarnessfile(
      resolve(FIXTURES, "eval-loop.yaml"),
    ) as any;
    expect(result.steps["write-spec"].eval).toHaveLength(1);
    expect(result.steps["write-spec"]["max-iterations"]).toBe(3);
  });

  it("parses router routes", () => {
    const result = parseHarnessfile(resolve(FIXTURES, "router.yaml")) as any;
    expect(result.steps.classify.routes).toEqual({
      feature: "build",
      bug: "fix",
    });
  });

  it("parses gate fields", () => {
    const result = parseHarnessfile(resolve(FIXTURES, "gate.yaml")) as any;
    expect(result.steps.review.approve).toBe("human");
    expect(result.steps.review.channel).toBe("#approvals");
    expect(result.steps.review.timeout).toBe("1h");
    expect(result.steps.review.fallback).toBe("reject");
  });
});
