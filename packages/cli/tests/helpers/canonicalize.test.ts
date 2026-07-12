import { describe, it, expect } from "vitest";
import { canonicalize } from "./canonicalize.js";

describe("canonicalize", () => {
  it("is idempotent", () => {
    const yaml = `
name: test
description: |
  Line 1
  Line 2
nodes:
  - id: a
    command: foo
  - id: b
    depends_on: [a]
    command: bar
`;
    const first = canonicalize(yaml);
    const second = canonicalize(JSON.stringify(first));
    // Re-serializing as JSON then canonicalizing should yield equivalent
    // shape (JSON roundtrip erases YAML-specific style but preserves data)
    expect(first).toEqual(second);
  });

  it("strips trailing whitespace from multi-line strings", () => {
    const yaml = `
name: test
description: "Line 1 \\nLine 2  "
nodes:
  - id: a
    command: foo
`;
    const result = canonicalize(yaml) as { description: string };
    expect(result.description).not.toMatch(/ $/);
  });

  it("sorts depends_on arrays", () => {
    const yaml = `
name: test
nodes:
  - id: a
    command: foo
  - id: b
    command: bar
  - id: c
    depends_on: [b, a]
    command: baz
`;
    const result = canonicalize(yaml) as {
      nodes: Array<{ id: string; depends_on?: string[] }>;
    };
    const cNode = result.nodes.find((n) => n.id === "c")!;
    expect(cNode.depends_on).toEqual(["a", "b"]);
  });

  it("drops default provider: claude at root", () => {
    const yaml = `
name: test
provider: claude
nodes:
  - id: a
    command: foo
`;
    const result = canonicalize(yaml) as Record<string, unknown>;
    expect(result.provider).toBeUndefined();
  });

  it("preserves non-default provider at root", () => {
    const yaml = `
name: test
provider: codex
nodes:
  - id: a
    command: foo
`;
    const result = canonicalize(yaml) as { provider?: string };
    expect(result.provider).toBe("codex");
  });

  it("drops null/undefined values", () => {
    const yaml = `
name: test
description: null
nodes:
  - id: a
    command: foo
`;
    const result = canonicalize(yaml) as Record<string, unknown>;
    expect("description" in result).toBe(false);
  });

  it("normalizes leading/trailing blank lines in block scalars", () => {
    const yaml = `
name: test
description: |

  content
  more content

nodes:
  - id: a
    command: foo
`;
    const result = canonicalize(yaml) as { description: string };
    expect(result.description).toBe("content\nmore content");
  });
});
