import { stringify, Document, YAMLMap, YAMLSeq, Scalar } from "yaml";

// Archon workflow YAML emitter.
//
// Archon's YAML has a conventional field ordering per node:
//   id → depends_on → when → trigger_rule → context → model →
//   allowed_tools → denied_tools → (prompt|bash|command|loop) → output_format →
//   timeout → (other fields)
//
// And top-level:
//   name → description → provider → model → interactive → (other) → nodes
//
// Multi-line strings use block scalar form (`|`). The `yaml` lib handles this
// automatically when the string contains newlines — we just pass regular
// strings and it picks the right scalar style.

// ---- Ordering conventions ----

const TOP_FIELD_ORDER = [
  "name",
  "description",
  "provider",
  "model",
  "interactive",
  "env",
  "nodes",
];

const NODE_FIELD_ORDER = [
  "id",
  "depends_on",
  "when",
  "trigger_rule",
  "context",
  "model",
  "allowed_tools",
  "denied_tools",
  "skills",
  "mcp",
  "prompt",
  "bash",
  "command",
  "loop",
  "approval",
  "output_format",
  "timeout",
  "idle_timeout",
  "hooks",
];

const LOOP_FIELD_ORDER = [
  "prompt",
  "until",
  "until_bash",
  "max_iterations",
  "fresh_context",
  "interactive",
  "gate_message",
];

// ---- Public API ----

/**
 * Serialize an Archon workflow object to YAML. Applies Archon's conventional
 * field ordering and prefers block scalars for multi-line strings.
 */
export function emitArchonYaml(workflow: ArchonWorkflow): string {
  const topMap = buildMap(
    workflow as unknown as Record<string, unknown>,
    TOP_FIELD_ORDER,
  );

  // Replace the nodes sequence with ordered-per-node maps
  if (workflow.nodes && Array.isArray(workflow.nodes)) {
    const seq = new YAMLSeq();
    for (const node of workflow.nodes) {
      seq.add(
        buildMap(node as Record<string, unknown>, NODE_FIELD_ORDER, {
          loop: LOOP_FIELD_ORDER,
        }),
      );
    }
    topMap.set("nodes", seq);
  }

  const doc = new Document();
  doc.contents = topMap;

  return stringify(doc, {
    lineWidth: 0, // preserve long prompts on one line unless they have newlines
    minContentWidth: 0,
  });
}

// ---- Internals ----

/**
 * Build a YAMLMap with keys ordered by `order`, then any remaining keys
 * appended in declaration order. Values that are plain objects are
 * recursively converted. `nestedOrders` provides ordering for nested fields.
 */
function buildMap(
  obj: Record<string, unknown>,
  order: string[],
  nestedOrders: Record<string, string[]> = {},
): YAMLMap {
  const map = new YAMLMap();

  // Emit ordered keys first
  for (const key of order) {
    if (key in obj && obj[key] !== undefined && obj[key] !== null) {
      map.set(key, toNode(obj[key], nestedOrders[key]));
    }
  }

  // Then any remaining keys (passthrough) in declaration order
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (!order.includes(key)) {
      map.set(key, toNode(value, nestedOrders[key]));
    }
  }

  return map;
}

function toNode(value: unknown, nestedOrder?: string[]): unknown {
  // Preserve multi-line strings as block scalars
  if (typeof value === "string") {
    if (value.includes("\n")) {
      const scalar = new Scalar(value);
      scalar.type = Scalar.BLOCK_LITERAL;
      return scalar;
    }
    return value;
  }
  // Arrays: recurse into elements
  if (Array.isArray(value)) {
    return value.map((v) => toNode(v));
  }
  // Plain objects: build a map (with optional ordering)
  if (isPlainObject(value)) {
    if (nestedOrder) {
      return buildMap(value, nestedOrder);
    }
    // Unknown object: serialize keys in declaration order
    const m = new YAMLMap();
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === null) continue;
      m.set(k, toNode(v));
    }
    return m;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

// ---- Archon workflow shape (loose; emitter is data-driven) ----

export interface ArchonWorkflow {
  name: string;
  description?: string;
  provider?: string;
  model?: string;
  interactive?: boolean;
  nodes?: ArchonNode[];
  [key: string]: unknown;
}

export interface ArchonNode {
  id: string;
  depends_on?: string[];
  when?: string;
  trigger_rule?: string;
  context?: string;
  model?: string;
  allowed_tools?: string[];
  denied_tools?: string[];
  prompt?: string;
  bash?: string;
  command?: string;
  loop?: ArchonLoop;
  output_format?: Record<string, unknown>;
  timeout?: number | string;
  [key: string]: unknown;
}

export interface ArchonLoop {
  prompt?: string;
  until?: string;
  until_bash?: string;
  max_iterations?: number;
  fresh_context?: boolean;
  interactive?: boolean;
  gate_message?: string;
  [key: string]: unknown;
}
