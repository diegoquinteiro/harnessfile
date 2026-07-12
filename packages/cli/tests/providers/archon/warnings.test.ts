import { describe, it, expect } from "vitest";
import { parseHarnessfile } from "../../../src/parser/parse.js";
import { normalize } from "../../../src/ir/normalize.js";
import { getCompileProvider } from "../../../src/providers/compile.js";
import "../../../src/providers/archon/index.js";
import { WARNING_CODES } from "../../../src/providers/archon/warnings.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const provider = () => getCompileProvider("archon/v1");

function compileFromYaml(yaml: string) {
  const dir = join(tmpdir(), `hf-warnings-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "test.harnessfile.yaml");
  writeFileSync(file, yaml);
  const raw = parseHarnessfile(file);
  const ir = normalize(raw as Record<string, unknown>);
  return provider().compile(ir);
}

function codes(result: { warnings: { code: string }[] }): string[] {
  return result.warnings.map((w) => w.code).sort();
}

describe("archon warnings", () => {
  it("emits model-not-mapped for unknown model IDs", () => {
    const result = compileFromYaml(`
harnessfile: "0.2"
name: t
steps:
  a:
    command: foo
    model: openai/gpt-5
`);
    expect(codes(result)).toContain(WARNING_CODES.MODEL_NOT_MAPPED);
  });

  it("emits skills-not-supported for agent-level skills", () => {
    const result = compileFromYaml(`
harnessfile: "0.2"
name: t
agents:
  a:
    model: anthropic/claude-sonnet-4-6
    instructions: do stuff
    skills: [./skills/code.md]
steps:
  s:
    agent: a
`);
    expect(codes(result)).toContain(WARNING_CODES.SKILLS_NOT_SUPPORTED);
  });

  it("emits eval-not-supported when a step has eval metrics", () => {
    const result = compileFromYaml(`
harnessfile: "0.2"
name: t
agents:
  a:
    model: anthropic/claude-sonnet-4-6
    instructions: do stuff
steps:
  s:
    agent: a
    eval:
      - metric: tests-pass
`);
    expect(codes(result)).toContain(WARNING_CODES.EVAL_NOT_SUPPORTED);
  });

  it("emits feature-ignored for observability/memory/security/hooks", () => {
    const result = compileFromYaml(`
harnessfile: "0.2"
name: t
observability:
  tracing: langfuse/v1
memory:
  backend: postgres/v1
security:
  budget:
    max-tokens: 100000
hooks:
  on-error: slack:#alerts
steps:
  s:
    command: foo
`);
    expect(codes(result).filter((c) => c === WARNING_CODES.FEATURE_IGNORED).length).toBe(4);
  });

  it("emits wait-for-any-done-unsupported with fallback", () => {
    const result = compileFromYaml(`
harnessfile: "0.2"
name: t
steps:
  a:
    command: foo
  b:
    command: bar
  c:
    command: baz
    depends_on: [a, b]
    wait-for: any-done
`);
    expect(codes(result)).toContain(WARNING_CODES.WAIT_FOR_ANY_DONE_UNSUPPORTED);
    // Should fall back to one_success in the emitted yaml
    const yaml = result.files[0].content;
    expect(yaml).toContain("trigger_rule: one_success");
  });

  it("emits orchestrator-not-supported (error severity)", () => {
    const result = compileFromYaml(`
harnessfile: "0.2"
name: t
agents:
  a:
    model: anthropic/claude-sonnet-4-6
    instructions: do
steps:
  s:
    type: orchestrator
    agent: a
    pool: [a]
`);
    expect(codes(result)).toContain(WARNING_CODES.ORCHESTRATOR_NOT_SUPPORTED);
    const err = result.warnings.find(
      (w) => w.code === WARNING_CODES.ORCHESTRATOR_NOT_SUPPORTED,
    );
    expect(err?.severity).toBe("error");
  });

  it("produces zero warnings for a minimal workflow", () => {
    const result = compileFromYaml(`
harnessfile: "0.2"
name: t
steps:
  s:
    command: foo
`);
    expect(result.warnings).toEqual([]);
  });
});
