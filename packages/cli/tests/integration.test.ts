import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadHarnessDirectory } from "../src/parser/directory.js";
import { validateHarnessfile } from "../src/validator/validate.js";

// Integration: parse + normalize + validate the flagship AltaVox harness
// (examples/altavox/.agents — a real production harness expressed in v0.2).

const ALTAVOX = resolve(
  import.meta.dirname,
  "../../../examples/altavox",
);

describe("integration — AltaVox flagship harness", () => {
  const harness = loadHarnessDirectory(ALTAVOX);
  const ir = harness.ir;

  it("resolves the .agents directory from the project root", () => {
    expect(harness.agentsDir).toBe(resolve(ALTAVOX, ".agents"));
    expect(harness.root).toBe(resolve(ALTAVOX));
  });

  it("validates with zero errors", () => {
    const result = validateHarnessfile(ir);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("parses all 10 agents", () => {
    expect(Object.keys(ir.agents).sort()).toEqual([
      "copy-writer",
      "designer",
      "engineer",
      "planner",
      "pm",
      "researcher",
      "reviewer",
      "risk-assessor",
      "sentry-triage",
      "tester",
    ]);
    for (const agent of Object.values(ir.agents)) {
      expect(agent.description).toBeTruthy();
      expect(agent.instructions).toBeTruthy();
      expect(agent.runtime).toMatch(/^(claude|codex)$/);
      expect(agent.model).toBeTruthy();
    }
  });

  it("resolves the development squad with 9 members and pm as leader", () => {
    const dev = ir.squads!["development"];
    expect(dev).toBeDefined();
    expect(dev.leader).toBe("pm");
    expect(dev.members).toHaveLength(9);
    expect(dev.members.some((m) => m.agent === "pm")).toBe(true);
    expect(dev.instructions).toContain("How the Development squad runs");
  });

  it("wires the squad step into the graph", () => {
    const step = ir.steps!["development"];
    expect(step.type).toBe("squad");
    expect(step.squad).toBe("development");
  });

  it("resolves the scheduled trigger with the autopilot prompt text", () => {
    const trigger = ir.steps!["sentry-sweep"];
    expect(trigger.type).toBe("trigger");
    expect(trigger.schedule).toBe("0 * * * *");
    expect(trigger.timezone).toBe("America/Sao_Paulo");
    expect(trigger.promptPath).toBe("./autopilots/sentry-triage.md");
    expect(trigger.prompt).toContain("Run a Sentry triage sweep now.");
    expect(trigger.next).toBe("sentry-triage");
  });

  it("parses all 4 targets with multica ownership", () => {
    expect(Object.keys(ir.targets!)).toEqual([
      "multica",
      "claude-code",
      "codex",
      "github",
    ]);
    expect(ir.targets!["multica"].provider).toBe("multica/v1");
    expect(ir.targets!["multica"].owns).toEqual([
      "model",
      "runtime",
      "thinking-level",
      "concurrency",
      "env",
      "mcp",
    ]);
    expect(ir.targets!["github"].provider).toBe("github-agent-hq/v1");
  });

  it("lists the 8 skills and resolves every agent skill reference", () => {
    expect(ir.skills).toHaveLength(8);
    const skills = new Set(ir.skills);
    for (const agent of Object.values(ir.agents)) {
      for (const skill of agent.skills ?? []) {
        expect(skills.has(skill)).toBe(true);
      }
    }
  });

  it("carries agent passthrough (multica display names)", () => {
    expect(ir.agents["engineer"].passthrough).toEqual({
      multica: { display_name: "Engineer" },
    });
  });

  it("keeps the multica trigger as an event trigger", () => {
    const trigger = ir.steps!["issue-assigned"];
    expect(trigger.type).toBe("trigger");
    expect(trigger.provider).toBe("multica/v1");
    expect(trigger.event).toBe("issue-assigned");
    expect(trigger.next).toBe("development");
  });
});
