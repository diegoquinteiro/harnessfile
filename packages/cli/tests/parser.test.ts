import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { substituteVariables } from "../src/parser/variables.js";
import { parseHarnessfile } from "../src/parser/parse.js";
import { splitFrontmatter } from "../src/parser/frontmatter.js";
import {
  resolveAgentsDir,
  loadHarnessDirectory,
} from "../src/parser/directory.js";

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

// ---- Frontmatter splitting ----

describe("splitFrontmatter", () => {
  it("splits frontmatter and body", () => {
    const { frontmatter, body } = splitFrontmatter(
      "---\nname: engineer\nskills: [a, b]\n---\n\n# Role\nBuild things.\n",
    );
    expect(frontmatter).toEqual({ name: "engineer", skills: ["a", "b"] });
    expect(body).toBe("# Role\nBuild things.\n");
  });

  it("returns whole content as body when no frontmatter", () => {
    const { frontmatter, body } = splitFrontmatter("# Just markdown\n");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Just markdown\n");
  });

  it("returns whole content as body when frontmatter is unterminated", () => {
    const content = "---\nname: x\nno closing delimiter";
    const { frontmatter, body } = splitFrontmatter(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it("handles empty frontmatter block", () => {
    const { frontmatter, body } = splitFrontmatter("---\n---\nbody");
    expect(frontmatter).toEqual({});
    expect(body).toBe("body");
  });

  it("handles nested frontmatter objects", () => {
    const { frontmatter } = splitFrontmatter(
      "---\nname: x\nmultica:\n  display_name: X\n---\nbody",
    );
    expect(frontmatter["multica"]).toEqual({ display_name: "X" });
  });

  it("handles CRLF line endings", () => {
    const { frontmatter, body } = splitFrontmatter(
      "---\r\nname: x\r\n---\r\nbody\r\n",
    );
    expect(frontmatter).toEqual({ name: "x" });
    expect(body).toContain("body");
  });
});

// ---- Directory resolution ----

describe("resolveAgentsDir", () => {
  it("resolves a directory containing harness.yaml", () => {
    const { agentsDir, harnessPath } = resolveAgentsDir(
      resolve(FIXTURES, "minimal"),
    );
    expect(agentsDir).toBe(resolve(FIXTURES, "minimal"));
    expect(harnessPath).toBe(resolve(FIXTURES, "minimal/harness.yaml"));
  });

  it("resolves a project root containing .agents/", () => {
    const { agentsDir, root } = resolveAgentsDir(
      resolve(FIXTURES, "sync-plan"),
    );
    expect(agentsDir).toBe(resolve(FIXTURES, "sync-plan/.agents"));
    expect(root).toBe(resolve(FIXTURES, "sync-plan"));
  });

  it("resolves a direct harness.yaml file path", () => {
    const { agentsDir } = resolveAgentsDir(
      resolve(FIXTURES, "minimal/harness.yaml"),
    );
    expect(agentsDir).toBe(resolve(FIXTURES, "minimal"));
  });

  it("throws for a non-existent path", () => {
    expect(() => resolveAgentsDir("/tmp/definitely-does-not-exist")).toThrow(
      "not found",
    );
  });

  it("throws when no harness is found", () => {
    expect(() => resolveAgentsDir(resolve(FIXTURES, "minimal/agents"))).toThrow(
      "No harness found",
    );
  });
});

// ---- Directory loading ----

describe("loadHarnessDirectory", () => {
  it("loads agents from agents/*.md", () => {
    const { ir } = loadHarnessDirectory(resolve(FIXTURES, "pipeline"));
    expect(Object.keys(ir.agents).sort()).toEqual(["researcher", "writer"]);
    expect(ir.agents["researcher"].instructions).toBe(
      "Research the problem space thoroughly.",
    );
    expect(ir.agents["researcher"].description).toBe(
      "Researches the problem space.",
    );
    expect(ir.agents["researcher"].runtime).toBe("claude");
    expect(ir.agents["researcher"].model).toBe("claude-sonnet-4-6");
  });

  it("loads squads from squads/*.md", () => {
    const { ir } = loadHarnessDirectory(resolve(FIXTURES, "squad"));
    expect(ir.squads).toBeDefined();
    const dev = ir.squads!["development"];
    expect(dev.leader).toBe("pm");
    expect(dev.members).toHaveLength(3);
    expect(dev.members[1]).toEqual({
      agent: "researcher",
      role: "Gathers context",
    });
    expect(dev.instructions).toContain("How the Development squad runs");
    expect(dev.passthrough).toEqual({
      multica: { display_name: "Development" },
    });
  });

  it("lists skills from skills/<name>/SKILL.md", () => {
    const { ir } = loadHarnessDirectory(resolve(FIXTURES, "full"));
    expect(ir.skills).toEqual(["writing"]);
  });

  it("resolves trigger prompt files relative to the harness dir", () => {
    const { ir } = loadHarnessDirectory(resolve(FIXTURES, "scheduled-trigger"));
    const trigger = ir.steps!["hourly-sweep"];
    expect(trigger.type).toBe("trigger");
    expect(trigger.schedule).toBe("0 * * * *");
    expect(trigger.timezone).toBe("America/Sao_Paulo");
    expect(trigger.promptPath).toBe("./autopilots/sweep.md");
    expect(trigger.prompt).toContain("Run a triage sweep now.");
    expect(trigger.prompt).toContain("finish with a short summary");
  });

  it("keeps inline prompts as-is", () => {
    const { ir } = loadHarnessDirectory(resolve(FIXTURES, "scheduled-trigger"));
    const trigger = ir.steps!["inline-sweep"];
    expect(trigger.prompt).toBe("Run a quick inline sweep.");
    expect(trigger.promptPath).toBeUndefined();
  });

  it("throws when a prompt file is missing", () => {
    const dir = resolve(FIXTURES, "minimal");
    // Build a raw object by hand — go through a temp harness in scratch instead
    expect(() =>
      loadHarnessDirectory(resolve(FIXTURES, "broken-prompt")),
    ).toThrow();
  });

  it("substitutes variables in harness.yaml and entity files", () => {
    const { ir } = loadHarnessDirectory(resolve(FIXTURES, "variables"), {
      AGENT_INSTRUCTIONS: "Test instructions",
    });
    expect(ir.name).toBe("variables");
    expect(ir.agents["my-agent"].model).toBe("claude-sonnet-4-6");
    expect(ir.agents["my-agent"].description).toBe(
      "A variable-driven agent.",
    );
    expect(ir.agents["my-agent"].instructions).toBe("Test instructions");
  });

  it("throws when a required variable is missing", () => {
    expect(() =>
      loadHarnessDirectory(resolve(FIXTURES, "variables"), {}),
    ).toThrow("AGENT_INSTRUCTIONS");
  });

  it("exposes agent passthrough frontmatter", () => {
    const { ir } = loadHarnessDirectory(resolve(FIXTURES, "sync-plan"));
    expect(ir.agents["triager"].passthrough).toEqual({
      multica: { display_name: "Triager" },
    });
  });

  it("parses targets", () => {
    const { ir } = loadHarnessDirectory(resolve(FIXTURES, "targets"));
    expect(Object.keys(ir.targets!)).toEqual([
      "multica",
      "claude-code",
      "codex",
      "github",
      "bad-owns",
    ]);
    expect(ir.targets!["multica"].owns).toEqual([
      "model",
      "runtime",
      "thinking-level",
      "concurrency",
      "env",
      "mcp",
    ]);
  });
});

// ---- YAML parsing ----

describe("parseHarnessfile", () => {
  it("parses harness.yaml", () => {
    const result = parseHarnessfile(
      resolve(FIXTURES, "pipeline/harness.yaml"),
    ) as any;
    expect(result.harnessfile).toBe("0.2");
    expect(Object.keys(result.steps)).toEqual(["start", "research", "write"]);
    expect(result.steps.start.type).toBe("trigger");
    expect(result.steps.start.next).toBe("research");
  });

  it("throws for non-existent file", () => {
    expect(() => parseHarnessfile("/nonexistent/file.yaml")).toThrow();
  });

  it("parses the full example with all sections", () => {
    const result = parseHarnessfile(
      resolve(FIXTURES, "full/harness.yaml"),
    ) as any;
    expect(result.name).toBe("test-pipeline");
    expect(result.observability.tracing).toBe("langfuse/v1");
    expect(result.security.budget["max-tokens"]).toBe(100000);
    expect(result.memory.backend).toBe("postgres/v1");
    expect(result.resilience.timeout).toBe("1h");
    expect(result.hooks["on-error"]).toBe("slack:#alerts");
  });
});
