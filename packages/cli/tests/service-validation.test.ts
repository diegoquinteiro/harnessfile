import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { normalize } from "../src/ir/normalize.js";
import { validateHarnessfile } from "../src/validator/validate.js";
import { parseProject } from "../../../ui/src/lib/parse.js";
import { dumpHarness } from "../../../ui/src/lib/serialize.js";
import { validate as validateUI } from "../../../ui/src/lib/validate.js";

const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../schema/harness-0.2.schema.json"), "utf8"));
const schemaValid = new Ajv2020({ strict: false }).compile(schema);
const agent = "---\nname: engineer\ndescription: Implements tasks.\n---\nImplement the task.\n";
const minimal = { harnessfile: "0.2", name: "composition" };

function cliValid(doc: Record<string, unknown>): boolean {
  try {
    return validateHarnessfile(normalize({ ...doc, agents: { engineer: {
      name: "engineer", description: "Implements tasks.", instructions: "Implement the task.",
    } } })).valid;
  } catch { return false; }
}
function uiValid(doc: Record<string, unknown>): boolean {
  return !validateUI(parseProject({ "harness.yaml": JSON.stringify(doc), "agents/engineer.md": agent }))
    .some((problem) => problem.severity === "error");
}

describe("service binding validation parity", () => {
  it("materializes only the documented defaults", () => {
    const ir = normalize(minimal);
    expect(ir.orchestration).toEqual(schema.properties.orchestration.default);
    expect(ir.execution).toEqual(schema.properties.execution.default);
    expect(ir.identity).toEqual(schema.properties.identity.default);
    expect(ir.projectManagement).toBeUndefined();
    expect(ir.taskMemory).toBeUndefined();
    expect(schema.properties["task-memory"].default).toBeUndefined();
    expect(schema.properties["project-management"].default).toBeUndefined();
  });
  for (const field of ["orchestration", "execution", "project-management", "task-memory", "identity"]) {
    for (const binding of [
      { provider: "team/service/v2" },
      { provider: { type: "custom/v1", region: "example", accounts: { engineer: "bot" } }, "x-note": [1, 2] },
    ]) {
      it(`accepts ${field} ${JSON.stringify(binding)} in schema, CLI, and UI`, () => {
        const doc = { ...minimal, [field]: binding };
        expect(schemaValid(doc), JSON.stringify(schemaValid.errors)).toBe(true);
        expect(cliValid(doc)).toBe(true);
        expect(uiValid(doc)).toBe(true);
      });
    }
    for (const binding of [
      null, false, "local/v1", [], {}, { provider: null }, { provider: [] },
      { provider: "local" }, { provider: "team/service/v1/extra" }, { provider: "Local/v1" },
      { provider: {} }, { provider: { type: "" } }, { provider: { type: 1 } },
      { provider: { type: "not/versioned" } }, { provider: "local/v1", config: {} },
    ]) {
      it(`rejects ${field} ${JSON.stringify(binding)} in schema, CLI, and UI`, () => {
        const doc = { ...minimal, [field]: binding };
        expect(schemaValid(doc)).toBe(false);
        expect(cliValid(doc)).toBe(false);
        expect(uiValid(doc)).toBe(false);
      });
    }
  }
  for (const engine of ["langgraph-stateless/v1", { type: "langgraph-stateless/v1" }]) {
    it(`requires task-memory for stateless orchestration ${JSON.stringify(engine)}`, () => {
      const missing = { ...minimal, orchestration: { provider: engine }, memory: { backend: "sqlite/v1" } };
      expect(schemaValid(missing)).toBe(false);
      expect(cliValid(missing)).toBe(false);
      expect(uiValid(missing)).toBe(false);
      const bound = { ...missing, "task-memory": { provider: "team/durable/v1" } };
      expect(schemaValid(bound), JSON.stringify(schemaValid.errors)).toBe(true);
      expect(cliValid(bound)).toBe(true);
      expect(uiValid(bound)).toBe(true);
      expect(normalize(bound).taskMemory).toEqual(bound["task-memory"]);
    });
  }
  it("preserves provider configuration and extensions through normalization and editor serialization", () => {
    const doc = { ...minimal,
      execution: { provider: { type: "daytona/v1", repository: "https://github.com/example/project.git", envSecrets: { TOKEN: "WORKER_TOKEN" } }, "x-policy": { concurrency: 2 } },
      "project-management": { provider: { type: "github/v1", repository: "example/project" } },
      "task-memory": { provider: { type: "gitlab/v1", project: "example/state" }, "x-retention": "30d" },
    };
    const ir = normalize(doc);
    expect(ir.execution).toEqual(doc.execution);
    expect(ir.projectManagement).toEqual(doc["project-management"]);
    expect(ir.taskMemory).toEqual(doc["task-memory"]);
    const parsed = parseProject({ "harness.yaml": JSON.stringify(doc), "agents/engineer.md": agent });
    const roundtrip = parseProject({ "harness.yaml": dumpHarness(parsed.harness!), "agents/engineer.md": agent });
    expect(roundtrip.harness).toEqual(doc);
    expect(validateUI(roundtrip)).toEqual([]);
  });
});
