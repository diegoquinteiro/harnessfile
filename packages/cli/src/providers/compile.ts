import type { Harnessfile } from "../ir/types.js";

// ---- Compile provider contract ----
//
// A CompileProvider translates a Harnessfile IR into a target format without
// executing the harness itself. This is distinct from HarnessProvider (in
// interface.ts), which owns runtime execution (e.g., LangGraph).
//
// CompileProviders are code generators: they produce target-specific YAML,
// JSON, or source files, along with structured warnings for any Harnessfile
// construct that the target cannot represent losslessly.

export interface CompileProvider {
  /** Unique identifier, e.g., "archon/v1". */
  target: string;
  /** Human-readable name shown in CLI output. */
  displayName: string;
  /** Translate the IR into target artifacts. */
  compile(ir: Harnessfile): CompileResult;
}

export interface CompileResult {
  /** Emitted files. Each compile typically produces 1 file but the shape
   *  leaves room for multi-file targets. */
  files: CompileFile[];
  /** Structured warnings (info/warning/error) for provenance and CI gating. */
  warnings: Warning[];
}

export interface CompileFile {
  /** Suggested output filename (relative path). */
  path: string;
  /** File contents. */
  content: string;
}

export type WarningSeverity = "info" | "warning" | "error";

export interface Warning {
  severity: WarningSeverity;
  /** Stable machine-readable code, e.g., "model-not-mapped". */
  code: string;
  /** Human-readable description. */
  message: string;
  /** Optional IR path for context, e.g., "steps.classify.model". */
  path?: string;
  /** Optional remediation hint. */
  suggestion?: string;
}

// ---- Compile provider registry ----

const compileProviders = new Map<string, CompileProvider>();

export function registerCompileProvider(provider: CompileProvider): void {
  compileProviders.set(provider.target, provider);
}

export function getCompileProvider(target: string): CompileProvider {
  const provider = compileProviders.get(target);
  if (!provider) {
    const available = [...compileProviders.keys()].join(", ") || "(none)";
    throw new Error(
      `Unknown compile target '${target}'. Available targets: ${available}`,
    );
  }
  return provider;
}

export function listCompileProviders(): string[] {
  return [...compileProviders.keys()];
}
