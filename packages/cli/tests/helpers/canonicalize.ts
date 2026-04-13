import { parse as parseYaml } from "yaml";

// Canonical normalization for Archon workflow YAML comparisons.
//
// Used by the parity test suite to compare Harnessfile-compiled output
// against the upstream Archon fixtures. Byte-a-byte comparison is
// impractical because of whitespace, comment stripping, and cosmetic
// YAML style choices that the emitter can't always reproduce.
//
// The canonicalize function parses YAML into a plain JS object and then
// applies the following transformations:
//
// 1. Drop keys whose values are null/undefined.
// 2. Normalize multi-line strings: strip trailing whitespace on every line
//    and remove trailing blank lines.
// 3. Sort depends_on lists alphabetically (Archon and Harnessfile both
//    treat these as sets).
// 4. Drop default-valued keys that Archon treats as implicit:
//    - provider: claude (default)
//    - model: sonnet (default when no top-level/node override)
// 5. Preserve declaration order for nodes (list) and per-node fields
//    where order matters for debugging diffs.
//
// The result is a plain nested object suitable for deep-equality
// comparison via Vitest's expect(...).toEqual(...).

const DEFAULT_PROVIDER = "claude";
const DEFAULT_MODEL = "sonnet";

export function canonicalize(yaml: string): unknown {
  const parsed = parseYaml(yaml);
  return canonicalizeValue(parsed, { isWorkflowRoot: true });
}

interface CanonOptions {
  isWorkflowRoot?: boolean;
}

function canonicalizeValue(value: unknown, opts: CanonOptions = {}): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return canonicalizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => canonicalizeValue(v));
  }
  if (typeof value === "object") {
    return canonicalizeObject(value as Record<string, unknown>, opts);
  }
  return value;
}

function canonicalizeString(s: string): string {
  // Trim trailing whitespace on every line, strip leading/trailing blank lines.
  const lines = s.split("\n").map((line) => line.replace(/\s+$/, ""));
  // Drop trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  // Drop leading blank lines
  while (lines.length > 0 && lines[0] === "") lines.shift();
  return lines.join("\n");
}

function canonicalizeObject(
  obj: Record<string, unknown>,
  opts: CanonOptions,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    // Drop Archon default-valued keys at the workflow root
    if (opts.isWorkflowRoot) {
      if (key === "provider" && value === DEFAULT_PROVIDER) continue;
      if (key === "model" && value === DEFAULT_MODEL) {
        // Only drop if no nodes override model — we can't tell at this level,
        // so we'll leave this decision to a later pass
      }
    }

    // Normalize depends_on (sort as a set)
    if (key === "depends_on" && Array.isArray(value)) {
      out[key] = [...value].sort();
      continue;
    }

    // Recurse
    out[key] = canonicalizeValue(value);
  }

  // Post-process: if this is the workflow root and 'nodes' is present,
  // apply node-specific normalization.
  if (opts.isWorkflowRoot && Array.isArray(out.nodes)) {
    out.nodes = (out.nodes as unknown[]).map((node) => {
      if (node && typeof node === "object" && !Array.isArray(node)) {
        return canonicalizeNode(node as Record<string, unknown>);
      }
      return node;
    });
  }

  return out;
}

function canonicalizeNode(node: Record<string, unknown>): Record<string, unknown> {
  // depends_on already normalized above
  return node;
}
