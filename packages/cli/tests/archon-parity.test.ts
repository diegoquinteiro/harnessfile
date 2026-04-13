import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseHarnessfile } from "../src/parser/parse.js";
import { normalize } from "../src/ir/normalize.js";
import { validateHarnessfile } from "../src/validator/validate.js";
import { getCompileProvider } from "../src/providers/compile.js";
// Register archon/v1 compile provider via side-effect import
import "../src/providers/archon/index.js";
import { canonicalize } from "./helpers/canonicalize.js";
import expectedWarnings from "./fixtures/archon-parity.expected.json" with { type: "json" };

const FIXTURES = resolve(import.meta.dirname, "fixtures/archon");
const EXAMPLES = resolve(import.meta.dirname, "../../../examples/archon");

/**
 * The 20 default Archon workflows we must support. Kept in sync with
 * `.archon/workflows/defaults/` on the upstream repo (vendored in
 * tests/fixtures/archon/).
 *
 * A workflow becomes a parity test as soon as its harnessfile.yaml is
 * written in examples/archon/. Missing examples skip (rather than fail)
 * so the suite grows incrementally as examples are authored.
 */
const WORKFLOWS = [
  "adversarial-dev",
  "architect",
  "assist",
  "comprehensive-pr-review",
  "create-issue",
  "feature-development",
  "fix-github-issue",
  "idea-to-pr",
  "interactive-prd",
  "issue-review-full",
  "piv-loop",
  "plan-to-pr",
  "ralph-dag",
  "refactor-safely",
  "remotion-generate",
  "resolve-conflicts",
  "smart-pr-review",
  "test-loop-dag",
  "validate-pr",
  "workflow-builder",
];

type ExpectedMap = Record<string, string[]>;
const expected = expectedWarnings as ExpectedMap;

describe("Archon parity", () => {
  for (const name of WORKFLOWS) {
    const hasExample = tryReadExample(name) !== null;

    test.skipIf(!hasExample)(`${name} round-trips`, () => {
      const originalYaml = readFileSync(
        resolve(FIXTURES, `archon-${name}.yaml`),
        "utf-8",
      );
      const harnessYaml = tryReadExample(name)!;

      // Compile Harnessfile → Archon YAML
      const rawParsed = parseHarnessfile(
        resolve(EXAMPLES, `${name}.harnessfile.yaml`),
      );
      const ir = normalize(rawParsed as Record<string, unknown>);
      const validation = validateHarnessfile(ir);
      if (!validation.valid) {
        throw new Error(
          `Harnessfile ${name} failed validation:\n${validation.errors
            .map((e) => `  ${e.path}: ${e.message}`)
            .join("\n")}`,
        );
      }

      const provider = getCompileProvider("archon/v1");
      const result = provider.compile(ir);

      expect(result.files.length).toBe(1);
      const generatedYaml = result.files[0].content;

      // Structural comparison
      const originalCanon = canonicalize(originalYaml);
      const generatedCanon = canonicalize(generatedYaml);
      expect(generatedCanon).toEqual(originalCanon);

      // Warning expectations
      const expectedCodes = (expected[name] ?? []).slice().sort();
      const actualCodes = result.warnings.map((w) => w.code).sort();
      expect(actualCodes).toEqual(expectedCodes);
    });
  }
});

function tryReadExample(name: string): string | null {
  try {
    return readFileSync(
      resolve(EXAMPLES, `${name}.harnessfile.yaml`),
      "utf-8",
    );
  } catch {
    return null;
  }
}
