import type {
  Harnessfile,
  AgentDef,
  StepDef,
  StepType,
  EvalDef,
  RetryDef,
  HooksDef,
  HookEntry,
  ObservabilityDef,
  MemoryDef,
  SecurityDef,
  ResilienceDef,
  ToolRef,
  LoopDef,
} from "./types.js";

// Normalizes a raw parsed YAML object into a typed Harnessfile IR.
// Handles kebab-case → camelCase, default inference, and shorthand expansion.

// Top-level standard keys — anything else is preserved in raw for provider consumption.
const TOP_LEVEL_STANDARD_KEYS = new Set([
  "harnessfile",
  "name",
  "description",
  "provider",
  "model",
  "agents",
  "steps",
  "hooks",
  "observability",
  "memory",
  "security",
  "resilience",
]);

// Step-level standard keys — anything else goes into step.raw.
const STEP_STANDARD_KEYS = new Set([
  "type",
  "agent",
  "next",
  "depends-on",
  "depends_on",
  "dependson",
  "when",
  "wait-for",
  "waitfor",
  "prompt",
  "bash",
  "exec",
  "command",
  "loop",
  "model",
  "allowed-tools",
  "allowedtools",
  "allowed_tools",
  "denied-tools",
  "deniedtools",
  "denied_tools",
  "output-format",
  "output_format",
  "outputformat",
  "eval",
  "max-iterations",
  "max_iterations",
  "maxiterations",
  "context",
  "output",
  "timeout",
  "retry",
  "on-error",
  "onerror",
  "event",
  "filter",
  "approve",
  "channel",
  "fallback",
  "routes",
  "pool",
  "max-agents",
  "max_agents",
  "maxagents",
  "input",
  "provider",
  "hooks",
]);

// Loop-level standard keys.
const LOOP_STANDARD_KEYS = new Set([
  "prompt",
  "until",
  "until-bash",
  "until_bash",
  "max-iterations",
  "max_iterations",
  "fresh-context",
  "fresh_context",
  "interactive",
  "gate-message",
  "gate_message",
]);

export function normalize(raw: Record<string, unknown>): Harnessfile {
  const version = expectString(raw, "harnessfile", "harnessfile version");
  const name = optString(raw, "name");
  const description = optString(raw, "description");
  const provider = optString(raw, "provider");
  const model = optString(raw, "model");

  // v0.1 requires an agents map. v0.2 makes it optional — workflows that only
  // use inline prompt/bash/command/loop nodes don't need to predefine agents.
  let agents: Record<string, AgentDef> = {};
  const rawAgentsEntry = version === "0.1"
    ? expectObject(raw, "agents", "agents map")
    : optObject(raw, "agents");
  if (rawAgentsEntry) {
    for (const [key, value] of Object.entries(rawAgentsEntry)) {
      agents[key] = normalizeAgent(value, key);
    }
  }

  let steps: Record<string, StepDef> | undefined;
  const rawSteps = optObject(raw, "steps");
  if (rawSteps) {
    steps = {};
    for (const [key, value] of Object.entries(rawSteps)) {
      steps[key] = normalizeStep(value, key);
    }
  }

  // Collect unknown top-level fields into raw passthrough.
  const topRaw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!TOP_LEVEL_STANDARD_KEYS.has(key)) {
      topRaw[key] = value;
    }
  }

  return {
    version,
    name,
    description,
    provider,
    model,
    agents,
    steps,
    hooks: raw["hooks"] ? normalizeHooks(raw["hooks"]) : undefined,
    observability: raw["observability"]
      ? normalizeObservability(raw["observability"] as Record<string, unknown>)
      : undefined,
    memory: raw["memory"]
      ? normalizeMemory(raw["memory"] as Record<string, unknown>)
      : undefined,
    security: raw["security"]
      ? normalizeSecurity(raw["security"] as Record<string, unknown>)
      : undefined,
    resilience: raw["resilience"]
      ? normalizeResilience(raw["resilience"] as Record<string, unknown>)
      : undefined,
    raw: Object.keys(topRaw).length > 0 ? topRaw : undefined,
  };
}

// ---- Agents ----

function normalizeAgent(raw: unknown, name: string): AgentDef {
  const obj = asObject(raw, `agent '${name}'`);
  return {
    model: expectString(obj, "model", `agent '${name}' model`),
    instructions: expectString(
      obj,
      "instructions",
      `agent '${name}' instructions`,
    ),
    tools: obj["tools"] ? normalizeTools(obj["tools"] as unknown[]) : undefined,
    skills: obj["skills"] ? (obj["skills"] as string[]) : undefined,
  };
}

function normalizeTools(raw: unknown[]): ToolRef[] {
  return raw.map((t) => {
    const obj = t as Record<string, unknown>;
    return { mcp: obj["mcp"] as string };
  });
}

// ---- Steps ----

function normalizeStep(raw: unknown, name: string): StepDef {
  const obj = asObject(raw, `step '${name}'`);
  const type = inferStepType(obj);

  const step: StepDef = { type };

  if (obj["agent"] != null) step.agent = obj["agent"] as string;
  if (obj["next"] != null) step.next = obj["next"] as string | string[];

  // depends-on / depends_on — archon-native backward edges
  const depKey = firstKey(obj, ["depends-on", "depends_on", "dependsOn"]);
  if (depKey && obj[depKey] != null) {
    const val = obj[depKey];
    if (typeof val === "string") {
      step.dependsOn = [val];
    } else if (Array.isArray(val)) {
      step.dependsOn = val as string[];
    }
  }

  // when — opaque expression string
  if (obj["when"] != null) step.when = obj["when"] as string;

  // wait-for / trigger-rule — fan-in mode
  const waitKey = firstKey(obj, ["wait-for", "waitFor", "wait_for"]);
  if (waitKey && obj[waitKey] != null) {
    step.waitFor = obj[waitKey] as StepDef["waitFor"];
  } else if (obj["trigger-rule"] != null || obj["trigger_rule"] != null) {
    // trigger_rule is Archon's snake_case form — preserved in raw, see below
    // but also expose via waitFor for convenience
    const tr = (obj["trigger-rule"] ?? obj["trigger_rule"]) as string;
    if (tr === "one_success") step.waitFor = "any";
    else if (tr === "all_success") step.waitFor = "all";
    else if (tr === "all_done") step.waitFor = "all-done";
  }

  // Node execution modes
  if (obj["prompt"] != null) step.prompt = obj["prompt"] as string;
  if (obj["bash"] != null) step.bash = obj["bash"] as string;
  if (obj["exec"] != null) step.bash = obj["exec"] as string; // alias
  if (obj["command"] != null) step.command = obj["command"] as string;
  if (obj["loop"] != null) step.loop = normalizeLoop(obj["loop"]);

  // Per-step model override
  if (obj["model"] != null) step.model = obj["model"] as string;

  // Tool allow/deny
  const allowKey = firstKey(obj, [
    "allowed-tools",
    "allowed_tools",
    "allowedTools",
  ]);
  if (allowKey && obj[allowKey] != null) {
    step.allowedTools = obj[allowKey] as string[];
  }
  const denyKey = firstKey(obj, [
    "denied-tools",
    "denied_tools",
    "deniedTools",
  ]);
  if (denyKey && obj[denyKey] != null) {
    step.deniedTools = obj[denyKey] as string[];
  }

  // Output format (JSON Schema object or short-hand)
  const ofKey = firstKey(obj, ["output-format", "output_format", "outputFormat"]);
  if (ofKey && obj[ofKey] != null) {
    step.outputFormat = obj[ofKey] as Record<string, unknown>;
  }

  if (obj["context"] != null) step.context = obj["context"] as string;
  if (obj["output"] != null)
    step.output = obj["output"] as Record<string, unknown>;
  if (obj["timeout"] != null)
    step.timeout = obj["timeout"] as string | number;
  if (obj["on-error"] != null)
    step.onError = obj["on-error"] as "fail" | "skip" | "continue";
  if (obj["max-iterations"] != null)
    step.maxIterations = obj["max-iterations"] as number;
  if (obj["max_iterations"] != null && step.maxIterations == null)
    step.maxIterations = obj["max_iterations"] as number;

  // Retry shorthand
  if (obj["retry"] != null) step.retry = normalizeRetry(obj["retry"]);

  // Eval
  if (obj["eval"] != null)
    step.eval = (obj["eval"] as unknown[]).map(normalizeEval);

  // Trigger
  if (obj["event"] != null) step.event = obj["event"] as string;
  if (obj["filter"] != null) step.filter = obj["filter"] as string;

  // Gate
  if (obj["approve"] != null) step.approve = obj["approve"] as "human";
  if (obj["channel"] != null) step.channel = obj["channel"] as string;
  if (obj["fallback"] != null)
    step.fallback = obj["fallback"] as "reject" | "approve" | "escalate";

  // Router
  if (obj["routes"] != null)
    step.routes = obj["routes"] as Record<string, string>;

  // Orchestrator
  if (obj["pool"] != null) step.pool = obj["pool"] as string[];
  if (obj["max-agents"] != null) step.maxAgents = obj["max-agents"] as number;

  // Output step
  if (obj["input"] != null)
    step.input = obj["input"] as Record<string, string>;

  // Provider
  if (obj["provider"] != null) step.provider = obj["provider"] as string;

  // Per-step hooks
  // v0.1 hooks use lifecycle-event keys in kebab-case (on-start, before-step, ...)
  // Archon-native hooks use Claude Code format (PreToolUse, PostToolUse, ...)
  // — those are non-standard and flow through step.raw untouched.
  if (obj["hooks"] != null && isV01Hooks(obj["hooks"])) {
    step.hooks = normalizeHooks(obj["hooks"]);
  }

  // Collect passthrough: anything not in STEP_STANDARD_KEYS is preserved
  // verbatim for provider-specific consumption (Archon hooks, approval,
  // skills, mcp, idle_timeout, etc.).
  const stepRaw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!STEP_STANDARD_KEYS.has(key)) {
      stepRaw[key] = value;
    }
  }
  // Archon-style hooks (PreToolUse/PostToolUse) aren't v0.1 lifecycle hooks —
  // preserve them verbatim. v0.1 hooks consumed above are not re-added.
  if (obj["hooks"] != null && !isV01Hooks(obj["hooks"])) {
    stepRaw["hooks"] = obj["hooks"];
  }

  if (Object.keys(stepRaw).length > 0) {
    step.raw = stepRaw;
  }

  return step;
}

function inferStepType(obj: Record<string, unknown>): StepType {
  if (obj["type"] != null) return obj["type"] as StepType;
  if (obj["event"] != null) return "trigger";
  if (obj["approve"] != null) return "gate";
  if (obj["routes"] != null) return "router";
  if (obj["pool"] != null) return "orchestrator";
  if (obj["input"] != null && obj["agent"] == null) return "output";
  return "agent";
}

// ---- Loop ----

function normalizeLoop(raw: unknown): LoopDef {
  const obj = asObject(raw, "loop block");
  const loop: LoopDef = {};
  if (obj["prompt"] != null) loop.prompt = obj["prompt"] as string;
  if (obj["until"] != null) loop.until = obj["until"] as string;

  const untilBashKey = firstKey(obj, ["until-bash", "until_bash", "untilBash"]);
  if (untilBashKey && obj[untilBashKey] != null) {
    loop.untilBash = obj[untilBashKey] as string;
  }

  const maxItKey = firstKey(obj, [
    "max-iterations",
    "max_iterations",
    "maxIterations",
  ]);
  if (maxItKey && obj[maxItKey] != null) {
    loop.maxIterations = obj[maxItKey] as number;
  }

  const freshKey = firstKey(obj, [
    "fresh-context",
    "fresh_context",
    "freshContext",
  ]);
  if (freshKey && obj[freshKey] != null) {
    loop.freshContext = obj[freshKey] as boolean;
  }

  if (obj["interactive"] != null) loop.interactive = obj["interactive"] as boolean;

  const gmKey = firstKey(obj, ["gate-message", "gate_message", "gateMessage"]);
  if (gmKey && obj[gmKey] != null) {
    loop.gateMessage = obj[gmKey] as string;
  }

  // Passthrough
  const loopRaw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!LOOP_STANDARD_KEYS.has(key)) {
      loopRaw[key] = value;
    }
  }
  if (Object.keys(loopRaw).length > 0) {
    loop.raw = loopRaw;
  }

  return loop;
}

// ---- Eval ----

function normalizeEval(raw: unknown): EvalDef {
  const obj = raw as Record<string, unknown>;
  return {
    metric: obj["metric"] as string,
    type: (obj["type"] as EvalDef["type"]) ?? "code",
    pass: (obj["pass"] as EvalDef["pass"]) ?? true,
    aggregate: (obj["aggregate"] as EvalDef["aggregate"]) ?? "all",
    prompt: obj["prompt"] as string | undefined,
    dataset: obj["dataset"] as string | undefined,
    expected: obj["expected"] as string | undefined,
  };
}

// ---- Retry ----

function normalizeRetry(raw: unknown): RetryDef {
  if (typeof raw === "number") {
    return { max: raw, backoff: "none" };
  }
  const obj = raw as Record<string, unknown>;
  return {
    max: (obj["max"] as number) ?? 0,
    backoff: (obj["backoff"] as RetryDef["backoff"]) ?? "none",
  };
}

// ---- Hooks ----

const V01_HOOK_EVENT_KEYS = new Set([
  "on-start",
  "before-step",
  "after-step",
  "on-error",
  "on-gate-pending",
  "on-gate-resolved",
  "on-complete",
]);

function isV01Hooks(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length === 0) return false;
  // If every key is a known v0.1 lifecycle event, it's v0.1 hooks.
  return keys.every((k) => V01_HOOK_EVENT_KEYS.has(k));
}

function normalizeHooks(raw: unknown): HooksDef {
  const obj = raw as Record<string, unknown>;
  const hooks: HooksDef = {};
  if (obj["on-start"] != null)
    hooks.onStart = normalizeHookEntry(obj["on-start"]);
  if (obj["before-step"] != null)
    hooks.beforeStep = normalizeHookEntry(obj["before-step"]);
  if (obj["after-step"] != null)
    hooks.afterStep = normalizeHookEntry(obj["after-step"]);
  if (obj["on-error"] != null)
    hooks.onError = normalizeHookEntry(obj["on-error"]);
  if (obj["on-gate-pending"] != null)
    hooks.onGatePending = normalizeHookEntry(obj["on-gate-pending"]);
  if (obj["on-gate-resolved"] != null)
    hooks.onGateResolved = normalizeHookEntry(obj["on-gate-resolved"]);
  if (obj["on-complete"] != null)
    hooks.onComplete = normalizeHookEntry(obj["on-complete"]);
  return hooks;
}

function normalizeHookEntry(raw: unknown): HookEntry {
  if (typeof raw === "string") return raw;
  const obj = raw as Record<string, unknown>;
  return {
    run: obj["run"] as string,
    can: obj["can"] as Array<"abort" | "modify"> | undefined,
  };
}

// ---- Observability ----

function normalizeObservability(
  obj: Record<string, unknown>,
): ObservabilityDef {
  return {
    tracing: obj["tracing"] as string | undefined,
    metrics: obj["metrics"] as string | undefined,
    sampling: obj["sampling"] as number | undefined,
    level: obj["level"] as ObservabilityDef["level"] | undefined,
  };
}

// ---- Memory ----

function normalizeMemory(obj: Record<string, unknown>): MemoryDef {
  return {
    backend: obj["backend"] as string,
    scope: obj["scope"] as MemoryDef["scope"] | undefined,
    type: obj["type"] as MemoryDef["type"] | undefined,
    ttl: obj["ttl"] as string | undefined,
  };
}

// ---- Security ----

function normalizeSecurity(obj: Record<string, unknown>): SecurityDef {
  const sec: SecurityDef = {};
  if (obj["guardrails"]) {
    const g = obj["guardrails"] as Record<string, unknown>;
    sec.guardrails = {
      input: g["input"] as string[] | undefined,
      output: g["output"] as string[] | undefined,
      provider: g["provider"] as string | undefined,
    };
  }
  if (obj["budget"]) {
    const b = obj["budget"] as Record<string, unknown>;
    sec.budget = {
      maxTokens: b["max-tokens"] as number | undefined,
      maxCost: b["max-cost"] as string | undefined,
    };
  }
  if (obj["audit"]) {
    const a = obj["audit"] as Record<string, unknown>;
    sec.audit = {
      destination: a["destination"] as string | undefined,
      level: a["level"] as "actions" | "reasoning" | "full" | undefined,
    };
  }
  return sec;
}

// ---- Resilience ----

function normalizeResilience(obj: Record<string, unknown>): ResilienceDef {
  return {
    timeout: obj["timeout"] as string | undefined,
    checkpoint: obj["checkpoint"] as boolean | undefined,
  };
}

// ---- Helpers ----

function asObject(
  raw: unknown,
  label: string,
): Record<string, unknown> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Expected object for ${label}, got ${typeof raw}`);
  }
  return raw as Record<string, unknown>;
}

function expectString(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const val = obj[key];
  if (typeof val !== "string") {
    throw new Error(`${label} is required and must be a string`);
  }
  return val;
}

function optString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

function optObject(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const val = obj[key];
  if (val == null) return undefined;
  if (typeof val !== "object" || Array.isArray(val)) return undefined;
  return val as Record<string, unknown>;
}

function expectObject(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, unknown> {
  const val = obj[key];
  if (val == null || typeof val !== "object" || Array.isArray(val)) {
    throw new Error(`${label} is required and must be a mapping`);
  }
  return val as Record<string, unknown>;
}

function firstKey(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    if (k in obj) return k;
  }
  return undefined;
}
