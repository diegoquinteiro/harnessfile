import { describe, it, expect } from "vitest";
import { emitArchonYaml } from "../../../src/providers/archon/emit.js";

describe("archon emit", () => {
  it("emits a minimal workflow", () => {
    const yaml = emitArchonYaml({
      name: "test",
      nodes: [{ id: "a", command: "foo" }],
    });
    expect(yaml).toContain("name: test");
    expect(yaml).toContain("nodes:");
    expect(yaml).toContain("- id: a");
    expect(yaml).toContain("command: foo");
  });

  it("uses block scalar style for multi-line strings", () => {
    const yaml = emitArchonYaml({
      name: "test",
      description: "line 1\nline 2\nline 3",
      nodes: [],
    });
    // Block literal marker `|` should appear
    expect(yaml).toMatch(/description:\s*\|/);
  });

  it("orders top-level fields: name, description, provider, model, …, nodes", () => {
    const yaml = emitArchonYaml({
      nodes: [],
      model: "sonnet",
      description: "desc",
      name: "test",
      provider: "claude",
    });
    const nameIdx = yaml.indexOf("name:");
    const descIdx = yaml.indexOf("description:");
    const provIdx = yaml.indexOf("provider:");
    const modelIdx = yaml.indexOf("model:");
    const nodesIdx = yaml.indexOf("nodes:");
    expect(nameIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(provIdx);
    expect(provIdx).toBeLessThan(modelIdx);
    expect(modelIdx).toBeLessThan(nodesIdx);
  });

  it("orders node fields: id, depends_on, when, trigger_rule, …", () => {
    const yaml = emitArchonYaml({
      name: "test",
      nodes: [
        {
          command: "foo",
          context: "fresh",
          depends_on: ["a"],
          id: "b",
          when: "$a.output == 'x'",
        },
      ],
    });
    const idIdx = yaml.indexOf("id: b");
    const depsIdx = yaml.indexOf("depends_on:");
    const whenIdx = yaml.indexOf("when:");
    const ctxIdx = yaml.indexOf("context:");
    const cmdIdx = yaml.indexOf("command: foo");
    expect(idIdx).toBeLessThan(depsIdx);
    expect(depsIdx).toBeLessThan(whenIdx);
    expect(whenIdx).toBeLessThan(ctxIdx);
    expect(ctxIdx).toBeLessThan(cmdIdx);
  });

  it("preserves passthrough fields verbatim", () => {
    const yaml = emitArchonYaml({
      name: "test",
      interactive: true,
      nodes: [
        {
          id: "a",
          command: "foo",
          idle_timeout: 300000,
          skills: ["agent-browser"],
        },
      ],
    });
    expect(yaml).toContain("interactive: true");
    expect(yaml).toContain("idle_timeout: 300000");
    expect(yaml).toContain("skills:");
  });

  it("orders loop fields correctly", () => {
    const yaml = emitArchonYaml({
      name: "test",
      nodes: [
        {
          id: "a",
          loop: {
            max_iterations: 5,
            prompt: "do stuff",
            until: "DONE",
            fresh_context: true,
          },
        },
      ],
    });
    const promptIdx = yaml.indexOf("prompt:");
    const untilIdx = yaml.indexOf("until:");
    const maxItIdx = yaml.indexOf("max_iterations:");
    const freshIdx = yaml.indexOf("fresh_context:");
    expect(promptIdx).toBeLessThan(untilIdx);
    expect(untilIdx).toBeLessThan(maxItIdx);
    expect(maxItIdx).toBeLessThan(freshIdx);
  });
});
