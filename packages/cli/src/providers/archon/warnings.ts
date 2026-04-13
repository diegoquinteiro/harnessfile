import type { Warning, WarningSeverity } from "../compile.js";

// Catalog of warning codes produced by the Archon compile provider.
// Each constant is a stable identifier used by tests and by --strict mode
// to filter or escalate warnings.

export const WARNING_CODES = {
  /** A Harnessfile model ID had no entry in MODEL_MAP; passthrough assumed. */
  MODEL_NOT_MAPPED: "model-not-mapped",
  /** `agents.*.skills` declared — Archon does not consume agent-level skills. */
  SKILLS_NOT_SUPPORTED: "skills-not-supported",
  /** Step has `eval:` — Archon has no native metric-based retry loop. */
  EVAL_NOT_SUPPORTED: "eval-not-supported",
  /** Step type is `router` but has no structured output. */
  ROUTER_NEEDS_STRUCTURED_OUTPUT: "router-needs-structured-output",
  /** Step type is `orchestrator` — Archon has no dynamic agent pool construct. */
  ORCHESTRATOR_NOT_SUPPORTED: "orchestrator-not-supported",
  /** Step type is `trigger` — Archon does not represent triggers inline. */
  TRIGGER_NOT_TRANSLATED: "trigger-not-translated",
  /** Step type is `output` — Archon has no output node type. */
  OUTPUT_NOT_TRANSLATED: "output-not-translated",
  /** Top-level section (observability/memory/security/hooks/resilience) has
   *  no Archon equivalent; dropped on compile. */
  FEATURE_IGNORED: "feature-ignored",
  /** `wait-for: any-done` has no Archon equivalent; falls back to one_success. */
  WAIT_FOR_ANY_DONE_UNSUPPORTED: "wait-for-any-done-unsupported",
  /** A `max-iterations` field was declared without a matching `loop:` or
   *  `eval:` — Archon can't express standalone retry counts. */
  RETRY_AS_LOOP: "retry-as-loop",
} as const;

export type WarningCode = (typeof WARNING_CODES)[keyof typeof WARNING_CODES];

export function makeWarning(
  code: WarningCode,
  message: string,
  options: {
    severity?: WarningSeverity;
    path?: string;
    suggestion?: string;
  } = {},
): Warning {
  return {
    severity: options.severity ?? "warning",
    code,
    message,
    path: options.path,
    suggestion: options.suggestion,
  };
}

/** Shorthand for info-level warnings (non-issue, purely informational). */
export function makeInfo(
  code: WarningCode,
  message: string,
  options: { path?: string; suggestion?: string } = {},
): Warning {
  return makeWarning(code, message, { ...options, severity: "info" });
}

/** Shorthand for error-level warnings (compile cannot produce a faithful
 *  translation; output may be incomplete or incorrect). */
export function makeError(
  code: WarningCode,
  message: string,
  options: { path?: string; suggestion?: string } = {},
): Warning {
  return makeWarning(code, message, { ...options, severity: "error" });
}
